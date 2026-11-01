"""Routes for connected apps (the MCP server at classroom.cordiacode.com/mcp). These are the only
backend routes that accept a connected app's token, and only that kind (auth_utils.verify_mcp_token).
They read as the student, through a Supabase client built with that token, so Row Level Security
and the connected-app role decide what they see. They call the same functions the app's routes do.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from auth_utils import verify_mcp_token
from database import get_student_supabase
from ids import is_uuid
from routers.stats import _graded_items, _student_results, activity_rows, streak_summary
from services.mcp_progress import progress_summary

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _student(authorization: str):
    """(user_id, client acting as the student) for a connected app that is still connected."""
    user_id, token = verify_mcp_token(authorization)
    db = get_student_supabase(token)
    try:
        active = db.rpc("mcp_session_check").execute().data
    except Exception:
        raise HTTPException(status_code=503, detail="Cordia could not check this connection")
    if active is not True:
        raise HTTPException(status_code=401, detail="This app was disconnected from Cordia")
    return user_id, db


def _time_zone(db, user_id: str) -> ZoneInfo:
    try:
        rows = db.table("user_profiles").select("timezone").eq("id", user_id).limit(1).execute().data or []
        return ZoneInfo(rows[0]["timezone"]) if rows and rows[0].get("timezone") else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def _progress(authorization: str, since: str, course_id: str) -> dict:
    user_id, db = _student(authorization)
    zone = _time_zone(db, user_id)
    now = datetime.now(timezone.utc).astimezone(zone)
    tz_offset = int(now.utcoffset().total_seconds() // 60)
    today = now.date()
    try:
        start = date.fromisoformat(since) if since else today - timedelta(days=29)
    except ValueError:
        raise HTTPException(status_code=422, detail="since must be YYYY-MM-DD")
    start = max(min(start, today), today - timedelta(days=366))
    sessions, attempts, guides = activity_rows(db, user_id, attempts_limit=500)
    data = _student_results(user_id, db)
    results, _ = _graded_items(data)
    from services.study_insights import build_insights
    summary = progress_summary(
        sessions=sessions, attempts=attempts, guides=guides, streak=streak_summary(db, user_id, tz_offset),
        insights=build_insights(results, data["sessions"]), today=today, tz_offset=tz_offset, since=start,
        course_id=course_id or "",
    )
    summary["time_zone"] = zone.key
    return summary


@router.get("/progress")
async def get_progress(authorization: str = Header(default=""), since: str = Query(default="", max_length=10),
                       course_id: Optional[str] = Query(default=None, max_length=36)):
    """Streak, active minutes, quiz accuracy, best hours and weak spots, as the app's Progress page
    counts them, from `since` (the student's local date) through today."""
    if course_id and not is_uuid(course_id):
        raise HTTPException(status_code=422, detail="course_id must be an id")
    return await run_in_threadpool(_progress, authorization, since, course_id or "")
