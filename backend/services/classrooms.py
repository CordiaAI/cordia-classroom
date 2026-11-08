"""Classrooms (social plan, Stage 5): groups a student is invited into, with roles.

A classroom is separate from a course (classes + class_terms): anyone can claim a course by typing
its code, but a classroom's members are let in by an invite, a code, or (for a public classroom
listed on its course page) a request. Roles:
  owner        everything; the only one who changes roles, transfers ownership or archives
  instructor   staff, in an approved instructor class
  admin        staff: settings, invites, items, milestones, approving and removing members
  member       studies; adds guides when members_can_add, invites when members_can_invite
An instructor class waits for an app admin's approval (instructor_request = 'requested') and works
as a study group until then. Visibility of the classroom itself:
  public     listed on its course page; anyone signed in can ask to join there, or use a link
  unlisted   only people with a link or code
  private    only people a member invites by name (links and codes don't work)

The backend uses the service role, so every rule (role, status, caps, blocks, archive) is checked
here. Behind CLASSROOMS; before migration 20261114120000 every read is empty.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from services.blocks import is_blocked

logger = logging.getLogger(__name__)

STAFF = ("owner", "instructor", "admin")
CAPS = {"study_group": 50, "instructor_class": 500}
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
FRIEND_INVITE_DAYS = 14


def enabled() -> bool:
    return os.getenv("CLASSROOMS", "").strip().lower() in ("1", "true", "yes", "on")


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(status_code=404, detail="Not found")


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_token() -> str:
    return secrets.token_urlsafe(24)


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


def clean_code(value: str) -> str:
    """What a student typed, as a code: capitals, no spaces or dashes."""
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def load(db, classroom_id: str) -> Optional[dict]:
    try:
        return _one(db.table("classrooms").select("*").eq("id", classroom_id).limit(1).execute())
    except Exception:  # before the migration
        return None


def membership(db, classroom_id: str, user_id: str) -> Optional[dict]:
    try:
        return _one(db.table("classroom_members").select("*").eq("classroom_id", classroom_id).eq("user_id", user_id).limit(1).execute())
    except Exception:
        return None


def active_count(db, classroom_id: str) -> int:
    return len(db.table("classroom_members").select("user_id").eq("classroom_id", classroom_id).eq("status", "active").execute().data or [])


def is_staff(me: Optional[dict]) -> bool:
    return bool(me and me.get("status") == "active" and me.get("role") in STAFF)


def member_of(db, classroom_id: str, user_id: str, staff: bool = False) -> tuple:
    """(classroom, my membership) for an active member (or staff); otherwise the same 404, so a
    classroom's existence isn't revealed to outsiders."""
    require_enabled()
    room = load(db, classroom_id)
    me = membership(db, classroom_id, user_id) if room else None
    if not room or room.get("archived_at") or not me or me.get("status") != "active":
        raise HTTPException(status_code=404, detail="Classroom not found")
    if staff and not is_staff(me):
        raise HTTPException(status_code=403, detail="Only the classroom's owner and admins can do that.")
    return room, me


def may_add(room: dict, me: dict) -> bool:
    return is_staff(me) or bool(room.get("members_can_add"))


def may_invite(room: dict, me: dict) -> bool:
    return is_staff(me) or bool(room.get("members_can_invite"))


def may_remove(me: dict, target: dict) -> bool:
    """The owner removes anyone else; instructors and admins remove members only."""
    if not target or target.get("role") == "owner" or me.get("user_id") == target.get("user_id"):
        return False
    if me.get("role") == "owner":
        return True
    return me.get("role") in ("instructor", "admin") and target.get("role") == "member"


def assignable_roles(room: dict) -> tuple:
    return ("instructor", "admin", "member") if room.get("kind") == "instructor_class" else ("admin", "member")


def cap(room: dict) -> int:
    return CAPS.get(room.get("kind") or "study_group", CAPS["study_group"])


def log(db, classroom_id: str, actor_id: Optional[str], kind: str, payload: Optional[dict] = None) -> None:
    try:
        db.table("classroom_activity").insert({"classroom_id": classroom_id, "actor_id": actor_id, "kind": kind,
                                               "payload": payload or {}, "created_at": now().isoformat()}).execute()
    except Exception as exc:
        logger.warning(f"Classroom activity not logged: {type(exc).__name__}")


# Invites ----------------------------------------------------------------------------------------

def make_invite(db, classroom_id: str, created_by: str, *, expires_days: Optional[int] = None, max_uses: Optional[int] = None,
                invitee_id: Optional[str] = None) -> dict:
    row = {"classroom_id": classroom_id, "token": new_token(), "short_code": new_code(), "created_by": created_by,
           "invitee_id": invitee_id, "max_uses": max_uses, "created_at": now().isoformat(),
           "expires_at": (now() + timedelta(days=expires_days)).isoformat() if expires_days else None}
    for _ in range(3):  # a code clash is unlikely; try again with a new one
        try:
            return _one(db.table("classroom_invites").insert(row).execute()) or row
        except Exception:
            row = {**row, "token": new_token(), "short_code": new_code()}
    raise HTTPException(status_code=503, detail="Couldn't make an invite. Try again.")


def find_invite(db, token: Optional[str] = None, code: Optional[str] = None) -> Optional[dict]:
    try:
        query = db.table("classroom_invites").select("*")
        query = query.eq("token", token) if token else query.eq("short_code", clean_code(code))
        return _one(query.limit(1).execute())
    except Exception:
        return None


def invite_problem(invite: Optional[dict], room: Optional[dict], user_id: Optional[str]) -> Optional[str]:
    """Why an invite can't be used, in plain words (None when it can)."""
    if not invite or not room or room.get("archived_at"):
        return "This invite isn't valid."
    if invite.get("revoked_at"):
        return "This invite was turned off."
    expires = invite.get("expires_at")
    if expires and datetime.fromisoformat(str(expires).replace("Z", "+00:00")) <= now():
        return "This invite has expired."
    if invite.get("max_uses") and (invite.get("uses") or 0) >= invite["max_uses"]:
        return "This invite has been used up."
    if invite.get("invitee_id") and user_id and invite["invitee_id"] != user_id:
        return "This invite is for someone else."
    if room.get("visibility") == "private" and not invite.get("invitee_id"):
        return "This classroom only lets in people a member invites by name."
    return None


def blocked_with(db, user_id: str, room: dict, invite: Optional[dict] = None) -> bool:
    """Blocked users can't invite, or be invited by, each other; nor join a blocker's classroom."""
    if is_blocked(db, user_id, room["owner_id"]):
        return True
    return bool(invite and invite.get("created_by") and is_blocked(db, user_id, invite["created_by"]))


def join(db, room: dict, user_id: str, share_progress: Optional[bool]) -> dict:
    """Let a student in (or put them in line for approval). Returns {status}."""
    me = membership(db, room["id"], user_id)
    if me and me.get("status") in ("active", "pending"):
        return {"status": me["status"]}
    if room.get("kind") == "instructor_class" and share_progress is None:
        raise HTTPException(status_code=409, detail="consent_required")
    if active_count(db, room["id"]) >= cap(room):
        raise HTTPException(status_code=409, detail="This classroom is full.")
    status = "pending" if room.get("join_policy") == "approval" else "active"
    row = {"classroom_id": room["id"], "user_id": user_id, "role": "member", "status": status,
           "progress_visible_to_staff": bool(share_progress) and room.get("kind") == "instructor_class", "joined_at": now().isoformat()}
    db.table("classroom_members").upsert(row, on_conflict="classroom_id,user_id").execute()
    if status == "active":
        log(db, room["id"], user_id, "member_joined")
    return {"status": status}


def use_invite(db, invite: dict) -> None:
    update = {"uses": (invite.get("uses") or 0) + 1}
    if invite.get("invitee_id"):
        update["revoked_at"] = now().isoformat()  # a personal invite works once
    db.table("classroom_invites").update(update).eq("id", invite["id"]).execute()


# What members can see -----------------------------------------------------------------------------

def _active_rooms(db, viewer: str, classroom_ids: list) -> set:
    if not classroom_ids:
        return set()
    mine = {r["classroom_id"] for r in (db.table("classroom_members").select("classroom_id").eq("user_id", viewer)
                                         .eq("status", "active").in_("classroom_id", classroom_ids).execute().data or [])}
    if not mine:
        return set()
    # A classroom held for review grants nothing to its members until it's cleared.
    return {r["id"] for r in (db.table("classrooms").select("*").in_("id", list(mine)).execute().data or [])
            if not r.get("archived_at") and (r.get("review_status") or "ok") == "ok"}


def grants(db, viewer: Optional[str], guide: dict) -> bool:
    """True when the viewer is an active member of a classroom the guide is shared with: directly
    (unless the author has since made it private), or through its folder (a folder shares
    everything in it with the classroom's members, now and later)."""
    if not viewer or not enabled():
        return False
    try:
        rooms = []
        if (guide.get("visibility") or "private") != "private":
            rooms += [r["classroom_id"] for r in (db.table("classroom_items").select("classroom_id").eq("item_type", "guide")
                                                  .eq("item_id", guide["id"]).execute().data or [])]
        if guide.get("folder_id"):
            rooms += [r["classroom_id"] for r in (db.table("classroom_items").select("classroom_id").eq("item_type", "folder")
                                                  .eq("item_id", guide["folder_id"]).execute().data or [])]
        return bool(_active_rooms(db, viewer, list(set(rooms))))
    except Exception:  # before the migration
        return False


def drop_items_of(db, classroom_id: str, user_id: str) -> None:
    """Someone leaves or is removed: their own guides and folders leave the classroom with them."""
    items = db.table("classroom_items").select("item_type,item_id").eq("classroom_id", classroom_id).execute().data or []
    guide_ids = [i["item_id"] for i in items if i["item_type"] == "guide"]
    folder_ids = [i["item_id"] for i in items if i["item_type"] == "folder"]
    own_guides = {g["id"] for g in (db.table("study_guides").select("id").eq("user_id", user_id).in_("id", guide_ids).execute().data or [])} if guide_ids else set()
    own_folders = {f["id"] for f in (db.table("folders").select("id").eq("user_id", user_id).in_("id", folder_ids).execute().data or [])} if folder_ids else set()
    for item_type, ids in (("guide", own_guides), ("folder", own_folders)):
        if ids:
            db.table("classroom_items").delete().eq("classroom_id", classroom_id).eq("item_type", item_type).in_("item_id", list(ids)).execute()
