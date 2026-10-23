"""Assignment kickoff, study blocks, the Sunday weekly review and Dashboard alerts.

Kickoff: an assignment gets an effort estimate and 2-6 steps (the model reads its description and
rubric; a plain estimate stands in when it can't). Steps get due dates spaced back from the
deadline and, once scheduled, study blocks in the student's free time. Blocks and steps reach
Google through services.google_sync when the student has turned that sync on.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from rate_limit import limiter
from routers.calendar import calendar_for
from services import composio, google_sync, planner, sync_state
from services.llm import plan_assignment

log = logging.getLogger(__name__)
router = APIRouter(tags=["plans"])
ITEM_KEY = re.compile(r"[\w@.:\-]{1,200}")
SYNC_APPS = ("gtasks", "gcal")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _key(item_key: str) -> str:
    if not ITEM_KEY.fullmatch(item_key):
        raise HTTPException(status_code=400, detail="Unknown assignment")
    return item_key


def _item(user_id: str, item_key: str) -> dict:
    item = next((i for i in calendar_for(user_id).get("items") or [] if i["id"] == item_key), None)
    if not item:
        raise HTTPException(status_code=404, detail="That assignment isn't on your calendar anymore.")
    return item


def canvas_detail(user_id: str, item_key: str) -> dict:
    """The Canvas assignment behind an item key ('canvas-123'), or {}."""
    match = re.fullmatch(r"canvas-(\d+)", item_key)
    if not match:
        return {}
    rows = get_supabase().table("canvas_assignments").select("*").eq("user_id", user_id) \
        .eq("canvas_assignment_id", int(match.group(1))).limit(1).execute().data or []
    return rows[0] if rows else {}


def _plan(user_id: str, item_key: str) -> Optional[dict]:
    db = get_supabase()
    plan = (db.table("assignment_plans").select("*").eq("user_id", user_id).eq("item_key", item_key).limit(1).execute().data or [None])[0]
    if not plan:
        return None
    steps = db.table("assignment_steps").select("*").eq("user_id", user_id).eq("item_key", item_key).order("position").execute().data or []
    blocks = db.table("study_blocks").select("*").eq("user_id", user_id).eq("item_key", item_key).neq("status", "removed") \
        .order("starts_at").execute().data or []
    return {**plan, "steps": steps, "blocks": blocks}


def _is_exam(user_id: str, item: dict) -> bool:
    return bool(canvas_detail(user_id, item["id"]).get("is_exam")) or item.get("type") == "exam"


def make_plan(user_id: str, item: dict) -> dict:
    """Estimate and steps for one assignment (kept if it already has a plan)."""
    existing = _plan(user_id, item["id"])
    if existing:
        return existing
    detail = canvas_detail(user_id, item["id"])
    is_exam = _is_exam(user_id, item)
    fallback = planner.estimate_effort(item["title"], detail.get("points_possible"), detail.get("submission_types") or [],
                                       detail.get("description") or "", is_exam)
    made = {}
    if not is_exam:
        try:
            made = plan_assignment(item["title"], item.get("course") or "", detail.get("description") or "",
                                   detail.get("points_possible"), detail.get("submission_types") or [], detail.get("rubric") or [])
        except Exception as error:
            log.info("assignment plan model failed: %s", type(error).__name__)
    try:
        effort = int(made.get("effort_minutes") or 0)
    except (TypeError, ValueError):
        effort = 0
    effort = effort if 5 <= effort <= 6000 else fallback
    steps = planner.clean_steps(made.get("steps"), effort) or planner.default_steps(effort, detail.get("submission_types") or [], is_exam)
    basis = str(made.get("basis") or "").strip()[:300] or ("Review sessions before the exam." if is_exam else "Estimated from the assignment type and points.")
    now = _now()
    due = google_sync._time(item["due_at"])
    dues = planner.stagger(len(steps), due, now) if due else [None] * len(steps)
    db = get_supabase()
    db.table("assignment_plans").upsert({
        "user_id": user_id, "item_key": item["id"], "effort_minutes": effort, "effort_basis": basis, "updated_at": now.isoformat(),
    }, on_conflict="user_id,item_key").execute()
    db.table("assignment_steps").insert([{
        "user_id": user_id, "item_key": item["id"], "position": index, "title": step["title"], "minutes": step["minutes"],
        "due_at": dues[index].isoformat() if dues[index] else None,
    } for index, step in enumerate(steps)]).execute()
    return _plan(user_id, item["id"])


def _zone(user_id: str, time_zone: Optional[str]) -> "planner.ZoneInfo":
    if time_zone:
        return google_sync.zone_of(time_zone)
    for app in SYNC_APPS:
        saved = (sync_state.get(user_id, app).get("stats") or {}).get("time_zone")
        if saved:
            return google_sync.zone_of(saved)
    return google_sync.zone_of("UTC")


def _busy(user_id: str, start: datetime, end: datetime) -> list:
    """The student's busy times when Google Calendar is connected; else just Cordia's own blocks."""
    db = get_supabase()
    own = [(google_sync._time(b["starts_at"]), google_sync._time(b["ends_at"])) for b in db.table("study_blocks").select("starts_at,ends_at")
           .eq("user_id", user_id).neq("status", "removed").gte("ends_at", start.isoformat()).lte("starts_at", end.isoformat()).execute().data or []]
    account = composio.active_accounts(user_id).get("gcal") if composio.configured() else None
    if not account:
        return own
    try:
        return own + google_sync.busy_times(user_id, account, start, end)
    except HTTPException:
        return own


def _preferred_hour(user_id: str, zone) -> Optional[int]:
    rows = get_supabase().table("study_blocks").select("starts_at").eq("user_id", user_id).eq("status", "moved") \
        .order("updated_at", desc=True).limit(20).execute().data or []
    return planner.preferred_hour([google_sync._time(r["starts_at"]) for r in rows], zone)


def schedule(user_id: str, item: dict, zone) -> list:
    """Study blocks for the plan's unfinished work, in free time before the deadline. Blocks the
    student moved or removed are left alone and count as already placed."""
    plan = make_plan(user_id, item)
    now = _now()
    due = google_sync._time(item["due_at"])
    if not due or due <= now + timedelta(minutes=30):
        return []
    db = get_supabase()
    existing = db.table("study_blocks").select("*").eq("user_id", user_id).eq("item_key", item["id"]).execute().data or []
    placed = sum(int((google_sync._time(b["ends_at"]) - google_sync._time(b["starts_at"])).total_seconds() // 60)
                 for b in existing if b["status"] != "removed")
    removed = sum(1 for b in existing if b["status"] == "removed")
    start = planner._round_up(now + timedelta(hours=1))
    busy = _busy(user_id, start, due)
    slots = planner.free_slots(busy, start, due, zone)
    hour = _preferred_hour(user_id, zone)
    rows = []
    if _is_exam(user_id, item):
        # Exams: spaced review sessions, shorter as the exam gets closer; one per remaining day slot.
        taken_days = {google_sync._time(b["starts_at"]).astimezone(zone).date() for b in existing}
        for days, minutes in planner.exam_sessions(due, now):
            day = (due - timedelta(days=days)).astimezone(zone).date()
            if day in taken_days:
                continue
            day_slots = [s for s in slots if s[0].astimezone(zone).date() == day]
            for a, b in planner.place_blocks(minutes, day_slots, zone, hour)[:1]:
                rows.append({"user_id": user_id, "item_key": item["id"], "kind": "review", "starts_at": a.isoformat(), "ends_at": b.isoformat()})
    else:
        remaining = sum(s["minutes"] for s in plan["steps"] if not s.get("done")) - placed
        if removed and remaining <= 0:
            return []
        open_steps = [s for s in plan["steps"] if not s.get("done")]
        placed_blocks = planner.place_blocks(remaining, slots, zone, hour)
        for index, (a, b) in enumerate(placed_blocks):
            # Blocks follow the steps in order: the first blocks cover the first steps.
            step = open_steps[index * len(open_steps) // len(placed_blocks)] if open_steps else None
            rows.append({"user_id": user_id, "item_key": item["id"], "kind": "work", "step_id": step and step["id"],
                         "starts_at": a.isoformat(), "ends_at": b.isoformat()})
    if rows:
        db.table("study_blocks").insert(rows).execute()
    return rows


def schedule_exams(user_id: str) -> int:
    """Review sessions for exams in the next two weeks that have none yet (the worker calls this)."""
    now = _now()
    db = get_supabase()
    exams = [i for i in calendar_for(user_id).get("items") or [] if not i.get("done") and _is_exam(user_id, i)
             and now < google_sync._time(i["due_at"]) <= now + timedelta(days=14)]
    added = 0
    for item in exams:
        if db.table("study_blocks").select("id").eq("user_id", user_id).eq("item_key", item["id"]).limit(1).execute().data:
            continue  # Already planned, or every session was removed by the student: leave it.
        added += len(schedule(user_id, item, _zone(user_id, None)))
    return added


def _push(user_id: str) -> None:
    """Send changes to Google now when sync is on; the background worker catches anything missed."""
    for app, run in (("gtasks", google_sync.sync_tasks), ("gcal", google_sync.sync_calendar)):
        if sync_state.get(user_id, app).get("container_id"):
            try:
                run(user_id)
            except HTTPException as error:
                sync_state.record(user_id, app, error=str(error.detail))


# ---- Routes ----

class ScheduleRequest(BaseModel):
    time_zone: str = Field(default="", max_length=64)


class StepRequest(BaseModel):
    done: bool


@router.get("/plans/{item_key}")
def get_plan(item_key: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    detail = canvas_detail(user_id, _key(item_key))
    return {"plan": _plan(user_id, item_key), "rubric": detail.get("rubric"), "points": detail.get("points_possible"),
            "missing": bool(detail.get("missing"))}


@router.post("/plans/{item_key}")
@limiter.limit("20/minute")
def create_plan(item_key: str, request: Request, authorization: str = Header(default="")):
    """One tap: break the assignment into steps (their due dates spaced back from the deadline)."""
    user_id = get_user_id(authorization)
    plan = make_plan(user_id, _item(user_id, _key(item_key)))
    _push(user_id)
    return {"plan": plan}


@router.delete("/plans/{item_key}")
def delete_plan(item_key: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("study_blocks").delete().eq("user_id", user_id).eq("item_key", _key(item_key)).execute()
    db.table("assignment_plans").delete().eq("user_id", user_id).eq("item_key", item_key).execute()
    return {"ok": True}


@router.put("/plans/{item_key}/steps/{step_id}")
def set_step(item_key: str, step_id: str, body: StepRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    got = get_supabase().table("assignment_steps").update({"done": body.done, "done_at": _now().isoformat() if body.done else None}) \
        .eq("id", step_id).eq("user_id", user_id).eq("item_key", _key(item_key)).execute().data
    if not got:
        raise HTTPException(status_code=404, detail="Step not found")
    _push(user_id)
    return {"step": got[0]}


@router.post("/plans/{item_key}/schedule")
@limiter.limit("20/minute")
def schedule_plan(item_key: str, body: ScheduleRequest, request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    item = _item(user_id, _key(item_key))
    added = schedule(user_id, item, _zone(user_id, body.time_zone))
    _push(user_id)
    return {"plan": _plan(user_id, item_key), "added": len(added)}


# ---- Google sync on/off ----

class SyncRequest(BaseModel):
    time_zone: str = Field(default="UTC", max_length=64)


@router.post("/sync/{connector}")
@limiter.limit("6/minute")
def sync_on(connector: str, body: SyncRequest, request: Request, authorization: str = Header(default="")):
    """Turn on (or re-run) sync into the Cordia task list or calendar."""
    user_id = get_user_id(authorization)
    if connector not in SYNC_APPS:
        raise HTTPException(status_code=404, detail="Unknown connector")
    return google_sync.turn_on(user_id, connector, body.time_zone)


@router.delete("/sync/{connector}")
def sync_off(connector: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if connector not in SYNC_APPS:
        raise HTTPException(status_code=404, detail="Unknown connector")
    google_sync.turn_off(user_id, connector)
    return {"on": False}


# ---- Dashboard alerts and the weekly review ----

@router.get("/alerts")
def alerts(authorization: str = Header(default="")):
    """Grade drops, missing work and announcements that change a deadline or add work."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    out = [{**a, "id": f"canvas:{a.get('at')}"} for a in (sync_state.get(user_id, "canvas").get("stats") or {}).get("alerts") or []]
    courses = {row["canvas_course_id"]: row.get("course_code") or row.get("name") for row in
               db.table("canvas_courses").select("canvas_course_id,name,course_code").eq("user_id", user_id).execute().data or []}
    for row in db.table("canvas_assignments").select("canvas_assignment_id,canvas_course_id,title,due_at,html_url") \
            .eq("user_id", user_id).eq("missing", True).limit(20).execute().data or []:
        out.append({"id": f"missing:{row['canvas_assignment_id']}", "kind": "missing", "title": row["title"],
                    "course": courses.get(row["canvas_course_id"]), "url": row.get("html_url"), "at": row.get("due_at")})
    for row in db.table("canvas_announcements").select("canvas_announcement_id,canvas_course_id,title,summary,changes,posted_at") \
            .eq("user_id", user_id).neq("changes", "none").is_("read_at", "null").order("posted_at", desc=True).limit(10).execute().data or []:
        out.append({"id": f"announcement:{row['canvas_announcement_id']}", "kind": row["changes"], "title": row["title"],
                    "summary": row.get("summary"), "course": courses.get(row["canvas_course_id"]), "at": row.get("posted_at")})
    return {"alerts": out}


@router.delete("/alerts/{alert_id:path}")
def dismiss_alert(alert_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    kind, _, value = alert_id.partition(":")
    if kind == "announcement" and value.isdigit():
        get_supabase().table("canvas_announcements").update({"read_at": _now().isoformat()}).eq("user_id", user_id) \
            .eq("canvas_announcement_id", int(value)).execute()
    elif kind == "canvas":
        sync_state.dismiss_alert(user_id, "canvas", value)
    return {"ok": True}


@router.get("/announcements")
def announcements(authorization: str = Header(default="")):
    """The digest: recent announcements across classes, summarized, newest first."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    courses = {row["canvas_course_id"]: row.get("course_code") or row.get("name") for row in
               db.table("canvas_courses").select("canvas_course_id,name,course_code").eq("user_id", user_id).execute().data or []}
    rows = db.table("canvas_announcements").select("canvas_announcement_id,canvas_course_id,title,summary,changes,posted_at,read_at") \
        .eq("user_id", user_id).order("posted_at", desc=True).limit(30).execute().data or []
    return {"announcements": [{**row, "course": courses.get(row["canvas_course_id"])} for row in rows]}


@router.get("/week")
def week(time_zone: str = "", authorization: str = Header(default="")):
    """Sunday review: what's due in the next 7 days and its plan, grades, and study time last week."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    now = _now()
    items = [i for i in calendar_for(user_id).get("items") or []
             if not i.get("done") and now <= google_sync._time(i["due_at"]) <= now + timedelta(days=7)]
    plans = {row["item_key"]: row for row in db.table("assignment_plans").select("item_key,effort_minutes").eq("user_id", user_id)
             .in_("item_key", [i["id"] for i in items] or ["-"]).execute().data or []}
    blocks = db.table("study_blocks").select("item_key,starts_at,ends_at,status").eq("user_id", user_id) \
        .gte("starts_at", (now - timedelta(days=7)).isoformat()).lte("starts_at", (now + timedelta(days=7)).isoformat()).execute().data or []
    minutes = lambda b: int((google_sync._time(b["ends_at"]) - google_sync._time(b["starts_at"])).total_seconds() // 60)  # noqa: E731
    past = [b for b in blocks if google_sync._time(b["starts_at"]) < now and b["status"] != "removed"]
    ahead = [b for b in blocks if google_sync._time(b["starts_at"]) >= now and b["status"] != "removed"]
    done_steps = db.table("assignment_steps").select("minutes").eq("user_id", user_id).eq("done", True) \
        .gte("done_at", (now - timedelta(days=7)).isoformat()).execute().data or []
    grades = db.table("canvas_courses").select("canvas_course_id,name,course_code,current_score,current_grade") \
        .eq("user_id", user_id).eq("imported", True).execute().data or []
    return {
        "due": [{**i, "effort_minutes": (plans.get(i["id"]) or {}).get("effort_minutes"), "planned": i["id"] in plans,
                 "scheduled_minutes": sum(minutes(b) for b in ahead if b["item_key"] == i["id"])} for i in items],
        "grades": [{"course": g.get("course_code") or g.get("name"), "score": g.get("current_score"), "grade": g.get("current_grade")}
                   for g in grades if g.get("current_score") is not None],
        "last_week": {"planned_minutes": sum(minutes(b) for b in past), "done_minutes": sum(int(s["minutes"] or 0) for s in done_steps)},
        "next_week_minutes": sum(minutes(b) for b in ahead),
    }


class AcceptRequest(BaseModel):
    item_keys: list[str] = Field(default_factory=list, max_length=30)
    time_zone: str = Field(default="", max_length=64)


@router.post("/week/accept")
@limiter.limit("6/minute")
def accept_week(body: AcceptRequest, request: Request, authorization: str = Header(default="")):
    """Plan and schedule the picked assignments for the week in one go."""
    user_id = get_user_id(authorization)
    zone = _zone(user_id, body.time_zone)
    items = {i["id"]: i for i in calendar_for(user_id).get("items") or []}
    added = 0
    for key in body.item_keys:
        if ITEM_KEY.fullmatch(key) and key in items:
            added += len(schedule(user_id, items[key], zone))
    _push(user_id)
    return {"added": added}
