"""
Quiz router for CordiaClassroom.
Generates MCQ quizzes from study guide Q&A pairs and tracks attempts.
"""

import re
import json
import random
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import List
from database import get_supabase
from services.llm import get_openai_client
from services.llm_calls import chat
from auth_utils import get_user_id
from services.entitlements import record, remaining, require

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quiz", tags=["quiz"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


class QuizAnswer(BaseModel):
    """A single quiz answer with validation."""
    question_index: int = Field(..., ge=0, le=100)
    selected_index: int = Field(..., ge=0, le=10)
    is_correct: bool = False


class QuizSubmission(BaseModel):
    answers: List[QuizAnswer] = Field(..., max_length=50)


def _parse_qa_pairs(text: str) -> list:
    """Parse Question 1: ... Answer 1: ... format into list of {question, answer}."""
    pairs = []
    lines = text.split('\n')
    current_q = None
    for line in lines:
        line = line.strip()
        q_match = re.match(r'^Q(\d+):\s*(.+)', line)
        a_match = re.match(r'^A(\d+):\s*(.+)', line)
        if q_match:
            current_q = q_match.group(2).strip()
        elif a_match and current_q:
            pairs.append({"question": current_q, "answer": a_match.group(2).strip()})
            current_q = None
    return pairs


def _other_answers(qa_pairs: list, index: int) -> list:
    """Return distinct guide answers, closest in length to the correct answer."""
    answer = qa_pairs[index]["answer"]
    seen = {answer.casefold()}
    candidates = []
    for candidate in qa_pairs:
        value = candidate["answer"].strip()
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            candidates.append(value)
    return sorted(candidates, key=lambda value: abs(len(value) - len(answer)))


def _standard_questions(qa_pairs: list) -> list:
    """Build an instant free Retain quiz from answers already in the guide."""
    questions = []
    for index, pair in enumerate(qa_pairs):
        answer = pair["answer"]
        candidates = _other_answers(qa_pairs, index)
        shortlist = candidates[:min(6, len(candidates))]
        distractors = random.sample(shortlist, min(3, len(shortlist)))
        if not distractors:
            continue
        options = [answer, *distractors]
        random.shuffle(options)
        questions.append({
            "question": pair["question"],
            "options": options,
            "correct_index": options.index(answer),
        })
    return questions


def _balanced_distractors(answer: str, generated: list, fallback: list) -> list:
    """Prefer distinct model choices close to the correct answer's visible length."""
    lower = max(1, round(len(answer) * 0.65))
    upper = max(lower, round(len(answer) * 1.35))
    seen = {answer.casefold()}
    accepted = []

    def add(values, enforce_length=False):
        for raw in values:
            value = str(raw).strip()
            key = value.casefold()
            if not value or key in seen:
                continue
            if enforce_length and not lower <= len(value) <= upper:
                continue
            seen.add(key)
            accepted.append(value)
            if len(accepted) == 3:
                return

    add(generated, enforce_length=True)
    add(fallback, enforce_length=True)
    add(sorted([*generated, *fallback], key=lambda value: abs(len(str(value)) - len(answer))))
    return accepted[:3]


def _save_quiz(supabase, guide_id: str, user_id: str, questions: list) -> None:
    """Attach the quiz to its guide so returning to Retain shows the same questions."""
    try:
        supabase.table("study_guides") \
            .update({"quiz_questions": questions}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()
    except Exception as cache_err:
        logger.warning(f"Failed to cache quiz questions for guide {guide_id}: {cache_err}")


def _quiz_for_guide(guide_id: str, authorization: str, regenerate: bool = False):
    """Load or generate a Retain quiz, optionally replacing saved distractors."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("study_guides") \
            .select("study_guide, quiz_questions") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Guide not found")


        # A quiz is generated once, then stays attached to its guide until the user regenerates it.
        cached = result.data[0].get("quiz_questions")
        if cached and not regenerate:
            return {"questions": cached}

        study_guide_text = result.data[0].get("study_guide", "")
        if not study_guide_text:
            raise HTTPException(status_code=400, detail="No study guide content to generate quiz from")

        qa_pairs = _parse_qa_pairs(study_guide_text)
        if not qa_pairs:
            raise HTTPException(status_code=400, detail="No Q&A pairs found in study guide")

        qa_pairs = qa_pairs[:50]

        # AI distractors are a Pro feature; free accounts get one AI quiz a month as a
        # preview, then guide-derived options. An explicit regenerate at 0 opens the upgrade.
        use_ai = remaining(user_id, "ai_quiz") > 0
        if not use_ai and regenerate:
            require(user_id, "ai_quiz")
        if not use_ai:
            questions = _standard_questions(qa_pairs)
            if not questions:
                raise HTTPException(
                    status_code=400,
                    detail="At least two distinct study-guide answers are needed for Retain",
                )
            _save_quiz(supabase, guide_id, user_id, questions)
            return {"questions": questions}

        require(user_id, "ai_quiz")
        client = get_openai_client()
        if not client:
            raise HTTPException(status_code=500, detail="AI service unavailable")

        qa_text = "\n".join(f"Q: {p['question']}\nA: {p['answer']}" for p in qa_pairs)

        prompt = f"""For each Q&A pair below, generate exactly 3 plausible but WRONG answer choices.
Return a JSON object {{"items": [...]}} with one element per Q&A pair, in order, where each element has:
- "distractors": [wrong1, wrong2, wrong3]

CRITICAL RULES — follow every one:
1. Match the correct answer's grammatical form, specificity, and approximate visible length. Keep every distractor within ±20% of the correct answer's character count. The correct answer must NEVER stand out as the longest, most detailed, or only precisely worded option.
2. Give the three distractors different incorrect logic: use an incorrect mechanism or relationship; incorrect terminology, value, actor, direction, or sequence; and an answer missing or altering one essential factor. When appropriate, adapt an answer from another supplied question if it remains plausible for this question.
3. Make each distractor tempting to a student with an incomplete understanding, while keeping it unambiguously false for the question. Do not create three paraphrases of the same mistake.
4. Never use "None of the above", "All of the above", "Both A and B", or any placeholder/filler text.
5. Ground every distractor in the same domain/topic as the correct answer — no random facts from unrelated subjects.

{qa_text}

Return ONLY the JSON object, no other text:"""

        response = chat(client, "quiz_distractors",
            messages=[
                {"role": "system", "content": "Generate quiz distractors. Return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
            response_format={"type": "json_object"},
        )

        # JSON mode keeps escaping valid (e.g. LaTeX backslashes in math guides).
        # If the AI reply is still unusable, fall back to guide-derived options instead of failing.
        try:
            distractors_list = json.loads(response.choices[0].message.content or "{}").get("items", [])
        except (json.JSONDecodeError, AttributeError):
            logger.warning(f"Unusable distractor JSON for guide {guide_id}; using guide-derived options")
            distractors_list = []
        if not isinstance(distractors_list, list):
            distractors_list = []

        questions = []
        for i, pair in enumerate(qa_pairs):
            correct_answer = pair["answer"]
            item = distractors_list[i] if i < len(distractors_list) and isinstance(distractors_list[i], dict) else {}
            generated = item.get("distractors", [])
            if not isinstance(generated, list):
                generated = []
            distractors = _balanced_distractors(
                correct_answer,
                generated,
                _other_answers(qa_pairs, i),
            )
            if not distractors:
                continue
            options = [correct_answer, *distractors]
            random.shuffle(options)
            correct_index = options.index(correct_answer)
            questions.append({
                "question": pair["question"],
                "options": options,
                "correct_index": correct_index
            })

        if not questions:
            raise HTTPException(status_code=502, detail="Could not create balanced Retain options")

        # Never cache the fallback, so the next visit retries the AI distractors.
        if distractors_list:
            _save_quiz(supabase, guide_id, user_id, questions)

        record(user_id, "ai_quiz")
        return {"questions": questions}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating quiz: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate quiz")


@router.get("/{guide_id}/generate")
def generate_quiz(guide_id: str, authorization: str = Header(default="")):
    """Load the saved Pro Retain quiz or build an instant free quiz."""
    return _quiz_for_guide(guide_id, authorization)


@router.post("/{guide_id}/regenerate")
def regenerate_quiz(guide_id: str, authorization: str = Header(default="")):
    """Replace the current distractors using the user's plan rules."""
    return _quiz_for_guide(guide_id, authorization, regenerate=True)


@router.post("/{guide_id}/submit")
def submit_quiz(guide_id: str, submission: QuizSubmission, authorization: str = Header(default="")):
    """Submit quiz answers and save results."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        total = len(submission.answers)
        if total == 0:
            raise HTTPException(status_code=400, detail="No answers submitted")
        correct = sum(1 for a in submission.answers if a.is_correct)
        score = round((correct / total) * 100)

        supabase.table("quiz_attempts").insert({
            "user_id": user_id,
            "guide_id": guide_id,
            "score": score,
            "total_questions": total,
            "correct_answers": correct,
            "answers": [a.model_dump() for a in submission.answers]
        }).execute()

        # Log study session
        supabase.table("study_sessions").insert({
            "user_id": user_id,
            "guide_id": guide_id,
            "session_type": "quiz",
            "duration_seconds": 0,
            "metadata": {"score": score, "total": total, "correct": correct}
        }).execute()

        # Update streak
        from routers.stats import _update_streak
        _update_streak(user_id)

        return {"score": score, "total": total, "correct": correct}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting quiz: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit quiz")


@router.get("/{guide_id}/history")
def quiz_history(guide_id: str, authorization: str = Header(default="")):
    """Get quiz attempt history for a guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("quiz_attempts") \
            .select("id, score, total_questions, correct_answers, completed_at") \
            .eq("user_id", user_id) \
            .eq("guide_id", guide_id) \
            .order("completed_at", desc=True) \
            .limit(10) \
            .execute()

        return {"attempts": result.data or []}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting quiz history: {e}")
        raise HTTPException(status_code=500, detail="Failed to get quiz history")
