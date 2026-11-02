"""Fill the reviewer demo account with study material, for the Claude directory review.

The account gets three courses (BIO 101, HIST 210, CHEM 120), two study sets in each, two recorded
lectures with transcripts and "Watch for" points, flashcards due today, a missed question it was
sure of, and two weeks of study history. All of it is written for the demo (scripts/demo_content.py):
no real student data.

Configured with environment variables; nothing secret is in this file:
    DEMO_EMAIL       the demo account's email (required)
    DEMO_PASSWORD    only to create the account when it doesn't exist yet
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  as for the backend (already set on Fly)

Shows what it would do and writes nothing unless --apply is given. Safe to run again: it replaces
only what it made before. It refuses an account that holds anything it didn't make (--force overrides).
On Fly:
    fly ssh console -C "env DEMO_EMAIL=you+demo@example.com python scripts/seed_demo_account.py"
    fly ssh console -C "env DEMO_EMAIL=you+demo@example.com python scripts/seed_demo_account.py --apply"
"""

import argparse
import os
import sys
from datetime import date, datetime, time, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import get_supabase  # noqa: E402
from demo_content import COURSES, LECTURES, STUDY_SETS  # noqa: E402

MARK = "demo:"


def outline_text(outline: list) -> str:
    """The Outline page's text format: "> overview", "## Heading", "- point"."""
    lines = []
    for heading, points in outline:
        lines.append(heading)
        lines.extend(f"- {point}" for point in points)
    return "\n".join(lines)


def guide_row(user_id: str, folder_id: str, item: dict, today: date) -> dict:
    pairs = item["pairs"]
    cards = [{"front": front, "back": back} for front, back in pairs]
    # Half the cards are due today (two never seen, two missed yesterday); the rest come back later.
    schedule = {}
    for index in range(len(cards)):
        if index in (2, 3):
            schedule[str(index)] = {"box": 0, "due": (today - timedelta(days=1)).isoformat()}
        elif index >= 4:
            schedule[str(index)] = {"box": 2, "due": (today + timedelta(days=index - 2)).isoformat()}
    questions = [{"question": q, "options": options, "correct_index": correct, "type": "mc"} for q, options, correct in item["quiz"]]
    return {
        "user_id": user_id,
        "folder_id": folder_id,
        "title": item["title"],
        "notes": outline_text(item["outline"]),
        "study_guide": "\n".join(f"Q{n}: {q}\nA{n}: {a}" for n, (q, a) in enumerate(pairs, 1)),
        "flashcards": cards,
        "quiz_questions": questions,
        "flashcard_progress": {
            "known": [i for i in range(4, len(cards))], "unknown": [2, 3], "schedule": schedule,
            "last_studied": datetime.combine(today - timedelta(days=1), time(19, 0), timezone.utc).isoformat(),
            # Learn: the first idea is being learned and was missed while sure, so it comes first.
            "learn": {"levels": {"0": {"l": 1, "at": (today - timedelta(days=1)).isoformat(), "q": _fingerprint(questions[0]["question"]), "sure": True},
                                 "1": {"l": 2, "at": (today - timedelta(days=3)).isoformat(), "q": _fingerprint(questions[1]["question"])}},
                      "test_date": None},
        },
        "source_type": "text",
        "external_source_id": MARK + item["slug"],
    }


def _fingerprint(question: str) -> str:
    """lib/learnEngine.mjs fingerprint."""
    import re
    return re.sub(r"[^a-z0-9]+", " ", question.lower()).strip()[:48]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write the demo content")
    parser.add_argument("--force", action="store_true", help="seed even though the account holds other study sets")
    args = parser.parse_args()
    email = os.getenv("DEMO_EMAIL", "").strip().lower()
    if not email:
        sys.exit("Set DEMO_EMAIL to the demo account's email.")
    db = get_supabase()

    user_id = find_user(db, email)
    if not user_id:
        password = os.getenv("DEMO_PASSWORD", "")
        if not password:
            sys.exit(f"No account for {email}. Create it in Supabase (Authentication > Users), or set DEMO_PASSWORD to create it here.")
        if not args.apply:
            print(f"Would create the account {email}.")
            return
        user_id = db.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user.id
        print(f"Created {email}.")

    others = [g for g in db.table("study_guides").select("id,external_source_id").eq("user_id", user_id).execute().data or []
              if not str(g.get("external_source_id") or "").startswith(MARK)]
    if others and not args.force:
        sys.exit(f"{email} already has {len(others)} study sets this script didn't make. Use the demo account only, or pass --force.")

    today = datetime.now(timezone.utc).date()
    print(f"Demo account {email} ({user_id}): {len(STUDY_SETS)} study sets, {len(LECTURES)} lectures, 14 days of history in {', '.join(COURSES.values())}.")
    if not args.apply:
        print("Nothing written. Run again with --apply.")
        return

    folders = ensure_folders(db, user_id)
    guides = {}
    for item in STUDY_SETS:
        row = guide_row(user_id, folders[item["course"]], item, today)
        saved = db.table("study_guides").upsert(row, on_conflict="user_id,external_source_id").execute().data[0]
        guides[item["slug"]] = saved["id"]

    # A question missed while sure: Study now puts it first.
    respiration = next(item for item in STUDY_SETS if item["slug"] == "bio-cellular-respiration")
    question, options, correct = respiration["quiz"][2]
    db.table("retain_misses").upsert({"user_id": user_id, "guide_id": guides["bio-cellular-respiration"],
                                      "items": [{"question": question, "answer": options[correct], "sure": True}],
                                      "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="user_id,guide_id").execute()

    seed_lectures(db, user_id, folders, today)
    seed_history(db, user_id, guides, today)
    print("Done. Sign in as the demo account to check: Library, a lecture, Study now and Progress.")


def find_user(db, email: str):
    page = 1
    while True:
        users = db.auth.admin.list_users(page=page, per_page=200)
        for user in users:
            if (user.email or "").lower() == email:
                return user.id
        if len(users) < 200:
            return None
        page += 1


def ensure_folders(db, user_id: str) -> dict:
    """The three courses, by name: the ones already there (from the demo classes) or new ones."""
    existing = {row["name"]: row["id"] for row in db.table("folders").select("id,name").eq("user_id", user_id).execute().data or []}
    folders = {}
    for key, name in COURSES.items():
        if name not in existing:
            existing[name] = db.table("folders").insert({"user_id": user_id, "name": name}).execute().data[0]["id"]
        folders[key] = existing[name]
    return folders


def seed_lectures(db, user_id: str, folders: dict, today: date) -> None:
    """Replaces the lectures this script made before (their to-dos go with them)."""
    for row in db.table("lectures").select("id,analysis").eq("user_id", user_id).execute().data or []:
        if str((row.get("analysis") or {}).get("demo") or "").startswith(MARK):
            db.table("lectures").delete().eq("id", row["id"]).eq("user_id", user_id).execute()
    for lecture in LECTURES:
        segments = [{"start_ms": start, "text": text} for start, text in lecture["segments"]]
        on = today - timedelta(days=lecture["days_ago"])
        saved = db.table("lectures").insert({
            "user_id": user_id, "folder_id": folders[lecture["course"]], "title": lecture["title"], "source": "recording",
            "lecture_date": on.isoformat(), "duration_ms": lecture["duration_ms"],
            "transcript": " ".join(text for _, text in lecture["segments"]), "segments": segments,
            "analysis": {**lecture["analysis"], "analyzed": True, "demo": MARK + lecture["slug"],
                         "todos": [{k: v for k, v in todo.items() if k != "days_ahead"} for todo in lecture["todos"]]},
        }).execute().data[0]
        for todo in lecture["todos"]:
            due = datetime.combine(on + timedelta(days=todo["days_ahead"]), time(23, 59), timezone.utc)
            db.table("lecture_todos").insert({
                "user_id": user_id, "lecture_id": saved["id"], "title": todo["title"], "kind": todo["kind"], "due_at": due.isoformat(),
                "said": todo["said"], "quote": todo["quote"], "at_ms": todo["at_ms"], "status": "confirmed",
            }).execute()


def seed_history(db, user_id: str, guides: dict, today: date) -> None:
    """Two weeks of studying: sessions, quiz scores, the daily log and a streak. Replaces earlier demo history."""
    ids = list(guides.values())
    db.table("study_sessions").delete().eq("user_id", user_id).in_("guide_id", ids).execute()
    db.table("quiz_attempts").delete().eq("user_id", user_id).in_("guide_id", ids).execute()
    plan = [  # (days ago, study set, kind, minutes, quiz right of 4)
        (13, "bio-cell-structure", "read", 25, None), (12, "bio-cell-structure", "quiz", 15, 2), (10, "hist-causes-wwi", "read", 30, None),
        (9, "hist-causes-wwi", "quiz", 12, 2), (8, "chem-periodic-trends", "flashcard", 20, None), (7, "chem-periodic-trends", "quiz", 15, 3),
        (5, "hist-versailles", "read", 22, None), (4, "bio-cellular-respiration", "flashcard", 18, None), (3, "hist-versailles", "quiz", 10, 3),
        (2, "chem-stoichiometry", "read", 25, None), (1, "bio-cellular-respiration", "quiz", 14, 2), (0, "bio-cell-structure", "flashcard", 12, None),
    ]
    days = {}
    for days_ago, slug, kind, minutes, right in plan:
        day = today - timedelta(days=days_ago)
        started = datetime.combine(day, time(18 + days_ago % 4, 15), timezone.utc)
        db.table("study_sessions").insert({
            "user_id": user_id, "guide_id": guides[slug], "session_type": kind, "duration_seconds": minutes * 60,
            "started_at": started.isoformat(), "ended_at": (started + timedelta(minutes=minutes)).isoformat(),
            "metadata": {"demo": True, **({"score": round(100 * right / 4), "total": 4, "correct": right} if right is not None else {})},
        }).execute()
        if right is not None:
            answers = [{"question_index": index, "is_correct": index < right, "credit": 1.0 if index < right else 0.0} for index in range(4)]
            db.table("quiz_attempts").insert({
                "user_id": user_id, "guide_id": guides[slug], "score": round(100 * right / 4), "total_questions": 4,
                "correct_answers": right, "answers": answers, "completed_at": (started + timedelta(minutes=minutes)).isoformat(),
            }).execute()
        entry = days.setdefault(day, {"minutes": 0, "cards": 0, "right_count": 0, "total": 0, "guides": {}})
        entry["minutes"] += minutes
        entry["cards"] += 4
        entry["right_count"] += right if right is not None else 3
        entry["total"] += 4
        guide_key = guides[slug][:8]
        entry["guides"][guide_key] = {"n": next(s["title"] for s in STUDY_SETS if s["slug"] == slug), "m": minutes, "k": ["quiz" if kind == "quiz" else "cards"]}
    for day, entry in days.items():
        db.table("study_days").upsert({"user_id": user_id, "day": day.isoformat(), **entry, "updated_at": datetime.now(timezone.utc).isoformat()},
                                      on_conflict="user_id,day").execute()
    db.table("user_streaks").upsert({"user_id": user_id, "current_streak": 6, "longest_streak": 6, "last_study_date": today.isoformat(),
                                     "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="user_id").execute()


if __name__ == "__main__":
    main()
