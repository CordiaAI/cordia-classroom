"""Authenticated beta feedback submission and staff review routes."""

import os
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid

router = APIRouter(prefix="/feedback", tags=["feedback"])

FeedbackCategory = Literal[
    "bug",
    "suggestion",
    "incorrect_content",
    "account_payment",
    "other",
]
FeedbackStatus = Literal["new", "reviewing", "planned", "resolved"]


class FeedbackContext(BaseModel):
    guide_id: Optional[str] = Field(default=None, max_length=100)
    question_id: Optional[str] = Field(default=None, max_length=100)

    @field_validator("guide_id", "question_id")
    @classmethod
    def normalize_identifier(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class FeedbackRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    category: FeedbackCategory = "other"
    page_path: Optional[str] = Field(default=None, max_length=500)
    app_version: Optional[str] = Field(default=None, max_length=100)
    context: FeedbackContext = Field(default_factory=FeedbackContext)
    client_request_id: UUID

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value):
        normalized = value.strip()
        if not normalized:
            raise ValueError("message cannot be empty")
        return normalized

    @field_validator("page_path")
    @classmethod
    def sanitize_page_path(cls, value):
        if not value:
            return None
        # Context must never persist query parameters, fragments, or absolute URLs.
        path = value.split("?", 1)[0].split("#", 1)[0].strip()
        if not path.startswith("/") or path.startswith("//"):
            return None
        return "".join(character for character in path if character.isprintable())[:500] or None

    @field_validator("app_version")
    @classmethod
    def normalize_version(cls, value):
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class FeedbackStatusUpdate(BaseModel):
    status: FeedbackStatus


def _reviewer_user_ids() -> set[str]:
    """Return the explicit server-side reviewer assignment."""
    return {
        value.strip()
        for value in os.getenv("FEEDBACK_REVIEWER_USER_IDS", "").split(",")
        if value.strip()
    }


def _require_reviewer(authorization: str) -> str:
    user_id = get_user_id(authorization)
    if user_id not in _reviewer_user_ids():
        raise HTTPException(status_code=403, detail="Feedback reviewer access required")
    return user_id


@router.post("")
def submit_feedback(request: FeedbackRequest, authorization: str = Header(default="")):
    """Create one feedback item for the authenticated user."""
    user_id = get_user_id(authorization)
    payload = {
        "user_id": user_id,
        "message": request.message,
        "category": request.category,
        "status": "new",
        "page_path": request.page_path,
        "app_version": request.app_version,
        "guide_id": request.context.guide_id,
        "question_id": request.context.question_id,
        "client_request_id": str(request.client_request_id),
    }
    supabase = get_supabase()
    result = (
        supabase
        .table("feedback")
        .upsert(
            payload,
            on_conflict="user_id,client_request_id",
            ignore_duplicates=True,
        )
        .execute()
    )
    row = result.data[0] if result.data else None
    if not row:
        duplicate = (
            supabase
            .table("feedback")
            .select("id")
            .eq("user_id", user_id)
            .eq("client_request_id", str(request.client_request_id))
            .limit(1)
            .execute()
        )
        row = duplicate.data[0] if duplicate.data else None
    return {"submitted": True, "feedback_id": row.get("id") if row else None}


@router.get("/reviewer-status")
def reviewer_status(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return {"reviewer": user_id in _reviewer_user_ids()}


@router.get("/review")
def list_feedback(
    category: Optional[FeedbackCategory] = Query(default=None),
    status: Optional[FeedbackStatus] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str = Header(default=""),
):
    _require_reviewer(authorization)
    query = get_supabase().table("feedback").select(
        "id,user_id,message,category,status,page_path,app_version,guide_id,question_id,created_at"
    )
    if category:
        query = query.eq("category", category)
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return {"items": result.data or [], "limit": limit, "offset": offset}


@router.get("/review/{feedback_id}")
def get_feedback_item(feedback_id: str, authorization: str = Header(default="")):
    _require_reviewer(authorization)
    require_uuid(feedback_id, "feedback ID")
    result = (
        get_supabase()
        .table("feedback")
        .select("id,user_id,message,category,status,page_path,app_version,guide_id,question_id,created_at")
        .eq("id", feedback_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return {"item": result.data[0]}


@router.patch("/review/{feedback_id}")
def update_feedback_status(
    feedback_id: str,
    request: FeedbackStatusUpdate,
    authorization: str = Header(default=""),
):
    reviewer_id = _require_reviewer(authorization)
    require_uuid(feedback_id, "feedback ID")
    result = (
        get_supabase()
        .table("feedback")
        .update({"status": request.status, "reviewed_by": reviewer_id})
        .eq("id", feedback_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return {"item": result.data[0]}
