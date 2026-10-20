"""POST /chat: every Tutor message, from the web app and the extension side panel.

A message is answered by one of: a browser command (capture / find material),
organizing a guide or note into a class, building a guide or practice set from
the selected material, or a grounded Tutor reply.
"""
import os
import re
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from auth_utils import get_user_id
from ids import require_uuid
from database import get_supabase
from rate_limit import limiter
from routers import guides, smart_notes
from schemas import ChatRequest, ChatResponse
from services.entitlements import record, require
from services.guidance import learning_guidance, style_instruction
from services.llm import (
    answer_question, explain_retain_answer, generate_practice_guide, generate_study_guide,
    study_guide_is_complete, study_guide_to_flashcards,
)
from services.text_processing import chunk_text, clean_text, html_to_text
from services.tutor_sessions import (
    TUTOR_SAFETY_POLICY, claim_tutor_turn, complete_tutor_turn, fail_tutor_turn,
    public_tutor_session, queue_browser_command, tutor_skill_instruction, wait_for_browser_result,
)

router = APIRouter(tags=["tutor"])

MAX_CONTENT_LENGTH = 500_000
TUTOR_CONTEXT_TOKENS = int(os.getenv("CLASSROOM_TUTOR_CONTEXT_TOKENS", "128000"))
TUTOR_RESERVED_TOKENS = 6_000
CONTEXT_FULL = "context_window_full"
PRACTICE_REQUEST = re.compile(r"\b(create|make|generate|build)\b.*\bpractice\b.*\b(problems?|questions?|guide)\b", re.IGNORECASE)
BROWSER_SKILLS = {
    "capture": ("capture_current_page", "Working in the browser side panel now. Keep it open while I read the current page."),
    "find_material": ("find_material_current_page", "Looking for relevant study material linked from the current page."),
}


@dataclass
class Material:
    """What the student asked about: an owned guide or note, an attached file or page, or nothing."""
    content: str
    source: Optional[dict] = None
    guide: Optional[dict] = None
    note: Optional[dict] = None

    @property
    def owned(self) -> dict:
        return self.guide or self.note or {}

    @property
    def title(self) -> str:
        return (self.source or {}).get("title") or "Study Material"


def _owned_row(table: str, columns: str, row_id: str, user_id: str, kind: str) -> dict:
    require_uuid(row_id, f"{kind} ID")
    result = get_supabase().table(table).select(columns).eq("id", row_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{kind.capitalize()} not found")
    return result.data[0]


def _load_material(body: ChatRequest, user_id: str) -> Material:
    """A saved guide or note is read from the database; the client's copy is only a fallback."""
    sent = (body.content or "")[:MAX_CONTENT_LENGTH]
    if body.guide_id:
        guide = _owned_row("study_guides", "id,title,folder_id,study_guide,notes,source_url", body.guide_id, user_id, "guide")
        text = guide.get("study_guide") or guide.get("notes") or sent
        source = {"type": "study_guide", "id": guide["id"], "title": guide.get("title") or "Study Guide"}
        return Material(text[:MAX_CONTENT_LENGTH], source, guide=guide)
    if body.note_id:
        note = _owned_row("smart_notes", "id,title,folder_id,content", body.note_id, user_id, "note")
        text = html_to_text(note.get("content") or sent)
        source = {"type": "smartnote", "id": note["id"], "title": note.get("title") or "SmartNote"}
        return Material(text[:MAX_CONTENT_LENGTH], source, note=note)
    if body.context_title and sent:
        source = {"type": "browser" if body.context_url else "file", "title": body.context_title.strip() or "Attached file"}
        if body.context_url:
            source["url"] = body.context_url
        return Material(sent, source)
    return Material(sent)


def _finish(user_id: str, turn: Optional[dict], response: ChatResponse) -> ChatResponse:
    """Save the reply to the Tutor session (when there is one) and return it with the updated session."""
    if not turn:
        return response
    row = complete_tutor_turn(user_id, turn, response.model_dump(exclude_none=True))
    return response.model_copy(update={"skill": turn["active_skill"], "session": public_tutor_session(row)})


def _run_browser_skill(user_id: str, turn: Optional[dict], skill: str, question: str) -> ChatResponse:
    if not turn or not public_tutor_session(turn)["browser_available"]:
        return _finish(user_id, turn, ChatResponse(
            answer="Open the CordiaClassroom browser side panel, then try the browser request again.",
            action="browser_unavailable",
        ))
    command, answer = BROWSER_SKILLS[skill]
    queue_browser_command(user_id, turn, command, question)
    row = wait_for_browser_result(user_id, turn, answer)
    return ChatResponse(answer=answer, action="browser_command_queued", skill=skill, session=public_tutor_session(row))


def _organize(material: Material, class_id: Optional[str], authorization: str) -> ChatResponse:
    if not material.owned:
        return ChatResponse(answer="Choose a study guide or SmartNote to organize.")
    if not class_id:
        return ChatResponse(answer="Choose the destination class before organizing this material.")
    if material.guide:
        guides.move_guide(material.guide["id"], guides.MoveGuideRequest(folder_id=class_id), authorization)
    else:
        smart_notes.update_note(material.note["id"], smart_notes.UpdateNoteRequest(folder_id=class_id), authorization)
    return ChatResponse(
        answer=f"Moved {(material.source or {}).get('title') or 'the material'} to the selected class.",
        action="organized_material",
        source=material.source,
    )


def _build_practice(user_id: str, material: Material) -> tuple:
    practice = generate_practice_guide(material.content, learning_guidance(user_id))
    if not practice:
        raise HTTPException(status_code=502, detail="Cordia could not create practice problems from this material")
    cards = study_guide_to_flashcards(practice)
    if not cards or not study_guide_is_complete(practice):
        raise HTTPException(status_code=502, detail="Cordia received incomplete practice problems. Please try again.")
    return practice, cards


def _build_guide(user_id: str, material: Material) -> tuple:
    guide = generate_study_guide(chunk_text(clean_text(material.content)), learning_guidance=learning_guidance(user_id))
    cards = study_guide_to_flashcards(guide or "")
    if not guide or not cards or not study_guide_is_complete(guide):
        raise HTTPException(status_code=502, detail="Cordia could not build a complete guide from this material")
    return guide, cards


# feature -> (title suffix, name used when saving fails, builder)
GUIDE_KINDS = {
    "practice": ("Practice Problems", "Practice guide", _build_practice),
    "guide": ("Study Guide", "Study guide", _build_guide),
}


def _check_picked_class(user_id: str, body: ChatRequest) -> None:
    """A class the student picked must be theirs (one inherited from the material already is)."""
    if body.class_id:
        guides.require_own_folder(get_supabase(), user_id, body.class_id)


def _create_guide(user_id: str, material: Material, class_id: Optional[str], feature: str) -> ChatResponse:
    """Build a guide or practice set from the selected material and save it beside its source."""
    require(user_id, feature)
    suffix, saved_name, build = GUIDE_KINDS[feature]
    study_guide, flashcards = build(user_id, material)
    source = material.source or {}
    payload = {
        "user_id": user_id,
        "folder_id": class_id,
        "title": f"{material.title} — {suffix}",
        "study_guide": study_guide,
        "flashcards": flashcards,
        "source_type": source.get("type"),
        "source_title": material.title,
        "source_id": source.get("id"),
        "source_url": source.get("url") or (material.guide or {}).get("source_url"),
    }
    if material.guide:
        payload["source_guide_id"] = material.guide["id"]
    created = get_supabase().table("study_guides").insert(payload).execute()
    if not created.data:
        raise HTTPException(status_code=500, detail=f"{saved_name} could not be saved")
    record(user_id, feature)
    saved = created.data[0]
    location = " in the same class" if saved.get("folder_id") else " in Study Guides"
    return ChatResponse(
        answer=f"Created {saved['title']}{location}.",
        action="created_guide",
        guide={"id": saved["id"], "title": saved["title"], "folder_id": saved.get("folder_id")},
        source=material.source,
    )


def _verified_retain_context(body: ChatRequest, content: str):
    """A missed practice question the Tutor explains must still match the guide it came from."""
    retain = body.retain_context
    if not retain:
        return None
    if not body.guide_id:
        raise HTTPException(status_code=400, detail="A Retain explanation requires its study guide")
    if retain.options and (retain.selected_answer not in retain.options or retain.correct_answer not in retain.options):
        raise HTTPException(status_code=400, detail="Retain answers do not match the question choices")
    if retain.selected_answer == retain.correct_answer:
        raise HTTPException(status_code=400, detail="This Retain answer is already correct")

    def normalized(text: str) -> str:
        return re.sub(r"\s+", " ", text).casefold()

    source = normalized(content)
    if normalized(retain.question) not in source or normalized(retain.correct_answer) not in source:
        raise HTTPException(status_code=409, detail="This Retain question no longer matches the selected guide")
    return retain


def _estimated_tokens(*texts: str) -> int:
    return int(sum(len(text or "") for text in texts) / 3.5) + 1


def _tutor_reply(body: ChatRequest, user_id: str, question: str, material: Material,
                 skill: Optional[str], turn: Optional[dict]) -> ChatResponse:
    require(user_id, "tutor")
    guidance = "\n".join(filter(None, [
        learning_guidance(user_id),
        style_instruction(user_id),
        tutor_skill_instruction(skill),
        TUTOR_SAFETY_POLICY,
    ]))
    # The session's last message is the question being answered now.
    earlier = ((turn or {}).get("messages") or [])[:-1]
    retain = _verified_retain_context(body, material.content)
    if retain:
        answer = explain_retain_answer(
            question=retain.question,
            options=retain.options,
            selected_answer=retain.selected_answer,
            correct_answer=retain.correct_answer,
            context=material.content,
            conversation=earlier,
            learning_guidance=guidance,
        )
    else:
        # Clients without a server session (the extension) send their own history.
        history = [message.model_dump() for message in body.history] if not turn else []
        if history:
            used = _estimated_tokens(material.content[:25000], guidance, question, *(message["text"] for message in history))
            if used > TUTOR_CONTEXT_TOKENS - TUTOR_RESERVED_TOKENS:
                raise HTTPException(status_code=413, detail=CONTEXT_FULL)
        answer = answer_question(
            question=question,
            context=material.content,
            mode=body.mode,
            learning_guidance=guidance,
            conversation=history or earlier,
            allow_clarification=skill in {"explain", "retain", None},
            rich_text=body.rich_text,
            full_history=bool(history),
        )
    record(user_id, "tutor")
    return ChatResponse(answer=answer, source=material.source)


def _reply(body: ChatRequest, user_id: str, question: str, material: Material, class_id: Optional[str],
           skill: Optional[str], turn: Optional[dict], authorization: str) -> ChatResponse:
    if skill == "plan" and not material.content.strip():
        return ChatResponse(
            answer="Open Canvas calendar reminders on the Dashboard to review what is due today and what is coming next.",
            action="opened_plan_help",
        )
    if skill == "organize":
        return _organize(material, body.class_id, authorization)
    if not material.content.strip():
        if material.source:
            return ChatResponse(answer=(
                f"{material.source.get('title') or 'The selected material'} is selected, but it does not contain "
                "readable study material yet. Add content or choose another source."
            ))
        return ChatResponse(answer="Choose a study guide, SmartNote, or uploaded file before asking Cordia.")
    if skill == "practice" or PRACTICE_REQUEST.search(question):
        _check_picked_class(user_id, body)
        return _create_guide(user_id, material, class_id, "practice")
    if skill == "build_guide":
        _check_picked_class(user_id, body)
        return _create_guide(user_id, material, class_id, "guide")
    return _tutor_reply(body, user_id, question, material, skill, turn)


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
def chat(body: ChatRequest, request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if body.guide_id and body.note_id:
        raise HTTPException(status_code=400, detail="Choose one study source")
    question = body.question
    material = _load_material(body, user_id)
    class_id = body.class_id or material.owned.get("folder_id")

    turn = None
    if body.session_id:
        turn = claim_tutor_turn(
            user_id=user_id,
            session_id=body.session_id,
            expected_version=body.conversation_version,
            message=question,
            requested_skill=body.skill,
            guide_id=body.guide_id,
            class_id=class_id,
        )
    skill = turn["active_skill"] if turn else body.skill
    try:
        if skill in BROWSER_SKILLS:
            return _run_browser_skill(user_id, turn, skill, question)
        return _finish(user_id, turn, _reply(body, user_id, question, material, class_id, skill, turn, authorization))
    except HTTPException as error:
        if turn:
            fail_tutor_turn(user_id, turn, str(error.detail))
        raise
    except Exception:
        # The request-id middleware logs the traceback and returns a 500 the client can quote.
        if turn:
            fail_tutor_turn(user_id, turn, "Unexpected Tutor error")
        raise
