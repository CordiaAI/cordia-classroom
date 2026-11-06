"""Classrooms (social plan, Stage 5): create and manage them, invite and join, share guides and
folders, milestones, and the activity feed. Rules live in services/classrooms.py; every route
re-checks role, status, blocks and caps itself (the service role bypasses RLS). Behind CLASSROOMS.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import classroom_study as cstudy
from services import classrooms as rooms
from services import guide_versions as versions
from services import viewer_study
from services import guide_access as access
from services import social_graph as graph
from services.blocks import hidden_from, is_blocked
from services.class_db import is_member

router = APIRouter(prefix="/classrooms", tags=["classrooms"])
join_router = APIRouter(prefix="/join", tags=["classrooms"])
WRITE = [Depends(ai_rate_limit(30, 60))]
MAX_OWNED = 50


def _uid(authorization: str) -> str:
    rooms.require_enabled()
    return get_user_id(authorization)


def _optional_uid(authorization: str) -> Optional[str]:
    if not authorization:
        return None
    try:
        return get_user_id(authorization)
    except HTTPException:
        return None


def _course(db, class_id: Optional[str]) -> Optional[dict]:
    if not class_id:
        return None
    return (db.table("classes").select("id,course_code_normalized,display_name,school_id").eq("id", class_id).limit(1).execute().data or [None])[0]


def _summary(db, room: dict, me: Optional[dict]) -> dict:
    """A classroom as its members see it."""
    course = _course(db, room.get("class_id"))
    staff = rooms.is_staff(me)
    out = {
        "id": room["id"], "name": room["name"], "description": room.get("description") or "",
        "kind": room.get("kind") or "study_group", "instructor_request": room.get("instructor_request"),
        "visibility": room.get("visibility") or "unlisted", "join_policy": room.get("join_policy") or "auto",
        "members_can_add": bool(room.get("members_can_add")), "members_can_invite": bool(room.get("members_can_invite")),
        "class": {"id": course["id"], "code": course.get("course_code_normalized")} if course else None,
        "member_count": rooms.active_count(db, room["id"]),
        "me": {"role": me.get("role"), "status": me.get("status"), "progress_visible_to_staff": bool(me.get("progress_visible_to_staff"))} if me else None,
        "can": {"add": bool(me) and me.get("status") == "active" and rooms.may_add(room, me),
                "invite": bool(me) and me.get("status") == "active" and rooms.may_invite(room, me),
                "manage": staff, "owner": bool(me) and me.get("role") == "owner"},
    }
    if staff:
        out["pending_count"] = len(db.table("classroom_members").select("user_id").eq("classroom_id", room["id"]).eq("status", "pending").execute().data or [])
    return out


# Classrooms -----------------------------------------------------------------------------------------
class ClassroomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    kind: Literal["study_group", "instructor_class"] = "study_group"
    class_id: Optional[str] = None
    visibility: Literal["public", "unlisted", "private"] = "unlisted"
    join_policy: Literal["auto", "approval"] = "auto"
    members_can_add: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, value):
        if not value.strip():
            raise ValueError("Give it a name")
        return value.strip()


@router.get("")
def my_classrooms(can_add: bool = False, authorization: str = Header(default="")):
    """Classrooms you're in (and ones waiting on your approval request), newest first. can_add=true
    lists only the ones you can add guides to (the "Add to classroom" picker)."""
    user_id = _uid(authorization)
    db = get_supabase()
    mine = db.table("classroom_members").select("*").eq("user_id", user_id).in_("status", ["active", "pending"]).execute().data or []
    if not mine:
        return {"classrooms": []}
    by_id = {m["classroom_id"]: m for m in mine}
    found = db.table("classrooms").select("*").in_("id", list(by_id)).execute().data or []
    out = []
    for room in sorted(found, key=lambda r: str(r.get("created_at") or ""), reverse=True):
        me = by_id[room["id"]]
        if room.get("archived_at") or (can_add and (me.get("status") != "active" or not rooms.may_add(room, me))):
            continue
        out.append(_summary(db, room, me))
    return {"classrooms": out}


@router.post("", dependencies=[Depends(ai_rate_limit(5, 60))])
def create_classroom(body: ClassroomCreate, authorization: str = Header(default="")):
    """A new study group, or a request for an instructor class: it works as a study group until an
    admin approves it."""
    user_id = _uid(authorization)
    db = get_supabase()
    owned = db.table("classrooms").select("id").eq("owner_id", user_id).is_("archived_at", "null").execute().data or []
    if len(owned) >= MAX_OWNED:
        raise HTTPException(status_code=409, detail="You own the most classrooms you can. Archive one first.")
    course = None
    if body.class_id:
        course = _course(db, require_uuid(body.class_id, "class ID"))
        if not course or not is_member(db, user_id, course["id"]):
            raise HTTPException(status_code=400, detail="Add that class to your Library first.")
    instructor = body.kind == "instructor_class"
    row = {
        "kind": "study_group", "name": body.name, "description": (body.description or "").strip() or None,
        "class_id": course["id"] if course else None, "school_id": course.get("school_id") if course else None,
        "visibility": body.visibility, "join_policy": body.join_policy,
        "members_can_add": body.members_can_add if body.members_can_add is not None else not instructor,
        "members_can_invite": True, "instructor_request": "requested" if instructor else None,
        "owner_id": user_id, "created_at": rooms.now().isoformat(),
    }
    room = (db.table("classrooms").insert(row).execute().data or [None])[0]
    if not room:
        raise HTTPException(status_code=500, detail="Couldn't make the classroom. Try again.")
    db.table("classroom_members").insert({"classroom_id": room["id"], "user_id": user_id, "role": "owner", "status": "active",
                                          "joined_at": rooms.now().isoformat()}).execute()
    return {"classroom": _summary(db, room, rooms.membership(db, room["id"], user_id))}


@router.get("/for-class/{class_id}")
def course_classrooms(class_id: str, authorization: str = Header(default="")):
    """Public classrooms for a course (its page's "Classrooms for this course")."""
    user_id = _uid(authorization)
    db = get_supabase()
    found = (db.table("classrooms").select("*").eq("class_id", require_uuid(class_id, "class ID")).eq("visibility", "public")
             .is_("archived_at", "null").limit(50).execute().data or [])
    hidden = hidden_from(db, user_id)
    owners = graph.cards(db, [r["owner_id"] for r in found])
    out = []
    for room in found:
        if room["owner_id"] in hidden:
            continue
        me = rooms.membership(db, room["id"], user_id)
        out.append({"id": room["id"], "name": room["name"], "kind": room.get("kind"), "member_count": rooms.active_count(db, room["id"]),
                    "owner": owners.get(room["owner_id"]), "join_policy": room.get("join_policy"),
                    "my_status": me.get("status") if me and me.get("status") != "removed" else None})
    return {"classrooms": out}


@router.get("/due")
def due_across_classrooms(authorization: str = Header(default="")):
    """For the Dashboard: how much is due in each of your classrooms (your own progress on its
    guides), most first. Classrooms with nothing due are left out."""
    user_id = _uid(authorization)
    db = get_supabase()
    mine = db.table("classroom_members").select("classroom_id").eq("user_id", user_id).eq("status", "active").execute().data or []
    found = db.table("classrooms").select("id,name,archived_at").in_("id", [m["classroom_id"] for m in mine]).execute().data or [] if mine else []
    today = cstudy.today_iso()
    out = []
    for room in found:
        if room.get("archived_at"):
            continue
        due = 0
        for guide in cstudy.classroom_guides(db, user_id, room["id"]):
            if guide.get("user_id") != user_id and not versions.enabled():
                continue  # the study round leaves these out too (study_payload's `skipped`)
            content, questions, _ = cstudy.guide_ideas(guide)
            due += cstudy.due_count(guide, cstudy.member_ideas(db, user_id, guide, content, questions), content, questions, today)
        if due:
            out.append({"id": room["id"], "name": room["name"], "due": due})
    return {"classrooms": sorted(out, key=lambda r: -r["due"])}


@router.get("/{classroom_id}")
def get_classroom(classroom_id: str, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    return {"classroom": _summary(db, room, me)}


class ClassroomUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: Optional[Literal["public", "unlisted", "private"]] = None
    join_policy: Optional[Literal["auto", "approval"]] = None
    members_can_add: Optional[bool] = None
    members_can_invite: Optional[bool] = None


@router.patch("/{classroom_id}", dependencies=WRITE)
def update_classroom(classroom_id: str, body: ClassroomUpdate, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id, staff=True)
    changes = body.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise HTTPException(status_code=400, detail="Give it a name")
    if "description" in changes:
        changes["description"] = changes["description"].strip() or None
    if changes:
        room = (db.table("classrooms").update(changes).eq("id", room["id"]).execute().data or [room])[0]
    return {"classroom": _summary(db, room, me)}


@router.post("/{classroom_id}/archive", dependencies=WRITE)
def archive_classroom(classroom_id: str, authorization: str = Header(default="")):
    """Close a classroom for everyone (owner only). Guides stay with their authors."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if me.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can archive a classroom.")
    db.table("classrooms").update({"archived_at": rooms.now().isoformat()}).eq("id", room["id"]).execute()
    db.table("classroom_invites").update({"revoked_at": rooms.now().isoformat()}).eq("classroom_id", room["id"]).is_("revoked_at", "null").execute()
    return {"archived": True}


# Members --------------------------------------------------------------------------------------------
@router.get("/{classroom_id}/members")
def list_members(classroom_id: str, authorization: str = Header(default="")):
    """Everyone in the classroom (staff also see who's waiting). People either side has blocked
    are left out."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    statuses = ["active", "pending"] if rooms.is_staff(me) else ["active"]
    rows = db.table("classroom_members").select("user_id,role,status,joined_at").eq("classroom_id", room["id"]).in_("status", statuses).execute().data or []
    hidden = hidden_from(db, user_id)
    people = graph.cards(db, [r["user_id"] for r in rows])
    order = {"owner": 0, "instructor": 1, "admin": 2, "member": 3}
    out = []
    for row in sorted(rows, key=lambda r: (order.get(r["role"], 9), str(r.get("joined_at") or ""))):
        person = people.get(row["user_id"])
        if row["user_id"] in hidden or not person:
            continue
        out.append({**person, "user_id": row["user_id"], "role": row["role"], "status": row["status"], "joined_at": row.get("joined_at"),
                    "is_me": row["user_id"] == user_id, "removable": rooms.may_remove(me, row)})
    return {"members": out, "roles": list(rooms.assignable_roles(room)) if me.get("role") == "owner" else []}


def _target(db, room: dict, target_id: str) -> dict:
    target = rooms.membership(db, room["id"], require_uuid(target_id, "user ID"))
    if not target or target.get("status") == "removed":
        raise HTTPException(status_code=404, detail="Member not found")
    return target


class RoleChange(BaseModel):
    role: Literal["instructor", "admin", "member"]


@router.patch("/{classroom_id}/members/{target_id}", dependencies=WRITE)
def change_role(classroom_id: str, target_id: str, body: RoleChange, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if me.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can change roles.")
    target = _target(db, room, target_id)
    if target["role"] == "owner" or target.get("status") != "active":
        raise HTTPException(status_code=400, detail="Pick an active member who isn't the owner.")
    if body.role not in rooms.assignable_roles(room):
        raise HTTPException(status_code=400, detail="Instructors are only for approved instructor classes.")
    db.table("classroom_members").update({"role": body.role}).eq("classroom_id", room["id"]).eq("user_id", target["user_id"]).execute()
    return {"role": body.role}


@router.post("/{classroom_id}/members/{target_id}/approve", dependencies=WRITE)
def approve_member(classroom_id: str, target_id: str, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, _ = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id, staff=True)
    target = _target(db, room, target_id)
    if target["status"] != "pending":
        return {"status": target["status"]}
    if rooms.active_count(db, room["id"]) >= rooms.cap(room):
        raise HTTPException(status_code=409, detail="This classroom is full.")
    db.table("classroom_members").update({"status": "active", "joined_at": rooms.now().isoformat()}) \
        .eq("classroom_id", room["id"]).eq("user_id", target["user_id"]).execute()
    rooms.log(db, room["id"], target["user_id"], "member_joined")
    return {"status": "active"}


@router.delete("/{classroom_id}/members/{target_id}", dependencies=WRITE)
def remove_member(classroom_id: str, target_id: str, authorization: str = Header(default="")):
    """Remove a member, or decline someone waiting. Their own guides and folders leave with them."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id, staff=True)
    target = _target(db, room, target_id)
    if target["status"] == "active" and not rooms.may_remove(me, target):
        raise HTTPException(status_code=403, detail="You can't remove that member.")
    db.table("classroom_members").update({"status": "removed"}).eq("classroom_id", room["id"]).eq("user_id", target["user_id"]).execute()
    rooms.drop_items_of(db, room["id"], target["user_id"])
    return {"status": "removed"}


@router.post("/{classroom_id}/leave", dependencies=WRITE)
def leave_classroom(classroom_id: str, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room = rooms.load(db, require_uuid(classroom_id, "classroom ID"))
    me = rooms.membership(db, room["id"], user_id) if room else None
    if not room or not me or me.get("status") == "removed":
        raise HTTPException(status_code=404, detail="Classroom not found")
    if me.get("role") == "owner":
        raise HTTPException(status_code=409, detail="Make someone else the owner before you leave.")
    db.table("classroom_members").update({"status": "removed"}).eq("classroom_id", room["id"]).eq("user_id", user_id).execute()
    rooms.drop_items_of(db, room["id"], user_id)
    return {"status": "removed"}


class Transfer(BaseModel):
    user_id: str


@router.post("/{classroom_id}/transfer", dependencies=WRITE)
def transfer_ownership(classroom_id: str, body: Transfer, authorization: str = Header(default="")):
    """Hand the classroom to another active member; you become an admin."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if me.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can do that.")
    target = _target(db, room, body.user_id)
    if target["user_id"] == user_id or target.get("status") != "active":
        raise HTTPException(status_code=400, detail="Pick another active member.")
    db.table("classroom_members").update({"role": "admin"}).eq("classroom_id", room["id"]).eq("user_id", user_id).execute()
    db.table("classroom_members").update({"role": "owner"}).eq("classroom_id", room["id"]).eq("user_id", target["user_id"]).execute()
    db.table("classrooms").update({"owner_id": target["user_id"]}).eq("id", room["id"]).execute()
    return {"owner_id": target["user_id"]}


class MySettings(BaseModel):
    progress_visible_to_staff: Optional[bool] = None
    test_date: Optional[date] = None
    clear_test_date: bool = False


@router.patch("/{classroom_id}/me", dependencies=WRITE)
def my_settings(classroom_id: str, body: MySettings, authorization: str = Header(default="")):
    """Whether this classroom's staff can see your progress (instructor classes), and your own test
    date for studying it (Stage 6; otherwise the nearest milestone is used)."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, _ = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    change = {}
    if body.progress_visible_to_staff is not None:
        change["progress_visible_to_staff"] = body.progress_visible_to_staff
    if body.test_date or body.clear_test_date:
        change["study_test_date"] = body.test_date.isoformat() if body.test_date and not body.clear_test_date else None
    if change:
        try:
            db.table("classroom_members").update(change).eq("classroom_id", room["id"]).eq("user_id", user_id).execute()
        except Exception:  # before migration 20261116120000 (study_test_date)
            raise HTTPException(status_code=503, detail="Saving a test date needs an update on our side. It's used for this visit only.")
    return {key.replace("study_", ""): value for key, value in change.items()}


# Invites --------------------------------------------------------------------------------------------
def _invite_out(invite: dict) -> dict:
    return {"id": invite["id"], "token": invite["token"], "code": invite["short_code"], "expires_at": invite.get("expires_at"),
            "max_uses": invite.get("max_uses"), "uses": invite.get("uses") or 0, "created_at": invite.get("created_at")}


def _live_invites(db, room: dict, me: dict) -> list:
    query = db.table("classroom_invites").select("*").eq("classroom_id", room["id"]).is_("revoked_at", "null").is_("invitee_id", "null")
    if not rooms.is_staff(me):
        query = query.eq("created_by", me["user_id"])
    return [i for i in (query.order("created_at", desc=True).execute().data or []) if not rooms.invite_problem(i, room, None)]


@router.get("/{classroom_id}/invites")
def list_invites(classroom_id: str, authorization: str = Header(default="")):
    """Links and codes that still work (staff see all; members see their own)."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if not rooms.may_invite(room, me):
        raise HTTPException(status_code=403, detail="Only the owner and admins can invite people here.")
    return {"invites": [_invite_out(i) for i in _live_invites(db, room, me)], "private": room.get("visibility") == "private"}


class InviteCreate(BaseModel):
    expires_days: Optional[int] = Field(default=None, ge=1, le=90)
    max_uses: Optional[int] = Field(default=None, ge=1, le=500)


@router.post("/{classroom_id}/invites", dependencies=WRITE)
def create_invite(classroom_id: str, body: InviteCreate, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if not rooms.may_invite(room, me):
        raise HTTPException(status_code=403, detail="Only the owner and admins can invite people here.")
    if room.get("visibility") == "private":
        raise HTTPException(status_code=400, detail="A private classroom only lets in people invited by name.")
    if len(_live_invites(db, room, me)) >= 20:
        raise HTTPException(status_code=409, detail="Turn off an old link first.")
    return {"invite": _invite_out(rooms.make_invite(db, room["id"], user_id, expires_days=body.expires_days, max_uses=body.max_uses))}


def _own_invite(db, user_id: str, invite_id: str) -> tuple:
    invite = (db.table("classroom_invites").select("*").eq("id", require_uuid(invite_id, "invite ID")).limit(1).execute().data or [None])[0]
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    room, me = rooms.member_of(db, invite["classroom_id"], user_id)
    if not rooms.is_staff(me) and invite.get("created_by") != user_id:
        raise HTTPException(status_code=403, detail="You can only change invites you made.")
    return invite, room, me


@router.post("/invites/{invite_id}/revoke", dependencies=WRITE)
def revoke_invite(invite_id: str, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    invite, _, _ = _own_invite(db, user_id, invite_id)
    db.table("classroom_invites").update({"revoked_at": rooms.now().isoformat()}).eq("id", invite["id"]).execute()
    return {"revoked": True}


@router.post("/invites/{invite_id}/regenerate", dependencies=WRITE)
def regenerate_invite(invite_id: str, authorization: str = Header(default="")):
    """A new link and code with the same limits; the old ones stop working."""
    user_id = _uid(authorization)
    db = get_supabase()
    invite, room, _ = _own_invite(db, user_id, invite_id)
    db.table("classroom_invites").update({"revoked_at": rooms.now().isoformat()}).eq("id", invite["id"]).execute()
    days = None
    if invite.get("expires_at") and invite.get("created_at"):
        start = str(invite["created_at"])[:10]
        end = str(invite["expires_at"])[:10]
        days = max(1, (date.fromisoformat(end) - date.fromisoformat(start)).days)
    return {"invite": _invite_out(rooms.make_invite(db, room["id"], user_id, expires_days=days, max_uses=invite.get("max_uses")))}


class FriendInvite(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=20)


@router.post("/{classroom_id}/invite-friends", dependencies=[Depends(ai_rate_limit(10, 60))])
def invite_friends(classroom_id: str, body: FriendInvite, authorization: str = Header(default="")):
    """Invite friends by name: each gets a notification with a one-time invite. Only friends, and
    never anyone either side has blocked."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if not rooms.may_invite(room, me):
        raise HTTPException(status_code=403, detail="Only the owner and admins can invite people here.")
    sent = 0
    for friend_id in dict.fromkeys(require_uuid(i, "user ID") for i in body.user_ids):
        if friend_id == user_id or not graph.are_friends(db, user_id, friend_id) or is_blocked(db, friend_id, room["owner_id"]):
            continue
        current = rooms.membership(db, room["id"], friend_id)
        if current and current.get("status") in ("active", "pending"):
            continue
        invite = rooms.make_invite(db, room["id"], user_id, expires_days=rooms.FRIEND_INVITE_DAYS, max_uses=1, invitee_id=friend_id)
        db.table("notifications").insert({"user_id": friend_id, "kind": "classroom_invite", "created_at": rooms.now().isoformat(),
                                          "payload": {"actor_id": user_id, "classroom_id": room["id"], "name": room["name"],
                                                      "token": invite["token"]}}).execute()
        sent += 1
    return {"sent": sent}


# Joining --------------------------------------------------------------------------------------------
class JoinRequest(BaseModel):
    token: Optional[str] = Field(default=None, max_length=64)
    code: Optional[str] = Field(default=None, max_length=16)
    share_progress: Optional[bool] = None


@router.post("/join", dependencies=[Depends(ai_rate_limit(20, 60))])
def join_classroom(body: JoinRequest, authorization: str = Header(default="")):
    """Join with an invite link or code. Approval classrooms put you in line; an instructor class
    first asks whether its staff can see your progress (409 consent_required until answered)."""
    user_id = _uid(authorization)
    db = get_supabase()
    if not body.token and not body.code:
        raise HTTPException(status_code=400, detail="Enter a code or open an invite link.")
    invite = rooms.find_invite(db, token=body.token, code=body.code)
    room = rooms.load(db, invite["classroom_id"]) if invite else None
    problem = rooms.invite_problem(invite, room, user_id)
    if not problem and rooms.blocked_with(db, user_id, room, invite):
        problem = "This invite isn't valid."
    if problem:
        raise HTTPException(status_code=404, detail=problem)
    result = rooms.join(db, room, user_id, body.share_progress)
    if result["status"] in ("active", "pending"):
        rooms.use_invite(db, invite)
    return {**result, "classroom_id": room["id"]}


class RequestJoin(BaseModel):
    share_progress: Optional[bool] = None


@router.post("/{classroom_id}/request-join", dependencies=[Depends(ai_rate_limit(20, 60))])
def request_join(classroom_id: str, body: RequestJoin, authorization: str = Header(default="")):
    """Join a public classroom from its course page."""
    user_id = _uid(authorization)
    db = get_supabase()
    room = rooms.load(db, require_uuid(classroom_id, "classroom ID"))
    if not room or room.get("archived_at") or room.get("visibility") != "public" or rooms.blocked_with(db, user_id, room):
        raise HTTPException(status_code=404, detail="Classroom not found")
    return {**rooms.join(db, room, user_id, body.share_progress), "classroom_id": room["id"]}


@join_router.get("/{token}", dependencies=[Depends(ai_rate_limit(60, 60))])
def preview_invite(token: str, authorization: str = Header(default="")):
    """What an invite leads to, for the join screen: name, size, owner. Works signed out for links
    and codes; an invite by name only shows to the person it's for."""
    rooms.require_enabled()
    viewer = _optional_uid(authorization)
    db = get_supabase()
    is_code = len(rooms.clean_code(token)) == 8 and len(token) <= 10
    invite = rooms.find_invite(db, code=token) if is_code else rooms.find_invite(db, token=token[:64])
    room = rooms.load(db, invite["classroom_id"]) if invite else None
    problem = rooms.invite_problem(invite, room, viewer)
    if not problem and invite.get("invitee_id") and not viewer:
        problem = "Sign in to see this invite."
    if not problem and viewer and rooms.blocked_with(db, viewer, room, invite):
        problem = "This invite isn't valid."
    if problem:
        return {"valid": False, "reason": problem}
    owner = graph.cards(db, [room["owner_id"]]).get(room["owner_id"])
    me = rooms.membership(db, room["id"], viewer) if viewer else None
    return {"valid": True, "token": invite["token"], "classroom": {
        "id": room["id"], "name": room["name"], "description": room.get("description") or "", "kind": room.get("kind"),
        "member_count": rooms.active_count(db, room["id"]), "owner": owner, "join_policy": room.get("join_policy"),
        "needs_consent": room.get("kind") == "instructor_class",
        "my_status": me.get("status") if me and me.get("status") != "removed" else None}}


# Items ----------------------------------------------------------------------------------------------
def _guide_card(db, guide: dict, viewer: str) -> dict:
    return {"id": guide["id"], "title": guide.get("title") or "Untitled", "question_count": access.question_count(guide),
            "author": access.author(db, guide), "is_mine": guide.get("user_id") == viewer}


@router.get("/{classroom_id}/items")
def list_items(classroom_id: str, authorization: str = Header(default="")):
    """Guides and folders shared here, in order, with milestones. A folder lists every guide in it
    now. Guides you can't see (hidden, held, blocked, removed) are left out."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    items = db.table("classroom_items").select("*").eq("classroom_id", room["id"]).order("position").execute().data or []
    guide_ids = [i["item_id"] for i in items if i["item_type"] == "guide"]
    folder_ids = [i["item_id"] for i in items if i["item_type"] == "folder"]
    guides = {g["id"]: g for g in (db.table("study_guides").select(access.GUIDE_COLUMNS).in_("id", guide_ids).execute().data or [])} if guide_ids else {}
    folders = {f["id"]: f for f in (db.table("folders").select("id,user_id,name").in_("id", folder_ids).execute().data or [])} if folder_ids else {}
    in_folders = {}
    if folders:
        for guide in db.table("study_guides").select(access.GUIDE_COLUMNS).in_("folder_id", list(folders)).execute().data or []:
            folder = folders.get(guide.get("folder_id"))
            if folder and guide.get("user_id") == folder.get("user_id"):
                in_folders.setdefault(folder["id"], []).append(guide)
    adders = graph.cards(db, [i.get("added_by") for i in items if i.get("added_by")])
    out = []
    for item in items:
        base = {"item_type": item["item_type"], "item_id": item["item_id"], "position": item.get("position") or 0,
                "milestone_label": item.get("milestone_label"), "milestone_date": item.get("milestone_date"),
                "added_by": adders.get(item.get("added_by")), "removable": rooms.is_staff(me) or item.get("added_by") == user_id}
        if item["item_type"] == "guide":
            guide = guides.get(item["item_id"])
            if guide and access.can_view(db, user_id, guide):
                out.append({**base, "guide": _guide_card(db, guide, user_id)})
        else:
            folder = folders.get(item["item_id"])
            if folder:
                shown = [g for g in in_folders.get(folder["id"], []) if access.can_view(db, user_id, g)]
                out.append({**base, "folder": {"id": folder["id"], "name": folder.get("name") or "Folder",
                                               "guides": [_guide_card(db, g, user_id) for g in sorted(shown, key=lambda g: str(g.get("title") or ""))]}})
    return {"items": out}


class ItemAdd(BaseModel):
    item_type: Literal["guide", "folder"]
    item_id: str
    milestone_label: Optional[str] = Field(default=None, max_length=120)
    milestone_date: Optional[date] = None


@router.post("/{classroom_id}/items", dependencies=WRITE)
def add_item(classroom_id: str, body: ItemAdd, authorization: str = Header(default="")):
    """Share one of your guides or folders (or a public guide) with the classroom. Your own private
    guide becomes visible to the classroom's members (and your class, if it has one); a folder
    shares everything in it, now and later, with members only."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    if not rooms.may_add(room, me):
        raise HTTPException(status_code=403, detail="Only the owner and admins add guides here.")
    item_id = require_uuid(body.item_id, "item ID")
    if body.item_type == "guide":
        guide = access.load(db, item_id, access.GUIDE_COLUMNS + ",linked_set_id")
        if not guide:
            raise HTTPException(status_code=404, detail="Guide not found")
        if guide["user_id"] == user_id:
            from routers.guide_sharing import _is_others_copy
            if (guide.get("visibility") or "private") == "private":
                if _is_others_copy(db, guide):
                    raise HTTPException(status_code=400, detail="A copy of someone else's guide stays private.")
                db.table("study_guides").update({"visibility": "classroom"}).eq("id", guide["id"]).eq("user_id", user_id).execute()
        elif not (access.can_view(db, user_id, guide) and guide.get("visibility") in ("public", "link")):
            raise HTTPException(status_code=403, detail="You can add your own guides, or public ones.")
    else:
        folder = (db.table("folders").select("id,user_id").eq("id", item_id).limit(1).execute().data or [None])[0]
        if not folder or folder.get("user_id") != user_id:
            raise HTTPException(status_code=404, detail="Folder not found")
    existing = db.table("classroom_items").select("position").eq("classroom_id", room["id"]).execute().data or []
    if len(existing) >= 500:
        raise HTTPException(status_code=409, detail="This classroom has as many items as it can hold.")
    row = {"classroom_id": room["id"], "item_type": body.item_type, "item_id": item_id, "added_by": user_id,
           "position": 1 + max((r.get("position") or 0 for r in existing), default=0),
           "milestone_label": (body.milestone_label or "").strip() or None,
           "milestone_date": body.milestone_date.isoformat() if body.milestone_date else None, "added_at": rooms.now().isoformat()}
    db.table("classroom_items").upsert(row, on_conflict="classroom_id,item_type,item_id", ignore_duplicates=True).execute()
    rooms.log(db, room["id"], user_id, "guide_added" if body.item_type == "guide" else "folder_added", {"item_id": item_id})
    return {"added": True}


class ItemUpdate(BaseModel):
    milestone_label: Optional[str] = Field(default=None, max_length=120)
    milestone_date: Optional[date] = None


@router.patch("/{classroom_id}/items/{item_type}/{item_id}", dependencies=WRITE)
def set_milestone(classroom_id: str, item_type: Literal["guide", "folder"], item_id: str, body: ItemUpdate, authorization: str = Header(default="")):
    """A milestone on an item ("Unit 2 quiz", a date). Empty clears it. Staff only."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, _ = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id, staff=True)
    label = (body.milestone_label or "").strip() or None
    when = body.milestone_date.isoformat() if body.milestone_date else None
    updated = db.table("classroom_items").update({"milestone_label": label, "milestone_date": when}) \
        .eq("classroom_id", room["id"]).eq("item_type", item_type).eq("item_id", require_uuid(item_id, "item ID")).execute().data or []
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")
    if label or when:
        rooms.log(db, room["id"], user_id, "milestone_set", {"item_id": item_id, "label": label, "date": when})
    return {"milestone_label": label, "milestone_date": when}


@router.delete("/{classroom_id}/items/{item_type}/{item_id}", dependencies=WRITE)
def remove_item(classroom_id: str, item_type: Literal["guide", "folder"], item_id: str, authorization: str = Header(default="")):
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    item = (db.table("classroom_items").select("added_by").eq("classroom_id", room["id"]).eq("item_type", item_type)
            .eq("item_id", require_uuid(item_id, "item ID")).limit(1).execute().data or [None])[0]
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not rooms.is_staff(me) and item.get("added_by") != user_id:
        raise HTTPException(status_code=403, detail="You can remove only what you added.")
    db.table("classroom_items").delete().eq("classroom_id", room["id"]).eq("item_type", item_type).eq("item_id", item_id).execute()
    return {"removed": True}


class ItemRef(BaseModel):
    item_type: Literal["guide", "folder"]
    item_id: str


class ItemOrder(BaseModel):
    items: list[ItemRef] = Field(max_length=500)


@router.put("/{classroom_id}/items/order", dependencies=WRITE)
def reorder_items(classroom_id: str, body: ItemOrder, authorization: str = Header(default="")):
    """The order items show in (staff). Items not listed keep their place after the listed ones."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, _ = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id, staff=True)
    for position, ref in enumerate(body.items, start=1):
        db.table("classroom_items").update({"position": position}).eq("classroom_id", room["id"]) \
            .eq("item_type", ref.item_type).eq("item_id", require_uuid(ref.item_id, "item ID")).execute()
    return {"ordered": len(body.items)}


# Studying the classroom (Stage 6) -------------------------------------------------------------------
@router.get("/{classroom_id}/study")
def study_payload(classroom_id: str, guide_ids: str = "", authorization: str = Header(default="")):
    """Everything a mixed review round needs across the classroom's guides (or the ones picked in
    guide_ids): each guide's cards and questions with your own progress, as the study screens read
    it. Someone else's guide comes as the version you're on (Stage 4); without per-viewer progress
    switched on, only your own guides are included and `skipped` says how many weren't."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    picked = {require_uuid(i, "guide ID") for i in guide_ids.split(",") if i.strip()} if guide_ids else None
    out, skipped = [], 0
    for guide in cstudy.classroom_guides(db, user_id, room["id"]):
        if picked is not None and guide["id"] not in picked:
            continue
        if guide["user_id"] == user_id:
            own = (db.table("study_guides").select("id,title,flashcards,quiz_questions,flashcard_progress").eq("id", guide["id"]).limit(1).execute().data or [None])[0]
            if own:
                out.append({**own, "viewer": None})
            continue
        if not versions.enabled():
            skipped += 1
            continue
        try:
            ctx = viewer_study.state(db, user_id, guide["id"])
        except (HTTPException, viewer_study.Unavailable):
            skipped += 1
            continue
        if ctx["row"] is None:
            viewer_study.pin(db, user_id, guide["id"], ctx["current"])
        content = ctx["content"]
        out.append({"id": guide["id"], "title": content.get("title") or guide.get("title"), "flashcards": content["cards"],
                    "quiz_questions": ctx["questions"], "flashcard_progress": viewer_study.progress_view(ctx),
                    "viewer": {"version": content["version"], "current_version": ctx["current"]}})
    today = cstudy.today_iso()
    return {"classroom": {"id": room["id"], "name": room["name"]}, "guides": out, "skipped": skipped,
            "test_date": me.get("study_test_date"), "milestone": cstudy.nearest_milestone(db, room["id"], today)}


@router.get("/{classroom_id}/progress")
def classroom_progress(classroom_id: str, authorization: str = Header(default="")):
    """Your own readiness per guide and combined (weighted by each guide's number of ideas); in a
    study group, anonymous "knows / still learning" counts per question where at least 3 members
    studied the guide; in an instructor class, staff also see members who chose to share."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, me = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    today = cstudy.today_iso()
    guides = cstudy.classroom_guides(db, user_id, room["id"])
    members = db.table("classroom_members").select("user_id,progress_visible_to_staff").eq("classroom_id", room["id"]).eq("status", "active").execute().data or []
    member_ids = [m["user_id"] for m in members]
    instructor_view = room.get("kind") == "instructor_class" and rooms.is_staff(me)
    sharing = [m["user_id"] for m in members if m.get("progress_visible_to_staff") and m["user_id"] != user_id] if instructor_view else []
    mine, group, staff_rows = [], [], {uid: [] for uid in sharing}
    for guide in guides:
        content, questions, ideas_list = cstudy.guide_ideas(guide)
        my = cstudy.tally(ideas_list, cstudy.member_ideas(db, user_id, guide, content, questions), today)
        mine.append({"id": guide["id"], "title": guide.get("title") or "Untitled", **my})
        if room.get("kind") != "instructor_class":
            group.append({"id": guide["id"], "title": guide.get("title") or "Untitled",
                          **cstudy.group_view(db, guide, member_ids, content, questions, ideas_list, today)})
        for uid in sharing:
            staff_rows[uid].append({"id": guide["id"], **cstudy.tally(ideas_list, cstudy.member_ideas(db, uid, guide, content, questions), today)})
    out = {"me": {"guides": mine, "readiness": cstudy.combined(mine), "test_date": me.get("study_test_date"),
                  "milestone": cstudy.nearest_milestone(db, room["id"], today)},
           "group": group if room.get("kind") != "instructor_class" else None, "group_min": cstudy.GROUP_MIN}
    if instructor_view:
        people = graph.cards(db, sharing)
        out["members"] = [{**people[uid], "readiness": cstudy.combined(rows), "guides": rows} for uid, rows in staff_rows.items() if uid in people]
        out["not_sharing"] = len([m for m in members if not m.get("progress_visible_to_staff") and m["user_id"] != user_id])
    return out


# Activity -------------------------------------------------------------------------------------------
@router.get("/{classroom_id}/activity")
def activity(classroom_id: str, authorization: str = Header(default="")):
    """The newest 50 events: who joined, what was added, milestones set."""
    user_id = _uid(authorization)
    db = get_supabase()
    room, _ = rooms.member_of(db, require_uuid(classroom_id, "classroom ID"), user_id)
    rows = db.table("classroom_activity").select("id,actor_id,kind,payload,created_at").eq("classroom_id", room["id"]) \
        .order("created_at", desc=True).limit(50).execute().data or []
    hidden = hidden_from(db, user_id)
    people = graph.cards(db, [r.get("actor_id") for r in rows if r.get("actor_id")])
    item_ids = [(r.get("payload") or {}).get("item_id") for r in rows]
    titles = {g["id"]: g.get("title") for g in (db.table("study_guides").select("id,title").in_("id", [i for i in item_ids if i]).execute().data or [])} if any(item_ids) else {}
    folder_names = {f["id"]: f.get("name") for f in (db.table("folders").select("id,name").in_("id", [i for i in item_ids if i]).execute().data or [])} if any(item_ids) else {}
    out = []
    for row in rows:
        if row.get("actor_id") in hidden:
            continue
        payload = row.get("payload") or {}
        item = payload.get("item_id")
        out.append({"id": row["id"], "kind": row["kind"], "created_at": row.get("created_at"), "actor": people.get(row.get("actor_id")),
                    "item_title": titles.get(item) or folder_names.get(item), "label": payload.get("label"), "date": payload.get("date")})
    return {"activity": out}
