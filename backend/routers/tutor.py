"""Shared Tutor session endpoints used by Classroom and the Chrome side panel."""

import re
from datetime import date, datetime, timezone
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import access
from access import Ctx
from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import limiter
from services.saved_chats import start_chat
from schemas import TutorStatusRequest
from services import tutor_speech, tutor_status
from services.entitlements import record, require
from services.study_helper import checkin_reply, learn_href
from services.tutor_sessions import (
    append_tutor_message,
    delete_tutor_chat,
    get_or_create_tutor_session,
    list_tutor_chats,
    public_tutor_session,
    update_browser_context,
    tutor_browser_content,
)


router = APIRouter(prefix="/tutor", tags=["tutor"])


class BrowserObservation(BaseModel):
    url: str = Field(default="", max_length=2_048)
    title: str = Field(default="", max_length=500)
    source_type: str = Field(default="webpage", max_length=40)
    content_refs: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        if value and urlparse(value).scheme not in {"http", "https"}:
            raise ValueError("Browser URL must use http or https")
        return value


class BrowserActionResult(BaseModel):
    command_id: str = Field(..., max_length=36)
    status: str = Field(..., pattern=r"^(completed|failed)$")
    action: str = Field(..., max_length=40)
    error: str = Field(default="", max_length=500)
    section_count: Optional[int] = Field(default=None, ge=0, le=100)
    evidence: list[BrowserObservation] = Field(default_factory=list, max_length=20)


class BrowserContextUpdate(BaseModel):
    session_id: str = Field(..., max_length=36)
    browser_available: bool = True
    browser_observation: Optional[BrowserObservation] = None
    browser_content: Optional[str] = Field(default=None, max_length=100_000)
    permission_scope: list[str] = Field(default_factory=lambda: ["read_page"], max_length=10)
    last_action_result: Optional[BrowserActionResult] = None

    @field_validator("permission_scope")
    @classmethod
    def validate_permissions(cls, value):
        allowed = {"read_page", "navigate", "download", "calendar_write"}
        if any(item not in allowed for item in value):
            raise ValueError("Unsupported browser permission")
        return sorted(set(value))

    @field_validator("browser_content")
    @classmethod
    def redact_secrets(cls, value):
        if value is None:
            return value
        return re.sub(
            r"(?i)\b(password|access[ _-]?token|api[ _-]?key|client[ _-]?secret)\b\s*[:=]\s*\S+",
            r"\1: [redacted]",
            value,
        ).strip()


class NewTutorChat(BaseModel):
    session_id: str = Field(..., max_length=36)
    guide_id: Optional[str] = Field(default=None, max_length=36)
    resume_id: Optional[str] = Field(default=None, max_length=36)


@router.get("/session")
def current_tutor_session(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return public_tutor_session(get_or_create_tutor_session(user_id))


@router.get("/session/browser-content")
def current_browser_content(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return tutor_browser_content(user_id)


@router.patch("/session/browser")
def browser_context(body: BrowserContextUpdate, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    row = update_browser_context(user_id, body.session_id, body.model_dump())
    return public_tutor_session(row)


@router.get("/chats")
def saved_tutor_chats(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return {"chats": list_tutor_chats(user_id)}


@router.delete("/chats/{chat_id}")
def delete_saved_tutor_chat(chat_id: str, ctx: Ctx = Depends(access.own())):
    """Delete one saved chat, the student's own only: anyone else's reads as already gone."""
    require_uuid(chat_id, "chat ID")
    if not delete_tutor_chat(ctx.user_id, chat_id):
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    return {"chats": list_tutor_chats(ctx.user_id)}


@router.post("/session/new")
def new_tutor_chat(body: NewTutorChat, authorization: str = Header(default="")):
    """Start a new chat (about a guide, or general) or resume a saved one; the current chat is saved."""
    user_id = get_user_id(authorization)
    for value, name in ((body.session_id, "session ID"), (body.guide_id, "guide ID"), (body.resume_id, "chat ID")):
        if value:
            require_uuid(value, name)
    # services/saved_chats keeps the saved chat's id, title and class once its migration has run.
    return public_tutor_session(start_chat(user_id, body.session_id, body.guide_id, None, body.resume_id)[1])


DAY = r"^\d{4}-\d{2}-\d{2}$"


class CheckinResult(BaseModel):
    """A finished check-in round in Learn, sent back so the Tutor can say what to do next and when."""
    checkin_id: str = Field(..., pattern=r"^[\w:.-]{1,80}$")
    guide_id: str = Field(..., max_length=36)
    right: int = Field(..., ge=0, le=500)
    total: int = Field(..., ge=1, le=500)
    remaining: int = Field(default=0, ge=0, le=5000)  # ideas not yet mastered after the round
    test_date: Optional[str] = Field(default=None, pattern=DAY)
    local_date: Optional[str] = Field(default=None, pattern=DAY)

    @model_validator(mode="after")
    def right_within_total(self):
        if self.right > self.total:
            raise ValueError("right cannot be more than total")
        return self


def _day(value: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Use a real date (YYYY-MM-DD).")


@router.post("/session/checkin")
@limiter.limit("20/minute")
def tutor_checkin(body: CheckinResult, request: Request, authorization: str = Header(default="")):
    """Learn's check-in is done: the Tutor posts what to do next and when (from the score and the days
    left) in the student's own conversation, once per check-in, about the student's own guide only."""
    user_id = get_user_id(authorization)
    require_uuid(body.guide_id, "guide ID")
    rows = get_supabase().table("study_guides").select("id,title").eq("id", body.guide_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Guide not found")
    title = rows[0].get("title") or "your guide"
    today = _day(body.local_date) or datetime.now(timezone.utc).date()
    text = checkin_reply(title=title, right=body.right, total=body.total, remaining=body.remaining, when=_day(body.test_date), today=today)
    link = {"href": learn_href(body.guide_id, checkin=False), "label": f"Learn for {title}"}
    row = append_tutor_message(user_id, text, extra={"link": link}, once=f"checkin:{body.checkin_id}")
    if not row:
        raise HTTPException(status_code=409, detail="The Tutor was busy. Your check-in is saved in Learn; try again.")
    return public_tutor_session(row)


# ---- What the Tutor shows while it works (services/tutor_status.py) ----

@router.post("/status")
@limiter.limit("30/minute")
def tutor_status_lines(body: TutorStatusRequest, request: Request, authorization: str = Header(default="")):
    """Lines about the question for the web app to show while the Tutor works (one light-tier call, run beside
    /chat by the browser, so the answer never waits for it). Not counted toward any limit: no require() or
    record(). The call is logged to usage_events as `tutor_status` by services.llm_calls. [] when it fails or is slow."""
    get_user_id(authorization)
    return {"lines": tutor_status.status_lines(body.question, body.title or "", body.class_name or "")}


@router.get("/steps")
@limiter.limit("240/minute")
def tutor_steps(request: Request, session_id: str, authorization: str = Header(default="")):
    """What the student's running Tutor request is really doing, step by step, oldest first (read by the web
    app about once a second while /chat is open)."""
    user_id = get_user_id(authorization)
    require_uuid(session_id, "session ID")
    return {"steps": tutor_status.steps_for(user_id, session_id)}


# ---- Voice mode's cloud voice (services/tutor_speech.py) ----

VOICE_UNAVAILABLE = {"code": "voice_unavailable", "message": "The Tutor's voice isn't available right now."}


class SpeakRequest(BaseModel):
    """One sentence of the Tutor's latest reply to speak, or the fixed sample for Settings › Tutor."""
    session_id: Optional[str] = Field(default=None, max_length=36)
    text: str = Field(default="", max_length=tutor_speech.MAX_CHARS * 2)
    voice: Optional[str] = Field(default=None, max_length=40)
    sample: bool = False


@router.post("/speak")
@limiter.limit("120/minute")
def tutor_speak(body: SpeakRequest, request: Request, authorization: str = Header(default="")):
    """Speak one sentence in the student's chosen voice (ElevenLabs, streamed as mp3). Only words from the latest
    replies in the student's own Tutor session, or the fixed sample. Charged to the monthly `voice_characters`
    limit (Free 0: the web app uses the browser's voice) and logged to usage_events as `tutor_voice`.
    503 voice_unavailable when ElevenLabs isn't set up or can't speak; the web app then uses the browser's voice."""
    user_id = get_user_id(authorization)
    if not tutor_speech.api_key():
        raise HTTPException(status_code=503, detail=VOICE_UNAVAILABLE)
    text = tutor_speech.SAMPLE_TEXT if body.sample else tutor_speech.spoken_text(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say.")
    if not body.sample:
        require_uuid(body.session_id or "", "session ID")
        rows = get_supabase().table("tutor_sessions").select("messages").eq("id", body.session_id) \
            .eq("user_id", user_id).limit(1).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Tutor session not found")
        if not tutor_speech.spoken_from_replies(text, rows[0].get("messages") or []):
            raise HTTPException(status_code=403, detail="Only the Tutor's own replies can be spoken.")
    require(user_id, "voice_characters", amount=len(text))
    try:
        audio = tutor_speech.open_stream(text, body.voice)
    except tutor_speech.SpeechUnavailable:
        raise HTTPException(status_code=503, detail=VOICE_UNAVAILABLE) from None
    try:
        record(user_id, "voice_characters", amount=len(text), model=tutor_speech.MODEL)
    except Exception:
        audio.close()
        raise
    return StreamingResponse(iter(audio), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
