"""Copyright takedowns: a report is received, staff review it, and only staff hold or remove anything.

- A report names a guide page (/sets/<guide id>), an older class-set link, or a profile
  (/u/<username>). `target` finds the guide and its class set, or the profile.
- One open report per item: a later report on the same item attaches to the open one (`open_report`).
- Staff can hold an item while they confirm the reporter by email from support@cordiaai.io, and take it
  down only once they have. Every hold or removal records the item's state just before it
  (set_status_before, guide_status_before, guide_hold_reason_before), so rejecting a report puts back
  exactly what this report changed and never clears a hold placed for another reason.
- The owner gets an in-app notification ("copyright_report") when a report on their item arrives.

The review columns and the one-open-report indexes come from migration 20261127120000 (NOT APPLIED
until the owner runs it). Until then reports are still received and queued, duplicates are
acknowledged without a new row, and the steps that need the new columns say so.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

HOLD_REASON = "Copyright report"
NOTIFY_KIND = "copyright_report"
# Reports accepted per day across every backend machine (counted from the table, not in memory).
DAILY_CAP = max(1, int(os.getenv("TAKEDOWN_DAILY_CAP", "50") or 50))
_ID = re.compile(r"set=([0-9a-fA-F-]{36})|/sets?/([0-9a-fA-F-]{36})")
_PROFILE = re.compile(r"/u/([A-Za-z0-9_.]{1,64})(?![A-Za-z0-9_.])")


class NeedsMigration(Exception):
    """A review step that needs migration 20261127120000's columns."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _first(result) -> Optional[dict]:
    return (result.data or [None])[0]


def profile_from(location: str, db) -> Optional[str]:
    """The user id behind a /u/<username> link (a recently released name still finds its owner)."""
    from services import usernames
    found = _PROFILE.search(location or "")
    if not found:
        return None
    name = usernames.normalize(found.group(1))
    row = _first(db.table("user_profiles").select("id").eq("username", name).limit(1).execute())
    if row:
        return row["id"]
    return usernames.held_by(db, name, datetime.now(timezone.utc))


def target(db, location: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(set_id, guide_id, profile_id) named by a report's link; any may be None. A profile is looked
    for only when the link names no guide or set."""
    set_id, guide_id = _guide_target(db, location)
    return set_id, guide_id, None if (set_id or guide_id) else profile_from(location, db)


def _guide_target(db, location: str) -> tuple[Optional[str], Optional[str]]:
    found = _ID.search(location or "")
    if not found:
        return None, None
    try:
        candidate = str(uuid.UUID(found.group(1) or found.group(2)))
    except ValueError:
        return None, None
    shared = _first(db.table("shared_sets").select("id,guide_id").eq("id", candidate).limit(1).execute())
    guide_id = None
    if not shared:
        shared = _first(db.table("shared_sets").select("id,guide_id").eq("guide_id", candidate).limit(1).execute())
        if shared or db.table("study_guides").select("id").eq("id", candidate).limit(1).execute().data:
            guide_id = candidate
    if shared:
        return shared["id"], guide_id or shared.get("guide_id")
    return None, guide_id


def received_today(db) -> int:
    """Reports created since midnight UTC, read from the database so every machine sees the same count."""
    midnight = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    result = db.table("copyright_takedowns").select("id", count="exact").gte("created_at", midnight).execute()
    return result.count if result.count is not None else len(result.data or [])


def open_report(db, set_id: Optional[str], guide_id: Optional[str], profile_id: Optional[str], location: str) -> Optional[dict]:
    """The open (received) report on the same item, if there is one."""
    query = db.table("copyright_takedowns").select("id,location,guide_id,set_id").eq("status", "received")
    if guide_id:
        return _first(query.eq("guide_id", guide_id).limit(1).execute())
    if set_id:
        return _first(query.eq("set_id", set_id).limit(1).execute())
    if profile_id:
        try:  # profile_id arrives with migration 20261126120000; before it, matched by link below
            return _first(db.table("copyright_takedowns").select("id").eq("status", "received").eq("profile_id", profile_id).limit(1).execute())
        except Exception:
            pass
    wanted = location.strip().lower()
    rows = query.is_("guide_id", "null").is_("set_id", "null").limit(500).execute().data or []
    return next((r for r in rows if (r.get("location") or "").strip().lower() == wanted), None)


def attach(db, report: dict) -> None:
    """A later report on an item that already has an open one: counted on it, no new queue item."""
    try:
        current = _first(db.table("copyright_takedowns").select("duplicate_count").eq("id", report["id"]).limit(1).execute()) or {}
        db.table("copyright_takedowns").update({
            "duplicate_count": int(current.get("duplicate_count") or 0) + 1, "last_reported_at": now(),
        }).eq("id", report["id"]).execute()
    except Exception:  # before migration 20261127120000: acknowledged, nothing new written
        logger.info("Duplicate takedown acknowledged without a count (migration not applied)")


def owner_and_title(db, set_id: Optional[str], guide_id: Optional[str], profile_id: Optional[str] = None) -> tuple[Optional[str], str]:
    if guide_id:
        guide = _first(db.table("study_guides").select("user_id,title").eq("id", guide_id).limit(1).execute())
        if guide:
            return guide.get("user_id"), guide.get("title") or ""
    if set_id:
        shared = _first(db.table("shared_sets").select("owner_id,title").eq("id", set_id).limit(1).execute())
        if shared:
            return shared.get("owner_id"), shared.get("title") or ""
    if profile_id:
        profile = _first(db.table("user_profiles").select("username").eq("id", profile_id).limit(1).execute()) or {}
        return profile_id, profile.get("username") or ""
    return None, ""


def notify_owner(db, set_id: Optional[str], guide_id: Optional[str], profile_id: Optional[str] = None) -> bool:
    """Tells the owner a copyright report was filed on their item and is being reviewed. Never fails
    the report: anything that goes wrong is logged and skipped."""
    try:
        owner, title = owner_and_title(db, set_id, guide_id, profile_id)
        if not owner:
            return False
        db.table("notifications").insert({
            "user_id": owner, "kind": NOTIFY_KIND, "created_at": now(),
            "payload": {"guide_id": guide_id, "set_id": set_id, "profile": bool(profile_id), "title": title[:200]},
        }).execute()
        return True
    except Exception:
        logger.warning("Copyright report notification skipped", exc_info=True)
        return False


# Staff actions -------------------------------------------------------------------------------------

def _before(db, row: dict) -> dict:
    """The item's state right now, to put back if this report is rejected."""
    out = {}
    if row.get("set_id"):
        shared = _first(db.table("shared_sets").select("status").eq("id", row["set_id"]).limit(1).execute())
        out["set_status_before"] = shared.get("status") if shared else None
    if row.get("guide_id"):
        guide = _first(db.table("study_guides").select("review_status,hold_reason").eq("id", row["guide_id"]).limit(1).execute())
        if guide:
            out["guide_status_before"] = guide.get("review_status") or "ok"
            out["guide_hold_reason_before"] = guide.get("hold_reason")
    return out


def _record_before(db, row: dict) -> dict:
    """Saves the item's state before this report first changes it (once: a later removal after a
    hold keeps the state from before the hold)."""
    if row.get("set_status_before") is not None or row.get("guide_status_before") is not None:
        return row
    before = _before(db, row)
    try:
        db.table("copyright_takedowns").update(before).eq("id", row["id"]).execute()
    except Exception:
        raise NeedsMigration
    return {**row, **before}


def hold(db, row: dict, admin_id: str) -> None:
    """A temporary hold while staff confirm the reporter: hidden from everyone but the owner."""
    row = _record_before(db, row)
    if row.get("set_id") and row.get("set_status_before") == "visible":
        db.table("shared_sets").update({"status": "held", "hold_reason": HOLD_REASON}).eq("id", row["set_id"]).eq("status", "visible").execute()
    if row.get("guide_id") and row.get("guide_status_before") == "ok":
        db.table("study_guides").update({"review_status": "held", "hold_reason": HOLD_REASON}).eq("id", row["guide_id"]).eq("review_status", "ok").execute()
    db.table("copyright_takedowns").update({"held_by": admin_id, "held_at": now()}).eq("id", row["id"]).execute()


def take_down(db, row: dict, admin_id: str) -> None:
    if row.get("profile_id"):  # a profile is never held on a report, only hidden once actioned
        db.table("user_profiles").update({"review_status": "hidden", "hold_reason": HOLD_REASON}).eq("id", row["profile_id"]).execute()
        return
    row = _record_before(db, row)
    if row.get("set_id"):
        db.table("shared_sets").update({"status": "taken_down"}).eq("id", row["set_id"]).execute()
    if row.get("guide_id"):
        db.table("study_guides").update({"review_status": "hidden", "hold_reason": HOLD_REASON}).eq("id", row["guide_id"]).execute()


def restore(db, row: dict) -> None:
    """Rejecting a report undoes only what this report did: a hold it placed is lifted back to the
    state recorded before it. A hold or removal for any other reason is left alone."""
    if not row.get("held_at"):
        return
    if row.get("set_id") and row.get("set_status_before"):
        db.table("shared_sets").update({"status": row["set_status_before"], "hold_reason": None}) \
            .eq("id", row["set_id"]).eq("status", "held").eq("hold_reason", HOLD_REASON).execute()
    if row.get("guide_id") and row.get("guide_status_before"):
        db.table("study_guides").update({"review_status": row["guide_status_before"], "hold_reason": row.get("guide_hold_reason_before")}) \
            .eq("id", row["guide_id"]).eq("review_status", "held").eq("hold_reason", HOLD_REASON).execute()
