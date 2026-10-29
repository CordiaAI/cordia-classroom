"""
Guides router for CordiaClassroom.
Handles CRUD operations for saved study guides.
"""

import re
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from database import get_supabase
from services.llm import guide_title
from services.sharing import on_guide_changed
from routers.quiz import start_quiz_warmup
from auth_utils import get_user_id
from ids import is_uuid, require_uuid


router = APIRouter(prefix="/guides", tags=["guides"])


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
    keep_title: bool = False  # The student typed the title: save it as typed.

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
        if v is not None and not is_uuid(v):
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
SUMMARY_COLUMNS = "id,folder_id,title,source_url,created_at,is_bookmarked,read_progress,source_type,source_title,flashcards,flashcard_progress"


@router.get("")
def list_guides(folder_id: Optional[str] = None, limit: int = 50, offset: int = 0, fields: str = "", authorization: str = Header(default="")):
    """List guides, optionally filtered by folder. Paginated.
    fields=summary returns list metadata plus flashcard_count and flashcard_progress (for the
    Dashboard's cards-due count), without guide text."""
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
        require_uuid(folder_id, "folder ID")
        query = query.eq("folder_id", folder_id)

    result = query.order("created_at", desc=True) \
        .range(offset, offset + limit - 1) \
        .execute()

    guides = result.data or []
    if summary:
        for guide in guides:
            cards = guide.pop("flashcards", None)
            guide["flashcard_count"] = len(cards) if isinstance(cards, list) else 0
            learned = flashcard_learn_levels(cards, guide.get("flashcard_progress"))
            if learned:
                guide["flashcard_learn"] = learned
    return {"guides": guides}


def _learn_fingerprint(question) -> str:
    """Learn's question fingerprint (fingerprint() in web/lib/learnEngine.mjs)."""
    return re.sub(r"[^a-z0-9]+", " ", str(question or "").lower()).strip()[:48]


def flashcard_learn_levels(cards, progress) -> dict:
    """{card index: Learn level 0-3} for flashcards whose question Learn has a level for. Learn's
    ideas are the guide's quiz questions, made from the same Q&A pairs as the cards, so a card and
    an idea are the same when their question fingerprints match. Lets the Progress knowledge map
    show Learn's progress without sending every card."""
    levels = ((progress or {}).get("learn") or {}).get("levels") if isinstance(progress, dict) else None
    if not isinstance(cards, list) or not isinstance(levels, dict):
        return {}
    by_question = {}
    for entry in levels.values():
        if isinstance(entry, dict) and isinstance(entry.get("l"), int) and entry.get("q"):
            by_question[entry["q"]] = max(by_question.get(entry["q"], 0), entry["l"])
    matched = {}
    for index, card in enumerate(cards):
        level = by_question.get(_learn_fingerprint(card.get("front") if isinstance(card, dict) else ""))
        if level:
            matched[str(index)] = level
    return matched


def require_own_folder(supabase, user_id: str, folder_id: Optional[str]) -> None:
    """A guide can only be filed in one of the student's own classes."""
    if not folder_id:
        return
    require_uuid(folder_id, "folder ID")
    if not supabase.table("folders").select("id").eq("id", folder_id).eq("user_id", user_id).execute().data:
        raise HTTPException(status_code=404, detail="Folder not found")


@router.post("")
def save_guide(request: SaveGuideRequest, authorization: str = Header(default="")):
    """Save a new study guide."""
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    data = {
        "user_id": user_id,
        "title": guide_title(request.title, request.notes or request.study_guide or "", keep=request.keep_title),
        "notes": request.notes,
        "study_guide": request.study_guide,
        "source_url": request.source_url,
    }

    if request.folder_id:
        require_own_folder(supabase, user_id, request.folder_id)
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
        start_quiz_warmup(result.data[0], user_id)
        return {"guide": result.data[0]}
    raise HTTPException(status_code=500, detail="Failed to save guide")

@router.patch("/{guide_id}")
def update_guide(guide_id: str, request: SaveGuideRequest, authorization: str = Header(default="")):
    """Update an existing study guide's content (notes, title, flashcards, etc.)."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    # 1. Prepare only the fields that were provided in the request
    # This converts the Pydantic model to a dict, excluding unset values
    update_data = request.model_dump(exclude_unset=True)
    update_data.pop("keep_title", None)
    require_own_folder(supabase, user_id, update_data.get("folder_id"))

    # 2. Perform the update in Supabase
    result = supabase.table("study_guides") \
        .update(update_data) \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Guide not found or no changes made")

    if {"title", "study_guide", "flashcards"} & set(update_data):
        on_guide_changed(supabase, user_id, guide_id)
    return {"guide": result.data[0]}
    
# Smaller column sets for screens that don't show the guide text (default: every column).
GUIDE_FIELDS = {
    "meta": "id,title,folder_id,flashcard_progress,source_type,created_at",
    "cards": "id,title,flashcards,flashcard_progress,is_bookmarked",
}


@router.get("/{guide_id}")
def get_guide(guide_id: str, fields: str = "", authorization: str = Header(default="")):
    """Get a single study guide. fields=meta or fields=cards returns only those columns."""
    require_uuid(guide_id, "guide ID")
    if fields and fields not in GUIDE_FIELDS:
        raise HTTPException(status_code=400, detail="fields must be meta or cards")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    result = supabase.table("study_guides") \
        .select(GUIDE_FIELDS.get(fields, "*")) \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Guide not found")

    return {"guide": result.data[0]}


@router.delete("/{guide_id}")
def delete_guide(guide_id: str, authorization: str = Header(default="")):
    """Delete a study guide."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    supabase.table("study_guides") \
        .delete() \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"deleted": True}


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
    require_uuid(guide_id, "guide ID")
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

    on_guide_changed(supabase, user_id, guide_id)
    return {"title": request.title}


@router.patch("/{guide_id}/bookmark")
def toggle_bookmark(guide_id: str, authorization: str = Header(default="")):
    """Toggle bookmark status on a guide."""
    require_uuid(guide_id, "guide ID")
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


_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_SCHEDULED_CARDS = 2000


class FlashcardProgressRequest(BaseModel):
    known: list = []
    unknown: list = []
    last_studied: Optional[str] = None
    # Spaced review (web/lib/spacedReview.mjs): {card index: {"box": 0-5, "due": "YYYY-MM-DD"}}.
    schedule: Optional[dict] = None

    @field_validator("schedule")
    @classmethod
    def valid_schedule(cls, value):
        if value is None:
            return None
        if len(value) > MAX_SCHEDULED_CARDS:
            raise ValueError("Too many cards")
        clean = {}
        for index, entry in value.items():
            box = entry.get("box") if isinstance(entry, dict) else None
            due = entry.get("due") if isinstance(entry, dict) else None
            if not str(index).isdigit() or not isinstance(box, int) or not 0 <= box <= 5 or not isinstance(due, str) or not _DAY.match(due):
                raise ValueError("Invalid schedule entry")
            clean[str(index)] = {"box": box, "due": due}
        return clean


@router.patch("/{guide_id}/flashcard-progress")
def update_flashcard_progress(guide_id: str, request: FlashcardProgressRequest, authorization: str = Header(default="")):
    """Update flashcard study progress."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    current = supabase.table("study_guides").select("flashcard_progress").eq("id", guide_id).eq("user_id", user_id).execute()
    saved = (current.data or [{}])[0].get("flashcard_progress") or {}
    # A client that doesn't schedule cards keeps the schedule already saved; Learn's progress is kept too.
    schedule = request.schedule if request.schedule is not None else saved.get("schedule") or {}

    supabase.table("study_guides") \
        .update({"flashcard_progress": {
            "known": request.known,
            "unknown": request.unknown,
            "last_studied": request.last_studied,
            "schedule": schedule,
            **({"learn": saved["learn"]} if saved.get("learn") else {}),
        }}) \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"updated": True}


MAX_LEARN_LEVEL = 3


class LearnProgressRequest(BaseModel):
    # Learn (web/lib/learnEngine.mjs): {question index: {"l": 0-3, "at": "YYYY-MM-DD", "q": fingerprint, "sure"?: true}}.
    levels: dict = {}
    test_date: Optional[str] = None

    @field_validator("levels")
    @classmethod
    def valid_levels(cls, value):
        if len(value) > MAX_SCHEDULED_CARDS:
            raise ValueError("Too many questions")
        clean = {}
        for index, entry in value.items():
            if not str(index).isdigit() or not isinstance(entry, dict):
                raise ValueError("Invalid level entry")
            level, day, mark = entry.get("l"), entry.get("at"), entry.get("q")
            if not isinstance(level, int) or not 0 <= level <= MAX_LEARN_LEVEL or not isinstance(mark, str) or len(mark) > 64:
                raise ValueError("Invalid level entry")
            if day is not None and not (isinstance(day, str) and _DAY.match(day)):
                raise ValueError("Invalid level entry")
            clean[str(index)] = {"l": level, "at": day, "q": mark, **({"sure": True} if entry.get("sure") is True else {})}
        return clean

    @field_validator("test_date")
    @classmethod
    def valid_test_date(cls, value):
        if value in (None, ""):
            return None
        if not _DAY.match(value):
            raise ValueError("Invalid test date")
        return value


@router.patch("/{guide_id}/learn-progress")
def update_learn_progress(guide_id: str, request: LearnProgressRequest, authorization: str = Header(default="")):
    """Save Learn's mastery levels and test date beside the flashcard progress."""
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    current = supabase.table("study_guides").select("flashcard_progress").eq("id", guide_id).eq("user_id", user_id).execute()
    if not current.data:
        raise HTTPException(status_code=404, detail="Study guide not found")
    progress = current.data[0].get("flashcard_progress") or {}
    progress["learn"] = {"levels": request.levels, "test_date": request.test_date}
    supabase.table("study_guides").update({"flashcard_progress": progress}).eq("id", guide_id).eq("user_id", user_id).execute()
    return {"updated": True}


class MoveGuideRequest(BaseModel):
    folder_id: Optional[str] = None

    @field_validator("folder_id")
    @classmethod
    def validate_folder_id(cls, v):
        if v is not None and not is_uuid(v):
            raise ValueError("Invalid folder ID")
        return v


@router.patch("/{guide_id}/move")
def move_guide(guide_id: str, request: MoveGuideRequest, authorization: str = Header(default="")):
    """Move a guide to a different folder (or remove from folder if folder_id is None)."""
    require_uuid(guide_id, "guide ID")
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

    require_own_folder(supabase, user_id, request.folder_id)

    supabase.table("study_guides") \
        .update({"folder_id": request.folder_id}) \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"updated": True, "folder_id": request.folder_id}


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
    require_uuid(guide_id, "guide ID")
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    supabase.table("study_guides") \
        .update({"read_progress": min(1.0, max(0.0, request.read_progress))}) \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()

    return {"updated": True}
