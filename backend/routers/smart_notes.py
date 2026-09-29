import re
import logging
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, field_validator
from typing import Optional
from database import get_supabase
from auth_utils import get_user_id
from routers.billing import check_usage, record_usage
from services.llm import study_guide_is_complete, study_guide_to_flashcards
from services.llm_calls import chat

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/smart_notes", tags=["smart_notes"])


def _validate_uuid(value: str, name: str = "ID") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


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
        if not _UUID_RE.match(v):
            raise ValueError("Invalid folder ID")
        return v


class DiagramRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if not v or not v.strip():
            raise ValueError("Content is required")
        return v[:10_000]


@router.get("")
def list_notes(authorization: str = Header(default="")):
    try:
        user_id = get_user_id(authorization)
        supabase = get_supabase()
        result = supabase.table("smart_notes") \
            .select("id, title, updated_at, created_at, folder_id, content") \
            .eq("user_id", user_id) \
            .order("updated_at", desc=True) \
            .execute()
        return {"notes": result.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing smart notes: {e}")
        raise HTTPException(status_code=500, detail="Failed to list notes")


@router.post("")
def create_note(request: CreateNoteRequest, authorization: str = Header(default="")):
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating smart note: {e}")
        raise HTTPException(status_code=500, detail="Failed to create note")


@router.get("/{note_id}")
def get_note(note_id: str, authorization: str = Header(default="")):
    try:
        _validate_uuid(note_id, "note ID")
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting smart note: {e}")
        raise HTTPException(status_code=500, detail="Failed to get note")


@router.put("/{note_id}")
def update_note(note_id: str, request: UpdateNoteRequest, authorization: str = Header(default="")):
    try:
        _validate_uuid(note_id, "note ID")
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

        from datetime import datetime, timezone
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()

        supabase.table("smart_notes") \
            .update(updates) \
            .eq("id", note_id) \
            .eq("user_id", user_id) \
            .execute()

        return {"updated": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating smart note: {e}")
        raise HTTPException(status_code=500, detail="Failed to update note")


@router.delete("/{note_id}")
def delete_note(note_id: str, authorization: str = Header(default="")):
    try:
        _validate_uuid(note_id, "note ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()
        supabase.table("smart_notes") \
            .delete() \
            .eq("id", note_id) \
            .eq("user_id", user_id) \
            .execute()
        return {"deleted": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting smart note: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete note")


@router.post("/{note_id}/study_guide")
def generate_study_guide_from_note(note_id: str, authorization: str = Header(default="")):
    """Generate a preview study guide from a SmartNote's content.
    Does NOT save to study_guides — the frontend shows a preview and the
    user picks Approve (which posts to /guides), Edit (manual editor),
    or Cancel.
    """
    try:
        _validate_uuid(note_id, "note ID")
        user_id = get_user_id(authorization)
        supabase = get_supabase()

        result = supabase.table("smart_notes") \
            .select("id, title, content") \
            .eq("id", note_id) \
            .eq("user_id", user_id) \
            .execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Note not found")

        note = result.data[0]
        html_content = note.get("content") or ""
        if not html_content.strip():
            raise HTTPException(status_code=400, detail="Note is empty — add some content first")

        from services.llm import generate_study_guide_from_notes
        usage = check_usage(user_id, "build")
        study_guide = generate_study_guide_from_notes(html_content)

        if not study_guide:
            raise HTTPException(status_code=422, detail="Couldn't find educational content in this note")
        if study_guide.startswith("[Error"):
            raise HTTPException(status_code=502, detail=study_guide.strip("[]"))

        pairs = [
            {"question": pair["front"], "answer": pair["back"]}
            for pair in study_guide_to_flashcards(study_guide)
        ]

        if not pairs or not study_guide_is_complete(study_guide):
            raise HTTPException(status_code=422, detail="No Q&A pairs could be generated from this note")

        title = (note.get("title") or "Untitled Notes").strip()
        suggested_title = title if title.lower().endswith("study guide") else f"{title} — Study Guide"

        record_usage(user_id, "build", usage)
        return {
            "title": suggested_title,
            "study_guide": study_guide,
            "pairs": pairs,
            "notes_html": html_content,  # passed back so frontend can save as the notes field
            "source": {"type": "smartnote", "id": note["id"], "title": title},
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating study guide from note: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate study guide")


@router.post("/diagram")
def generate_diagram(request: DiagramRequest, authorization: str = Header(default="")):
    try:
        user_id = get_user_id(authorization)
        import os
        from openai import OpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return {"mermaid": None}

        usage = check_usage(user_id, "lightweight")
        client = OpenAI(api_key=api_key)
        response = chat(client, "smart_notes_diagram",
            messages=[{
                "role": "system",
                "content": (
                    "You generate Mermaid.js diagrams for student notes. "
                    "The user has manually selected this text specifically because they want a visual that will help them understand the content. "
                    " BEFORE creating the diagram, understand the topic/field of study and determine if there is a specific type of diagram that would best represent the information or specific way it should be represented. (e.g., a list of ip packet headers should not be a flow chart diagram, but in the form of a packet with the corrent length based off the bits. if a user lists a process, it shouldn't be labeled as a table or graph, but as a flow chart with labeled conditions). "
                    "Always try to create the most useful diagram possible — If you cannot seem to determine the field of study and an already used/represnted visual example (in the industry already) then use sequenceDiagram for "
                    "communication/protocol flows, flowchart for processes, graph for relationships, "
                    "mindmap for hierarchies, or classDiagram for structures. "
                    "Output ONLY raw valid Mermaid.js syntax — no markdown fences, no explanation. "
                    "Keep diagrams concise (max 14 nodes). "
                    "If you cannot figure out how to visualize something and think it cannot be visualized, then simply create a classification diagram or think of a way to just help put in a visual the way somebody would remember it in their head." 
                )
            }, {
                "role": "user",
                "content": request.content
            }]
        )

        text = response.choices[0].message.content.strip()
        # Strip markdown fences if the model wrapped output anyway
        text = re.sub(r'^```(?:mermaid)?\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s*```$', '', text).strip()
        if not text or 'NO_DIAGRAM' in text:
            return {"mermaid": None}
        record_usage(user_id, "lightweight", usage)
        return {"mermaid": text}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating diagram: {e}")
        return {"mermaid": None}
