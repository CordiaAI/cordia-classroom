"""Backfill learning_events from saved quiz results (personalization plan step 0.5).

Quizzes finished before answer logging began kept each question's first-try result in
quiz_attempts.answers. This writes one learning_events row per such answer, with mode 'backfill',
so the history is there for the metrics and for seeding memory later. Nothing is invented:
- only quiz answers whose question is still in the guide's saved quiz (quiz_questions) are used,
  matched by position, so the idea's fingerprint is the real question's;
- the format comes from the stored type (mc -> choice, fill -> typed, written, matching -> pairs);
  answers saved before types existed were multiple choice;
- timings, confidence and choice counts weren't kept, so they stay empty;
- the time is the quiz's completed_at; same_day is worked out in UTC.
NCLEX attempts (their questions live elsewhere) and Leitner boxes or Learn levels (no per-answer
history) are not turned into events; Learn levels and boxes stay in study_guides.flashcard_progress
for seeding memory in Phase 2.

Shows what it would write and writes nothing unless --apply is given. It refuses to run twice:
if any 'backfill' rows exist it stops (delete them first to redo it).
On Fly:
    fly ssh console -C "python scripts/backfill_learning_events.py"
    fly ssh console -C "python scripts/backfill_learning_events.py --apply"
"""

import argparse
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.learning_events import DEFAULT_ARM, PARAMS_VERSION, fingerprint, item_id, same_day_flags  # noqa: E402

FORMATS = {"mc": "choice", "fill": "typed", "written": "written", "matching": "pairs"}
PAGE = 1000
CHUNK = 500


def _when(value):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _outcome(answer: dict) -> str:
    credit = answer.get("credit")
    if credit is None:
        credit = 1.0 if answer.get("is_correct") else 0.0
    if credit == 1:
        return "right"
    if credit == 0.5:
        return "partly"
    return "wrong"


def backfill_rows(attempts: list[dict], questions_by_guide: dict) -> tuple[list[dict], dict]:
    """attempts: quiz_attempts rows {user_id, guide_id, completed_at, answers}; questions_by_guide:
    guide_id -> the guide's saved quiz_questions. Returns (rows, skipped counts by reason)."""
    skipped = {"nclex": 0, "no_questions": 0, "question_gone": 0, "bad_row": 0}
    events = []
    for attempt in sorted(attempts, key=lambda a: str(a.get("completed_at") or "")):
        when = _when(attempt.get("completed_at"))
        answers = attempt.get("answers") if isinstance(attempt.get("answers"), list) else []
        if when is None or not attempt.get("user_id") or not attempt.get("guide_id"):
            skipped["bad_row"] += len(answers) or 1
            continue
        questions = questions_by_guide.get(attempt["guide_id"])
        for answer in answers:
            if not isinstance(answer, dict) or not isinstance(answer.get("question_index"), int):
                skipped["bad_row"] += 1
                continue
            if "selected_indices" in answer:
                skipped["nclex"] += 1
                continue
            if not isinstance(questions, list) or not questions:
                skipped["no_questions"] += 1
                continue
            index = answer["question_index"]
            question = questions[index] if 0 <= index < len(questions) and isinstance(questions[index], dict) else None
            print_ = fingerprint(question.get("question")) if question else ""
            if not print_:
                skipped["question_gone"] += 1
                continue
            events.append({
                "user_id": attempt["user_id"],
                "item_id": item_id(attempt["guide_id"], print_),
                "guide_id": attempt["guide_id"],
                "decision_id": None,
                "mode": "backfill",
                "format": FORMATS.get(answer.get("type"), "choice"),
                "outcome": _outcome(answer),
                "confidence": None,
                "first_key_ms": None,
                "submit_ms": None,
                "hidden_ms": 0,
                "rapid_guess": False,
                "answer_chars": None,
                "view_shown": None,
                "fsrs_rating": None,
                "arm": DEFAULT_ARM,
                "params_version": PARAMS_VERSION,
                "occurred_at": when,
            })
    # same_day per student, in UTC (the student's time zone wasn't kept with the quiz).
    by_user: dict[str, list[int]] = {}
    for position, event in enumerate(events):
        by_user.setdefault(event["user_id"], []).append(position)
    for positions in by_user.values():
        flags = same_day_flags([events[p] for p in positions], [], 0)
        for position, flag in zip(positions, flags):
            events[position]["same_day"] = flag
    for event in events:
        event["occurred_at"] = event["occurred_at"].isoformat()
    return events, skipped


def _all(query_for_page) -> list[dict]:
    rows, start = [], 0
    while True:
        page = query_for_page(start, start + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="write the rows (default: only show them)")
    args = parser.parse_args(argv)

    from database import get_supabase
    db = get_supabase()
    if db.table("learning_events").select("id").eq("mode", "backfill").limit(1).execute().data:
        print("Backfill rows already exist; nothing written. Delete them first to run it again.")
        return 1
    attempts = _all(lambda a, b: db.table("quiz_attempts").select("user_id, guide_id, completed_at, answers")
                    .order("completed_at").range(a, b))
    guide_ids = sorted({a["guide_id"] for a in attempts if a.get("guide_id")})
    questions = {}
    for start in range(0, len(guide_ids), 100):
        for row in db.table("study_guides").select("id, quiz_questions").in_("id", guide_ids[start:start + 100]).execute().data or []:
            questions[row["id"]] = row.get("quiz_questions")
    rows, skipped = backfill_rows(attempts, questions)
    students = len({row["user_id"] for row in rows})
    print(f"{len(attempts)} quiz attempts -> {len(rows)} answers for {students} students.")
    print("Skipped: " + ", ".join(f"{reason} {count}" for reason, count in skipped.items()))
    for row in rows[:3]:
        print("  e.g.", {key: row[key] for key in ("item_id", "format", "outcome", "same_day", "occurred_at")})
    if not args.apply:
        print("Dry run: nothing written. Run again with --apply to write these rows.")
        return 0
    for start in range(0, len(rows), CHUNK):
        db.table("learning_events").insert(rows[start:start + CHUNK]).execute()
    print(f"Wrote {len(rows)} rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
