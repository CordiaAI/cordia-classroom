"""Public forms: instructor opt-out and copyright takedowns (guides, class sets and profiles)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import access
from access import Ctx
from database import get_supabase
from rate_limit import ai_rate_limit
from services import instructors, usernames
from services.class_catalog import normalize_course_code
from services.class_db import ensure_class

router = APIRouter(tags=["public"])
COPYRIGHT_EMAIL = "support@cordiaai.io"


def _verified_email(user_id: str) -> str:
    try:
        user = get_supabase().auth.admin.get_user_by_id(user_id).user
    except Exception:
        raise HTTPException(status_code=401, detail="Verify your school email first")
    if not getattr(user, "email", None) or not getattr(user, "email_confirmed_at", None):
        raise HTTPException(status_code=401, detail="Verify your school email first")
    return user.email


class BlockRequest(BaseModel):
    school_id: str
    course_code: str = Field(..., min_length=2, max_length=60)


@router.get("/instructors/schools")
def instructor_schools(q: str = "", _=Depends(ai_rate_limit(30, 60)), ctx: Ctx = Depends(access.public())):
    q = re.sub(r"[%_,()]", " ", q).strip()
    if len(q) < 2:
        return {"schools": []}
    rows = ctx.db.table("schools").select("id,name").ilike("name", f"%{q}%").limit(8).execute().data or []
    return {"schools": rows}


@router.post("/instructors/block", dependencies=[Depends(ai_rate_limit(10, 3600))])
def block_course(body: BlockRequest, ctx: Ctx = Depends(access.own())):
    """An instructor with a verified school email turns sharing off for their course."""
    email = _verified_email(ctx.user_id)
    db = ctx.db
    try:
        school_id = str(uuid.UUID(body.school_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Pick your school")
    school = (db.table("schools").select("*").eq("id", school_id).limit(1).execute().data or [None])[0]
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    domains = instructors.school_email_domains(school)
    if not domains or not instructors.email_matches(email, domains):
        raise HTTPException(status_code=403, detail="Use your school email")
    if not normalize_course_code(body.course_code).code:
        raise HTTPException(status_code=400, detail="Use a course code like MGT 300")
    class_row = ensure_class(db, school["id"], body.course_code)
    db.table("classes").update({"sharing_blocked": True}).eq("id", class_row["id"]).execute()
    db.table("shared_sets").update({"visibility": "private"}).eq("class_id", class_row["id"]).execute()
    db.table("instructor_blocks").upsert({"class_id": class_row["id"], "email": email.lower()}, on_conflict="class_id,email").execute()
    return {"code": class_row["course_code_normalized"], "blocked": True}


class TakedownRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    work: str = Field(..., min_length=1, max_length=4000)
    location: str = Field(..., min_length=1, max_length=2000)
    statement: bool


COPYRIGHT_HOLD = "Copyright report"
_SET_ID = re.compile(r"set=([0-9a-fA-F-]{36})|/sets?/([0-9a-fA-F-]{36})")
_PROFILE = re.compile(r"/u/([A-Za-z0-9_.]{1,64})(?![A-Za-z0-9_.])")


def profile_from(location: str, db) -> Optional[str]:
    """The user id behind a /u/<username> link (a recently released name still finds its owner)."""
    found = _PROFILE.search(location or "")
    if not found:
        return None
    name = usernames.normalize(found.group(1))
    row = (db.table("user_profiles").select("id").eq("username", name).limit(1).execute().data or [None])[0]
    if row:
        return row["id"]
    return usernames.held_by(db, name, datetime.now(timezone.utc))


@router.post("/copyright/takedown", dependencies=[Depends(ai_rate_limit(5, 3600))])
def takedown(body: TakedownRequest, ctx: Ctx = Depends(access.public())):
    """A guide or class set named in the link (/sets/<guide id>, or an older class set link) is held
    at once for an admin to review (well inside the 24-hour promise). A profile (/u/<username>)
    goes to the admin queue without a hold: the form is anonymous and a whole profile is at stake."""
    if not body.statement:
        raise HTTPException(status_code=400, detail="Confirm the statement to continue")
    db = ctx.db
    set_id: Optional[str] = None
    guide_id: Optional[str] = None
    found = _SET_ID.search(body.location)
    if found:
        candidate = found.group(1) or found.group(2)
        try:
            candidate = str(uuid.UUID(candidate))
        except ValueError:
            candidate = None
        if candidate:
            shared = (db.table("shared_sets").select("id,guide_id").eq("id", candidate).limit(1).execute().data or [None])[0]
            if not shared:
                shared = (db.table("shared_sets").select("id,guide_id").eq("guide_id", candidate).limit(1).execute().data or [None])[0]
                if shared or db.table("study_guides").select("id").eq("id", candidate).limit(1).execute().data:
                    guide_id = candidate
            if shared:
                set_id, guide_id = shared["id"], guide_id or shared.get("guide_id")
    row = {
        "set_id": set_id, "claimant_name": body.name.strip(), "claimant_email": str(body.email),
        "work_description": body.work.strip(), "location": body.location.strip(),
    }
    if guide_id:
        row["guide_id"] = guide_id
    profile_id = None if (set_id or guide_id) else profile_from(body.location, db)
    try:  # profile_id arrives with migration 20261126120000; before it, the link stays in `location`
        db.table("copyright_takedowns").insert({**row, "profile_id": profile_id} if profile_id else row).execute()
    except Exception:
        if not profile_id:
            raise
        db.table("copyright_takedowns").insert(row).execute()
    if set_id:
        db.table("shared_sets").update({"status": "held", "hold_reason": COPYRIGHT_HOLD}).eq("id", set_id).in_("status", ["visible", "held"]).execute()
    if guide_id:
        db.table("study_guides").update({"review_status": "held", "hold_reason": COPYRIGHT_HOLD}).eq("id", guide_id).neq("review_status", "hidden").execute()
    return {"ok": True, "contact": COPYRIGHT_EMAIL}


@router.get("/instructors/opt-outs", dependencies=[Depends(ai_rate_limit(30, 60))])
def my_opt_outs(ctx: Ctx = Depends(access.own())):
    """For a verified instructor: each course they turned sharing off for, and what that hides now
    (public guides out of Discover, class sets kept private, classrooms where adding is locked)."""
    return {"courses": instructors.opt_out_report(ctx.db, ctx.user_id)}
