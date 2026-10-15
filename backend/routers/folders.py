"""
Folders router for CordiaClassroom.
Handles CRUD operations for class folders.
"""

import re
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, field_validator
from database import get_supabase
from auth_utils import get_user_id

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/folders", tags=["folders"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


class CreateFolderRequest(BaseModel):
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
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("folders") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .limit(200) \
            .execute()

        return {"folders": result.data}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing folders: {e}")
        raise HTTPException(status_code=500, detail="Failed to list folders")


@router.post("")
def create_folder(request: CreateFolderRequest, authorization: str = Header(default="")):
    """Create a new folder (class)."""
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("folders").insert({
            "user_id": user_id,
            "name": request.name
        }).execute()

        if result.data:
            return {"folder": result.data[0]}
        raise HTTPException(status_code=500, detail="Failed to create folder")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating folder: {e}")
        raise HTTPException(status_code=500, detail="Failed to create folder")


@router.delete("/{folder_id}")
def delete_folder(folder_id: str, authorization: str = Header(default="")):
    """Delete a folder."""
    try:
        _validate_uuid(folder_id, "folder ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        supabase.table("folders") \
            .delete() \
            .eq("id", folder_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"deleted": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting folder: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete folder")
