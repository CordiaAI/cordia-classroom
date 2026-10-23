"""Background sync on the always-on Fly machine (min_machines_running = 1).

Every minute it looks for users due a sync and claims each one with a conditional update, so two
machines never sync the same user at once:
- Canvas every 20 minutes (assignments, grades, announcements), for connected, unpaused tokens.
- Google Tasks and Calendar every 15 minutes, for students who turned Cordia sync on.
- Google Drive folders linked to classes every 30 minutes (new and changed files into Library).
- Gmail and Outlook every 30 minutes for students watching for date changes (services.mail_watch).
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
TICK_SECONDS = 60
CANVAS_EVERY = timedelta(minutes=20)
GOOGLE_EVERY = timedelta(minutes=15)
PER_TICK = 20
_started = False


def _due_canvas(now: datetime) -> list[dict]:
    cutoff = (now - CANVAS_EVERY).isoformat()
    return get_supabase().table("canvas_connections").select("user_id,last_synced_at").eq("status", "connected") \
        .eq("sync_paused", False).or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(PER_TICK).execute().data or []


def _claim_canvas(row: dict, now: datetime) -> bool:
    q = get_supabase().table("canvas_connections").update({"last_synced_at": now.isoformat()}).eq("user_id", row["user_id"])
    q = q.eq("last_synced_at", row["last_synced_at"]) if row.get("last_synced_at") else q.is_("last_synced_at", "null")
    return bool(q.execute().data)


def _due_google(now: datetime) -> list[dict]:
    cutoff = (now - GOOGLE_EVERY).isoformat()
    return get_supabase().table("connector_settings").select("user_id,connector,last_synced_at").in_("connector", ["gtasks", "gcal"]) \
        .not_.is_("container_id", "null").or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(PER_TICK).execute().data or []


def tick() -> None:
    from routers import canvas, plans
    from services import drive_sync, google_sync, mail_watch
    now = datetime.now(timezone.utc)
    for row in _due_canvas(now):
        if not _claim_canvas(row, now):
            continue
        try:
            canvas.sync(get_supabase(), row["user_id"])
        except Exception as error:
            log.info("background canvas sync failed: %s", type(error).__name__)
    for row in _due_google(now):
        if not sync_state.claim(row["user_id"], row["connector"], row.get("last_synced_at")):
            continue
        try:
            if row["connector"] == "gcal":
                plans.schedule_exams(row["user_id"])
                google_sync.sync_calendar(row["user_id"])
            else:
                google_sync.sync_tasks(row["user_id"])
        except Exception as error:
            log.info("background %s sync failed: %s", row["connector"], type(error).__name__)
            sync_state.record(row["user_id"], row["connector"], error="Sync failed. It will try again soon.")
    for row in drive_sync.due(now):
        if not sync_state.claim(row["user_id"], "gdrive", row.get("last_synced_at")):
            continue
        try:
            drive_sync.sync_folders(row["user_id"])
        except Exception as error:
            log.info("background drive sync failed: %s", type(error).__name__)
            sync_state.record(row["user_id"], "gdrive", error="Drive sync failed. It will try again soon.")
    for row in mail_watch.due(now):
        if not sync_state.claim(row["user_id"], row["connector"], row.get("last_synced_at")):
            continue
        try:
            mail_watch.watch(row["user_id"], row["connector"])
        except Exception as error:
            log.info("background mail watch failed: %s", type(error).__name__)
            sync_state.record(row["user_id"], row["connector"], error="Checking mail failed. It will try again soon.")


def _loop() -> None:
    while True:
        try:
            tick()
        except Exception:
            log.exception("sync worker tick failed")
        time.sleep(TICK_SECONDS)


def start() -> None:
    global _started
    if _started or os.getenv("SYNC_WORKER", "1" if os.getenv("FLY_APP_NAME") else "0") != "1":
        return
    _started = True
    threading.Thread(target=_loop, name="sync-worker", daemon=True).start()
