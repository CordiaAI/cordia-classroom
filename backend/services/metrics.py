"""Activation and return metrics for the personalization plan (step 0.4), admin only.

Definitions (docs/research/09-onboarding-retention.md, "Metrics"):
- Recall activation: within 24 hours of signing up, the student (a) made a guide, (b) answered at
  least 3 recall-format questions and (c) saved an exam date.
- D1 / D7 return: any study activity on day 1 (24-48 h after signup) / within days 6-8.

Recall formats are typed, free fill-in and written answers (docs/research/01 rule 4, research 08's
grade mapping, brief section 5.1). Flashcard flips, multiple choice, matching and word-bank fill-ins
are recognition: they count as study activity for D1/D7 but not as recall answers. A correct answer
the student marked "Guess" is not a recall win either (owner decision G1); a wrong one still counts
as an answer given.

Exam date: until onboarding stores the answer with a time (plan step 1.2), "saved an exam date" is
any of the student's guides having a Learn test date when the report runs. That over-counts slightly
(a date saved after the first day still counts); the report says so.

With ~40 signups a month every rate here is directional: each comes with a 95% Wilson interval.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

RECALL_FORMATS = frozenset({"typed", "fill_free", "written"})
ACTIVATION_WINDOW = timedelta(hours=24)
RECALL_ANSWERS_NEEDED = 3
DAY = timedelta(days=1)
PAGE = 1000


def _when(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def wilson(successes: int, total: int, z: float = 1.96) -> Optional[list[float]]:
    """95% interval for a rate; None when there is nobody to count."""
    if total <= 0:
        return None
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return [round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3)]


def _rate(successes: int, total: int) -> dict:
    return {"n": total, "yes": successes, "rate": round(successes / total, 3) if total else None,
            "interval": wilson(successes, total)}


def _counts_as_recall(answer: dict) -> bool:
    if answer.get("format") not in RECALL_FORMATS or answer.get("mode") == "backfill":
        return False
    return not (answer.get("confidence") == "guess" and answer.get("outcome") in ("right", "partly"))


def user_outcomes(signed_up: datetime, guides: Iterable[dict], answers: Iterable[dict],
                  activity: Iterable[datetime], now: datetime) -> dict:
    """One student's activation and returns. guides: {created_at, test_date}; answers:
    {occurred_at, format, mode, outcome, confidence}; activity: times of any study (answers and sessions)."""
    window_end = signed_up + ACTIVATION_WINDOW
    guides = list(guides)
    made_guide = any((t := _when(g.get("created_at"))) and signed_up <= t < window_end for g in guides)
    recall = sum(1 for a in answers
                 if _counts_as_recall(a) and (t := _when(a.get("occurred_at"))) and signed_up <= t < window_end)
    exam_date = any(g.get("test_date") for g in guides)
    days = {int((t - signed_up) / DAY) for t in activity if t is not None and t >= signed_up}
    return {
        "activated": made_guide and recall >= RECALL_ANSWERS_NEEDED and exam_date,
        "made_guide": made_guide,
        "recall_answers": recall,
        "exam_date": exam_date,
        # Only students whose day 1 / days 6-8 are over can count either way.
        "d1": (1 in days) if now >= signed_up + 2 * DAY else None,
        "d7": bool(days & {6, 7, 8}) if now >= signed_up + 9 * DAY else None,
    }


def activation_report(users: list[dict], guides: list[dict], answers: list[dict], sessions: list[dict],
                      now: datetime, arms: Optional[dict] = None) -> dict:
    """users: {id, created_at}; guides: {user_id, created_at, test_date}; answers: {user_id,
    occurred_at, format, mode}; sessions: {user_id, started_at}; arms: user_id -> experiment arm."""
    by_user = defaultdict(lambda: {"guides": [], "answers": [], "activity": []})
    for g in guides:
        by_user[g["user_id"]]["guides"].append(g)
    for a in answers:
        by_user[a["user_id"]]["answers"].append(a)
        by_user[a["user_id"]]["activity"].append(_when(a.get("occurred_at")))
    for s in sessions:
        by_user[s["user_id"]]["activity"].append(_when(s.get("started_at")))

    groups: dict[str, list[dict]] = defaultdict(list)
    everyone = []
    for user in users:
        signed_up = _when(user.get("created_at"))
        if signed_up is None:
            continue
        data = by_user[user["id"]]
        result = user_outcomes(signed_up, data["guides"], data["answers"], data["activity"], now)
        week = (signed_up - timedelta(days=signed_up.weekday())).date().isoformat()
        result["week"] = week
        result["arm"] = (arms or {}).get(user["id"])
        everyone.append(result)
        groups[week].append(result)

    def summary(rows: list[dict]) -> dict:
        d1 = [r["d1"] for r in rows if r["d1"] is not None]
        d7 = [r["d7"] for r in rows if r["d7"] is not None]
        return {
            "signups": len(rows),
            "activation": _rate(sum(r["activated"] for r in rows), len(rows)),
            "made_guide": _rate(sum(r["made_guide"] for r in rows), len(rows)),
            "three_recall_answers": _rate(sum(r["recall_answers"] >= RECALL_ANSWERS_NEEDED for r in rows), len(rows)),
            "exam_date": _rate(sum(r["exam_date"] for r in rows), len(rows)),
            "d1_return": _rate(sum(d1), len(d1)),
            "d7_return": _rate(sum(d7), len(d7)),
        }

    by_arm = defaultdict(list)
    for r in everyone:
        if r["arm"]:
            by_arm[r["arm"]].append(r)
    return {
        "overall": summary(everyone),
        "by_week": [{"week": week, **summary(rows)} for week, rows in sorted(groups.items())],
        "by_arm": {arm: summary(rows) for arm, rows in sorted(by_arm.items())},
        "notes": [
            "Directional only: small samples, so read the intervals, not the point rates.",
            "Exam date counts any guide with a Learn test date, saved at any time (onboarding answers will add the time).",
            "Recall answers: typed, free fill-in and written, not counting correct guesses; flashcards, choice, matching and word-bank fill-ins are recognition.",
        ],
    }


def _all(query_for_page) -> list[dict]:
    rows, start = [], 0
    while True:
        page = query_for_page(start, start + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def _signups(db, since: datetime) -> list[dict]:
    users, page = [], 1
    while True:
        batch = db.auth.admin.list_users(page=page, per_page=PAGE)
        batch = batch if isinstance(batch, list) else getattr(batch, "users", []) or []
        for user in batch:
            created = _when(getattr(user, "created_at", None) or (user.get("created_at") if isinstance(user, dict) else None))
            user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
            if created and created >= since and user_id:
                users.append({"id": str(user_id), "created_at": created})
        if len(batch) < PAGE:
            return users
        page += 1


def load_activation(db, days: int = 30, now: Optional[datetime] = None) -> dict:
    """Reads the last `days` days of signups and their first weeks, then builds the report."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    users = _signups(db, since)
    ids = [u["id"] for u in users]
    if not ids:
        return activation_report([], [], [], [], now)
    guides, answers, sessions = [], [], []
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        guides += _all(lambda a, b: db.table("study_guides")
                       .select("user_id, created_at, test_date:flashcard_progress->learn->>test_date")
                       .in_("user_id", chunk).range(a, b))
        answers += _all(lambda a, b: db.table("learning_events").select("user_id, occurred_at, format, mode, outcome, confidence")
                        .in_("user_id", chunk).gte("occurred_at", since.isoformat()).range(a, b))
        sessions += _all(lambda a, b: db.table("study_sessions").select("user_id, started_at")
                         .in_("user_id", chunk).gte("started_at", since.isoformat()).range(a, b))
    from services.experiments import arms_by_user
    arms = arms_by_user(db)
    return activation_report(users, guides, answers, sessions, now, arms)
