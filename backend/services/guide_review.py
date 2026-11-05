"""The leak check and course lookup for shared guides, kept apart from guide_access so the guide
save path (which the MCP worker also uses) never imports class membership code."""

from __future__ import annotations

from typing import Optional

from services.class_catalog import screen_share

# Holds the leak check sets itself; it may lift them again. Report and takedown holds wait for an admin.
SCREEN_REASONS = ("Looks like an exam or answer key", "Numbered test questions copied verbatim")


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def honor_code_accepted(db, user_id: str) -> bool:
    row = _one(db.table("user_profiles").select("honor_code_accepted_at").eq("id", user_id).limit(1).execute())
    return bool(row and row.get("honor_code_accepted_at"))


def course(db, guide: dict) -> Optional[dict]:
    """The course the guide is filed under (its folder's class), if any."""
    if not guide.get("folder_id"):
        return None
    folder = _one(db.table("folders").select("class_id").eq("id", guide["folder_id"]).limit(1).execute())
    if not folder or not folder.get("class_id"):
        return None
    return _one(db.table("classes").select("id,course_code_normalized,display_name,sharing_blocked").eq("id", folder["class_id"]).limit(1).execute())


def screen(guide: dict) -> Optional[str]:
    return screen_share(guide.get("title") or "", guide.get("study_guide") or "", guide.get("flashcards") or [])


def rescreen(db, guide: dict) -> dict:
    """Run the leak check on a shared guide: hold it when it trips, lift the check's own hold when
    it no longer does. Holds from reports and takedowns stay for an admin."""
    if (guide.get("visibility") or "private") == "private":
        return guide
    reason = screen(guide)
    status, current = guide.get("review_status") or "ok", guide.get("hold_reason")
    if reason and status == "ok":
        update = {"review_status": "held", "hold_reason": reason}
    elif not reason and status == "held" and current in SCREEN_REASONS:
        update = {"review_status": "ok", "hold_reason": None}
    else:
        return guide
    db.table("study_guides").update(update).eq("id", guide["id"]).execute()
    return {**guide, **update}
