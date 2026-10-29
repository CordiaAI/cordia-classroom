"""Shared Tutor session endpoints used by Classroom and the Chrome side panel."""

import re
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from ids import require_uuid
from services.tutor_sessions import (
    get_or_create_tutor_session,
    list_tutor_chats,
    public_tutor_session,
    start_tutor_chat,
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


@router.post("/session/new")
def new_tutor_chat(body: NewTutorChat, authorization: str = Header(default="")):
    """Start a new chat (about a guide, or general) or resume a saved one; the current chat is saved."""
    user_id = get_user_id(authorization)
    for value, name in ((body.session_id, "session ID"), (body.guide_id, "guide ID"), (body.resume_id, "chat ID")):
        if value:
            require_uuid(value, name)
    return public_tutor_session(start_tutor_chat(user_id, body.session_id, body.guide_id, body.resume_id))
