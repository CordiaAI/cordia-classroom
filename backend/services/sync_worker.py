"""Background sync on the always-on Fly machine (min_machines_running = 1).

Every 5 minutes it looks for users due a sync (Canvas, then one connector_settings query for every
other app) and claims each one with a conditional update, so two
machines never sync the same user at once:
- Canvas every 20 minutes (assignments, grades, announcements), for connected, unpaused tokens.
- Google Tasks and Calendar every 15 minutes, for students who turned Cordia sync on.
- Google Drive folders linked to classes every 30 minutes (new and changed files into Library).
- Gmail and Outlook every 30 minutes for students watching for date changes (services.mail_watch).
- The Notion course database every 30 minutes, and linked Google Doc drafts every 6 hours.
- Dropbox class folders and watched Slack channels every 30 minutes, GitHub repos on assignments
  every 6 hours, the Google Sheets export daily when it's set to keep itself updated, and Slack
  study-session reminders when they're due (checked every minute).
- Exams found in Canvas get their review sessions scheduled once Calendar sync is on.
On by default on Fly (FLY_APP_NAME is set there), off elsewhere; SYNC_WORKER=1 or 0 overrides.
"""

import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from database import get_supabase
from services import sync_state

log = logging.getLogger(__name__)
TICK_SECONDS = 300      # the shortest sync interval is 15 minutes (Google), so 5 minutes is plenty
REMINDER_SECONDS = 60   # Slack session reminders can be 5 minutes ahead: checked every minute (one query)
CANVAS_EVERY = timedelta(minutes=20)
GOOGLE_EVERY = timedelta(minutes=15)
PER_TICK = 20
_started = False


def _rules() -> dict[str, tuple[str, timedelta]]:
    """connector -> (what makes a row eligible, as a PostgREST filter; how often it syncs)."""
    from services import docs_sync, github_sync, mail_watch, sheets_export, slack_sync
    half_hour = timedelta(minutes=30)
    return {
        "gtasks": ("container_id.not.is.null", GOOGLE_EVERY),
        "gcal": ("container_id.not.is.null", GOOGLE_EVERY),
        "gdrive": ("stats->>linked.eq.true", half_hour),
        **{app: ("stats->>watch_dates.eq.true", mail_watch.EVERY) for app in mail_watch.MAIL_APPS},
        "notion": ("container_id.not.is.null", half_hour),
        "gdocs": ("", docs_sync.DRAFT_EVERY),  # narrowed to students with linked drafts below
        "dropbox": ("stats->>linked.eq.true", half_hour),
        "github": ("stats->>linked.eq.true", github_sync.EVERY),
        "gsheets": ("stats->>auto.eq.true", sheets_export.EVERY),
        "slack": ("stats->>watching.eq.true", slack_sync.EVERY),
    }


def due_connectors(now: datetime) -> dict[str, list[dict]]:
    """Every connector's due rows from one connector_settings query, oldest first, PER_TICK each."""
    rules = _rules()
    groups = []
    for connector, (eligible, every) in rules.items():
        cutoff = (now - every).isoformat()
        parts = [f"connector.eq.{connector}", eligible, f"or(last_synced_at.is.null,last_synced_at.lt.{cutoff})"]
        groups.append(f"and({','.join(part for part in parts if part)})")
    rows = get_supabase().table("connector_settings").select("user_id,connector,last_synced_at") \
        .in_("connector", list(rules)).or_(",".join(groups)) \
        .order("last_synced_at", desc=False, nullsfirst=True).limit(PER_TICK * len(rules)).execute().data or []
    due: dict[str, list[dict]] = {connector: [] for connector in rules}
    for row in rows:
        bucket = due.get(row["connector"])
        if bucket is not None and len(bucket) < PER_TICK:
            bucket.append(row)
    if due["gdocs"]:
        from services import docs_sync
        drafting = docs_sync.users_with_drafts([row["user_id"] for row in due["gdocs"]])
        due["gdocs"] = [row for row in due["gdocs"] if row["user_id"] in drafting]
    return due


def _due_canvas(now: datetime) -> list[dict]:
    cutoff = (now - CANVAS_EVERY).isoformat()
    return get_supabase().table("canvas_connections").select("user_id,last_synced_at").eq("status", "connected") \
        .eq("sync_paused", False).or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(PER_TICK).execute().data or []


def _claim_canvas(row: dict, now: datetime) -> bool:
    q = get_supabase().table("canvas_connections").update({"last_synced_at": now.isoformat()}).eq("user_id", row["user_id"])
    q = q.eq("last_synced_at", row["last_synced_at"]) if row.get("last_synced_at") else q.is_("last_synced_at", "null")
    return bool(q.execute().data)


def _run_google(user_id: str, connector: str) -> None:
    from routers import plans
    from services import google_sync
    if connector == "gcal":
        plans.schedule_exams(user_id)
        google_sync.sync_calendar(user_id)
    else:
        google_sync.sync_tasks(user_id)


def _runners() -> dict:
    """connector -> (run(user_id, connector), message shown when it fails)."""
    from services import docs_sync, drive_sync, dropbox_sync, github_sync, mail_watch, notion_sync, sheets_export, slack_sync
    failed = "Sync failed. It will try again soon."
    plain = lambda run: (lambda user_id, _connector: run(user_id), failed)  # noqa: E731
    return {
        "gtasks": (_run_google, failed), "gcal": (_run_google, failed),
        "gdrive": (lambda user_id, _connector: drive_sync.sync_folders(user_id), "Drive sync failed. It will try again soon."),
        **{app: (mail_watch.watch, "Checking mail failed. It will try again soon.") for app in mail_watch.MAIL_APPS},
        "notion": plain(notion_sync.sync_db), "gdocs": plain(docs_sync.check_drafts),
        "dropbox": plain(dropbox_sync.sync_folders), "github": plain(github_sync.check_repos),
        "gsheets": plain(sheets_export.auto_export), "slack": plain(slack_sync.watch),
    }


def tick() -> None:
    from routers import canvas
    now = datetime.now(timezone.utc)
    for row in _due_canvas(now):
        if not _claim_canvas(row, now):
            continue
        try:
            canvas.sync(get_supabase(), row["user_id"])
        except Exception as error:
            log.info("background canvas sync failed: %s", type(error).__name__)
    runners = _runners()
    for connector, rows in due_connectors(now).items():
        run, message = runners[connector]
        for row in rows:
            if not sync_state.claim(row["user_id"], connector, row.get("last_synced_at")):
                continue
            try:
                run(row["user_id"], connector)
            except Exception as error:
                log.info("background %s sync failed: %s", connector, type(error).__name__)
                sync_state.record(row["user_id"], connector, error=message)


def send_reminders() -> None:
    from services import slack_sync
    now = datetime.now(timezone.utc)
    for user_id in slack_sync.due_reminders(now):
        try:
            slack_sync.send_reminders(user_id, now)
        except Exception as error:
            log.info("slack reminders failed: %s", type(error).__name__)


def _loop() -> None:
    last_tick = 0.0
    while True:
        if time.monotonic() - last_tick >= TICK_SECONDS:
            last_tick = time.monotonic()
            try:
                tick()
            except Exception:
                log.exception("sync worker tick failed")
        try:
            send_reminders()
        except Exception:
            log.exception("slack reminder check failed")
        time.sleep(REMINDER_SECONDS)


def start() -> None:
    global _started
    if _started or os.getenv("SYNC_WORKER", "1" if os.getenv("FLY_APP_NAME") else "0") != "1":
        return
    _started = True
    threading.Thread(target=_loop, name="sync-worker", daemon=True).start()
