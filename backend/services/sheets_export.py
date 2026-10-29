"""Google Sheets: the student's own numbers in a spreadsheet they own, through Composio.

One spreadsheet, "Cordia: grades and study time" (its id is connector_settings.container_id for
"gsheets"), with two tabs Cordia rewrites on each export:
- Grades: each Canvas class with its current score and letter (canvas_courses, kept by the Canvas sync).
- Study time: one row per day with study sessions, minutes and how many were quizzes or flashcards
  (study_sessions, the same log the streak counts).
Exports run on demand and, with stats.auto on, once a day. A spreadsheet the student deleted is
made again on the next export.
"""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state

log = logging.getLogger(__name__)
TITLE = "Cordia: grades and study time"
TABS = ("Grades", "Study time")
DAYS = 120
EVERY = timedelta(hours=24)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def grade_rows(user_id: str) -> list[list]:
    rows = get_supabase().table("canvas_courses").select("name,course_code,current_score,current_grade,grade_checked_at") \
        .eq("user_id", user_id).execute().data or []
    out = [["Class", "Code", "Current score (%)", "Letter", "Checked"]]
    for row in sorted(rows, key=lambda r: str(r.get("name") or "")):
        if row.get("current_score") is None and not row.get("current_grade"):
            continue
        out.append([row.get("name") or "", row.get("course_code") or "",
                    float(row["current_score"]) if row.get("current_score") is not None else "",
                    row.get("current_grade") or "", str(row.get("grade_checked_at") or "")[:10]])
    return out


def study_rows(user_id: str, tz: str = "UTC", now: Optional[datetime] = None) -> list[list]:
    now = now or _now()
    zone = _zone(tz)
    since = (now - timedelta(days=DAYS)).isoformat()
    sessions = get_supabase().table("study_sessions").select("started_at,duration_seconds,session_type") \
        .eq("user_id", user_id).gte("started_at", since).limit(5000).execute().data or []
    days: dict = defaultdict(lambda: {"sessions": 0, "seconds": 0, "quiz": 0, "flashcards": 0})
    for row in sessions:
        try:
            at = datetime.fromisoformat(str(row.get("started_at")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        day = days[at.astimezone(zone).date().isoformat()]
        day["sessions"] += 1
        day["seconds"] += int(row.get("duration_seconds") or 0)
        kind = str(row.get("session_type") or "")
        if kind in ("quiz", "nclex", "exam"):
            day["quiz"] += 1
        elif "flash" in kind or kind == "cards":
            day["flashcards"] += 1
    out = [["Date", "Sessions", "Minutes", "Quizzes", "Flashcard sessions"]]
    for date in sorted(days, reverse=True):
        d = days[date]
        out.append([date, d["sessions"], round(d["seconds"] / 60), d["quiz"], d["flashcards"]])
    return out


def _sheet_id(made: dict) -> str:
    for key in ("spreadsheetId", "spreadsheet_id", "id"):
        if made.get(key):
            return str(made[key])
    for inner in made.values():
        if isinstance(inner, dict):
            found = _sheet_id(inner)
            if found:
                return found
    return ""


def _create(acct: str, user_id: str) -> str:
    made = composio.run(acct, user_id, "GOOGLESHEETS_CREATE_GOOGLE_SHEET1", {"title": TITLE})
    sheet = _sheet_id(made)
    if not sheet:
        raise HTTPException(status_code=502, detail="Google Sheets didn't make the spreadsheet. Try again.")
    for tab in TABS:
        try:
            composio.run(acct, user_id, "GOOGLESHEETS_ADD_SHEET", {"spreadsheet_id": sheet, "title": tab, "force_unique": False})
        except HTTPException:
            log.info("sheet tab %s not added (may exist)", tab)
    sync_state.set_container(user_id, "gsheets", sheet)
    return sheet


def _write(acct: str, user_id: str, sheet: str, tab: str, rows: list[list]) -> None:
    composio.run(acct, user_id, "GOOGLESHEETS_CLEAR_VALUES", {"spreadsheet_id": sheet, "range": f"'{tab}'!A1:Z2000"})
    composio.run(acct, user_id, "GOOGLESHEETS_VALUES_UPDATE", {
        "spreadsheet_id": sheet, "range": f"'{tab}'!A1", "values": rows, "value_input_option": "USER_ENTERED",
    })


def export(user_id: str, tz: Optional[str] = None) -> dict:
    acct = composio.active_accounts(user_id).get("gsheets")
    if not acct:
        sync_state.record(user_id, "gsheets", error="Google Sheets isn't connected anymore.", needs_reconnect=True)
        raise HTTPException(status_code=409, detail="Connect Google Sheets in Settings › Connectors first.")
    state = sync_state.get(user_id, "gsheets")
    stats = state.get("stats") or {}
    tz = tz or stats.get("time_zone") or "UTC"
    grades, study = grade_rows(user_id), study_rows(user_id, tz)
    sheet = state.get("container_id") or _create(acct, user_id)
    try:
        _write(acct, user_id, sheet, TABS[0], grades)
    except HTTPException:
        # Deleted or no longer shared: make a new one and write there.
        sheet = _create(acct, user_id)
        _write(acct, user_id, sheet, TABS[0], grades)
    _write(acct, user_id, sheet, TABS[1], study)
    sync_state.record(user_id, "gsheets", stats={"time_zone": tz, "classes": len(grades) - 1, "days": len(study) - 1})
    return {"spreadsheet_id": sheet, "url": f"https://docs.google.com/spreadsheets/d/{sheet}/edit", "classes": len(grades) - 1, "days": len(study) - 1}


def auto_export(user_id: str) -> None:
    """The daily export: a disconnected Sheets is already flagged on its card, so it just stops here."""
    try:
        export(user_id)
    except HTTPException as error:
        if error.status_code != 409:
            raise


def set_auto(user_id: str, on: bool, tz: Optional[str] = None) -> dict:
    sync_state.update_stats(user_id, "gsheets", {"auto": bool(on), **({"time_zone": tz} if tz else {})})
    return status(user_id)


def status(user_id: str) -> dict:
    state = sync_state.get(user_id, "gsheets")
    sheet = state.get("container_id")
    stats = state.get("stats") or {}
    return {"auto": bool(stats.get("auto")), "url": f"https://docs.google.com/spreadsheets/d/{sheet}/edit" if sheet else None,
            "last": state.get("last_synced_at")}
