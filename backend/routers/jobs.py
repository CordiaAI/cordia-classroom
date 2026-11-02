"""Study sets built in the background (services/generation_jobs.py), for the app.

POST /study-set-jobs queues one (the New sheet and the lecture page), GET /study-set-jobs/{id} says
how it's going and returns the saved guide when it's done. GET /study-set-jobs lists sets a
connected app (Claude) made that the student hasn't seen yet, so the app can tell them, and
POST /study-set-jobs/{id}/seen marks one seen.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase
from ids import is_uuid, require_uuid
from rate_limit import limiter
from routers.guides import require_own_folder
from services.entitlements import require

router = APIRouter(prefix="/study-set-jobs", tags=["jobs"])
JOB_COLUMNS = "id,status,progress,study_set_id,error,title,source,client_name,created_at,updated_at"
MAX_ACTIVE = 5


class StudySetJobRequest(BaseModel):
    content: str = Field(..., min_length=10, max_length=500_000)
    title: str = Field(..., min_length=1, max_length=500)
    keep_title: bool = False
    notes: bool = True
    flashcards: bool = True
    source_type: Optional[str] = Field(default=None, max_length=50)
    source_title: Optional[str] = Field(default=None, max_length=500)
    source_url: Optional[str] = Field(default=None, max_length=2048)
    external_source_id: Optional[str] = Field(default=None, max_length=500)
    folder_id: Optional[str] = None

    @field_validator("folder_id")
    @classmethod
    def valid_folder(cls, value):
        if value in (None, ""):
            return None
        if not is_uuid(value):
            raise ValueError("Invalid folder ID")
        return value

    @field_validator("source_url")
    @classmethod
    def valid_url(cls, value):
        if value and not value.lower().startswith(("http://", "https://")):
            raise ValueError("Source URL must use HTTP or HTTPS")
        return value or None


@router.post("")
@limiter.limit("15/minute")
def queue_job(body: StudySetJobRequest, request: Request, authorization: str = Header(default="")):
    """Queue a study set from the student's material. Checks the plan first, like /generate."""
    user_id = get_user_id(authorization)
    require(user_id, "guide")
    db = get_supabase()
    require_own_folder(db, user_id, body.folder_id)
    active = db.table("generation_jobs").select("id").eq("user_id", user_id).in_("status", ["queued", "running"]).limit(MAX_ACTIVE).execute().data or []
    if len(active) >= MAX_ACTIVE:
        raise HTTPException(status_code=429, detail="Five study sets are already being made. Wait for one to finish.")
    data = body.model_dump(exclude={"folder_id"})
    row = db.table("generation_jobs").insert({
        "user_id": user_id, "kind": "study_set", "status": "queued", "source": "app",
        "title": body.title, "folder_id": body.folder_id, "input": data,
    }).execute().data
    if not row:
        raise HTTPException(status_code=500, detail="The study set could not be queued.")
    return {"job": {key: row[0].get(key) for key in JOB_COLUMNS.split(",")}}


@router.get("")
def unseen_jobs(authorization: str = Header(default="")):
    """Study sets a connected app made in the last two days that the student hasn't seen."""
    user_id = get_user_id(authorization)
    since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    rows = get_supabase().table("generation_jobs").select(JOB_COLUMNS).eq("user_id", user_id).eq("source", "mcp") \
        .is_("seen_at", "null").gte("created_at", since).order("created_at", desc=True).limit(10).execute().data or []
    return {"jobs": rows}


@router.get("/{job_id}")
def job_status(job_id: str, authorization: str = Header(default="")):
    require_uuid(job_id, "job ID")
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = db.table("generation_jobs").select(JOB_COLUMNS).eq("id", job_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Job not found")
    job = rows[0]
    guide = None
    if job["status"] == "done" and job.get("study_set_id"):
        found = db.table("study_guides").select("*").eq("id", job["study_set_id"]).eq("user_id", user_id).limit(1).execute().data
        guide = found[0] if found else None
    return {"job": job, "guide": guide}


@router.post("/{job_id}/seen")
def mark_seen(job_id: str, authorization: str = Header(default="")):
    require_uuid(job_id, "job ID")
    user_id = get_user_id(authorization)
    get_supabase().table("generation_jobs").update({"seen_at": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", job_id).eq("user_id", user_id).execute()
    return {"seen": True}
