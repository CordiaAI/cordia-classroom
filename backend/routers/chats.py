"""Saved Tutor chats (redesign T5): list, open, rename, move, delete and undo. The logic and the
fallback for a database that has not had migration 20261130120000 yet are in services/saved_chats.py.

Every route is the signed-in student's own (access.own()) and every lookup also matches on user_id,
so another student's chat reads as "already gone" (404), like DELETE /tutor/chats/{id}.
Until the migration runs, the list and a single chat still answer; rename, move, delete and undo
answer 503 with {"detail", "code": "chats_not_available"}.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

import access
from access import Ctx
from ids import require_uuid
from services import saved_chats

router = APIRouter(prefix="/chats", tags=["chats"])


class NewChat(BaseModel):
    guide_id: Optional[str] = Field(default=None, max_length=36)
    class_id: Optional[str] = Field(default=None, max_length=36)
    session_id: Optional[str] = Field(default=None, max_length=36)


class ChatEdit(BaseModel):
    """title renames; class_id moves (null moves the chat out of its class). Send either or both."""
    title: Optional[str] = Field(default=None, max_length=120)
    class_id: Optional[str] = Field(default=None, max_length=36)

    @field_validator("title")
    @classmethod
    def title_has_text(cls, value):
        value = " ".join((value or "").split())
        if not value:
            raise ValueError("A chat needs a title")
        return value


def _answer(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except saved_chats.NotAvailable:
        return JSONResponse(status_code=503, content=saved_chats.NOT_AVAILABLE)


@router.get("")
def list_chats(
    limit: int = Query(default=saved_chats.DEFAULT_LIMIT, ge=1, le=saved_chats.MAX_LIMIT),
    class_id: Optional[str] = Query(default=None, max_length=36),
    ctx: Ctx = Depends(access.own()),
):
    """The student's chats, newest first (last activity), optionally only those in one class."""
    if class_id:
        require_uuid(class_id, "class ID")
    return saved_chats.list_chats(ctx.user_id, limit, class_id)


@router.post("")
def start_chat(body: NewChat, ctx: Ctx = Depends(access.own())):
    """Start a new chat (about a guide, in a class, or general). The conversation it replaces is saved."""
    for value, name in ((body.guide_id, "guide ID"), (body.class_id, "class ID"), (body.session_id, "session ID")):
        if value:
            require_uuid(value, name)
    chat, session = saved_chats.start_chat(ctx.user_id, body.session_id, body.guide_id, body.class_id)
    return {"chat": chat, "session": saved_chats.sessions.public_tutor_session(session)}


@router.get("/{chat_id}")
def get_chat(chat_id: str, ctx: Ctx = Depends(access.own())):
    require_uuid(chat_id, "chat ID")
    return saved_chats.get_chat(ctx.user_id, chat_id)


@router.patch("/{chat_id}")
def edit_chat(chat_id: str, body: ChatEdit, ctx: Ctx = Depends(access.own())):
    require_uuid(chat_id, "chat ID")
    changes = {key: getattr(body, key) for key in ("title", "class_id") if key in body.model_fields_set}
    if "class_id" in changes and changes["class_id"]:
        require_uuid(changes["class_id"], "class ID")
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change")
    return _answer(saved_chats.edit_chat, ctx.user_id, chat_id, changes)


@router.delete("/{chat_id}")
def delete_chat(chat_id: str, ctx: Ctx = Depends(access.own())):
    """Delete a chat; POST /chats/{id}/restore undoes it (for 30 days)."""
    require_uuid(chat_id, "chat ID")
    return _answer(saved_chats.delete_chat, ctx.user_id, chat_id)


@router.post("/{chat_id}/restore")
def restore_chat(chat_id: str, ctx: Ctx = Depends(access.own())):
    require_uuid(chat_id, "chat ID")
    return _answer(saved_chats.restore_chat, ctx.user_id, chat_id)


@router.post("/{chat_id}/open")
def open_chat(chat_id: str, ctx: Ctx = Depends(access.own())):
    """Make a saved chat the Tutor's current conversation, so the student can carry on in it."""
    require_uuid(chat_id, "chat ID")
    chat, session = saved_chats.start_chat(ctx.user_id, resume_id=chat_id)
    return {"chat": chat, "session": saved_chats.sessions.public_tutor_session(session)}
