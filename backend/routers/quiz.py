"""
Quiz router for CordiaClassroom.
Generates MCQ quizzes from study guide Q&A pairs and tracks attempts.
"""

import re
import json
import random
import logging
import threading
from fastapi import APIRouter, HTTPException, Header, Depends
from rate_limit import ai_rate_limit
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from database import get_supabase
from services.llm import explain_miss_briefly, get_openai_client, grade_written_answer, memory_hook
from services.llm_calls import chat
from services.models import current_user_id
from auth_utils import get_user_id
from ids import require_uuid
from services import retain
from services.choice_shapes import conform, is_value, repair, shape
from services.entitlements import LIMITS, plan_for, record, remaining, require, subscription_row


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quiz", tags=["quiz"])


class QuizAnswer(BaseModel):
    """A single quiz answer with validation."""
    question_index: int = Field(..., ge=0, le=100)
    selected_index: int = Field(..., ge=0, le=10)
    is_correct: bool = False


class RetainAttempt(BaseModel):
    """A first try at one idea; the server re-checks it against the saved question."""
    concept: int = Field(..., ge=0, le=100)
    type: Literal["mc", "written", "fill", "matching"]
    response: str = Field(default="", max_length=4000)
    credit: Optional[float] = None
    token: Optional[str] = Field(default=None, max_length=128)
    self_marked: bool = False  # a typed answer the student counted as right after seeing the answer


class QuizSubmission(BaseModel):
    answers: List[QuizAnswer] = Field(default_factory=list, max_length=50)
    attempts: List[RetainAttempt] = Field(default_factory=list, max_length=100)


class SessionRequest(BaseModel):
    types: List[Literal["mc", "written", "fill", "matching"]] = Field(default_factory=lambda: ["mc"], max_length=4)
    # How many questions to ask (picked at random); none asks every question. Order is always shuffled.
    count: Optional[int] = Field(default=None, ge=1, le=retain.MAX_QUIZ_QUESTIONS)


class WrittenAnswer(BaseModel):
    concept: int = Field(..., ge=0, le=100)
    answer: str = Field(..., min_length=1, max_length=4000)


class MissRequest(BaseModel):
    concept: int = Field(..., ge=0, le=100)
    chosen: str = Field(..., min_length=1, max_length=4000)


class RememberRequest(BaseModel):
    concept: int = Field(..., ge=0, le=100)
    previous: Optional[str] = Field(default=None, max_length=600)


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


# Abbreviations whose closing period stays (see choice_text).
_KEEP_PERIOD = {"etc", "vs", "inc", "jr", "sr", "dr", "st", "mr", "mrs", "ms", "no", "approx", "co", "ltd", "al"}


def choice_text(text) -> str:
    """One choice as shown: without a lone closing period. The correct answer is the guide's own
    sentence ("... in the mitochondria.") while wrong choices are written without one, so the period
    gave the answer away. Abbreviations ("etc.", "U.S.") and ellipses keep theirs. Mirrors
    web/lib/retainEngine.mjs choiceText; grading ignores periods either way."""
    value = str(text if text is not None else "").strip()
    if not value.endswith(".") or value.endswith(".."):
        return value
    last = value[:-1].split()[-1] if value[:-1].split() else ""
    if "." in last or last.lower() in _KEEP_PERIOD:
        return value
    return value[:-1].rstrip()


def _choices(answer: str, distractors: list) -> tuple:
    """(options, correct_index): the answer and its distractors with matching endings, shuffled,
    dropping a distractor that becomes the answer once the period goes."""
    shown = choice_text(answer)
    rest, seen = [], {shown.casefold()}
    for value in distractors:
        value = choice_text(value)
        if value and value.casefold() not in seen:
            seen.add(value.casefold())
            rest.append(value)
    options = [shown, *rest]
    random.shuffle(options)
    return options, options.index(shown)


def even_choices(question: dict) -> dict:
    """A saved question with its choices' endings matched (quizzes saved before this kept them),
    and, when the answer is a year, date or amount, every wrong choice written the same way
    (choice_shapes.repair; the right answer and its position never change)."""
    options = question.get("options")
    if not isinstance(options, list):
        return question
    shown = [choice_text(option) for option in options]
    return {**question, "options": repair(question.get("question") or "", shown, question.get("correct_index"))}


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


def _not_longest(answer: str, chosen: list, pool: list) -> list:
    """Keep the correct answer from being the visibly longest option.

    If no chosen distractor is at least 90% of the answer's length, swap the shortest one for
    the closest-length pool value that is (when the pool has one)."""
    if not chosen or any(len(str(value)) >= 0.9 * len(answer) for value in chosen):
        return chosen
    taken = {str(value).casefold() for value in chosen} | {answer.casefold()}
    longer = sorted((str(value).strip() for value in pool if len(str(value).strip()) >= 0.9 * len(answer) and str(value).strip().casefold() not in taken),
                    key=lambda value: len(value) - len(answer))
    if not longer:
        return chosen
    shortest = min(range(len(chosen)), key=lambda i: len(str(chosen[i])))
    return [longer[0] if i == shortest else value for i, value in enumerate(chosen)]


def _same_kind(answer: str, values: list) -> list:
    kind = shape(answer).kind
    return [value for value in values if shape(value).kind == kind]


def _standard_questions(qa_pairs: list) -> list:
    """Build an instant free Retain quiz from answers already in the guide. Wrong choices look like
    the answer: a date gets dates in its style (made up nearby when the guide has too few), and a
    short term gets short terms before longer answers (services/choice_shapes.py)."""
    questions = []
    for index, pair in enumerate(qa_pairs):
        answer = pair["answer"]
        candidates = _other_answers(qa_pairs, index)
        if is_value(answer):
            distractors = conform(answer, [], candidates, seed=pair["question"])
        else:
            same = _same_kind(answer, candidates)
            shortlist = same[:min(6, len(same))]
            picked = conform(answer, random.sample(shortlist, min(3, len(shortlist))), candidates, seed=pair["question"])
            distractors = _not_longest(answer, picked, same or [c for c in candidates if not is_value(c)])
        if not distractors:
            continue
        options, correct_index = _choices(answer, distractors)
        questions.append({
            "question": pair["question"],
            "options": options,
            "correct_index": correct_index,
        })
    return questions


def _balanced_distractors(answer: str, generated: list, fallback: list, seed: str = "") -> list:
    """Prefer distinct model choices close to the correct answer's visible length, in the answer's
    format: a year, date or amount only ever gets the same kind of value written the same way
    (off-format model choices are rewritten or replaced), and text prefers text of its own kind."""
    if is_value(answer):
        return conform(answer, generated, fallback, seed=seed or answer)
    generated = [str(value) for value in generated]
    same_generated, same_fallback = _same_kind(answer, generated), _same_kind(answer, fallback)
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

    add(same_generated, enforce_length=True)
    add(same_fallback, enforce_length=True)
    add(sorted([*same_generated, *same_fallback], key=lambda value: abs(len(str(value)) - len(answer))))
    text = [value for value in [*generated, *fallback] if not is_value(value)]
    add(sorted(text, key=lambda value: abs(len(str(value)) - len(answer))))
    return _not_longest(answer, accepted[:3], [*same_generated, *same_fallback] or text)


def _save_quiz(supabase, guide_id: str, user_id: str, questions: list) -> None:
    """Attach the quiz to its guide so returning to Retain shows the same questions."""
    try:
        supabase.table("study_guides") \
            .update({"quiz_questions": questions}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()
    except Exception:
        logger.warning("Failed to cache quiz questions for guide %s", guide_id, exc_info=True)


def _guide_columns(supabase, guide_id: str, user_id: str, columns: str) -> dict:
    result = supabase.table("study_guides").select(columns).eq("id", guide_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Guide not found")
    return result.data[0]


def _quiz_for_guide(guide_id: str, authorization: str, regenerate: bool = False):
    """Load or generate a Retain quiz, optionally replacing saved distractors."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    return {"questions": _load_quiz(get_supabase(), guide_id, user_id, regenerate)[0]}


def _load_quiz(supabase, guide_id: str, user_id: str, regenerate: bool = False) -> tuple:
    """(questions, saved): the guide's Retain quiz, built on first use. saved is False only
    when the questions are an unsaved fallback, so the next visit retries the AI distractors."""
    # A quiz is generated once, then stays attached to its guide until the user regenerates it.
    # Read the small question set first; the guide text is only needed to build one.
    if not regenerate:
        cached = _guide_columns(supabase, guide_id, user_id, "quiz_questions").get("quiz_questions")
        if cached:
            return [even_choices(q) if isinstance(q, dict) else q for q in cached], True

    study_guide_text = _guide_columns(supabase, guide_id, user_id, "study_guide").get("study_guide", "")
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
        return questions, True

    require(user_id, "ai_quiz")
    client = get_openai_client()

    qa_text = "\n".join(f"Q: {p['question']}\nA: {p['answer']}" for p in qa_pairs)

    prompt = f"""For each Q&A pair below, generate exactly 3 plausible but WRONG answer choices.
Return a JSON object {{"items": [...]}} with one element per Q&A pair, in order, where each element has:
- "distractors": [wrong1, wrong2, wrong3]

CRITICAL RULES — follow every one:
1. Match the correct answer's grammatical form, specificity, format, and approximate visible length. When the answer is a date, year, number, percentage, or amount, every distractor is the same kind of value written in exactly the same format (for "July 4, 1776": "June 21, 1788", never "1788" or "the late 1700s"; for "45%": "30%", never "about half"). Keep every distractor within ±20% of the correct answer's character count. The correct answer must NEVER stand out as the longest, most detailed, or only precisely worded option.
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
            seed=pair["question"],
        )
        if not distractors:
            continue
        options, correct_index = _choices(correct_answer, distractors)
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

    # A guide's first quiz is charged once, even if the save-time warm-up and a first Learn race.
    record(user_id, "ai_quiz", None if regenerate else f"first:{guide_id}")
    return questions, bool(distractors_list)


def prewarm_quiz(guide_id: str, user_id: str) -> None:
    """Build a just-saved guide's Retain quiz so the first Learn opens instantly.

    Only for accounts with more AI quizzes than the free monthly preview: a free student keeps
    that one AI quiz for the guide they choose to study (their first Learn builds it, as before).
    """
    current_user_id.set(user_id)  # usage rows name the student, as in a request
    try:
        if remaining(user_id, "ai_quiz") <= LIMITS["free"]["ai_quiz"]:
            return
        _load_quiz(get_supabase(), guide_id, user_id)
    except Exception:
        # The first Learn simply builds it instead.
        logger.warning("Quiz warm-up failed for guide %s", guide_id, exc_info=True)


def start_quiz_warmup(guide: Optional[dict], user_id: str) -> None:
    """After a guide with Q&A is saved, build its quiz on a background thread (never delays the save)."""
    guide = guide or {}
    if guide.get("id") and _parse_qa_pairs(guide.get("study_guide") or ""):
        threading.Thread(target=prewarm_quiz, args=(guide["id"], user_id), daemon=True).start()


@router.post("/{guide_id}/regenerate", dependencies=[Depends(ai_rate_limit())])
def regenerate_quiz(guide_id: str, authorization: str = Header(default="")):
    """Replace the current distractors using the user's plan rules."""
    return _quiz_for_guide(guide_id, authorization, regenerate=True)


def _saved_questions(supabase, guide_id: str, user_id: str) -> list:
    result = supabase.table("study_guides").select("quiz_questions") \
        .eq("id", guide_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Guide not found")
    questions = result.data[0].get("quiz_questions")
    if not isinstance(questions, list) or not questions:
        raise HTTPException(status_code=409, detail="Start Retain again to load this guide's questions")
    return questions


@router.post("/{guide_id}/session", dependencies=[Depends(ai_rate_limit())])
def start_session(guide_id: str, body: SessionRequest, authorization: str = Header(default="")):
    """The questions plus which format asks each idea, from the types the student turned on."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    questions, saved = _load_quiz(supabase, guide_id, user_id)
    if not saved:
        # Answers are checked against the saved questions, so a session always starts from them.
        _save_quiz(supabase, guide_id, user_id, questions)
    # A random set of the size the student chose, asked in random order. Only those questions count
    # toward Pro types and the score (submit divides by the questions answered).
    cards = retain.shuffled_cards(retain.plan_session(questions, body.types, retain.pick_questions(questions, body.count)))
    uses_pro_types = any(card["type"] in retain.PRO_TYPES for card in cards)
    if uses_pro_types:
        require(user_id, "retain_types")
        record(user_id, "retain_types")
    return {
        "questions": questions,
        "cards": cards,
        "types": sorted({card["type"] for card in cards}),
        "pro": plan_for(subscription_row(user_id)) == "pro",
    }


@router.post("/{guide_id}/grade", dependencies=[Depends(ai_rate_limit(max_calls=30))])
def grade_written(guide_id: str, body: WrittenAnswer, authorization: str = Header(default="")):
    """Mark one written answer with full, partial or no credit, signed so the score can be trusted."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    questions = _saved_questions(get_supabase(), guide_id, user_id)
    if body.concept >= len(questions):
        raise HTTPException(status_code=400, detail="Unknown question")
    question = questions[body.concept]
    require(user_id, "light")
    result = grade_written_answer(question.get("question", ""), retain.concept_answer(question), body.answer.strip())
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not check this answer right now. Please try again.")
    record(user_id, "light")
    credit = result["credit"]
    return {
        "credit": credit,
        "explanation": result["explanation"],
        "answer": retain.concept_answer(question),
        "token": retain.sign_grade(user_id, guide_id, body.concept, credit),
    }


@router.post("/{guide_id}/why", dependencies=[Depends(ai_rate_limit(max_calls=30))])
def explain_miss(guide_id: str, body: MissRequest, authorization: str = Header(default="")):
    """Feedback under a missed question: why the answer is right and why the choice was not."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    questions = _saved_questions(supabase, guide_id, user_id)
    if body.concept >= len(questions):
        raise HTTPException(status_code=400, detail="Unknown question")
    question = questions[body.concept]
    correct = retain.concept_answer(question)
    # The guide's own answer to this question, when the quiz wording matches it.
    guide = supabase.table("study_guides").select("study_guide").eq("id", guide_id).eq("user_id", user_id).execute()
    pairs = _parse_qa_pairs(((guide.data or [{}])[0].get("study_guide")) or "")
    passage = next((pair["answer"] for pair in pairs if pair["question"].strip() == str(question.get("question") or "").strip()), "")
    require(user_id, "light")
    result = explain_miss_briefly(question.get("question", ""), correct, body.chosen.strip(), passage)
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not explain this one right now.")
    record(user_id, "light")
    return result


def _memory_preferences(supabase, user_id: str) -> tuple:
    """The student's newest memory_style and interests answers (About-you screen), or defaults."""
    style, interests = "link", []
    try:
        rows = (supabase.table("onboarding_answers").select("question_id, answer, answered_at")
                .eq("user_id", user_id).in_("question_id", ["memory_style", "interests"])
                .order("answered_at", desc=True).limit(20).execute()).data or []
    except Exception:
        logger.warning("Memory preferences unavailable", exc_info=True)
        return style, interests
    seen = set()
    for row in rows:
        question_id, answer = row.get("question_id"), row.get("answer") or {}
        if question_id in seen:
            continue
        seen.add(question_id)
        value = answer.get("value") if isinstance(answer, dict) else None
        if question_id == "memory_style" and isinstance(value, str):
            style = value
        elif question_id == "interests" and isinstance(value, list):
            interests = [str(item) for item in value[:3]]
    return style, interests


@router.post("/{guide_id}/remember", dependencies=[Depends(ai_rate_limit(max_calls=30))])
def help_me_remember(guide_id: str, body: RememberRequest, authorization: str = Header(default="")):
    """A memory hook for a missed question, in the student's style ("Help me remember")."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    questions = _saved_questions(supabase, guide_id, user_id)
    if body.concept >= len(questions):
        raise HTTPException(status_code=400, detail="Unknown question")
    question = questions[body.concept]
    style, interests = _memory_preferences(supabase, user_id)
    require(user_id, "light")
    result = memory_hook(question.get("question", ""), retain.concept_answer(question), style, interests,
                         (body.previous or "").strip())
    if not result:
        raise HTTPException(status_code=502, detail="Cordia couldn't come up with one right now. Try again.")
    record(user_id, "light")
    return result


def _checked_attempts(supabase, guide_id: str, user_id: str, attempts: list) -> list:
    """First try per idea, re-checked on the server; returns the stored answer records."""
    questions = _saved_questions(supabase, guide_id, user_id)
    checked, seen = [], set()
    for attempt in attempts:
        if attempt.concept in seen or attempt.concept >= len(questions):
            continue
        seen.add(attempt.concept)
        credit = retain.first_try_credit(questions[attempt.concept], attempt.model_dump(), user_id, guide_id)
        checked.append({
            "question_index": attempt.concept,
            "type": attempt.type,
            "credit": credit,
            "is_correct": credit == 1.0,
        })
    return checked


@router.post("/{guide_id}/submit")
def submit_quiz(guide_id: str, submission: QuizSubmission, authorization: str = Header(default="")):
    """Save a finished session. The score is first-try credit; practice after a miss never lowers it."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    if submission.attempts:
        answers = _checked_attempts(supabase, guide_id, user_id, submission.attempts)
    else:  # sessions started before question types shipped
        answers = [a.model_dump() for a in submission.answers]
    total = len(answers)
    if total == 0:
        raise HTTPException(status_code=400, detail="No answers submitted")
    correct = sum(1 for a in answers if a["is_correct"])
    earned = sum(a.get("credit", 1.0 if a["is_correct"] else 0.0) for a in answers)
    score = round((earned / total) * 100)

    supabase.table("quiz_attempts").insert({
        "user_id": user_id,
        "guide_id": guide_id,
        "score": score,
        "total_questions": total,
        "correct_answers": correct,
        "answers": answers,
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

    return {"score": score, "total": total, "correct": correct, "earned": earned}


@router.get("/{guide_id}/history")
def quiz_history(guide_id: str, authorization: str = Header(default="")):
    """Get quiz attempt history for a guide."""
    require_uuid(guide_id, "guide ID")
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
