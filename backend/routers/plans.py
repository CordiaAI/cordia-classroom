"""Assignment kickoff, study blocks, the Sunday weekly review and Dashboard alerts.

Kickoff: an assignment gets an effort estimate and 2-6 steps (the model reads its description and
rubric; a plain estimate stands in when it can't). Steps get due dates spaced back from the
deadline and, once scheduled, study blocks in the student's free time. Blocks and steps reach
Google through services.google_sync when the student has turned that sync on.
"""

import hashlib
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
from services import composio, google_sync, library_import, planner, sync_state
from services.llm import plan_assignment
from services.text_processing import text_to_outline

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
    if not exams:
        return 0
    # Already planned, or every session was removed by the student: leave it.
    planned = {row["item_key"] for row in db.table("study_blocks").select("item_key").eq("user_id", user_id)
               .in_("item_key", [item["id"] for item in exams]).execute().data or []}
    added = 0
    for item in exams:
        if item["id"] not in planned:
            added += len(schedule(user_id, item, _zone(user_id, None)))
    return added


def item_folder(user_id: str, item_key: str) -> Optional[str]:
    """The Library folder of the class a Canvas assignment belongs to."""
    detail = canvas_detail(user_id, item_key)
    if not detail:
        return None
    row = (get_supabase().table("canvas_courses").select("class_id").eq("user_id", user_id)
           .eq("canvas_course_id", detail.get("canvas_course_id")).limit(1).execute().data or [{}])[0]
    return library_import.class_folder(user_id, row.get("class_id"))


def build_review(user_id: str, folder_id: str, title: str, ref: str, prefix: Optional[str] = None) -> dict:
    """One review guide gathering the class's material (Canvas imports, Drive files and the
    student's own guides), each source under its own headings. Building it again refreshes it."""
    sources = library_import.folder_material(user_id, folder_id, source_title_prefix=prefix)
    if not sources:
        raise HTTPException(status_code=404, detail="This class has no material yet. Link a Drive folder, turn on Canvas imports, or add your own notes.")
    lines: list[str] = []
    for source in reversed(sources):  # Oldest first: the order the course covered it.
        outline = source.get("notes") or ""
        if not any(line.startswith("- ") for line in outline.splitlines()):
            outline = text_to_outline(source.get("study_guide") or "")
        name = (source.get("title") or "Notes")[:80]
        if not outline.lstrip().startswith("## "):
            lines.append(f"## {name}")
        for line in outline.splitlines():
            lines.append(f"## {name} · {line[3:].strip()}" if line.startswith("## ") else line)
    db = get_supabase()
    row = {"user_id": user_id, "title": title[:300], "notes": "\n".join(lines), "study_guide": "", "folder_id": folder_id,
           "external_source_id": ref[:500], "source_type": "review", "source_title": f"Review of {len(sources)} sources"}
    return (db.table("study_guides").upsert(row, on_conflict="user_id,external_source_id").execute().data or [row])[0]


def reflow(user_id: str, item_key: str, time_zone: str = "") -> dict:
    """After a due date changes: open steps get new dates spaced back from it, study blocks Cordia
    planned past the new date are taken off (blocks the student moved stay), and free time before
    it is filled if the work still needs some. A cancelled deadline loses its planned blocks."""
    db = get_supabase()
    now = _now()
    item = next((i for i in calendar_for(user_id).get("items") or [] if i["id"] == item_key), None)
    blocks = db.table("study_blocks").select("id,starts_at,status").eq("user_id", user_id).eq("item_key", item_key).eq("status", "planned").execute().data or []
    due = google_sync._time(item["due_at"]) if item and not item.get("cancelled") else None
    late = [b["id"] for b in blocks if google_sync._time(b["starts_at"]) > now and (due is None or google_sync._time(b["starts_at"]) >= due)]
    if late:
        db.table("study_blocks").delete().in_("id", late).eq("user_id", user_id).execute()
    moved_steps = added = 0
    if due:
        steps = [s for s in db.table("assignment_steps").select("*").eq("user_id", user_id).eq("item_key", item_key)
                 .order("position").execute().data or [] if not s.get("done")]
        # All new dates in one write (whole rows, so the upsert only ever updates).
        moved = [{**step, "due_at": step_due.isoformat()} for step, step_due in zip(steps, planner.stagger(len(steps), due, now))]
        if moved:
            db.table("assignment_steps").upsert(moved, on_conflict="id").execute()
        moved_steps = len(moved)
        if steps or _is_exam(user_id, item):
            added = len(schedule(user_id, item, _zone(user_id, time_zone or None)))
    return {"blocks_removed": len(late), "steps_moved": moved_steps, "blocks_added": added}


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
    from services import docs_sync, github_sync
    return {"plan": _plan(user_id, item_key), "rubric": detail.get("rubric"), "points": detail.get("points_possible"),
            "missing": bool(detail.get("missing")), "draft": docs_sync.draft(user_id, item_key),
            "repo": github_sync.repo_for(user_id, item_key, with_activity=False)}


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


class ReviewRequest(BaseModel):
    folder_id: str = Field(default="", max_length=36)
    prefix: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=300)
    time_zone: str = Field(default="", max_length=64)


@router.post("/plans/{item_key}/review-set")
@limiter.limit("10/minute")
def exam_review_set(item_key: str, body: ReviewRequest, request: Request, authorization: str = Header(default="")):
    """Exam prep: gather the class's material into one review guide and space review sessions
    before the exam (each one also a Google subtask when Tasks sync is on)."""
    user_id = get_user_id(authorization)
    item = _item(user_id, _key(item_key))
    folder_id = item_folder(user_id, item_key) or body.folder_id
    if not folder_id:
        raise HTTPException(status_code=400, detail="Pick the class this is for.")
    from routers.drive import _own_folder
    _own_folder(user_id, folder_id)
    guide = build_review(user_id, folder_id, f"{item['title']}: review", f"review:{item_key}")
    added = schedule(user_id, item, _zone(user_id, body.time_zone)) if _is_exam(user_id, item) else []
    _push(user_id)
    return {"guide": {"id": guide.get("id"), "title": guide.get("title")}, "sessions": len(added)}


@router.post("/review-sets")
@limiter.limit("10/minute")
def module_review_set(body: ReviewRequest, request: Request, authorization: str = Header(default="")):
    """A review set for part of a class, e.g. one Canvas module once it's finished."""
    user_id = get_user_id(authorization)
    from routers.drive import _own_folder
    folder = _own_folder(user_id, body.folder_id)
    key = hashlib.sha256(body.prefix.encode()).hexdigest()[:12]
    guide = build_review(user_id, folder["id"], body.title or f"{folder.get('name') or 'Class'}: review",
                         f"review:{folder['id']}:{key}", prefix=body.prefix or None)
    return {"guide": {"id": guide.get("id"), "title": guide.get("title")}}


# ---- Date changes from email and announcements (services.mail_watch) ----

class DecideRequest(BaseModel):
    time_zone: str = Field(default="", max_length=64)


def _change(user_id: str, change_id: str) -> dict:
    from ids import require_uuid
    require_uuid(change_id, "change ID")
    rows = get_supabase().table("deadline_changes").select("*").eq("id", change_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="That change isn't there anymore.")
    return rows[0]


@router.get("/deadline-changes")
def list_changes(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    rows = get_supabase().table("deadline_changes").select("id,source,item_key,kind,title,summary,sender,old_due,new_due,created_at") \
        .eq("user_id", user_id).eq("status", "pending").order("created_at", desc=True).limit(20).execute().data or []
    return {"changes": rows}


@router.post("/deadline-changes/{change_id}/accept")
@limiter.limit("20/minute")
def accept_change(change_id: str, body: DecideRequest, request: Request, authorization: str = Header(default="")):
    """One confirm: the new date (or the cancellation) applies to the deadline, its steps, its study
    blocks and its Google Task. Older pending changes to the same deadline are set aside."""
    user_id = get_user_id(authorization)
    result = apply_change(user_id, change_id, body.time_zone)
    _push(user_id)
    return {"ok": True, **result}


def apply_change(user_id: str, change_id: str, time_zone: str = "") -> dict:
    change = _change(user_id, change_id)
    db = get_supabase()
    now = _now().isoformat()
    db.table("deadline_changes").update({"status": "accepted", "decided_at": now}).eq("id", change_id).eq("user_id", user_id).execute()
    db.table("deadline_changes").update({"status": "dismissed", "decided_at": now}).eq("user_id", user_id) \
        .eq("item_key", change["item_key"]).eq("status", "pending").execute()
    return reflow(user_id, change["item_key"], time_zone)


@router.post("/deadline-changes/{change_id}/dismiss")
def dismiss_change(change_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _change(user_id, change_id)
    get_supabase().table("deadline_changes").update({"status": "dismissed", "decided_at": _now().isoformat()}) \
        .eq("id", change_id).eq("user_id", user_id).execute()
    return {"ok": True}


class WatchRequest(BaseModel):
    on: bool


@router.put("/mail/{connector}/watch")
@limiter.limit("10/minute")
def watch_mail(connector: str, body: WatchRequest, request: Request, authorization: str = Header(default="")):
    """Turn "Watch for date changes" on or off for Gmail or Outlook; on runs a first pass now."""
    from services import mail_watch
    user_id = get_user_id(authorization)
    if connector not in mail_watch.MAIL_APPS:
        raise HTTPException(status_code=404, detail="Unknown connector")
    sync_state.update_stats(user_id, connector, {"watch_dates": body.on})
    if not body.on:
        return {"on": False}
    composio.account_for(user_id, connector)
    return {"on": True, **mail_watch.watch(user_id, connector)}


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
    stats = sync_state.get(user_id, "canvas").get("stats") or {}
    course_rows = db.table("canvas_courses").select("canvas_course_id,name,course_code,class_id").eq("user_id", user_id).execute().data or []
    courses = {row["canvas_course_id"]: row.get("course_code") or row.get("name") for row in course_rows}
    classes = {row["canvas_course_id"]: row.get("class_id") for row in course_rows}
    out = []
    for alert in stats.get("alerts") or []:
        alert = {**alert, "id": f"canvas:{alert.get('at')}"}
        if alert.get("kind") == "module_done":
            # The button makes a review set from that module's imports.
            alert["folder_id"] = library_import.class_folder(user_id, classes.get(alert.get("course_id")))
            alert["prefix"] = f"{alert.get('course') or ''} · {alert.get('module') or ''}"
        out.append(alert)
    # Stalled drafts (Docs), quiet repos (GitHub) and class announcements (Slack).
    for connector in ("gdocs", "github", "slack"):
        for alert in (sync_state.get(user_id, connector).get("stats") or {}).get("alerts") or []:
            out.append({**alert, "id": f"{connector}:{alert.get('at')}"})
    # Exams in the next 10 days without a review set yet.
    now = _now()
    reviewed = library_import.existing_refs(user_id, "review:")
    dismissed = set(stats.get("exam_dismissed") or [])
    for item in calendar_for(user_id).get("items") or []:
        due = google_sync._time(item.get("due_at"))
        if (due and now < due <= now + timedelta(days=10) and not item.get("done") and f"review:{item['id']}" not in reviewed
                and item["id"] not in dismissed and _is_exam(user_id, item)):
            out.append({"id": f"exam:{item['id']}", "kind": "exam_prep", "title": item["title"], "item_key": item["id"],
                        "course": item.get("course"), "at": item["due_at"], "days": max(1, (due - now).days)})
    for row in db.table("canvas_assignments").select("canvas_assignment_id,canvas_course_id,title,due_at,html_url") \
            .eq("user_id", user_id).eq("missing", True).limit(20).execute().data or []:
        out.append({"id": f"missing:{row['canvas_assignment_id']}", "kind": "missing", "title": row["title"],
                    "course": courses.get(row["canvas_course_id"]), "url": row.get("html_url"), "at": row.get("due_at")})
    proposed = set()
    try:
        for row in db.table("deadline_changes").select("id,source,source_id,kind,title,summary,sender,old_due,new_due,item_key") \
                .eq("user_id", user_id).eq("status", "pending").order("created_at", desc=True).limit(10).execute().data or []:
            if row["source"] == "canvas_announcement":
                proposed.add(row["source_id"])
            out.append({**row, "id": f"change:{row['id']}", "change_id": row["id"], "kind": "date_change", "change": row["kind"]})
    except Exception:
        log.warning("deadline_changes missing; run the deadline_changes migration")
    for row in db.table("canvas_announcements").select("canvas_announcement_id,canvas_course_id,title,summary,changes,posted_at") \
            .eq("user_id", user_id).neq("changes", "none").is_("read_at", "null").order("posted_at", desc=True).limit(10).execute().data or []:
        if str(row["canvas_announcement_id"]) in proposed:
            continue  # Shown as a date change to accept instead.
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
    elif kind in ("canvas", "gdocs", "github", "slack"):
        sync_state.dismiss_alert(user_id, kind, value)
    elif kind == "change":
        dismiss_change(value, authorization)
    elif kind == "exam" and ITEM_KEY.fullmatch(value):
        stats = sync_state.get(user_id, "canvas").get("stats") or {}
        sync_state.update_stats(user_id, "canvas", {"exam_dismissed": [*(stats.get("exam_dismissed") or []), value][-100:]})
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
