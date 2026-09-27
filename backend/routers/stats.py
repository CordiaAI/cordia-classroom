"""
Stats router for CordiaClassroom.
Handles streak tracking, study session logging, and overview statistics.
"""

import re
import json
import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from database import get_supabase
from auth_utils import get_user_id

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stats", tags=["stats"])

FORMAT_NAMES = {
    "flashcard": "recall cards",
    "quiz": "practice questions",
    "read": "concise explanations",
}


def _build_learning_profile(attempts: list, sessions: list) -> dict:
    scores = [row.get("score") for row in attempts if isinstance(row.get("score"), (int, float))]
    average = round(sum(scores) / len(scores)) if scores else None
    guidance = "Use a balanced mix of direct recall and application questions."
    if average is not None and average < 70:
        guidance = "Start with short foundational recall questions before application questions."
    elif average is not None and average >= 85:
        guidance = "Favor application and comparison questions while preserving source wording."

    formats_by_guide = {}
    for session in sessions:
        guide_id = session.get("guide_id")
        mode = session.get("session_type")
        if guide_id and mode in FORMAT_NAMES:
            formats_by_guide.setdefault(guide_id, set()).add(mode)

    format_scores = {mode: [] for mode in FORMAT_NAMES}
    for attempt in attempts:
        for mode in formats_by_guide.get(attempt.get("guide_id"), set()):
            if isinstance(attempt.get("score"), (int, float)):
                format_scores[mode].append(attempt["score"])
    observed = [
        (sum(values) / len(values), len(values), mode)
        for mode, values in format_scores.items() if len(values) >= 2
    ]
    strongest = max(observed, default=None)
    ready = len(scores) >= 3
    return {
        "status": "active" if ready else "collecting",
        "quiz_average": average,
        "evidence_count": len(scores),
        "strongest_observed_format": FORMAT_NAMES[strongest[2]] if strongest and ready else None,
        "generation_guidance": guidance,
        "message": (
            "Cordia is matching question difficulty to your recent Retain results."
            if ready
            else f"Complete {3 - len(scores)} more quiz{'zes' if 3 - len(scores) != 1 else ''} so Cordia can adapt."
        ),
    }


def learning_profile_for_user(user_id: str) -> dict:
    supabase = get_supabase()
    attempts = supabase.table("quiz_attempts") \
        .select("guide_id, score, completed_at") \
        .eq("user_id", user_id) \
        .order("completed_at", desc=True) \
        .limit(50) \
        .execute()
    sessions = supabase.table("study_sessions") \
        .select("guide_id, session_type, started_at") \
        .eq("user_id", user_id) \
        .order("started_at", desc=True) \
        .limit(200) \
        .execute()
    return _build_learning_profile(attempts.data or [], sessions.data or [])


class LogSessionRequest(BaseModel):
    guide_id: Optional[str] = None
    session_type: str = Field(..., max_length=20)
    duration_seconds: int = Field(default=0, ge=0, le=86400)  # max 24 hours
    metadata: Optional[dict] = Field(default_factory=dict)

    @field_validator("session_type")
    @classmethod
    def validate_session_type(cls, v):
        allowed = {"flashcard", "quiz", "read", "timer", "browse"}
        if v not in allowed:
            raise ValueError(f"session_type must be one of: {allowed}")
        return v

    @field_validator("guide_id")
    @classmethod
    def validate_guide_id(cls, v):
        if v is not None and not _UUID_RE.match(v):
            raise ValueError("Invalid guide ID")
        return v

    @field_validator("metadata")
    @classmethod
    def validate_metadata(cls, v):
        import json
        if v and len(json.dumps(v)) > 10_000:
            raise ValueError("Metadata too large")
        return v


def _update_streak(user_id: str):
    """Update streak after a study session."""
    supabase = get_supabase()
    today = date.today()

    result = supabase.table("user_streaks").select("*").eq("user_id", user_id).execute()

    if not result.data:
        supabase.table("user_streaks").insert({
            "user_id": user_id,
            "current_streak": 1,
            "longest_streak": 1,
            "last_study_date": str(today)
        }).execute()
        return

    streak = result.data[0]
    last_date = date.fromisoformat(streak["last_study_date"]) if streak["last_study_date"] else None

    if last_date == today:
        return

    if last_date == today - timedelta(days=1):
        new_streak = streak["current_streak"] + 1
    else:
        new_streak = 1

    longest = max(streak["longest_streak"], new_streak)
    supabase.table("user_streaks").update({
        "current_streak": new_streak,
        "longest_streak": longest,
        "last_study_date": str(today),
    }).eq("user_id", user_id).execute()


@router.get("/streak")
def get_streak(authorization: str = Header(default=""), tz_offset: int = 0):
    """Get current user's streak info.

    tz_offset: minutes from UTC (e.g. -300 for EST). Used to determine
    the user's local day boundaries (12:00 AM - 11:59:59 PM).
    """
    try:
        # Clamp offset to valid range (-720 to +840 minutes)
        tz_offset = max(-720, min(840, tz_offset))

        user_id = get_user_id(authorization)
        supabase = get_supabase()

        # Determine "today" in the user's local timezone
        user_now = datetime.utcnow() + timedelta(minutes=tz_offset)
        user_today = user_now.date()

        result = supabase.table("user_streaks").select("*").eq("user_id", user_id).execute()

        if not result.data:
            # Build empty Sunday-aligned week
            days_since_sunday = (user_today.weekday() + 1) % 7
            sunday = user_today - timedelta(days=days_since_sunday)
            week = [{"date": str(sunday + timedelta(days=i)), "active": False} for i in range(7)]
            return {
                "current_streak": 0,
                "longest_streak": 0,
                "last_study_date": None,
                "studied_today": False,
                "week": week
            }

        streak = result.data[0]

        # Study sessions are the source of truth; bucket them by the user's local day so the
        # streak, week dots, and "studied today" agree (streak rows are written in server UTC).
        window_start = datetime(user_today.year, user_today.month, user_today.day) - timedelta(days=400, minutes=tz_offset)
        sessions = supabase.table("study_sessions") \
            .select("started_at") \
            .eq("user_id", user_id) \
            .gte("started_at", window_start.isoformat()) \
            .order("started_at", desc=True) \
            .limit(5000) \
            .execute()

        active_days = set()
        for s in (sessions.data or []):
            ts = s["started_at"]
            try:
                utc_dt = datetime.fromisoformat(ts.replace("Z", "+00:00").replace("+00:00", ""))
                active_days.add((utc_dt + timedelta(minutes=tz_offset)).date())
            except (ValueError, AttributeError):
                continue

        studied_today = user_today in active_days
        day = user_today if studied_today else user_today - timedelta(days=1)
        current = 0
        while day in active_days:
            current += 1
            day -= timedelta(days=1)

        # Sunday-aligned week: weekday() Mon=0 .. Sun=6  →  days_since_sunday = (weekday+1)%7
        sunday = user_today - timedelta(days=(user_today.weekday() + 1) % 7)
        week = []
        for i in range(7):
            d = sunday + timedelta(days=i)
            week.append({"date": str(d), "active": d in active_days})

        return {
            "current_streak": current,
            "longest_streak": max(streak["longest_streak"] or 0, current),
            "last_study_date": streak["last_study_date"],
            "studied_today": studied_today,
            "week": week
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting streak: {e}")
        raise HTTPException(status_code=500, detail="Failed to get streak")


@router.get("/overview")
def get_overview(authorization: str = Header(default="")):
    """Get dashboard overview stats."""
    user_id = get_user_id(authorization)
    overview = {
        "total_guides": 0,
        "total_folders": 0,
        "total_flashcards": 0,
        "cards_studied": 0,
        "avg_quiz_score": 0,
        "current_streak": 0,
        "minutes_today": 0,
    }
    try:
        supabase = get_supabase()

        guides = supabase.table("study_guides").select("id, flashcards").eq("user_id", user_id).execute()
        overview["total_guides"] = len(guides.data or [])

        for g in (guides.data or []):
            fc = g.get("flashcards")
            if isinstance(fc, list):
                overview["total_flashcards"] += len(fc)

        folders = supabase.table("folders").select("id").eq("user_id", user_id).execute()
        overview["total_folders"] = len(folders.data or [])

        fc_sessions = supabase.table("study_sessions") \
            .select("metadata") \
            .eq("user_id", user_id) \
            .eq("session_type", "flashcard") \
            .execute()
        for s in (fc_sessions.data or []):
            meta = s.get("metadata", {})
            if isinstance(meta, dict):
                overview["cards_studied"] += meta.get("cards_studied", 0)

        quizzes = supabase.table("quiz_attempts") \
            .select("score") \
            .eq("user_id", user_id) \
            .execute()
        if quizzes.data:
            overview["avg_quiz_score"] = round(sum(q["score"] for q in quizzes.data) / len(quizzes.data))

        streak_result = supabase.table("user_streaks").select("current_streak, longest_streak, last_study_date").eq("user_id", user_id).execute()
        if streak_result.data:
            s = streak_result.data[0]
            last = date.fromisoformat(s["last_study_date"]) if s["last_study_date"] else None
            if last and last >= date.today() - timedelta(days=1):
                overview["current_streak"] = s["current_streak"]

        today_start = str(date.today()) + "T00:00:00"
        today_sessions = supabase.table("study_sessions") \
            .select("duration_seconds") \
            .eq("user_id", user_id) \
            .gte("started_at", today_start) \
            .execute()
        overview["minutes_today"] = sum(
            s.get("duration_seconds", 0) for s in (today_sessions.data or [])
        ) // 60
    except Exception as e:
        logger.warning("Returning partial overview after database error: %s", e)
    return overview


@router.get("/learning-profile")
def get_learning_profile(authorization: str = Header(default="")):
    try:
        return learning_profile_for_user(get_user_id(authorization))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error building learning profile: {e}")
        raise HTTPException(status_code=500, detail="Failed to build learning profile")


@router.post("/log-session")
def log_session(request: LogSessionRequest, authorization: str = Header(default="")):
    """Log a study session and update streak."""
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        data = {
            "user_id": user_id,
            "session_type": request.session_type,
            "duration_seconds": request.duration_seconds,
            "metadata": request.metadata or {}
        }
        if request.guide_id:
            data["guide_id"] = request.guide_id

        supabase.table("study_sessions").insert(data).execute()
        _update_streak(user_id)

        return {"logged": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error logging session: {e}")
        raise HTTPException(status_code=500, detail="Failed to log session")


@router.post("/beacon")
async def beacon_session(request: Request):
    """Log a session via navigator.sendBeacon (fires on page unload).
    Parses raw body since sendBeacon may send as text/plain."""
    try:
        body = await request.body()
        data = json.loads(body)

        auth = data.get("authorization", "")
        if not auth:
            return {"logged": False}

        user_id = get_user_id(auth)
        supabase = get_supabase()

        session_type = data.get("session_type", "browse")
        allowed = {"flashcard", "quiz", "read", "timer", "browse"}
        if session_type not in allowed:
            session_type = "browse"

        duration = min(max(int(data.get("duration_seconds", 0)), 0), 86400)

        row = {
            "user_id": user_id,
            "session_type": session_type,
            "duration_seconds": duration,
            "metadata": {}
        }
        guide_id = data.get("guide_id")
        if guide_id and _UUID_RE.match(guide_id):
            row["guide_id"] = guide_id

        supabase.table("study_sessions").insert(row).execute()
        _update_streak(user_id)

        return {"logged": True}
    except Exception as e:
        logger.error(f"Error in beacon session: {e}")
        return {"logged": False}
