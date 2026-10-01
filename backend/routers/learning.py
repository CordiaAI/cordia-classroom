"""Student-chosen study style and the per-question study aids it defaults to."""

import logging
import re
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from routers.billing import check_usage, record_usage
from services.learning_styles import (
    STYLES,
    check_attempt,
    find_item,
    generate_study_aid,
    item_key,
    learning_styles_enabled,
    load_preference,
    public_aid,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["learning"])

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)
StyleName = Literal["visual", "aural", "read_write", "kinesthetic", "multimodal"]
AidMode = Literal["visual", "aural", "read_write", "kinesthetic"]


class StyleUpdate(BaseModel):
    style: Optional[StyleName] = None


class ExplanationPreference(BaseModel):
    text: str = Field(default="", max_length=500)


OnboardingStep = Literal["style", "extension", "extension_use", "create", "smartnotes", "practice", "done"]


class OnboardingUpdate(BaseModel):
    step: OnboardingStep


class StudyAidRequest(BaseModel):
    guide_id: str = Field(..., max_length=36)
    number: int = Field(..., ge=1, le=10000)
    mode: AidMode


class StudyAidCheck(BaseModel):
    guide_id: str = Field(..., max_length=36)
    number: int = Field(..., ge=1, le=10000)
    mode: Literal["aural", "kinesthetic"]
    attempt: str = Field(..., min_length=1, max_length=2000)


def _require_enabled():
    if not learning_styles_enabled():
        raise HTTPException(status_code=404, detail="Study styles are turned off")


@router.get("/learning-style")
def get_learning_style(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if not learning_styles_enabled():
        return {"enabled": False, "style": None, "prompted": True, "styles": list(STYLES)}
    preference = load_preference(get_supabase(), user_id)
    return {
        "enabled": True,
        "style": preference.get("style"),
        "prompted": bool(preference.get("prompted_at")),
        "styles": list(STYLES),
    }


@router.put("/learning-style")
def set_learning_style(body: StyleUpdate, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _require_enabled()
    now = datetime.now(timezone.utc).isoformat()
    try:
        get_supabase().table("learning_preferences").upsert({
            "user_id": user_id,
            "style": body.style,
            "prompted_at": now,
            "updated_at": now,
        }).execute()
    except Exception as e:
        logger.error(f"Could not save learning style: {e}")
        raise HTTPException(status_code=500, detail="Could not save your study style")
    return {"enabled": True, "style": body.style, "prompted": True, "styles": list(STYLES)}


@router.get("/explanation-preference")
def get_explanation_preference(authorization: str = Header(default="")):
    """How the student asked the Tutor to explain things (empty when never set)."""
    user_id = get_user_id(authorization)
    return {"text": load_preference(get_supabase(), user_id).get("explain_preference") or ""}


@router.put("/explanation-preference")
def set_explanation_preference(body: ExplanationPreference, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    text = " ".join(body.text.split())
    try:
        get_supabase().table("learning_preferences").upsert({
            "user_id": user_id,
            "explain_preference": text or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"Could not save explanation preference: {e}")
        raise HTTPException(status_code=500, detail="Could not save how you like things explained")
    return {"text": text}


@router.get("/onboarding")
def get_onboarding(authorization: str = Header(default="")):
    """Where the student is in the setup wizard. A missing row means they have not seen it."""
    user_id = get_user_id(authorization)
    try:
        rows = (
            get_supabase().table("onboarding_progress")
            .select("step, completed_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        ).data
    except Exception as e:
        # Never block the app on the wizard: report it finished when progress is unreadable.
        logger.warning(f"Onboarding progress unavailable: {e}")
        return {"step": "done", "completed": True}
    row = rows[0] if rows else {}
    return {"step": row.get("step") or "style", "completed": bool(row.get("completed_at"))}


@router.put("/onboarding")
def set_onboarding(body: OnboardingUpdate, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    now = datetime.now(timezone.utc).isoformat()
    record = {"user_id": user_id, "step": body.step, "updated_at": now}
    if body.step == "done":
        record["completed_at"] = now
    try:
        get_supabase().table("onboarding_progress").upsert(record).execute()
    except Exception as e:
        logger.error(f"Could not save onboarding progress: {e}")
        raise HTTPException(status_code=500, detail="Could not save your setup progress")
    return {"step": body.step, "completed": body.step == "done"}


def _owned_item(user_id: str, guide_id: str, number: int):
    if not UUID_PATTERN.match(guide_id):
        raise HTTPException(status_code=400, detail="Invalid guide ID")
    result = get_supabase().table("study_guides") \
        .select("id,study_guide") \
        .eq("id", guide_id) \
        .eq("user_id", user_id) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Guide not found")
    item, related = find_item(result.data[0].get("study_guide") or "", number)
    if not item:
        raise HTTPException(status_code=404, detail="Question not found in this guide")
    return item, related


def _cached_aid(user_id: str, guide_id: str, key: str, mode: str) -> Optional[dict]:
    result = get_supabase().table("study_aids") \
        .select("content") \
        .eq("user_id", user_id) \
        .eq("guide_id", guide_id) \
        .eq("item_key", key) \
        .eq("mode", mode) \
        .limit(1) \
        .execute()
    return (result.data or [{}])[0].get("content")


@router.post("/study-aids")
def create_study_aid(body: StudyAidRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _require_enabled()
    item, related = _owned_item(user_id, body.guide_id, body.number)
    key = item_key(item)
    cached = _cached_aid(user_id, body.guide_id, key, body.mode)
    if cached:
        return public_aid(body.mode, cached)

    usage = check_usage(user_id, "lightweight")
    content = generate_study_aid(body.mode, item, related)
    if not content:
        raise HTTPException(status_code=502, detail="Cordia could not build this view right now. Please try again.")
    try:
        get_supabase().table("study_aids").upsert({
            "user_id": user_id,
            "guide_id": body.guide_id,
            "item_key": key,
            "mode": body.mode,
            "content": content,
        }, on_conflict="user_id,guide_id,item_key,mode").execute()
    except Exception as e:
        logger.warning(f"Study aid cache write failed: {e}")
    record_usage(user_id, "lightweight", usage)
    return public_aid(body.mode, content)


@router.post("/study-aids/check")
def check_study_aid(body: StudyAidCheck, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _require_enabled()
    item, _ = _owned_item(user_id, body.guide_id, body.number)
    cached = _cached_aid(user_id, body.guide_id, item_key(item), body.mode) or {}
    task = cached.get("task") or "Explain this idea in your own words."
    usage = check_usage(user_id, "lightweight")
    result = check_attempt(item, task, cached.get("task_answer") or "", body.attempt.strip())
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not check this right now. Please try again.")
    record_usage(user_id, "lightweight", usage)
    return result
