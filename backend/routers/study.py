"""Studying someone else's guide (social plan, Stage 4): the guide as one student sees it, their
progress, and the "Update available" flow. Registered before routers/guides.py.

Every route re-checks visibility (services/viewer_study.state → guide_access.can_view) for every
version, and never writes the author's guide row. Behind PER_VIEWER_PROGRESS; off, these are 404s.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import guide_access as access
from services import guide_versions as versions
from services import viewer_study as study
from routers import quiz as quiz_router

router = APIRouter(prefix="/guides", tags=["study shared guides"])


def quiz_questions(db, guide_id: str, viewer: str) -> tuple:
    """(questions, content) of the version a student is on, for the quiz routes (registered below)."""
    try:
        ctx = study.state(db, viewer, guide_id)
    except study.Unavailable as gone:
        raise HTTPException(status_code=404, detail=gone.reason)
    except HTTPException as exc:
        if exc.status_code == 400:  # their own guide: the owner's routes already answered
            raise HTTPException(status_code=404, detail="Guide not found")
        raise
    return ctx["questions"], ctx["content"]


quiz_router.set_viewer_lookup(quiz_questions)


def _ctx(db, viewer: str, guide_id: str, version: Optional[int] = None):
    try:
        return study.state(db, viewer, require_uuid(guide_id, "guide ID"), version), None
    except study.Unavailable as gone:
        return None, {"unavailable": gone.reason, "title": gone.title}


@router.get("/{guide_id}/study", dependencies=[Depends(ai_rate_limit(120, 60))])
def study_guide(guide_id: str, authorization: str = Header(default="")):
    """Someone else's guide, ready to study: the cards and questions of the version you're on, your
    own progress in the usual shape, and whether the author has changed anything since."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    ctx, gone = _ctx(db, viewer, guide_id)
    if gone:
        return gone
    guide = ctx["guide"]
    if ctx["row"] is None:
        study.pin(db, viewer, guide["id"], ctx["current"])
    status = study.update_status(db, viewer, ctx)
    content = ctx["content"]
    return {"guide": {
        "id": guide["id"],
        "title": content.get("title") or guide.get("title") or "Untitled",
        "flashcards": content["cards"],
        "quiz_questions": ctx["questions"],
        "flashcard_progress": study.progress_view(ctx),
        "viewer": {
            "version": content["version"],
            "current_version": ctx["current"],
            "author": access.author(db, guide),
            **status,
        },
    }}


class LearnSave(BaseModel):
    levels: dict = Field(default_factory=dict)
    test_date: Optional[str] = Field(default=None, max_length=10)
    test_format: Optional[Literal["mc", "short", "essay", "mix", "unsure"]] = None


class ProgressSave(BaseModel):
    version: int = Field(ge=1)
    cards: Optional[dict] = None
    learn: Optional[LearnSave] = None


@router.post("/{guide_id}/progress", dependencies=[Depends(ai_rate_limit(240, 60))])
def save_progress(guide_id: str, body: ProgressSave, authorization: str = Header(default="")):
    """Save the cards and ideas just answered, by position in the version studied; they're stored
    by idea, so they survive the author's edits."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    if len(body.cards or {}) > 2000 or len((body.learn.levels if body.learn else {}) or {}) > 2000:
        raise HTTPException(status_code=400, detail="Too many answers in one save")
    ctx, gone = _ctx(db, viewer, guide_id, body.version)
    if gone:
        raise HTTPException(status_code=404, detail=gone["unavailable"])
    content = ctx["content"]
    patch = versions.patch_from(body.cards, body.learn.levels if body.learn else None, content["cards"], ctx["questions"])
    learn_fields = body.learn.model_fields_set if body.learn else set()
    params = {
        "viewer": viewer, "guide": ctx["guide"]["id"], "patch": patch, "version": content["version"],
        "test_date": {"value": body.learn.test_date} if "test_date" in learn_fields else None,
        "test_format": {"value": body.learn.test_format} if "test_format" in learn_fields and body.learn.test_format else None,
    }
    try:
        merged = db.rpc("merge_guide_progress", params).execute().data
    except Exception:
        raise HTTPException(status_code=503, detail="Your progress couldn't be saved right now. Try again.")
    ctx["row"] = study.row(db, viewer, ctx["guide"]["id"])
    return {"flashcard_progress": study.progress_view(ctx, merged if isinstance(merged, dict) else None)}


@router.get("/{guide_id}/changes", dependencies=[Depends(ai_rate_limit(60, 60))])
def guide_changes(guide_id: str, authorization: str = Header(default="")):
    """What changed between the version you're on and the newest: added, changed (old and new
    text) and removed ideas. Typo fixes and outline or title edits aren't listed."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    ctx, gone = _ctx(db, viewer, guide_id)
    if gone:
        raise HTTPException(status_code=404, detail=gone["unavailable"])
    newest = versions.live_content(ctx["guide"])
    delta = versions.changes(ctx["content"], newest)
    return {"from": ctx["content"]["version"], "to": ctx["current"], **{key: study.plain_ideas(value) for key, value in delta.items()}}


@router.post("/{guide_id}/accept-update", dependencies=[Depends(ai_rate_limit(30, 60))])
def accept_update(guide_id: str, authorization: str = Header(default="")):
    """Move to the newest version: unchanged ideas keep their progress, changed ones step back one
    level, removed ones are archived (they come back if the author restores them)."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    ctx, gone = _ctx(db, viewer, guide_id)
    if gone:
        raise HTTPException(status_code=404, detail=gone["unavailable"])
    if ctx["row"] is None or ctx["content"]["version"] >= ctx["current"]:
        return {"version": ctx["current"]}
    newest = versions.live_content(ctx["guide"])
    moved = versions.merge_for_update(ctx["row"].get("progress") or {}, ctx["content"], newest)
    study.advance(db, viewer, ctx["guide"]["id"], ctx["current"], moved)
    return {"version": ctx["current"]}


@router.post("/{guide_id}/stay", dependencies=[Depends(ai_rate_limit(30, 60))])
def stay_on_version(guide_id: str, authorization: str = Header(default="")):
    """Keep studying the version you're on; the notice stays quiet until the author's next change."""
    viewer = get_user_id(authorization)
    db = get_supabase()
    ctx, gone = _ctx(db, viewer, guide_id)
    if gone:
        raise HTTPException(status_code=404, detail=gone["unavailable"])
    if ctx["row"] is not None:
        db.table("guide_progress").update({"dismissed_version": ctx["current"]}).eq("user_id", viewer).eq("guide_id", ctx["guide"]["id"]).execute()
    return {"version": ctx["content"]["version"]}
