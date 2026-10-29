"""Student-chosen study style and the per-question study aids it defaults to."""

import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Depends, Request
from rate_limit import ai_rate_limit, limiter
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from ids import require_uuid
from database import get_supabase
from services.entitlements import record, require
from services.learning_events import valid_fingerprint, write_batch
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

StyleName = Literal["visual", "aural", "read_write", "kinesthetic", "multimodal"]
AidMode = Literal["visual", "aural", "read_write", "kinesthetic"]


class StyleUpdate(BaseModel):
    style: Optional[StyleName] = None


class ExplanationPreference(BaseModel):
    text: str = Field(default="", max_length=500)


OnboardingStep = Literal["style", "first_guide", "unlocked", "extension", "extension_use", "create", "smartnotes", "practice", "done"]


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


LearnFormat = Literal["choice", "typed", "written", "flashcard", "fill_bank", "fill_free", "pairs", "practice"]
UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
MAX_MS = 24 * 3600 * 1000


class _Item(BaseModel):
    guide_id: str = Field(..., pattern=UUID_PATTERN)
    fingerprint: str = Field(..., min_length=1, max_length=48)

    @field_validator("fingerprint")
    @classmethod
    def check_fingerprint(cls, value):
        if not valid_fingerprint(value):
            raise ValueError("fingerprint must be learnEngine.fingerprint of the question")
        return value


class FormatDecision(_Item):
    """Learn's choice of question format, logged before the question shows. Phase 1 has no
    exploration: one eligible choice by rule, or the only one the student's settings allow."""
    id: str = Field(..., pattern=UUID_PATTERN)
    session_id: Optional[str] = Field(default=None, pattern=UUID_PATTERN)
    decision_type: Literal["format"] = "format"
    policy_version_id: Literal["format-rules-v0"] = "format-rules-v0"
    source: Literal["rule", "student"]
    candidates: list[LearnFormat] = Field(..., min_length=1, max_length=8)
    mask_reasons: dict[LearnFormat, Literal["turned_off", "needs_recall", "recall_not_needed", "long_answer", "short_answer"]] = Field(default_factory=dict)
    eligible: list[LearnFormat] = Field(..., min_length=1, max_length=8)
    probs: dict[LearnFormat, float]
    chosen: LearnFormat
    propensity: float = Field(..., gt=0, le=1)
    seed: int = Field(default=0, ge=0, le=2**62)
    context: dict = Field(default_factory=dict, max_length=12)


class LearningEvent(_Item):
    """One answer. Raw values only; ratings and flags are derived later."""
    decision_id: Optional[str] = Field(default=None, pattern=UUID_PATTERN)
    mode: Literal["learn", "quiz", "check", "match", "timed_test", "flashcards", "study_now", "practice", "nclex"]
    format: LearnFormat
    outcome: Literal["right", "partly", "wrong", "got_it", "again"]
    confidence: Optional[Literal["sure", "think_so", "guess"]] = None
    first_key_ms: Optional[int] = Field(default=None, ge=0, le=MAX_MS)
    submit_ms: Optional[int] = Field(default=None, ge=0, le=MAX_MS)
    hidden_ms: int = Field(default=0, ge=0, le=MAX_MS)
    answer_chars: Optional[int] = Field(default=None, ge=0, le=100000)
    view_shown: Optional[str] = Field(default=None, max_length=40)
    occurred_at: Optional[datetime] = None


class LearningEventBatch(BaseModel):
    tz_offset: int = Field(default=0, ge=-14 * 60, le=14 * 60)  # minutes east of UTC
    decisions: list[FormatDecision] = Field(default_factory=list, max_length=50)
    events: list[LearningEvent] = Field(default_factory=list, max_length=50)


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
    get_supabase().table("learning_preferences").upsert({
        "user_id": user_id,
        "style": body.style,
        "prompted_at": now,
        "updated_at": now,
    }).execute()
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
    get_supabase().table("learning_preferences").upsert({
        "user_id": user_id,
        "explain_preference": text or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
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
    except Exception:
        # Never block the app on the wizard: report it finished when progress is unreadable.
        logger.warning("Onboarding progress unavailable", exc_info=True)
        return {"step": "done", "completed": True}
    row = rows[0] if rows else {}
    return {"step": row.get("step") or "style", "completed": bool(row.get("completed_at"))}


@router.get("/onboarding/checklist")
def get_onboarding_checklist(authorization: str = Header(default="")):
    """Which high-value features the student has actually used, for the dashboard checklist."""
    user_id = get_user_id(authorization)
    sb = get_supabase()

    def used(query) -> bool:
        try:
            return bool(query.limit(1).execute().data)
        except Exception:
            logger.warning("Checklist lookup failed", exc_info=True)
            return False

    return {
        "extension_guide": used(sb.table("study_guides").select("id").eq("user_id", user_id).eq("source_type", "webpage")),
        "learn_your_way": used(sb.table("study_aids").select("id").eq("user_id", user_id)),
        "practice": used(sb.table("study_guides").select("id").eq("user_id", user_id).not_.is_("practice_state", "null")),
        "smartnote": used(sb.table("smart_notes").select("id").eq("user_id", user_id).neq("title", "My first notes")),
    }


@router.put("/onboarding")
def set_onboarding(body: OnboardingUpdate, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    now = datetime.now(timezone.utc).isoformat()
    record = {"user_id": user_id, "step": body.step, "updated_at": now}
    if body.step == "done":
        record["completed_at"] = now
    get_supabase().table("onboarding_progress").upsert(record).execute()
    return {"step": body.step, "completed": body.step == "done"}


def _owned_item(user_id: str, guide_id: str, number: int):
    require_uuid(guide_id, "guide ID")
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


@router.post("/study-aids", dependencies=[Depends(ai_rate_limit(max_calls=20))])
def create_study_aid(body: StudyAidRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _require_enabled()
    item, related = _owned_item(user_id, body.guide_id, body.number)
    key = item_key(item)
    cached = _cached_aid(user_id, body.guide_id, key, body.mode)
    if cached:
        return public_aid(body.mode, cached)

    require(user_id, "learn_my_way")
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
    except Exception:
        logger.warning("Study aid cache write failed", exc_info=True)
    record(user_id, "learn_my_way")
    return public_aid(body.mode, content)


@router.post("/study-aids/check", dependencies=[Depends(ai_rate_limit(max_calls=20))])
def check_study_aid(body: StudyAidCheck, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _require_enabled()
    item, _ = _owned_item(user_id, body.guide_id, body.number)
    cached = _cached_aid(user_id, body.guide_id, item_key(item), body.mode) or {}
    task = cached.get("task") or "Explain this idea in your own words."
    require(user_id, "light")
    result = check_attempt(item, task, cached.get("task_answer") or "", body.attempt.strip())
    if not result:
        raise HTTPException(status_code=502, detail="Cordia could not check this right now. Please try again.")
    record(user_id, "light")
    return result


@router.post("/learning-events")
@limiter.limit("120/minute")
def log_learning_events(batch: LearningEventBatch, request: Request, authorization: str = Header(default="")):
    """Answers and format decisions from the study screens, sent in batches. Always answers 200 for
    a valid batch: {"logged": false} when logging is off or not set up, so studying never waits on it."""
    user_id = get_user_id(authorization)
    return write_batch(
        get_supabase(), user_id,
        [decision.model_dump() for decision in batch.decisions],
        [event.model_dump() for event in batch.events],
        batch.tz_offset,
    )
