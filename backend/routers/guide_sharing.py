"""Guide visibility, the public guide page, saving and copying (social plan, Stage 3).

Registered before routers/guides.py so /guides/saved and /guides/visibility-review aren't read as
guide ids. Every read of someone else's guide goes through services/guide_access.can_view.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import guide_access as access
from services import guide_review as review
from services.guide_review import honor_code_accepted
from services.sharing import upsert_share

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/guides", tags=["guide sharing"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _viewer(authorization: str) -> Optional[str]:
    """The signed-in viewer, or None for a signed-out visitor (public and link guides)."""
    if not authorization:
        return None
    try:
        return get_user_id(authorization)
    except HTTPException:
        return None


def _own(db, user_id: str, guide_id: str) -> dict:
    guide = access.load(db, require_uuid(guide_id, "guide ID"), access.GUIDE_COLUMNS + ",linked_set_id")
    if not guide or guide.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Guide not found")
    return guide


def _is_others_copy(db, guide: dict) -> bool:
    """A copy of someone else's guide (or a saved class set) can't be shared on: it's their work."""
    if guide.get("linked_set_id"):
        return True
    source_id = guide.get("forked_from_guide_id")
    if not source_id:
        return False
    source = access.load(db, source_id, "id,user_id")
    return bool(source and source.get("user_id") != guide.get("user_id"))


# Visibility --------------------------------------------------------------------------------------
class VisibilityChange(BaseModel):
    visibility: Optional[Literal["private", "link", "classroom", "public"]] = None
    attribution: Optional[Literal["named", "anonymous"]] = None
    accept_honor_code: bool = False


@router.patch("/{guide_id}/visibility", dependencies=[Depends(ai_rate_limit(30, 60))])
def set_visibility(guide_id: str, body: VisibilityChange, authorization: str = Header(default="")):
    """Who can see your guide, and whether your name shows. Publishing (public or link) the first
    time needs the Honor Code: without accept_honor_code it answers 409 honor_code_required."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _own(db, user_id, guide_id)
    visibility = body.visibility or guide.get("visibility") or "private"
    attribution = body.attribution or guide.get("attribution") or "named"
    klass = review.course(db, guide)
    if visibility != "private":
        if _is_others_copy(db, guide):
            raise HTTPException(status_code=400, detail="A copy of someone else's guide stays private.")
        if klass and klass.get("sharing_blocked"):
            raise HTTPException(status_code=403, detail="Sharing is off for this class.")
        if visibility == "classroom" and not klass:
            raise HTTPException(status_code=400, detail="Add this guide to a class first.")
    if visibility in ("public", "link") and not honor_code_accepted(db, user_id):
        if not body.accept_honor_code:
            raise HTTPException(status_code=409, detail="honor_code_required")
        db.table("user_profiles").update({"honor_code_accepted_at": _now()}).eq("id", user_id).execute()
    db.table("study_guides").update({"visibility": visibility, "attribution": attribution}).eq("id", guide["id"]).eq("user_id", user_id).execute()
    guide = {**guide, "visibility": visibility, "attribution": attribution}
    # Classmates keep finding public and class-only guides in the course's Class sets.
    if klass:
        shared = (db.table("shared_sets").select("id").eq("guide_id", guide["id"]).limit(1).execute().data or [])
        if visibility in ("public", "classroom"):
            upsert_share(db, user_id, guide, klass["id"], "class")
        elif shared:
            upsert_share(db, user_id, guide, klass["id"], "private")
    guide = review.rescreen(db, guide)
    return {
        "visibility": guide["visibility"],
        "attribution": guide["attribution"],
        "review_status": guide.get("review_status") or "ok",
        "hold_reason": guide.get("hold_reason"),
        "class": {"id": klass["id"], "code": klass.get("course_code_normalized")} if klass else None,
    }


@router.get("/visibility-review")
def visibility_review(authorization: str = Header(default="")):
    """How many of your guides were shared with a class before guides could go public (for the
    one-time "You can now make these public" note)."""
    user_id = get_user_id(authorization)
    try:
        rows = (get_supabase().table("study_guides").select("id").eq("user_id", user_id).eq("visibility_migrated", True)
                .eq("visibility", "classroom").limit(200).execute().data or [])
    except Exception:  # before the Stage 3 migration
        rows = []
    return {"count": len(rows)}


# The public page ----------------------------------------------------------------------------------
@router.get("/{guide_id}/public", dependencies=[Depends(ai_rate_limit(120, 60))])
def public_guide(guide_id: str, authorization: str = Header(default="")):
    """A guide as someone else sees it (/sets/<id>). Signed-out visitors see public and link guides.
    Private, held, opted-out or blocked guides are all the same 404."""
    viewer = _viewer(authorization)
    db = get_supabase()
    guide = access.viewable(db, viewer, require_uuid(guide_id, "guide ID"))
    return {"guide": access.public_card(db, viewer, guide)}


# Saving -------------------------------------------------------------------------------------------
@router.post("/{guide_id}/save", dependencies=[Depends(ai_rate_limit(60, 60))])
def save_guide(guide_id: str, authorization: str = Header(default="")):
    """Keep someone else's guide in your Library (Saved), at the version you saw."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = access.viewable(db, user_id, require_uuid(guide_id, "guide ID"))
    if guide["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="It's already in your Library")
    db.table("guide_saves").upsert({"user_id": user_id, "guide_id": guide["id"], "pinned_version": guide.get("version") or 1,
                                    "created_at": _now()}, on_conflict="user_id,guide_id").execute()
    return {"saved": True}


@router.delete("/{guide_id}/save", dependencies=[Depends(ai_rate_limit(60, 60))])
def unsave_guide(guide_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    get_supabase().table("guide_saves").delete().eq("user_id", user_id).eq("guide_id", require_uuid(guide_id, "guide ID")).execute()
    return {"saved": False}


@router.get("/saved")
def saved_guides(authorization: str = Header(default="")):
    """Guides you saved, newest first. One you can no longer see (made private, held, blocked)
    shows as unavailable so you can remove it."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = db.table("guide_saves").select("guide_id,pinned_version,created_at").eq("user_id", user_id).order("created_at", desc=True).limit(200).execute().data or []
    out = []
    for row in rows:
        guide = access.load(db, row["guide_id"])
        if access.can_view(db, user_id, guide):
            out.append({"id": guide["id"], "title": guide.get("title") or "Untitled", "author": access.author(db, guide),
                        "question_count": access.question_count(guide), "version": guide.get("version") or 1,
                        "pinned_version": row.get("pinned_version"), "saved_at": row.get("created_at"), "available": True})
        else:
            out.append({"id": row["guide_id"], "title": None, "available": False, "saved_at": row.get("created_at")})
    return {"guides": out}


# Copies -------------------------------------------------------------------------------------------
class CopyRequest(BaseModel):
    carry_progress: bool = False


@router.post("/{guide_id}/copy", dependencies=[Depends(ai_rate_limit(20, 60))])
def copy_guide(guide_id: str, body: CopyRequest, authorization: str = Header(default="")):
    """Your own private copy to edit and study. carry_progress brings what you've learned on this
    guide (your earlier copy of the same version, or your own guide when it's yours)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = access.viewable(db, user_id, require_uuid(guide_id, "guide ID"))
    full = (db.table("study_guides").select("title,notes,study_guide,flashcards,quiz_questions,flashcard_progress")
            .eq("id", guide["id"]).limit(1).execute().data or [{}])[0]
    version = guide.get("version") or 1
    row = {
        "user_id": user_id, "title": full.get("title") or "Untitled", "notes": full.get("notes"), "study_guide": full.get("study_guide"),
        "flashcards": full.get("flashcards"), "quiz_questions": full.get("quiz_questions"),
        "forked_from_guide_id": guide["id"], "forked_from_version": version, "visibility": "private", "attribution": "named",
    }
    if body.carry_progress:
        if guide["user_id"] == user_id:
            progress = full.get("flashcard_progress")
        else:
            earlier = (db.table("study_guides").select("flashcard_progress,created_at").eq("user_id", user_id).eq("forked_from_guide_id", guide["id"])
                       .eq("forked_from_version", version).order("created_at", desc=True).limit(1).execute().data or [])
            progress = earlier[0].get("flashcard_progress") if earlier else None
        if progress:
            row["flashcard_progress"] = progress
    made = (db.table("study_guides").insert(row).execute().data or [None])[0]
    if not made:
        raise HTTPException(status_code=500, detail="Couldn't make a copy. Try again.")
    if not row.get("quiz_questions"):
        try:
            from routers.quiz import start_quiz_warmup
            start_quiz_warmup(made, user_id)
        except Exception:
            logger.warning("Quiz warmup for a copy failed", exc_info=True)
    return {"guide_id": made["id"]}
