"""
Folders router for CordiaClassroom.
Handles CRUD operations for class folders.
"""

import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field, field_validator
from database import get_supabase
from auth_utils import get_user_id
from ids import require_uuid


router = APIRouter(prefix="/folders", tags=["folders"])


class FolderNameRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Folder name is required")
        if len(v) > 100:
            raise ValueError("Folder name too long")
        return v.strip()


class FolderCoverRequest(BaseModel):
    """A designed cover for Library's card view: one of eight colours and up to three icon names
    from the web app's fixed list (lib/coverDesign.mjs). Names only, never an image or a URL."""
    kind: Literal["design"] = "design"
    color: int = Field(default=0, ge=0, le=7)
    icons: list[str] = Field(min_length=1, max_length=3)

    @field_validator("icons")
    @classmethod
    def validate_icons(cls, v):
        if not all(re.fullmatch(r"[A-Z][A-Za-z0-9]{1,30}", name or "") for name in v):
            raise ValueError("Unknown icon")
        return list(dict.fromkeys(v))


def _set_cover(folder_id: str, user_id: str, cover):
    try:
        result = get_supabase().table("folders").update({"cover": cover}) \
            .eq("id", folder_id).eq("user_id", user_id).execute()
    except Exception as error:
        # Before the folder_covers migration runs, the column does not exist.
        if "cover" in str(error):
            raise HTTPException(status_code=503, detail="Class covers need a database update first")
        raise
    if not result.data:
        raise HTTPException(status_code=404, detail="Class not found")
    return {"folder": result.data[0]}


@router.get("")
def list_folders(authorization: str = Header(default="")):
    """List all folders for the current user (capped at 200)."""
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    result = supabase.table("folders") \
        .select("*") \
        .eq("user_id", user_id) \
        .order("created_at", desc=True) \
        .limit(200) \
        .execute()

    return {"folders": result.data}


@router.post("")
def create_folder(request: FolderNameRequest, authorization: str = Header(default="")):
    """Create a new folder (class)."""
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    result = supabase.table("folders").insert({
        "user_id": user_id,
        "name": request.name
    }).execute()

    if result.data:
        return {"folder": result.data[0]}
    raise HTTPException(status_code=500, detail="Failed to create folder")


@router.patch("/{folder_id}")
def rename_folder(folder_id: str, request: FolderNameRequest, authorization: str = Header(default="")):
    """Rename a class. Only your own Library name changes; a shared class keeps its course code."""
    require_uuid(folder_id, "folder ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    result = supabase.table("folders") \
        .update({"name": request.name}) \
        .eq("id", folder_id) \
        .eq("user_id", user_id) \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Class not found")
    return {"folder": result.data[0]}


@router.put("/{folder_id}/cover")
def set_folder_cover(folder_id: str, request: FolderCoverRequest, authorization: str = Header(default="")):
    """Save the class's cover for Library's card view."""
    require_uuid(folder_id, "folder ID")
    user_id = get_user_id(authorization)
    return _set_cover(folder_id, user_id, request.model_dump())


@router.delete("/{folder_id}/cover")
def remove_folder_cover(folder_id: str, authorization: str = Header(default="")):
    """Back to the plain placeholder cover."""
    require_uuid(folder_id, "folder ID")
    return _set_cover(folder_id, get_user_id(authorization), None)


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, authorization: str = Header(default="")):
    """Delete a folder."""
    require_uuid(folder_id, "folder ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    supabase.table("folders") \
        .delete() \
        .eq("id", folder_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"deleted": True}
