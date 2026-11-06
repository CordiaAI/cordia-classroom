"""Public forms: instructor opt-out and copyright takedowns."""
from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth_utils import get_user_id
from database import get_supabase
from rate_limit import ai_rate_limit
from services.class_catalog import normalize_course_code
from services.class_db import ensure_class

router = APIRouter(tags=["public"])
COPYRIGHT_EMAIL = "support@cordiaai.io"


def _school_email_domains(school: dict) -> list[str]:
    domains = [d.lower().lstrip("@") for d in school.get("email_domains") or [] if d]
    host = (school.get("canvas_domain") or "").lower()
    if not domains and host and not host.endswith(".instructure.com") and host.count(".") >= 2:
        domains.append(host.split(".", 1)[1])  # canvas.missouri.edu -> missouri.edu
    return domains


def _email_matches(email: str, domains: list[str]) -> bool:
    domain = email.rsplit("@", 1)[-1].lower()
    return any(domain == d or domain.endswith("." + d) for d in domains)


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
def instructor_schools(q: str = "", _=Depends(ai_rate_limit(30, 60))):
    q = re.sub(r"[%_,()]", " ", q).strip()
    if len(q) < 2:
        return {"schools": []}
    rows = get_supabase().table("schools").select("id,name").ilike("name", f"%{q}%").limit(8).execute().data or []
    return {"schools": rows}


@router.post("/instructors/block", dependencies=[Depends(ai_rate_limit(10, 3600))])
def block_course(body: BlockRequest, authorization: str = Header(default="")):
    """An instructor with a verified school email turns sharing off for their course."""
    user_id = get_user_id(authorization)
    email = _verified_email(user_id)
    db = get_supabase()
    try:
        school_id = str(uuid.UUID(body.school_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Pick your school")
    school = (db.table("schools").select("*").eq("id", school_id).limit(1).execute().data or [None])[0]
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    domains = _school_email_domains(school)
    if not domains or not _email_matches(email, domains):
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


@router.post("/copyright/takedown", dependencies=[Depends(ai_rate_limit(5, 3600))])
def takedown(body: TakedownRequest):
    """Holds the named guide or class set at once for an admin to review (well inside the 24-hour
    promise). The link can be a guide page (/sets/<guide id>) or an older class set link."""
    if not body.statement:
        raise HTTPException(status_code=400, detail="Confirm the statement to continue")
    db = get_supabase()
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
    db.table("copyright_takedowns").insert(row).execute()
    if set_id:
        db.table("shared_sets").update({"status": "held", "hold_reason": COPYRIGHT_HOLD}).eq("id", set_id).in_("status", ["visible", "held"]).execute()
    if guide_id:
        db.table("study_guides").update({"review_status": "held", "hold_reason": COPYRIGHT_HOLD}).eq("id", guide_id).neq("review_status", "hidden").execute()
    return {"ok": True, "contact": COPYRIGHT_EMAIL}


@router.get("/instructors/opt-outs", dependencies=[Depends(ai_rate_limit(30, 60))])
def my_opt_outs(authorization: str = Header(default="")):
    """For a verified instructor: each course they turned sharing off for, and what that hides now
    (public guides out of Discover, class sets kept private, classrooms where adding is locked)."""
    from services import instructors
    user_id = get_user_id(authorization)
    return {"courses": instructors.opt_out_report(get_supabase(), user_id)}
