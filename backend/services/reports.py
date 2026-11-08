"""Reports on guides, profiles and classrooms (social plan, Stage 9).

A report is one row in shared_set_reports naming its target (target_type, target_id), one per
person per target. Rules, all checked here because the backend uses the service role:
  - the reporter must be able to see the target (a guide through guide_access.can_view, a profile
    that isn't blocked either way, a classroom they're in or that's listed on its course page) and
    can't report their own;
  - the reasons offered depend on the target (REASONS);
  - 20 reports a day per person (rolling 24 hours, counted in the database so it holds across
    restarts and machines);
  - 3 or more different people with open reports hold the target at once (hold): a guide's own page
    and its class set, a profile, or a classroom disappear everywhere except for their owner (and
    a classroom's staff) until an admin clears it or keeps it hidden (decide). The database trigger
    hold_reported_target does the same; this keeps the rule if the trigger is ever missing.
Before migration 20261126120000 there is no target column: guide reports filed from a class set
keep the old set-only path, and anything else answers Unavailable ("isn't available yet").
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from services import classrooms as rooms
from services import guide_access
from services.blocks import is_blocked

TARGETS = ("guide", "profile", "classroom")
REASONS = {
    "guide": ("wrong", "copied_exam", "copyright", "inappropriate", "harassment"),
    "profile": ("harassment", "inappropriate"),
    "classroom": ("inappropriate", "harassment", "copied_exam"),
}
DAILY_LIMIT = 20
HOLD_AT = 3
HOLD_REASON = "Reported by 3 people"
TABLE = {"guide": "study_guides", "profile": "user_profiles", "classroom": "classrooms"}


class Unavailable(Exception):
    """Reports on this target need migration 20261126120000."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reports_today(db, reporter_id: str) -> int:
    since = (_now() - timedelta(hours=24)).isoformat()
    return len(db.table("shared_set_reports").select("id").eq("reporter_id", reporter_id).gte("created_at", since).execute().data or [])


def check_daily(db, reporter_id: str) -> None:
    if reports_today(db, reporter_id) >= DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="You've reached today's limit for reports. Try again tomorrow.")


def _owner(db, target_type: str, target_id: str, reporter_id: str) -> str:
    """The target's owner, after checking the reporter may see it (404 otherwise, the same as a
    target that doesn't exist)."""
    if target_type == "guide":
        return guide_access.viewable(db, reporter_id, target_id)["user_id"]
    if target_type == "profile":
        try:
            row = (db.table("user_profiles").select("id,review_status").eq("id", target_id).limit(1).execute().data or [None])[0]
        except Exception:
            row = (db.table("user_profiles").select("id").eq("id", target_id).limit(1).execute().data or [None])[0]
        if not row or (row.get("review_status") or "ok") != "ok" or is_blocked(db, reporter_id, target_id):
            raise HTTPException(status_code=404, detail="User not found")
        return row["id"]
    room = rooms.load(db, target_id) if rooms.enabled() else None
    me = rooms.membership(db, target_id, reporter_id) if room else None
    member = bool(me and me.get("status") == "active")
    listed = bool(room) and room.get("visibility") == "public" and (room.get("review_status") or "ok") == "ok"
    if not room or room.get("archived_at") or not (member or listed) or (not member and rooms.blocked_with(db, reporter_id, room)):
        raise HTTPException(status_code=404, detail="Classroom not found")
    return room["owner_id"]


def open_reporters(db, target_type: str, target_id: str) -> set:
    rows = db.table("shared_set_reports").select("reporter_id").eq("target_type", target_type).eq("target_id", target_id) \
        .eq("status", "open").execute().data or []
    return {r["reporter_id"] for r in rows}


def hold(db, target_type: str, target_id: str, reason: str = HOLD_REASON) -> None:
    """Hide the target everywhere except from its owner (and a classroom's staff)."""
    db.table(TABLE[target_type]).update({"review_status": "held", "hold_reason": reason}).eq("id", target_id).eq("review_status", "ok").execute()
    if target_type == "guide":
        db.table("shared_sets").update({"status": "hidden", "updated_at": _now().isoformat()}).eq("guide_id", target_id).eq("status", "visible").execute()


def file(db, reporter_id: str, target_type: str, target_id: str, reason: str, set_id: Optional[str] = None) -> dict:
    """File (or change the reason of) this person's report. Returns {"ok", "held"}."""
    if target_type not in TARGETS or reason not in REASONS[target_type]:
        raise HTTPException(status_code=400, detail="Pick a reason from the list")
    owner = _owner(db, target_type, target_id, reporter_id)
    if owner == reporter_id:
        raise HTTPException(status_code=400, detail="You can't report your own.")
    check_daily(db, reporter_id)
    row = {"target_type": target_type, "target_id": target_id, "reporter_id": reporter_id, "reason": reason, "status": "open"}
    if set_id:
        row["set_id"] = set_id
    try:
        db.table("shared_set_reports").upsert(row, on_conflict="target_type,target_id,reporter_id").execute()
    except Exception:  # before migration 20261126120000
        raise Unavailable()
    held = len(open_reporters(db, target_type, target_id)) >= HOLD_AT
    if held:
        hold(db, target_type, target_id)
    return {"ok": True, "held": held}


def file_set_report(db, reporter_id: str, shared: dict, reason: str) -> dict:
    """A report filed from a class set: it reports the guide behind the set. Before the migration
    (or for an old set with no guide) it keeps the set-only path."""
    if shared.get("guide_id"):
        try:
            return file(db, reporter_id, "guide", shared["guide_id"], reason, set_id=shared["id"])
        except Unavailable:
            pass
        except HTTPException as exc:
            if exc.status_code != 404:  # a set the reporter sees whose guide they can't: report the set
                raise
    check_daily(db, reporter_id)
    db.table("shared_set_reports").upsert({"set_id": shared["id"], "reporter_id": reporter_id, "reason": reason},
                                          on_conflict="set_id,reporter_id").execute()
    open_rows = db.table("shared_set_reports").select("reporter_id").eq("set_id", shared["id"]).eq("status", "open").execute().data or []
    held = len({r["reporter_id"] for r in open_rows}) >= HOLD_AT
    if held:
        db.table("shared_sets").update({"status": "hidden"}).eq("id", shared["id"]).eq("status", "visible").execute()
        if shared.get("guide_id"):
            try:
                db.table("study_guides").update({"review_status": "held", "hold_reason": "Reported by classmates"}) \
                    .eq("id", shared["guide_id"]).eq("review_status", "ok").execute()
            except Exception:  # before the Stage 3 migration
                pass
    return {"ok": True, "held": held}


# Admin ------------------------------------------------------------------------------------------
def queue(db, target_type: Optional[str] = None) -> list:
    """Open reports grouped by target, most reporters first, with a short summary of each target."""
    try:
        query = db.table("shared_set_reports").select("target_type,target_id,reason,created_at").eq("status", "open")
        rows = (query.eq("target_type", target_type) if target_type else query).execute().data or []
    except Exception:  # before the migration
        return []
    groups: dict = {}
    for r in rows:
        if not r.get("target_type"):
            continue
        key = (r["target_type"], r["target_id"])
        entry = groups.setdefault(key, {"target_type": key[0], "target_id": key[1], "count": 0, "reasons": {}, "first_at": r.get("created_at")})
        entry["count"] += 1
        entry["reasons"][r["reason"]] = entry["reasons"].get(r["reason"], 0) + 1
        entry["first_at"] = min(str(entry["first_at"] or ""), str(r.get("created_at") or "")) or None
    out = []
    for entry in groups.values():
        entry["target"] = _summary(db, entry["target_type"], entry["target_id"])
        out.append(entry)
    return sorted(out, key=lambda e: (-e["count"], str(e["first_at"] or "")))


def _summary(db, target_type: str, target_id: str) -> dict:
    try:
        if target_type == "guide":
            row = (db.table("study_guides").select("id,title,user_id,visibility,review_status,hold_reason").eq("id", target_id).limit(1).execute().data or [None])[0]
            return {"title": (row or {}).get("title") or "Untitled", "status": (row or {}).get("review_status") or "ok",
                    "visibility": (row or {}).get("visibility"), "link": f"/sets/{target_id}"} if row else {"missing": True}
        if target_type == "profile":
            row = (db.table("user_profiles").select("id,username,display_name,name,review_status").eq("id", target_id).limit(1).execute().data or [None])[0]
            return {"title": "@" + str(row.get("username")) if row.get("username") else (row.get("display_name") or row.get("name") or "Someone"),
                    "status": row.get("review_status") or "ok", "link": f"/u/{row['username']}" if row.get("username") else None} if row else {"missing": True}
        row = (db.table("classrooms").select("id,name,kind,visibility,review_status,archived_at").eq("id", target_id).limit(1).execute().data or [None])[0]
        return {"title": row.get("name") or "Classroom", "status": row.get("review_status") or "ok", "kind": row.get("kind"),
                "visibility": row.get("visibility")} if row else {"missing": True}
    except Exception:
        return {"missing": True}


def decide(db, target_type: str, target_id: str, decision: str) -> None:
    """clear: the reports are dismissed and the target is back for everyone. hide: the reports are
    upheld and the target stays hidden from everyone but its owner."""
    status = "ok" if decision == "clear" else "hidden"
    db.table(TABLE[target_type]).update({"review_status": status, "hold_reason": None}).eq("id", target_id).execute()
    db.table("shared_set_reports").update({"status": "dismissed" if decision == "clear" else "upheld"}) \
        .eq("target_type", target_type).eq("target_id", target_id).eq("status", "open").execute()
    if target_type == "guide":
        db.table("shared_sets").update({"status": "visible" if decision == "clear" else "hidden", "hold_reason": None, "updated_at": _now().isoformat()}) \
            .eq("guide_id", target_id).in_("status", ["held", "hidden", "visible"]).execute()
