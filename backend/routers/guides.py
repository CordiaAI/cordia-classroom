"""
Guides router for CordiaClassroom.
Handles CRUD operations for saved study guides.
"""

import re
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from database import get_supabase
from auth_utils import get_user_id

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/guides", tags=["guides"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    """Validate a path parameter is a valid UUID."""
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


class SaveGuideRequest(BaseModel):
    title: str
    folder_id: Optional[str] = None
    notes: Optional[str] = None
    study_guide: Optional[str] = None
    flashcards: Optional[list] = None
    source_url: Optional[str] = None
    external_source_id: Optional[str] = Field(default=None, max_length=500)
    source_type: Optional[str] = Field(default=None, max_length=50)
    source_title: Optional[str] = Field(default=None, max_length=500)
    source_id: Optional[str] = Field(default=None, max_length=500)
    domain: Optional[str] = None

    model_config = {"str_max_length": 5_000_000}

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError("Title is required")
        if len(v) > 500:
            raise ValueError("Title too long")
        return v.strip()

    @field_validator("folder_id")
    @classmethod
    def validate_folder_id(cls, v):
        if v is not None and not _UUID_RE.match(v):
            raise ValueError("Invalid folder ID")
        return v

    @field_validator("source_url")
    @classmethod
    def validate_url(cls, v):
        if v and len(v) > 2048:
            raise ValueError("URL too long")
        if v and not re.match(r"^https?://", v, re.IGNORECASE):
            raise ValueError("Source URL must use HTTP or HTTPS")
        return v


# Columns for list screens: everything except the large text and question sets.
SUMMARY_COLUMNS = "id,folder_id,title,source_url,created_at,is_bookmarked,read_progress,source_type,source_title,domain,flashcards"


@router.get("")
def list_guides(folder_id: Optional[str] = None, limit: int = 50, offset: int = 0, fields: str = "", authorization: str = Header(default="")):
    """List guides, optionally filtered by folder. Paginated.
    fields=summary returns list metadata plus flashcard_count, without guide text."""
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()
        summary = fields == "summary"

        # Enforce pagination bounds (summaries are small, so a whole library fits)
        limit = max(1, min(limit, 500 if summary else 100))
        offset = max(0, offset)

        query = supabase.table("study_guides") \
            .select(SUMMARY_COLUMNS if summary else "*") \
            .eq("user_id", user_id)

        if folder_id:
            _validate_uuid(folder_id, "folder ID")
            query = query.eq("folder_id", folder_id)

        result = query.order("created_at", desc=True) \
            .range(offset, offset + limit - 1) \
            .execute()

        guides = result.data or []
        if summary:
            for guide in guides:
                cards = guide.pop("flashcards", None)
                guide["flashcard_count"] = len(cards) if isinstance(cards, list) else 0
        return {"guides": guides}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing guides: {e}")
        raise HTTPException(status_code=500, detail="Failed to list guides")


@router.post("")
def save_guide(request: SaveGuideRequest, authorization: str = Header(default="")):
    """Save a new study guide."""
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        data = {
            "user_id": user_id,
            "title": request.title,
            "notes": request.notes,
            "study_guide": request.study_guide,
            "source_url": request.source_url,
        }

        if request.domain:
            data["domain"] = request.domain

        if request.folder_id:
            data["folder_id"] = request.folder_id

        if request.flashcards:
            data["flashcards"] = request.flashcards

        if request.external_source_id:
            data["external_source_id"] = request.external_source_id

        for field in ("source_type", "source_title", "source_id"):
            value = getattr(request, field)
            if value:
                data[field] = value

        table = supabase.table("study_guides")
        result = (
            table.upsert(data, on_conflict="user_id,external_source_id")
            if request.external_source_id
            else table.insert(data)
        ).execute()

        if result.data:
            return {"guide": result.data[0]}
        raise HTTPException(status_code=500, detail="Failed to save guide")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to save guide")

@router.patch("/{guide_id}")
def update_guide(guide_id: str, request: SaveGuideRequest, authorization: str = Header(default="")):
    """Update an existing study guide's content (notes, title, flashcards, etc.)."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        # 1. Prepare only the fields that were provided in the request
        # This converts the Pydantic model to a dict, excluding unset values
        update_data = request.model_dump(exclude_unset=True)

        # 2. Perform the update in Supabase
        result = supabase.table("study_guides") \
            .update(update_data) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Guide not found or no changes made")

        return {"guide": result.data[0]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to update guide")
    
@router.get("/{guide_id}")
def get_guide(guide_id: str, authorization: str = Header(default="")):
    """Get a single study guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("study_guides") \
            .select("*") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Guide not found")

        return {"guide": result.data[0]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to get guide")


@router.delete("/{guide_id}")
def delete_guide(guide_id: str, authorization: str = Header(default="")):
    """Delete a study guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        supabase.table("study_guides") \
            .delete() \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"deleted": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete guide")


class RenameGuideRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError("Title is required")
        if len(v) > 500:
            raise ValueError("Title too long")
        return v.strip()


@router.patch("/{guide_id}/rename")
def rename_guide(guide_id: str, request: RenameGuideRequest, authorization: str = Header(default="")):
    """Rename a study guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        current = supabase.table("study_guides") \
            .select("id") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not current.data:
            raise HTTPException(status_code=404, detail="Guide not found")

        supabase.table("study_guides") \
            .update({"title": request.title}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"title": request.title}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error renaming guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to rename guide")


@router.patch("/{guide_id}/bookmark")
def toggle_bookmark(guide_id: str, authorization: str = Header(default="")):
    """Toggle bookmark status on a guide."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        current = supabase.table("study_guides") \
            .select("is_bookmarked") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not current.data:
            raise HTTPException(status_code=404, detail="Guide not found")

        new_val = not current.data[0].get("is_bookmarked", False)
        supabase.table("study_guides") \
            .update({"is_bookmarked": new_val}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"is_bookmarked": new_val}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error toggling bookmark: {e}")
        raise HTTPException(status_code=500, detail="Failed to toggle bookmark")


class FlashcardProgressRequest(BaseModel):
    known: list = []
    unknown: list = []
    last_studied: Optional[str] = None


@router.patch("/{guide_id}/flashcard-progress")
def update_flashcard_progress(guide_id: str, request: FlashcardProgressRequest, authorization: str = Header(default="")):
    """Update flashcard study progress."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        supabase.table("study_guides") \
            .update({"flashcard_progress": {
                "known": request.known,
                "unknown": request.unknown,
                "last_studied": request.last_studied
            }}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"updated": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating flashcard progress: {e}")
        raise HTTPException(status_code=500, detail="Failed to update progress")


class MoveGuideRequest(BaseModel):
    folder_id: Optional[str] = None

    @field_validator("folder_id")
    @classmethod
    def validate_folder_id(cls, v):
        if v is not None and not _UUID_RE.match(v):
            raise ValueError("Invalid folder ID")
        return v


@router.patch("/{guide_id}/move")
def move_guide(guide_id: str, request: MoveGuideRequest, authorization: str = Header(default="")):
    """Move a guide to a different folder (or remove from folder if folder_id is None)."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        # Verify guide belongs to user
        current = supabase.table("study_guides") \
            .select("id") \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        if not current.data:
            raise HTTPException(status_code=404, detail="Guide not found")

        # If folder_id provided, verify folder belongs to user
        if request.folder_id:
            folder = supabase.table("folders") \
                .select("id") \
                .eq("id", request.folder_id) \
                .eq("user_id", user_id) \
                .execute()
            if not folder.data:
                raise HTTPException(status_code=404, detail="Folder not found")

        supabase.table("study_guides") \
            .update({"folder_id": request.folder_id}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"updated": True, "folder_id": request.folder_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error moving guide: {e}")
        raise HTTPException(status_code=500, detail="Failed to move guide")


class ReadProgressRequest(BaseModel):
    read_progress: float

    @field_validator("read_progress")
    @classmethod
    def validate_progress(cls, v):
        if not isinstance(v, (int, float)) or v < 0.0 or v > 1.0:
            raise ValueError("Progress must be between 0.0 and 1.0")
        return float(v)


@router.patch("/{guide_id}/read-progress")
def update_read_progress(guide_id: str, request: ReadProgressRequest, authorization: str = Header(default="")):
    """Update read progress (0.0 to 1.0)."""
    try:
        _validate_uuid(guide_id, "guide ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        supabase.table("study_guides") \
            .update({"read_progress": min(1.0, max(0.0, request.read_progress))}) \
            .eq("id", guide_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"updated": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating read progress: {e}")
        raise HTTPException(status_code=500, detail="Failed to update progress")
