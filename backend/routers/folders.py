"""
Folders router for CordiaClassroom.
Handles CRUD operations for class folders.
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, field_validator
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
