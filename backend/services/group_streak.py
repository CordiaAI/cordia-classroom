"""A classroom's group streak (social plan, Stage 10).

A day counts when at least half the classroom's active members studied that day (rounded up: 3 of 5,
2 of 4). "Studied" means at least one active minute in Cordia that day, on anything (the owner's
choice; study_sessions, never browsing). Days are the classroom owner's local days
(user_profiles.timezone, else UTC). Today joins the streak once it's reached; until then the streak
is the run of days up to yesterday, and `today` says how many have studied and how many it needs.
Only counts are shown: never who studied.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from services.leaderboard import EFFORT_KINDS, _zone

LOOKBACK_DAYS = 120


def needed(members: int) -> int:
    return (members + 1) // 2


def streak(db, room: dict, now: Optional[datetime] = None) -> dict:
    members = [m["user_id"] for m in db.table("classroom_members").select("user_id").eq("classroom_id", room["id"])
               .eq("status", "active").execute().data or []]
    zone_name = None
    try:
        owner = (db.table("user_profiles").select("timezone").eq("id", room["owner_id"]).limit(1).execute().data or [{}])[0]
        zone_name = owner.get("timezone")
    except Exception:
        pass
    zone = _zone(zone_name)
    now = (now or datetime.now(timezone.utc)).astimezone(zone)
    today = now.date()
    if not members:
        return {"streak": 0, "today": {"studied": 0, "members": 0, "needed": 0, "counts": False}}
    start = datetime.combine(today - timedelta(days=LOOKBACK_DAYS), datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
    rows = db.table("study_sessions").select("user_id,started_at,duration_seconds,session_type").in_("user_id", members) \
        .gte("started_at", start.isoformat()).execute().data or []
    studied: dict = {}
    for row in rows:
        if row.get("session_type") not in EFFORT_KINDS or int(row.get("duration_seconds") or 0) < 60:
            continue
        try:
            moment = datetime.fromisoformat(str(row["started_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        studied.setdefault(moment.astimezone(zone).date(), set()).add(row["user_id"])
    goal = needed(len(members))

    def counts(day: date) -> bool:
        return len(studied.get(day, set())) >= goal

    run, day = 0, today if counts(today) else today - timedelta(days=1)
    while run < LOOKBACK_DAYS and counts(day):
        run += 1
        day -= timedelta(days=1)
    return {"streak": run, "today": {"studied": len(studied.get(today, set())), "members": len(members), "needed": goal,
                                     "counts": counts(today)}}
