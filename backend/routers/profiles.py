"""Public profiles, usernames and privacy settings (social plan, Stage 1).

Everything goes through here: user_profiles stays readable only by its owner in the database (it
holds email and timezone), so other people's profiles are built field by field for the viewer.
Blocked pairs get a 404 both ways, as if the profile didn't exist.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase
from rate_limit import ai_rate_limit
from services import classmates, guide_access, instructors, minors, social_graph, usernames
from services.blocks import is_blocked

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profiles", tags=["profiles"])

PRIVATE_FIELDS = ("username", "display_name", "show_real_name", "profile_visibility", "allow_follows",
                  "allow_friend_requests", "show_school", "show_streak", "username_changed_at")
PROFILE_COLUMNS = "id,name,email,university," + ",".join(PRIVATE_FIELDS)


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def _own_profile(db, user_id: str) -> dict:
    """Your profile row; {"id": ...} alone (and no "exists") when the sign-up trigger never made one."""
    row = _one(db.table("user_profiles").select(PROFILE_COLUMNS).eq("id", user_id).limit(1).execute())
    return {**row, "exists": True} if row else {"id": user_id}


_shown_name = social_graph.shown_name
_initials = social_graph.initials


def _streak(db, user_id: str) -> int:
    """The current streak, or 0 when it has lapsed (no study yesterday or today, in UTC)."""
    row = _one(db.table("user_streaks").select("current_streak,last_study_date").eq("user_id", user_id).limit(1).execute())
    if not row or not row.get("last_study_date"):
        return 0
    try:
        last = date.fromisoformat(str(row["last_study_date"])[:10])
    except ValueError:
        return 0
    return int(row.get("current_streak") or 0) if (datetime.now(timezone.utc).date() - last).days <= 1 else 0


def _me(db, user_id: str) -> dict:
    profile = _own_profile(db, user_id)
    next_change = usernames.next_change_at(profile) if profile.get("username") else None
    out = {key: profile.get(key) for key in PRIVATE_FIELDS}
    out.update({
        "id": user_id,
        "name": profile.get("name") or "",
        "school": profile.get("university") or "",
        "initials": _initials(profile),
        "profile_visibility": profile.get("profile_visibility") or "public",
        "allow_follows": profile.get("allow_follows") or "everyone",
        "allow_friend_requests": profile.get("allow_friend_requests") or "everyone",
        "show_school": profile.get("show_school") is not False,
        "show_streak": bool(profile.get("show_streak")),
        "show_real_name": bool(profile.get("show_real_name")),
        "can_change_username_at": next_change.isoformat() if next_change and next_change > datetime.now(timezone.utc) else None,
    })
    try:  # its own query: the column arrives with migration 20261124120000
        extra = _one(db.table("user_profiles").select("find_by_classmates,is_minor").eq("id", user_id).limit(1).execute()) or {}
        out["find_by_classmates"] = classmates.findable(extra)
        out["find_by_classmates_available"] = True
    except Exception:
        try:
            minor = _one(db.table("user_profiles").select("is_minor").eq("id", user_id).limit(1).execute()) or {}
        except Exception:
            minor = {}
        out["find_by_classmates"] = classmates.findable(minor)
        out["find_by_classmates_available"] = False
    try:  # its own query, so /profiles/me keeps working before the Stage 3 migration
        accepted = _one(db.table("user_profiles").select("honor_code_accepted_at").eq("id", user_id).limit(1).execute())
        out["honor_code_accepted"] = bool(accepted and accepted.get("honor_code_accepted_at"))
    except Exception:
        out["honor_code_accepted"] = False
    if not profile.get("username"):
        email_name = (profile.get("email") or "").split("@")[0]
        out["suggestions"] = usernames.suggestions(db, user_id, profile.get("display_name") or "", profile.get("name") or "", email_name)
    return out


@router.get("/me")
def get_my_profile(authorization: str = Header(default="")):
    """Your own profile and privacy settings, plus username suggestions while you have none."""
    user_id = get_user_id(authorization)
    return _me(get_supabase(), user_id)


@router.get("/check-username", dependencies=[Depends(ai_rate_limit(60, 60))])
def check_username(u: str = Query(default="", max_length=64), authorization: str = Header(default="")):
    """Whether you could take this username now, and why not."""
    user_id = get_user_id(authorization)
    name = usernames.normalize(u)
    problem = usernames.availability(get_supabase(), name, user_id)
    return {"username": name, "available": problem is None, "reason": problem}


class UsernameRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)


@router.post("/me/username", dependencies=[Depends(ai_rate_limit(10, 60))])
def set_username(body: UsernameRequest, authorization: str = Header(default="")):
    """Claim a username, or change it (once every 30 days after the first change). The old one
    redirects to the new one for 90 days and is held for you in that time."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    name = usernames.normalize(body.username)
    profile = _own_profile(db, user_id)
    current = profile.get("username")
    if current and str(current).lower() == name:
        return _me(db, user_id)
    now = datetime.now(timezone.utc)
    problem = usernames.availability(db, name, user_id, now)
    if problem:
        raise HTTPException(status_code=409 if problem == "That username is taken." else 400, detail=problem)
    if current:
        next_change = usernames.next_change_at(profile)
        if next_change and next_change > now:
            raise HTTPException(status_code=429, detail=f"You can change your username again on {next_change:%B} {next_change.day}.")
    updates = {"username": name}
    if current:
        updates["username_changed_at"] = now.isoformat()
    try:
        if profile.get("exists"):
            db.table("user_profiles").update(updates).eq("id", user_id).execute()
        else:
            db.table("user_profiles").insert({"id": user_id, **updates}).execute()
    except Exception as error:  # the unique index: someone took it a moment ago
        if "duplicate" in str(error).lower() or "23505" in str(error):
            raise HTTPException(status_code=409, detail="That username is taken.")
        raise
    if current:
        db.table("username_history").upsert({"old_username": str(current).lower(), "user_id": user_id, "released_at": now.isoformat()},
                                            on_conflict="old_username").execute()
    # Taking back a name you released ends its hold.
    db.table("username_history").delete().eq("old_username", name).eq("user_id", user_id).execute()
    return _me(db, user_id)


class ProfileSettings(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=50)
    show_real_name: Optional[bool] = None
    profile_visibility: Optional[Literal["public", "friends", "private"]] = None
    allow_follows: Optional[Literal["everyone", "approval"]] = None
    allow_friend_requests: Optional[Literal["everyone", "friends_of_friends", "nobody"]] = None
    show_school: Optional[bool] = None
    show_streak: Optional[bool] = None
    find_by_classmates: Optional[bool] = None

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        if value is None:
            return None
        value = " ".join(value.split())
        if any(ord(ch) < 32 for ch in value):
            raise ValueError("Use plain text")
        return value


@router.patch("/me", dependencies=[Depends(ai_rate_limit(30, 60))])
def update_my_profile(body: ProfileSettings, authorization: str = Header(default="")):
    """Display name and privacy settings. Only the fields sent change."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    updates = body.model_dump(exclude_unset=True)
    findable = updates.pop("find_by_classmates", None)
    if "display_name" in updates:
        updates["display_name"] = updates["display_name"] or None  # empty clears it
    if updates:
        if _own_profile(db, user_id).get("exists"):
            db.table("user_profiles").update(updates).eq("id", user_id).execute()
        else:
            db.table("user_profiles").insert({"id": user_id, **updates}).execute()
    if findable is not None:
        # Its own write, so the other settings still save before migration 20261124120000.
        try:
            if not _own_profile(db, user_id).get("exists"):
                db.table("user_profiles").insert({"id": user_id}).execute()
            db.table("user_profiles").update({"find_by_classmates": bool(findable)}).eq("id", user_id).execute()
        except Exception:
            raise HTTPException(status_code=503, detail="This setting isn't available yet.")
    return _me(db, user_id)


def _find(db, name: str) -> Optional[dict]:
    return _one(db.table("user_profiles").select(PROFILE_COLUMNS).eq("username", name).limit(1).execute())


@router.get("/{username}", dependencies=[Depends(ai_rate_limit(120, 60))])
def get_profile(username: str, authorization: str = Header(default="")):
    """A student's profile as this viewer may see it. A username released in the last 90 days
    answers with where it moved ({"redirect": new}); blocked pairs and unknown names are 404."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    name = usernames.normalize(username)
    if usernames.format_problem(name) not in (None, "That username is reserved."):
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = _find(db, name)
    if not profile:
        holder = usernames.held_by(db, name, datetime.now(timezone.utc))
        moved = _one(db.table("user_profiles").select("id,username").eq("id", holder).limit(1).execute()) if holder else None
        if moved and moved.get("username") and not is_blocked(db, viewer, holder):
            return {"redirect": moved["username"]}
        raise HTTPException(status_code=404, detail="Profile not found")
    owner = profile["id"]
    if is_blocked(db, viewer, owner):
        raise HTTPException(status_code=404, detail="Profile not found")
    is_self = viewer == owner
    # A minor's profile is for themselves and accepted friends only; to anyone else it isn't there.
    if not is_self and minors.is_minor(db, owner) and not social_graph.are_friends(db, viewer, owner):
        raise HTTPException(status_code=404, detail="Profile not found")
    visibility = profile.get("profile_visibility") or "public"
    full = is_self or visibility == "public" or (visibility == "friends" and social_graph.are_friends(db, viewer, owner))
    out = {
        "id": owner,
        "username": profile.get("username"),
        "display_name": _shown_name(profile),
        "initials": _initials(profile),
        "is_self": is_self,
        "limited": not full,
        "badges": [{"key": "verified_instructor", "label": "Verified instructor"}] if instructors.is_verified(db, owner) else [],
        # Public folders and classrooms arrive in Stage 5.
        "guides": guide_access.profile_guides(db, viewer, owner) if full else [],
        "folders": [],
        "classrooms": [],
    }
    if not is_self:
        out["relationship"] = social_graph.relationship(db, viewer, owner)
        out["can_follow"] = True
        out["follows_need_approval"] = (profile.get("allow_follows") or "everyone") == "approval"
        friend_problem = social_graph.may_request_friend(db, viewer, profile)
        out["can_friend"] = friend_problem is None or out["relationship"]["friendship"] != "none"
        out["friend_note"] = friend_problem if out["relationship"]["friendship"] == "none" else None
    if full:
        out["counts"] = social_graph.counts(db, owner)
        if profile.get("show_real_name") and profile.get("name"):
            out["real_name"] = profile["name"].strip()
        if profile.get("show_school") is not False and profile.get("university"):
            out["school"] = profile["university"].strip()
        if profile.get("show_streak"):
            out["streak"] = _streak(db, owner)
    return out

