"""Google Tasks and Google Calendar sync, through Composio, into Cordia-owned containers only.

Ground rules (see migration 20261023130000_connector_sync.sql):
- Cordia writes only into a "Cordia" task list and a "Cordia" calendar, made on first use and
  found again by name after a reconnect. Sync is on while connector_settings.container_id is set.
- connector_links maps each Cordia object to the one Google object made for it, so updates follow
  it and nothing is created twice.
- Canvas owns due dates and titles (Cordia overwrites them on Google). The student owns study
  times: a block they move keeps its new time, one they delete stays deleted (removed_by_student),
  and Cordia learns their preferred hour from those moves. Done is either side's: checking a
  task off in Google marks it done in Cordia, and the reverse.
"""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state
from services.deadlines import marks

log = logging.getLogger(__name__)
CONTAINER_NAME = "Cordia"
HORIZON_DAYS = 60


def zone_of(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(*parts) -> str:
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode()).hexdigest()[:32]


def _time(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ---- Links ----

def links(user_id: str, connector: str) -> dict[tuple[str, str], dict]:
    rows = get_supabase().table("connector_links").select("*").eq("user_id", user_id).eq("connector", connector).execute().data or []
    return {(row["kind"], row["cordia_id"]): row for row in rows}


def save_link(user_id: str, connector: str, kind: str, cordia_id: str, external_id: str, container_id: str,
              synced_hash: str, removed: bool = False) -> None:
    get_supabase().table("connector_links").upsert({
        "user_id": user_id, "connector": connector, "kind": kind, "cordia_id": cordia_id, "external_id": external_id,
        "container_id": container_id, "synced_hash": synced_hash, "removed_by_student": removed, "updated_at": _now().isoformat(),
    }, on_conflict="user_id,connector,kind,cordia_id").execute()


# ---- Containers ----

def ensure_tasklist(user_id: str, account: str) -> str:
    saved = sync_state.get(user_id, "gtasks").get("container_id")
    if saved:
        return saved
    lists = composio.run(account, user_id, "GOOGLETASKS_LIST_TASK_LISTS", {"maxResults": 100})
    found = next((item.get("id") for item in lists.get("items") or [] if item.get("title") == CONTAINER_NAME), None)
    if not found:
        made = composio.run(account, user_id, "GOOGLETASKS_CREATE_TASK_LIST", {"tasklist_title": CONTAINER_NAME})
        found = made.get("id") or (made.get("tasklist") or {}).get("id")
    if not found:
        raise HTTPException(status_code=502, detail="Google Tasks didn't make the Cordia list. Try again.")
    sync_state.set_container(user_id, "gtasks", found)
    return found


def ensure_calendar(user_id: str, account: str, zone: ZoneInfo) -> str:
    saved = sync_state.get(user_id, "gcal").get("container_id")
    if saved:
        return saved
    listed = composio.run(account, user_id, "GOOGLECALENDAR_LIST_CALENDARS", {"max_results": 250})
    items = listed.get("items") or listed.get("calendars") or []
    found = next((item.get("id") for item in items if item.get("summary") == CONTAINER_NAME and item.get("accessRole") in (None, "owner")), None)
    if not found:
        made = composio.run(account, user_id, "GOOGLECALENDAR_CREATE_CALENDAR", {
            "summary": CONTAINER_NAME, "timezone": zone.key, "description": "Study time and deadlines from Cordia Classroom.",
        })
        found = made.get("id") or (made.get("calendar") or {}).get("id")
    if not found:
        raise HTTPException(status_code=502, detail="Google Calendar didn't make the Cordia calendar. Try again.")
    sync_state.set_container(user_id, "gcal", found)
    return found


def turn_on(user_id: str, connector: str, time_zone: str) -> dict:
    """Make (or find) the Cordia container and sync now."""
    account = composio.account_for(user_id, connector)
    zone = zone_of(time_zone)
    sync_state.record(user_id, connector, stats={"time_zone": zone.key})
    if connector == "gtasks":
        ensure_tasklist(user_id, account)
        return sync_tasks(user_id)
    ensure_calendar(user_id, account, zone)
    return sync_calendar(user_id)


def turn_off(user_id: str, connector: str) -> None:
    """Stops syncing. The Cordia list or calendar stays in the student's account for them to keep or delete."""
    sync_state.set_container(user_id, connector, None)


# ---- Google Tasks ----

def _open_items(user_id: str) -> list[dict]:
    from routers.calendar import calendar_for  # The calendar router owns how deadlines are read.
    now = _now()
    return [item for item in calendar_for(user_id).get("items") or []
            if item.get("due_at") and now - timedelta(days=1) <= _time(item["due_at"]) <= now + timedelta(days=HORIZON_DAYS)]


def _steps(user_id: str) -> list[dict]:
    return get_supabase().table("assignment_steps").select("*").eq("user_id", user_id).execute().data or []


def _due_date(dt: datetime, zone: ZoneInfo) -> str:
    # Google Tasks keeps only the date of a due time.
    return f"{dt.astimezone(zone).date().isoformat()}T00:00:00.000Z"


def sync_tasks(user_id: str) -> dict:
    state = sync_state.get(user_id, "gtasks")
    tasklist = state.get("container_id")
    if not tasklist:
        return {"on": False}
    account = composio.active_accounts(user_id).get("gtasks")
    if not account:
        sync_state.record(user_id, "gtasks", error="Google Tasks isn't connected anymore.", needs_reconnect=True)
        return {"on": True, "error": "reconnect"}
    zone = zone_of((state.get("stats") or {}).get("time_zone"))
    db = get_supabase()
    linked = links(user_id, "gtasks")
    remote = {}
    page = None
    for _ in range(10):
        args = {"tasklist_id": tasklist, "showCompleted": True, "showHidden": True, "maxResults": 100}
        if page:
            args["pageToken"] = page
        data = composio.run(account, user_id, "GOOGLETASKS_LIST_TASKS", args)
        for task in data.get("tasks") or data.get("items") or []:
            remote[task.get("id")] = task
        page = data.get("nextPageToken")
        if not page:
            break
    marked = marks(db, user_id)
    items = _open_items(user_id)
    steps = [step for step in _steps(user_id) if any(item["id"] == step["item_key"] for item in items)]
    done_in_google = 0

    # Read back first: a check-off or a deletion in Google wins over what Cordia would write.
    for (kind, cordia_id), link in linked.items():
        if link.get("removed_by_student") or kind not in ("task", "subtask"):
            continue
        task = remote.get(link["external_id"])
        if task is None or task.get("deleted"):
            db.table("connector_links").update({"removed_by_student": True}).eq("user_id", user_id).eq("connector", "gtasks") \
                .eq("kind", kind).eq("cordia_id", cordia_id).execute()
            link["removed_by_student"] = True
            continue
        if task.get("status") == "completed":
            if kind == "task" and not marked.get(cordia_id):
                db.table("deadline_marks").upsert({"user_id": user_id, "item_key": cordia_id, "done": True, "updated_at": _now().isoformat()},
                                                  on_conflict="user_id,item_key").execute()
                marked[cordia_id] = True
                done_in_google += 1
            elif kind == "subtask":
                step_id = cordia_id.split(":", 1)[1]
                step = next((s for s in steps if s["id"] == step_id), None)
                if step and not step.get("done"):
                    db.table("assignment_steps").update({"done": True, "done_at": _now().isoformat()}).eq("id", step_id).eq("user_id", user_id).execute()
                    step["done"] = True
                    done_in_google += 1

    def write(kind: str, cordia_id: str, title: str, due: datetime, notes: str, done: bool, parent: Optional[str] = None) -> Optional[str]:
        link = linked.get((kind, cordia_id))
        if link and link.get("removed_by_student"):
            return None
        fields = {"title": title[:200], "due": _due_date(due, zone), "notes": notes[:1000]}
        digest = _hash(fields["title"], fields["due"], done)
        if link:
            task = remote.get(link["external_id"]) or {}
            patch = {key: value for key, value in fields.items() if task.get(key) != value}
            if done and task.get("status") != "completed":
                patch["status"] = "completed"
            if patch and link.get("synced_hash") != digest:
                composio.run(account, user_id, "GOOGLETASKS_PATCH_TASK", {"tasklist_id": tasklist, "task_id": link["external_id"], **patch})
                save_link(user_id, "gtasks", kind, cordia_id, link["external_id"], tasklist, digest)
            return link["external_id"]
        if done:
            return None  # Nothing to add for work that's already finished.
        args = {"tasklist_id": tasklist, **fields, "status": "needsAction"}
        if parent:
            args["task_parent"] = parent
        made = composio.run(account, user_id, "GOOGLETASKS_INSERT_TASK", args)
        external = made.get("id") or (made.get("task") or {}).get("id")
        if external:
            save_link(user_id, "gtasks", kind, cordia_id, external, tasklist, digest)
        return external

    count = 0
    for item in items:
        done = bool(item.get("done") or marked.get(item["id"]))
        parent = write("task", item["id"], item["title"], _time(item["due_at"]), "\n".join(filter(None, [item.get("course"), item.get("url"), "From Cordia Classroom"])), done)
        count += 1 if parent else 0
        for step in sorted((s for s in steps if s["item_key"] == item["id"]), key=lambda s: s["position"]):
            if parent and step.get("due_at"):
                write("subtask", f"step:{step['id']}", step["title"], _time(step["due_at"]), f"Step {step['position'] + 1} of {item['title']}"[:1000],
                      bool(step.get("done") or done), parent)
    sync_state.record(user_id, "gtasks", stats={"tasks": count, "done_in_google": done_in_google})
    return {"on": True, "tasks": count, "done_in_google": done_in_google}


# ---- Google Calendar ----

def busy_times(user_id: str, account: str, start: datetime, end: datetime, extra_calendars: tuple = ()) -> list[tuple[datetime, datetime]]:
    """Busy intervals from the student's primary calendar (classes, work, plans) and Cordia's own."""
    data = composio.run(account, user_id, "GOOGLECALENDAR_FREE_BUSY_QUERY", {
        "items": [{"id": "primary"}, *({"id": c} for c in extra_calendars if c)],
        "timeMin": start.isoformat(), "timeMax": end.isoformat(),
    })
    calendars = data.get("calendars") or (data.get("response_data") or {}).get("calendars") or {}
    out = []
    for value in calendars.values():
        for span in (value or {}).get("busy") or []:
            a, b = _time(span.get("start")), _time(span.get("end"))
            if a and b:
                out.append((a, b))
    return out


def _event_window(event: dict) -> tuple[Optional[datetime], Optional[datetime]]:
    return _time((event.get("start") or {}).get("dateTime")), _time((event.get("end") or {}).get("dateTime"))


def sync_calendar(user_id: str) -> dict:
    state = sync_state.get(user_id, "gcal")
    calendar = state.get("container_id")
    if not calendar:
        return {"on": False}
    account = composio.active_accounts(user_id).get("gcal")
    if not account:
        sync_state.record(user_id, "gcal", error="Google Calendar isn't connected anymore.", needs_reconnect=True)
        return {"on": True, "error": "reconnect"}
    zone = zone_of((state.get("stats") or {}).get("time_zone"))
    db = get_supabase()
    now = _now()
    blocks = db.table("study_blocks").select("*").eq("user_id", user_id).gte("ends_at", (now - timedelta(days=1)).isoformat()) \
        .lte("starts_at", (now + timedelta(days=HORIZON_DAYS)).isoformat()).execute().data or []
    linked = links(user_id, "gcal")
    data = composio.run(account, user_id, "GOOGLECALENDAR_EVENTS_LIST", {
        "calendarId": calendar, "timeMin": (now - timedelta(days=1)).isoformat(), "timeMax": (now + timedelta(days=HORIZON_DAYS)).isoformat(),
        "singleEvents": True, "showDeleted": True, "maxResults": 250,
    })
    remote = {event.get("id"): event for event in data.get("items") or []}
    moved = removed = written = 0

    # The student owns study times: read their moves and deletions before writing anything.
    for block in blocks:
        link = linked.get(("event", f"block:{block['id']}"))
        if not link or link.get("removed_by_student"):
            continue
        event = remote.get(link["external_id"])
        if event is None or event.get("status") == "cancelled":
            db.table("study_blocks").update({"status": "removed", "updated_at": now.isoformat()}).eq("id", block["id"]).execute()
            save_link(user_id, "gcal", "event", f"block:{block['id']}", link["external_id"], calendar, link.get("synced_hash") or "", removed=True)
            block["status"] = "removed"
            removed += 1
            continue
        start, end = _event_window(event)
        if start and end and (start != _time(block["starts_at"]) or end != _time(block["ends_at"])):
            db.table("study_blocks").update({"starts_at": start.isoformat(), "ends_at": end.isoformat(), "status": "moved",
                                             "updated_at": now.isoformat()}).eq("id", block["id"]).execute()
            save_link(user_id, "gcal", "event", f"block:{block['id']}", link["external_id"], calendar, _hash(start.isoformat(), end.isoformat()))
            moved += 1

    titles = _block_titles(user_id, blocks)
    for block in blocks:
        if block["status"] in ("removed",) or ("event", f"block:{block['id']}") in linked:
            continue
        start, end = _time(block["starts_at"]), _time(block["ends_at"])
        made = composio.run(account, user_id, "GOOGLECALENDAR_CREATE_EVENT", {
            "calendar_id": calendar,
            "summary": titles.get(block["id"], "Study")[:200],
            "start_datetime": start.astimezone(zone).strftime("%Y-%m-%dT%H:%M:%S"),
            "end_datetime": end.astimezone(zone).strftime("%Y-%m-%dT%H:%M:%S"),
            "timezone": zone.key,
            "description": "Planned by Cordia Classroom. Move or delete it and Cordia keeps your change.",
        })
        external = made.get("id") or (made.get("response_data") or {}).get("id") or (made.get("event") or {}).get("id")
        if external:
            save_link(user_id, "gcal", "event", f"block:{block['id']}", external, calendar, _hash(start.isoformat(), end.isoformat()))
            written += 1
    planned = sum(1 for block in blocks if block["status"] in ("planned", "moved"))
    sync_state.record(user_id, "gcal", stats={"blocks": planned, "moved_by_you": moved, "removed_by_you": removed})
    return {"on": True, "blocks": planned, "added": written, "moved": moved, "removed": removed}


def _block_titles(user_id: str, blocks: list[dict]) -> dict:
    from routers.calendar import calendar_for
    names = {item["id"]: item.get("title") or "Assignment" for item in calendar_for(user_id).get("items") or []}
    step_ids = [block["step_id"] for block in blocks if block.get("step_id")]
    steps = {}
    if step_ids:
        steps = {row["id"]: row["title"] for row in get_supabase().table("assignment_steps").select("id,title").in_("id", step_ids).execute().data or []}
    out = {}
    for block in blocks:
        name = names.get(block["item_key"], "Assignment")
        if block.get("kind") == "review":
            out[block["id"]] = f"Review: {name}"
        else:
            step = steps.get(block.get("step_id"))
            out[block["id"]] = f"{name}: {step}" if step else f"Work on {name}"
    return out
