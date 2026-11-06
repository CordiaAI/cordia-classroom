"""Studying someone else's guide with your own progress (social plan, Stage 4).

A student studies the original guide (Flashcards, Learn, Quiz), never a copy. Their progress is
theirs alone (guide_progress, keyed by idea id); the author's guide row is never written. They
study the version they started on until they accept an update, and every visibility rule
(services/guide_access.can_view: private, held, removed, instructor opt-out, blocks) applies to
every version: an old version is never served once the guide is hidden.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException

from services import guide_access as access
from services import guide_versions as versions

logger = logging.getLogger(__name__)

STUDY_COLUMNS = access.GUIDE_COLUMNS + ",quiz_questions"


class Unavailable(Exception):
    """The student has progress on a guide they can no longer see."""

    def __init__(self, reason: str, title: Optional[str] = None):
        super().__init__(reason)
        self.reason = reason
        self.title = title


def row(db, viewer: str, guide_id: str) -> Optional[dict]:
    try:
        rows = (db.table("guide_progress").select("version_seen,dismissed_version,progress,test_date,test_format,updated_at")
                .eq("user_id", viewer).eq("guide_id", guide_id).limit(1).execute().data or [])
    except Exception:
        return None
    return rows[0] if rows else None


def state(db, viewer: str, guide_id: str, version: Optional[int] = None) -> dict:
    """{guide, row, content, questions, current} for a student on someone else's guide.
    Raises 404 when they can't see it and never studied it, Unavailable when they did, and 400 when
    it's their own guide (owners use the usual routes)."""
    if not versions.enabled():
        raise HTTPException(status_code=404, detail="Guide not found")
    guide = access.load(db, guide_id, STUDY_COLUMNS)
    if guide and guide.get("user_id") == viewer:
        raise HTTPException(status_code=400, detail="This is your own guide")
    saved = row(db, viewer, guide_id)
    if not access.can_view(db, viewer, guide):
        if saved is not None:
            raise Unavailable(access.unavailable_reason(db, viewer, guide) or "This guide isn't available.", (guide or {}).get("title"))
        raise HTTPException(status_code=404, detail="Guide not found")
    current = int(guide.get("version") or 1)
    on = version or int((saved or {}).get("version_seen") or current)
    content = versions.content_at(db, guide, min(on, current))
    return {"guide": guide, "row": saved, "content": content, "questions": versions.questions_for(content, guide_id), "current": current}


def pin(db, viewer: str, guide_id: str, version: int) -> None:
    """Start following a guide at this version (first study visit); a no-op once a row exists."""
    try:
        db.rpc("merge_guide_progress", {"viewer": viewer, "guide": guide_id, "patch": {}, "version": version,
                                        "test_date": None, "test_format": None}).execute()
    except Exception as exc:
        logger.warning(f"Pinning a studied guide failed: {type(exc).__name__}")


def plain_ideas(items: list) -> list:
    """Ideas for the update dialog: just the text."""
    out = []
    for idea in items:
        entry = {"question": idea.get("question") or "", "answer": idea.get("answer") or ""}
        if idea.get("before"):
            entry["before"] = {"question": idea["before"].get("question") or "", "answer": idea["before"].get("answer") or ""}
        out.append(entry)
    return out


def update_status(db, viewer: str, ctx: dict) -> dict:
    """Whether a newer version changed anything this student studies. A newer version that only
    renamed or re-outlined the guide moves them along silently."""
    saved, guide = ctx["row"], ctx["guide"]
    on = ctx["content"]["version"]
    if not saved or on >= ctx["current"]:
        return {"update_available": False, "changes": None}
    delta = versions.changes(ctx["content"], versions.live_content(guide))
    if not any(delta.values()):
        advance(db, viewer, guide["id"], ctx["current"], saved.get("progress") or {})
        ctx["content"] = versions.live_content(guide)
        ctx["questions"] = versions.questions_for(ctx["content"], guide["id"])
        return {"update_available": False, "changes": None}
    counts = {key: len(value) for key, value in delta.items()}
    return {"update_available": saved.get("dismissed_version") != ctx["current"], "stayed": saved.get("dismissed_version") == ctx["current"], "changes": counts}


def advance(db, viewer: str, guide_id: str, version: int, progress: dict) -> None:
    db.table("guide_progress").update({"version_seen": version, "dismissed_version": None, "progress": progress}) \
        .eq("user_id", viewer).eq("guide_id", guide_id).execute()
    try:
        db.table("guide_saves").update({"pinned_version": version}).eq("user_id", viewer).eq("guide_id", guide_id).execute()
    except Exception:
        pass
    versions.prune(db, guide_id, version)


def progress_view(ctx: dict, progress: Optional[dict] = None) -> dict:
    """The student's progress in the shape the study screens read (owners' flashcard_progress)."""
    saved = ctx["row"] or {}
    view = versions.legacy_view(progress if progress is not None else saved.get("progress") or {}, ctx["content"]["cards"], ctx["questions"])
    view["learn"]["test_date"] = saved.get("test_date")
    if saved.get("test_format"):
        view["learn"]["test_format"] = saved["test_format"]
    if saved.get("updated_at"):
        view["last_studied"] = saved["updated_at"]
    return view
