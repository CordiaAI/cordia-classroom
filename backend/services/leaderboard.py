"""The weekly friends leaderboard (social plan, Stage 10): effort, never scores.

Opt-in (user_profiles.leaderboard_opt_in, off by default) and reciprocal: only someone who joined
sees it, and it lists them and their friends who joined. Minors are never on it and can't join
(services/minors.py may_join_leaderboards). Blocked pairs and profiles held for review are left out.

The week runs Monday 00:00 to now in the viewer's time zone (user_profiles.timezone, else UTC).
Effort for each person that week:
  - minutes: active study minutes from study_sessions (reading, flashcards, quizzes, the study
    timer; never browsing), each sitting clamped like everywhere else (routers/stats.py);
  - reviews: ideas answered again on a later day than they were first studied (learning_events),
    once per idea per day. The app doesn't record yet whether a review was due, so a return visit
    to an idea counts. Correct or not doesn't matter: this rewards showing up, not quiz scores;
  - points = minutes + reviews (the owner's choice); ties break on minutes, then name.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from services import minors, social_graph
from services.blocks import hidden_from
from services.moderation import held_profile_ids

EFFORT_KINDS = ("read", "flashcard", "quiz", "timer")
MAX_SESSION_SECONDS = 3 * 3600  # the same clamp as routers/stats.py clamp_duration


def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def week_start(zone_name: Optional[str], now: Optional[datetime] = None) -> datetime:
    """Monday 00:00 of this week in the viewer's zone, as a UTC datetime."""
    zone = _zone(zone_name)
    local = (now or datetime.now(timezone.utc)).astimezone(zone)
    monday = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.astimezone(timezone.utc)


def _seconds(value) -> int:
    try:
        return min(max(int(value or 0), 0), MAX_SESSION_SECONDS)
    except (TypeError, ValueError):
        return 0


def minutes_by_user(db, user_ids: list, since: datetime) -> dict:
    rows = db.table("study_sessions").select("user_id,duration_seconds,session_type,started_at") \
        .in_("user_id", user_ids).gte("started_at", since.isoformat()).execute().data or []
    seconds: dict = {}
    for row in rows:
        if row.get("session_type") in EFFORT_KINDS:
            seconds[row["user_id"]] = seconds.get(row["user_id"], 0) + _seconds(row.get("duration_seconds"))
    return {uid: total // 60 for uid, total in seconds.items()}


def reviews_by_user(db, user_ids: list, since: datetime) -> dict:
    """Ideas answered on a later day than their first answer, once per idea per day (UTC days)."""
    try:
        rows = db.table("learning_events").select("user_id,item_id,occurred_at").in_("user_id", user_ids) \
            .gte("occurred_at", (since - timedelta(days=400)).isoformat()).execute().data or []
    except Exception:  # before the learning events migration
        return {}
    first: dict = {}
    for row in rows:
        key = (row["user_id"], row["item_id"])
        day = str(row.get("occurred_at") or "")[:10]
        if day and (key not in first or day < first[key]):
            first[key] = day
    counted: dict = {}
    week_day = since.date().isoformat()
    for row in rows:
        key = (row["user_id"], row["item_id"])
        day = str(row.get("occurred_at") or "")[:10]
        if day >= week_day and day > first.get(key, day):
            counted.setdefault(row["user_id"], set()).add((row["item_id"], day))
    return {uid: len(items) for uid, items in counted.items()}


def _profile(db, user_id: str) -> dict:
    try:
        return (db.table("user_profiles").select("id,leaderboard_opt_in,timezone").eq("id", user_id).limit(1).execute().data or [{}])[0]
    except Exception:  # before migration 20261128120000
        raise HTTPException(status_code=503, detail="The leaderboard isn't available yet.")


def board(db, viewer: str, now: Optional[datetime] = None) -> dict:
    """This week's board for the viewer. {joined: false} until they join (or when they can't)."""
    if not minors.may_join_leaderboards(db, viewer):
        return {"joined": False, "can_join": False, "people": []}
    me = _profile(db, viewer)
    if not me.get("leaderboard_opt_in"):
        return {"joined": False, "can_join": True, "people": []}
    hidden = hidden_from(db, viewer)
    friends = [f for f in social_graph.friend_ids(db, viewer) if f not in hidden]
    joined = {r["id"] for r in (db.table("user_profiles").select("id,leaderboard_opt_in").in_("id", friends).execute().data or [] if friends else [])
              if r.get("leaderboard_opt_in") is True}
    joined -= minors.minor_ids(db, joined) | held_profile_ids(db, joined)
    people_ids = [viewer, *sorted(joined)]
    since = week_start(me.get("timezone"), now)
    minutes = minutes_by_user(db, people_ids, since)
    reviews = reviews_by_user(db, people_ids, since)
    cards = social_graph.cards(db, people_ids)
    rows = [{**cards.get(uid, {"user_id": uid, "username": None, "display_name": "Someone", "initials": "?"}),
             "minutes": minutes.get(uid, 0), "reviews": reviews.get(uid, 0),
             "points": minutes.get(uid, 0) + reviews.get(uid, 0), "is_me": uid == viewer} for uid in people_ids]
    rows.sort(key=lambda r: (-r["points"], -r["minutes"], str(r["display_name"]).lower()))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return {"joined": True, "can_join": True, "week_start": since.isoformat(), "people": rows}


def set_joined(db, viewer: str, joined: bool) -> None:
    if joined and not minors.may_join_leaderboards(db, viewer):
        raise HTTPException(status_code=403, detail="The leaderboard isn't open to students under 18.")
    _profile(db, viewer)
    if not (db.table("user_profiles").select("id").eq("id", viewer).limit(1).execute().data or []):
        db.table("user_profiles").insert({"id": viewer}).execute()
    db.table("user_profiles").update({"leaderboard_opt_in": bool(joined)}).eq("id", viewer).execute()
