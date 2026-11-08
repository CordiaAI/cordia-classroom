"""Public forms: instructor opt-out and copyright takedowns (guides, class sets and profiles)."""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import access
from access import Ctx
from database import get_supabase
from rate_limit import ai_rate_limit
from services import instructors
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
    # Hidden on the form: people never fill it in.
    website: str = Field(default="", max_length=500)


@router.post("/copyright/takedown", dependencies=[Depends(ai_rate_limit(5, 3600))])
def takedown(body: TakedownRequest, ctx: Ctx = Depends(access.public())):
    """Receives a copyright report on a guide, class set or profile for staff to review. Nothing is
    held or removed here: staff confirm the reporter by email and decide in the admin queue
    (routers/admin.py). One open report per item; a later one on the same item attaches to it."""
    from services import takedowns
    received = {"ok": True, "contact": COPYRIGHT_EMAIL}
    if body.website.strip():
        return received  # the hidden field was filled: same answer, nothing saved
    if not body.statement:
        raise HTTPException(status_code=400, detail="Confirm the statement to continue")
    db = ctx.db
    if takedowns.received_today(db) >= takedowns.DAILY_CAP:
        raise HTTPException(status_code=429, detail=f"We can't take more reports online today. Email {COPYRIGHT_EMAIL} instead.")
    location = body.location.strip()
    set_id, guide_id, profile_id = takedowns.target(db, location)
    existing = takedowns.open_report(db, set_id, guide_id, profile_id, location)
    if existing:
        takedowns.attach(db, existing)
        return received
    row = {
        "set_id": set_id, "claimant_name": body.name.strip(), "claimant_email": str(body.email),
        "work_description": body.work.strip(), "location": location, "status": "received",
    }
    if guide_id:
        row["guide_id"] = guide_id
    try:
        try:  # profile_id arrives with migration 20261126120000; before it, the link stays in `location`
            db.table("copyright_takedowns").insert({**row, "profile_id": profile_id} if profile_id else row).execute()
        except Exception as error:
            if not profile_id or "duplicate key" in str(error) or "23505" in str(error):
                raise
            db.table("copyright_takedowns").insert(row).execute()
    except Exception as error:
        # Another report on the same item won the race (the one-open-report index): acknowledged.
        if "duplicate key" in str(error) or "23505" in str(error):
            return received
        raise
    takedowns.notify_owner(db, set_id, guide_id, profile_id)
    return received


@router.get("/instructors/opt-outs", dependencies=[Depends(ai_rate_limit(30, 60))])
def my_opt_outs(ctx: Ctx = Depends(access.own())):
    """For a verified instructor: each course they turned sharing off for, and what that hides now
    (public guides out of Discover, class sets kept private, classrooms where adding is locked)."""
    return {"courses": instructors.opt_out_report(ctx.db, ctx.user_id)}
