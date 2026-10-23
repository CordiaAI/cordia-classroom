"""Google Drive as a material source: link a Drive folder to a class, and save copies back to Drive.
The work happens in services.drive_sync."""

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import limiter
from services import drive_sync

router = APIRouter(prefix="/drive", tags=["drive"])


def _own_folder(user_id: str, folder_id: str) -> dict:
    require_uuid(folder_id, "folder ID")
    rows = get_supabase().table("folders").select("id,name").eq("id", folder_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Class not found")
    return rows[0]


@router.get("/folders")
@limiter.limit("30/minute")
def find_folders(request: Request, q: str = "", authorization: str = Header(default="")):
    return {"folders": drive_sync.search_folders(get_user_id(authorization), q)}


@router.get("/links")
def list_links(authorization: str = Header(default="")):
    return {"links": drive_sync.links(get_user_id(authorization))}


class LinkRequest(BaseModel):
    library_folder_id: str = Field(..., max_length=36)
    drive_folder_id: str = Field(..., min_length=5, max_length=200, pattern=r"^[\w-]+$")
    drive_folder_name: str = Field(default="", max_length=300)


@router.put("/links")
@limiter.limit("10/minute")
def link_folder(body: LinkRequest, request: Request, authorization: str = Header(default="")):
    """Link a Drive folder to a class; its files come into the class now and as they change."""
    user_id = get_user_id(authorization)
    _own_folder(user_id, body.library_folder_id)
    result = drive_sync.link(user_id, body.library_folder_id, body.drive_folder_id, body.drive_folder_name)
    return {**result, "links": drive_sync.links(user_id)}


@router.delete("/links/{library_folder_id}")
def unlink_folder(library_folder_id: str, authorization: str = Header(default="")):
    """Stop syncing. Files already imported stay in Library."""
    user_id = get_user_id(authorization)
    _own_folder(user_id, library_folder_id)
    drive_sync.unlink(user_id, library_folder_id)
    return {"links": drive_sync.links(user_id)}


@router.post("/sync")
@limiter.limit("6/minute")
def sync_now(request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return {**drive_sync.sync_folders(user_id), "links": drive_sync.links(user_id)}


class SaveRequest(BaseModel):
    guide_id: str = Field(..., max_length=36)
    kind: Literal["guide", "cards"] = "guide"
    title: str = Field(default="", max_length=300)
    content: str = Field(..., min_length=1, max_length=1_000_000)


@router.post("/save")
@limiter.limit("10/minute")
def save_to_drive(body: SaveRequest, request: Request, authorization: str = Header(default="")):
    """A copy of the guide (or its cards) in the student's Cordia folder in Drive."""
    user_id = get_user_id(authorization)
    require_uuid(body.guide_id, "guide ID")
    if not get_supabase().table("study_guides").select("id").eq("id", body.guide_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Guide not found")
    return drive_sync.save_copy(user_id, body.guide_id, body.kind, body.title, body.content)
