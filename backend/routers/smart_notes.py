from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, field_validator
from typing import Optional
from database import get_supabase
from auth_utils import get_user_id
from ids import is_uuid, require_uuid


router = APIRouter(prefix="/smart_notes", tags=["smart_notes"])


class CreateNoteRequest(BaseModel):
    title: str = "Untitled Notes"

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        v = v.strip() if v else "Untitled Notes"
        return v[:200] or "Untitled Notes"


class UpdateNoteRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    folder_id: Optional[str] = None  # set to empty string to clear

    model_config = {"str_max_length": 500_000}

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if v is not None:
            return v.strip()[:200]
        return v

    @field_validator("folder_id")
    @classmethod
    def validate_folder_id(cls, v):
        if v in (None, ""):
            return v
        if not is_uuid(v):
            raise ValueError("Invalid folder ID")
        return v


@router.get("")
def list_notes(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    result = supabase.table("smart_notes") \
        .select("id, title, updated_at, created_at, folder_id, content") \
        .eq("user_id", user_id) \
        .order("updated_at", desc=True) \
        .execute()
    return {"notes": result.data}


@router.post("")
def create_note(request: CreateNoteRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    result = supabase.table("smart_notes").insert({
        "user_id": user_id,
        "title": request.title,
        "content": "",
    }).execute()
    if result.data:
        return {"note": result.data[0]}
    raise HTTPException(status_code=500, detail="Failed to create note")


@router.get("/{note_id}")
def get_note(note_id: str, authorization: str = Header(default="")):
    require_uuid(note_id, "note ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    result = supabase.table("smart_notes") \
        .select("*") \
        .eq("id", note_id) \
        .eq("user_id", user_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"note": result.data[0]}


@router.put("/{note_id}")
def update_note(note_id: str, request: UpdateNoteRequest, authorization: str = Header(default="")):
    require_uuid(note_id, "note ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    updates = {}
    if request.title is not None:
        updates["title"] = request.title or "Untitled Notes"
    if request.content is not None:
        updates["content"] = request.content
    if request.folder_id is not None:
        # Empty string clears the folder_id; otherwise verify the folder is the user's
        if request.folder_id == "":
            updates["folder_id"] = None
        else:
            folder = supabase.table("folders") \
                .select("id") \
                .eq("id", request.folder_id) \
                .eq("user_id", user_id) \
                .execute()
            if not folder.data:
                raise HTTPException(status_code=404, detail="Folder not found")
            updates["folder_id"] = request.folder_id
    if not updates:
        return {"updated": False}

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    supabase.table("smart_notes") \
        .update(updates) \
        .eq("id", note_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"updated": True}


@router.delete("/{note_id}")
def delete_note(note_id: str, authorization: str = Header(default="")):
    require_uuid(note_id, "note ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    supabase.table("smart_notes") \
        .delete() \
        .eq("id", note_id) \
        .eq("user_id", user_id) \
        .execute()
    return {"deleted": True}
