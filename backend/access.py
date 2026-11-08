"""Who may do what with social things (social plan, Stage 9): one set of FastAPI dependencies.

The backend reads and writes with the service role, which bypasses RLS, so nothing in the database
stops a route that forgets a check. Every social route therefore declares exactly one of these as
a dependency (tests/test_authz_matrix.py fails any social route without one, then tries each route
as every kind of viewer). The dependency checks before the route body runs and hands the route a
Ctx with what it checked, so the route works on that and never loads it again on its own terms.

Kinds (each dependency's `access` attribute):
  public                anyone, signed in or not (forms, invite previews); ctx.user_id may be None
  own                   the signed-in viewer's own data, lists and settings
  admin                 app admins only
  guide:own             a guide by {guide_id} that the viewer owns
  guide:view            a guide the viewer may see (services/guide_access.can_view); signed out
                        too when the route allows it
  guide:study           a guide the viewer studies (services/viewer_study.state): ctx.study, or
                        ctx.gone with the plain reason when they lost access but have progress
  classroom:<level>     a classroom by {classroom_id}:
                          member  an active member (a held classroom: owner and staff only)
                          staff   owner, instructor or admin
                          owner   the owner
                          instructor_staff  staff of an approved instructor class
                          listed  listed on its course page (public), for asking to join
                          leave   anyone still in it (even held), to leave
  invite                a classroom invite by {invite_id}: its classroom's staff, or whoever made it
  person:<purpose>      another user by a path id: exists, isn't the viewer, no block either way and
                        not held for review (purpose "block" only needs them to exist)
  profile               a profile page by {username}
The shared rules are plain functions too (held, join_problem, minor_join_problem), for routes that
find their classroom from a body (joining with a code) or list many things at once.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from fastapi import Header, HTTPException

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from services import classrooms as rooms
from services import guide_access, instructors, minors, social_graph, usernames
from services.blocks import is_blocked

NOT_FOUND = {"guide": "Guide not found", "classroom": "Classroom not found", "person": "User not found",
             "profile": "Profile not found", "invite": "Invite not found"}


@dataclass
class Ctx:
    user_id: Optional[str]
    db: object
    guide: Optional[dict] = None
    room: Optional[dict] = None
    me: Optional[dict] = None
    person: Optional[dict] = None
    invite: Optional[dict] = None
    study: Optional[dict] = None
    gone: Optional[dict] = None
    redirect: Optional[str] = None


def held(row: Optional[dict]) -> bool:
    """Held for review or hidden by an admin (guides, profiles and classrooms alike)."""
    return bool(row) and (row.get("review_status") or "ok") != "ok"


def _not_found(what: str):
    return HTTPException(status_code=404, detail=NOT_FOUND[what])


def _viewer(authorization: str, required: bool) -> Optional[str]:
    if required:
        return get_user_id(authorization)
    if not authorization:
        return None
    try:
        return get_user_id(authorization)
    except HTTPException:
        return None


def _dependency(kind: str, check, *, param: Optional[str] = None, signed_in: bool = True):
    """A FastAPI dependency that reads the viewer (and one path parameter), runs check(ctx, value)
    and returns the Ctx. Tagged with its kind for the authorization matrix."""
    def dependency(**values):
        ctx = Ctx(_viewer(values.get("authorization", ""), signed_in), get_supabase())
        check(ctx, values.get(param) if param else None)
        return ctx
    parameters = [inspect.Parameter(param, inspect.Parameter.KEYWORD_ONLY, annotation=str)] if param else []
    parameters.append(inspect.Parameter("authorization", inspect.Parameter.KEYWORD_ONLY, annotation=str, default=Header(default="")))
    dependency.__signature__ = inspect.Signature(parameters)
    dependency.access = kind
    dependency.param = param
    dependency.signed_in = signed_in
    return dependency


# Viewer only -------------------------------------------------------------------------------------
def public():
    return _dependency("public", lambda ctx, _: None, signed_in=False)


def own(gate=None):
    """The viewer's own things. gate: a check to run first (rooms.require_enabled for classrooms)."""
    def check(ctx, _):
        if gate:
            gate()
    return _dependency("own", check)


def admin():
    def check(ctx, _):
        if not (ctx.db.table("app_admins").select("user_id").eq("user_id", ctx.user_id).limit(1).execute().data or []):
            raise HTTPException(status_code=403, detail="Admins only")
    return _dependency("admin", check)


# Guides ------------------------------------------------------------------------------------------
def guide(mode: str = "view", *, signed_in: bool = True):
    assert mode in ("own", "view", "study")

    def check(ctx, guide_id):
        guide_id = require_uuid(guide_id, "guide ID")
        if mode == "own":
            row = guide_access.load(ctx.db, guide_id, guide_access.GUIDE_COLUMNS + ",linked_set_id")
            if not row or row.get("user_id") != ctx.user_id:
                raise _not_found("guide")
            ctx.guide = row
        elif mode == "view":
            ctx.guide = guide_access.viewable(ctx.db, ctx.user_id, guide_id)
        else:
            from services import viewer_study
            try:
                ctx.study = viewer_study.state(ctx.db, ctx.user_id, guide_id)
                ctx.guide = ctx.study["guide"]
            except viewer_study.Unavailable as gone:
                ctx.gone = {"unavailable": gone.reason, "title": gone.title}
    return _dependency(f"guide:{mode}", check, param="guide_id", signed_in=signed_in)


# Classrooms --------------------------------------------------------------------------------------
LEVELS = ("member", "staff", "owner", "instructor_staff", "listed", "leave")


def minor_join_problem(db, user_id: Optional[str], room: dict) -> Optional[str]:
    """Strict minor rules: an instructor class is open to a minor only when a verified instructor at
    the course's school runs it."""
    if room.get("kind") == "instructor_class" and user_id and minors.strict_minor(db, user_id) \
            and not instructors.runs_verified_class(db, room):
        return "This instructor class isn't open to students under 18."
    return None


def join_problem(db, user_id: Optional[str], room: Optional[dict], invite: Optional[dict]) -> Optional[str]:
    """Why this invite can't be used by this viewer (None when it can): the invite itself, blocks,
    a classroom held for review, and the minor rules."""
    problem = rooms.invite_problem(invite, room, user_id)
    if problem:
        return problem
    if held(room) or (user_id and rooms.blocked_with(db, user_id, room, invite)):
        return "This invite isn't valid."
    return minor_join_problem(db, user_id, room)


def classroom(level: str = "member"):
    assert level in LEVELS

    def check(ctx, classroom_id):
        rooms.require_enabled()
        classroom_id = require_uuid(classroom_id, "classroom ID")
        db, uid = ctx.db, ctx.user_id
        if level in ("listed", "leave"):
            room = rooms.load(db, classroom_id)
            me = rooms.membership(db, classroom_id, uid) if room else None
            if level == "leave":
                if not room or not me or me.get("status") == "removed":
                    raise _not_found("classroom")
            else:
                if not room or room.get("archived_at") or room.get("visibility") != "public" or held(room) or rooms.blocked_with(db, uid, room):
                    raise _not_found("classroom")
                problem = minor_join_problem(db, uid, room)
                if problem:
                    raise HTTPException(status_code=403, detail=problem)
            ctx.room, ctx.me = room, me
            return
        room, me = rooms.member_of(db, classroom_id, uid)
        if held(room) and not rooms.is_staff(me):
            raise _not_found("classroom")
        if level == "staff" and not rooms.is_staff(me):
            raise HTTPException(status_code=403, detail="Only the classroom's owner and admins can do that.")
        if level == "owner" and me.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can do that.")
        if level == "instructor_staff" and (room.get("kind") != "instructor_class" or not rooms.is_staff(me)):
            raise HTTPException(status_code=403, detail="Only the staff of an instructor class see this.")
        ctx.room, ctx.me = room, me
    return _dependency(f"classroom:{level}", check, param="classroom_id")


def invite():
    def check(ctx, invite_id):
        rooms.require_enabled()
        row = (ctx.db.table("classroom_invites").select("*").eq("id", require_uuid(invite_id, "invite ID")).limit(1).execute().data or [None])[0]
        if not row:
            raise _not_found("invite")
        room, me = rooms.member_of(ctx.db, row["classroom_id"], ctx.user_id)
        if held(room) and not rooms.is_staff(me):
            raise _not_found("invite")
        if not rooms.is_staff(me) and row.get("created_by") != ctx.user_id:
            raise HTTPException(status_code=403, detail="You can only change invites you made.")
        ctx.invite, ctx.room, ctx.me = row, room, me
    return _dependency("invite", check, param="invite_id")


# People ------------------------------------------------------------------------------------------
PERSON_COLUMNS = "id,allow_follows,allow_friend_requests"


def _profile_row(db, user_id: str, columns: str) -> Optional[dict]:
    """A profile row with its review status (none before the Stage 9 migration)."""
    try:
        return (db.table("user_profiles").select(columns + ",review_status").eq("id", user_id).limit(1).execute().data or [None])[0]
    except Exception:
        return (db.table("user_profiles").select(columns).eq("id", user_id).limit(1).execute().data or [None])[0]


def person(param: str = "target_id", purpose: str = "reach"):
    """Another user. reach: following, friending, accepting; block: blocking someone."""
    assert purpose in ("reach", "block")

    def check(ctx, target_id):
        target_id = require_uuid(target_id, "user ID")
        if target_id == ctx.user_id:
            raise HTTPException(status_code=400, detail="You can't block yourself" if purpose == "block" else "That's you")
        row = _profile_row(ctx.db, target_id, PERSON_COLUMNS)
        if not row or (purpose == "reach" and (held(row) or is_blocked(ctx.db, ctx.user_id, target_id))):
            raise _not_found("person")
        ctx.person = row
    return _dependency(f"person:{purpose}", check, param=param)


PROFILE_COLUMNS = ("id,name,email,university,username,display_name,show_real_name,profile_visibility,allow_follows,"
                   "allow_friend_requests,show_school,show_streak,username_changed_at")


def profile():
    """A profile page: 404 when unknown, blocked either way, held (except for its owner), or a
    minor's and the viewer isn't their friend. A username released in the last 90 days sets
    ctx.redirect to the new one instead."""
    def check(ctx, username):
        db, viewer = ctx.db, ctx.user_id
        name = usernames.normalize(username)
        if usernames.format_problem(name) not in (None, "That username is reserved."):
            raise _not_found("profile")
        try:
            row = (db.table("user_profiles").select(PROFILE_COLUMNS + ",review_status").eq("username", name).limit(1).execute().data or [None])[0]
        except Exception:  # before the Stage 9 migration
            row = (db.table("user_profiles").select(PROFILE_COLUMNS).eq("username", name).limit(1).execute().data or [None])[0]
        if not row:
            holder = usernames.held_by(db, name, datetime.now(timezone.utc))
            moved = (db.table("user_profiles").select("id,username").eq("id", holder).limit(1).execute().data or [None])[0] if holder else None
            if moved and moved.get("username") and not is_blocked(db, viewer, holder):
                ctx.redirect = moved["username"]
                return
            raise _not_found("profile")
        owner = row["id"]
        if owner != viewer:
            if is_blocked(db, viewer, owner) or held(row):
                raise _not_found("profile")
            if minors.is_minor(db, owner) and not social_graph.are_friends(db, viewer, owner):
                raise _not_found("profile")
        ctx.person = row
    return _dependency("profile", check, param="username")


def kind_of(dependency) -> Optional[str]:
    return getattr(dependency, "access", None)
