"""Study insights from a student's own results, with study tips tied to learning research.

Everything here is deterministic: it reads what the student already answered (quiz and
Retain rounds, Practice sets) and study sessions, so it costs no AI calls. Question kinds
are read from the question wording, so they work for any subject.
"""

import re
from datetime import datetime, timedelta, timezone

MIN_PER_KIND = 2  # never call something a strength or a weak spot from one question

KIND_LABELS = {
    "terms": "Definitions and key terms",
    "why": "“Why” questions",
    "process": "Steps and processes",
    "apply": "Applying ideas to new situations",
    "compare": "Comparing ideas",
    "calculate": "Calculations and word problems",
    "facts": "Key facts",
}

# Plain-language tips, each tied to the research it comes from.
KIND_TIPS = {
    "terms": ("Before rereading, quiz yourself on terms from memory. Flashcards work well for this.",
              "Retrieval practice (Roediger & Karpicke, 2006)"),
    "why": ("After each fact, ask yourself “why is this true?” and answer in one sentence.",
            "Elaborative interrogation (Dunlosky et al., 2013)"),
    "process": ("Write the steps out from memory, then explain each step out loud in your own words.",
                "Self-explanation (Chi et al., 1994)"),
    "apply": ("Study one worked example closely, then try a similar problem on your own.",
              "Worked examples (Sweller & Cooper, 1985)"),
    "compare": ("Study similar topics side by side in one session and note how they differ.",
                "Interleaving (Rohrer & Taylor, 2007)"),
    "calculate": ("Do a few mixed problems each day instead of many of one type at once.",
                  "Spacing and interleaving (Rohrer & Taylor, 2007)"),
    "facts": ("Test yourself on the facts before looking at your notes again.",
              "Retrieval practice (Roediger & Karpicke, 2006)"),
}

SPACING_TIP = ("Spread your studying over more days. Short sessions on different days stick better than one long one.",
               "Spacing (Cepeda et al., 2006)")
TESTING_TIP = ("You reread more than you test yourself. Quizzing yourself builds memory faster than rereading.",
               "Testing effect (Karpicke & Blunt, 2011)")

PRACTICE_KINDS = {
    "calculation": "calculate", "word_problem": "calculate",
    "scenario": "apply", "code": "apply", "debugging": "apply", "design": "apply", "analysis": "apply",
    "explanation": "why",
}

_KIND_PATTERNS = [
    ("compare", r"\b(differ|difference|compare|comparison|contrast|distinguish|versus|vs\.?)\b"),
    ("why", r"^\s*why\b|\bwhat (causes|caused)\b|\breason\b|\bexplain why\b"),
    ("process", r"^\s*how (does|do|is|are|did)\b|\bsteps?\b|\bsequence\b|\bprocess\b|\border of\b|\bstages?\b"),
    ("calculate", r"\b(calculate|compute|solve|how many|how much|what is the value|estimate)\b|\d+\s*[-+*/x×÷=]\s*\d+"),
    ("apply", r"\b(scenario|example of|which would|what would|if a|suppose|a patient|a company|a student|apply)\b"),
    ("terms", r"^\s*(what (is|are|does)|define|which term|what term|who (is|was))\b|\bmeans?\b|\bdefinition\b"),
]


def question_kind(text: str) -> str:
    wording = (text or "").strip().lower()
    for kind, pattern in _KIND_PATTERNS:
        if re.search(pattern, wording):
            return kind
    return "facts"


def practice_results(practice_state) -> list:
    """(kind, correct) for every Practice problem that was actually graded."""
    if not isinstance(practice_state, dict):
        return []
    problems = practice_state.get("problems") or []
    progress = practice_state.get("progress") or {}
    evaluations = progress.get("evaluations") or {}
    revealed = progress.get("revealed") or {}
    results = []
    for key, evaluation in evaluations.items():
        # A failed grading request also shows "retry"; only a revealed answer was really graded.
        if not isinstance(evaluation, dict) or not revealed.get(key):
            continue
        try:
            problem = problems[int(key)]
        except (ValueError, IndexError, TypeError):
            continue
        kind = PRACTICE_KINDS.get(str(problem.get("practice_type") or ""), question_kind(problem.get("prompt")))
        results.append((kind, evaluation.get("status") == "correct"))
    return results


def quiz_results(attempt: dict, questions) -> list:
    """(kind, correct) for each answered question of one quiz or Retain round."""
    if not isinstance(questions, list):
        return []
    results = []
    for answer in attempt.get("answers") or []:
        if not isinstance(answer, dict):
            continue
        index = answer.get("question_index")
        if isinstance(index, int) and 0 <= index < len(questions) and isinstance(questions[index], dict):
            results.append((question_kind(questions[index].get("question")), bool(answer.get("is_correct"))))
    return results


def _habit_tips(sessions: list, now: datetime) -> list:
    recent = []
    for session in sessions:
        try:
            started = datetime.fromisoformat(str(session.get("started_at")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if now - started <= timedelta(days=14):
            recent.append((started.date(), session.get("session_type")))
    tips = []
    if len(recent) >= 3 and len({day for day, _ in recent}) <= 2:
        tips.append(SPACING_TIP)
    reading = sum(1 for _, kind in recent if kind == "read")
    testing = sum(1 for _, kind in recent if kind in ("quiz", "flashcard"))
    if reading >= 3 and reading > 2 * testing:
        tips.append(TESTING_TIP)
    return tips


def build_insights(results: list, sessions: list, now=None) -> dict:
    """What the student is strongest at, what needs work, and research-backed tips."""
    now = now or datetime.now(timezone.utc)
    by_kind = {}
    for kind, correct in results:
        total, right = by_kind.get(kind, (0, 0))
        by_kind[kind] = (total + 1, right + int(bool(correct)))

    rows = [
        {"kind": kind, "label": KIND_LABELS[kind], "correct": right, "total": total, "accuracy": round(100 * right / total)}
        for kind, (total, right) in by_kind.items() if total >= MIN_PER_KIND
    ]
    strengths = sorted((row for row in rows if row["accuracy"] >= 75), key=lambda row: (-row["accuracy"], -row["total"]))
    needs_work = sorted((row for row in rows if row["accuracy"] < 60), key=lambda row: (row["accuracy"], -row["total"]))

    tips = [KIND_TIPS[row["kind"]] for row in needs_work[:2]] + _habit_tips(sessions, now)
    return {
        "answered": len(results),
        "strengths": strengths[:3],
        "needs_work": needs_work[:3],
        "tips": [{"text": text, "source": source} for text, source in tips[:3]],
    }
