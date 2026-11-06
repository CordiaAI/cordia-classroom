"""Who may see a guide that isn't theirs (social plan, Stage 3).

The backend reads guides with the service role, which bypasses RLS, so every route that shows a
guide to someone other than its owner goes through can_view(). The rules, in order:
  - the owner always sees their own guide;
  - an instructor's opt-out (classes.sharing_blocked) hides the guide from everyone else;
  - a guide held for review or hidden by an admin is shown to no one else;
  - a block between owner and viewer hides it;
  - public and link guides are open to anyone, signed in or not (link guides are simply not
    listed anywhere);
  - classroom guides are open to signed-in members of the guide's course;
  - members of a classroom the guide is shared with see it too (Stage 5): a guide added directly
    (unless since made private), or any guide in a folder added to the classroom;
  - private guides are open to no one else.
Anonymous guides never reveal the author: public_card() leaves out their id, username and name.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from services import classrooms
from services.blocks import is_blocked
from services.class_db import is_member
from services.guide_review import course
from services.social_graph import cards

VISIBILITIES = ("private", "link", "classroom", "public")
GUIDE_COLUMNS = ("id,user_id,title,notes,study_guide,flashcards,folder_id,visibility,attribution,version,"
                 "review_status,hold_reason,forked_from_guide_id,created_at")


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def load(db, guide_id: str, columns: str = GUIDE_COLUMNS) -> Optional[dict]:
    return _one(db.table("study_guides").select(columns).eq("id", guide_id).limit(1).execute())


def can_view(db, viewer: Optional[str], guide: Optional[dict]) -> bool:
    if not guide:
        return False
    if viewer and viewer == guide.get("user_id"):
        return True
    visibility = guide.get("visibility") or "private"
    if (guide.get("review_status") or "ok") != "ok":
        return False
    # A private guide can still reach a classroom through its folder (Stage 5); without classrooms
    # on, it's closed here, before any lookups.
    if visibility == "private" and not (viewer and classrooms.enabled() and guide.get("folder_id")):
        return False
    klass = course(db, guide)
    if klass and klass.get("sharing_blocked"):
        return False
    if viewer and is_blocked(db, viewer, guide["user_id"]):
        return False
    if visibility in ("public", "link"):
        return True
    if visibility == "classroom" and viewer and klass and is_member(db, viewer, klass["id"]):
        return True
    # Members of a classroom it's shared with (directly, or through a shared folder).
    return classrooms.grants(db, viewer, guide)


def unavailable_reason(db, viewer: Optional[str], guide: Optional[dict]) -> Optional[str]:
    """Why a student can't see a guide they've been studying, in plain words (None when they can).
    Shown only to someone with progress on it; everyone else gets the usual 404."""
    if not guide:
        return "The author deleted this guide."
    if can_view(db, viewer, guide):
        return None
    if viewer and is_blocked(db, viewer, guide["user_id"]):
        return "This guide isn't available to you."
    status = guide.get("review_status") or "ok"
    if status == "held":
        return "This guide is being reviewed. If it's cleared, you can study it again."
    if status == "hidden":
        return "This guide was removed."
    klass = course(db, guide)
    if klass and klass.get("sharing_blocked"):
        return "Sharing is turned off for this guide's class."
    if (guide.get("visibility") or "private") == "private":
        return "The author made this guide private."
    return "This guide is only open to members of its class."


def viewable(db, viewer: Optional[str], guide_id: str) -> dict:
    """The guide, or the same 404 whether it's missing, private, held or blocked."""
    guide = load(db, guide_id)
    if not can_view(db, viewer, guide):
        raise HTTPException(status_code=404, detail="Guide not found")
    return guide


def author(db, guide: dict) -> Optional[dict]:
    """The author as shown to others: None when anonymous (nothing about them leaves the server)."""
    if guide.get("attribution") == "anonymous":
        return None
    card = cards(db, [guide["user_id"]]).get(guide["user_id"])
    if not card:
        return None
    return {"username": card.get("username"), "display_name": card["display_name"], "initials": card["initials"]}


def question_count(guide: dict) -> int:
    cards_list = guide.get("flashcards") or []
    if cards_list:
        return len(cards_list)
    return sum(1 for line in (guide.get("study_guide") or "").splitlines() if line.strip()[:1] == "Q" and ":" in line[:6])


def studied_by(db, guide_id: str) -> int:
    """How many other people saved or copied it."""
    saves = db.table("guide_saves").select("user_id").eq("guide_id", guide_id).execute().data or []
    copies = db.table("study_guides").select("user_id").eq("forked_from_guide_id", guide_id).execute().data or []
    return len({r["user_id"] for r in saves} | {r["user_id"] for r in copies})


def outline_preview(notes: str, lines: int = 14) -> list[str]:
    """The first lines of the outline, as plain text (no markup reaches the page)."""
    out = []
    for raw in (notes or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("[IMG:"):
            continue
        out.append(line[:300])
        if len(out) >= lines:
            break
    return out


def public_card(db, viewer: Optional[str], guide: dict) -> dict:
    """What anyone allowed to see the guide gets. Never the owner's id, folder or progress; for
    anonymous guides, nothing that identifies the author at all."""
    is_owner = bool(viewer and viewer == guide.get("user_id"))
    out = {
        "id": guide["id"],
        "title": guide.get("title") or "Untitled",
        "visibility": guide.get("visibility") or "private",
        "version": guide.get("version") or 1,
        "question_count": question_count(guide),
        "outline": outline_preview(guide.get("notes") or ""),
        "studied_by": studied_by(db, guide["id"]),
        "author": author(db, guide),
        "is_owner": is_owner,
    }
    if is_owner:
        out["review_status"] = guide.get("review_status") or "ok"
        out["hold_reason"] = guide.get("hold_reason")
    if viewer and not is_owner:
        out["saved"] = bool(db.table("guide_saves").select("guide_id").eq("user_id", viewer).eq("guide_id", guide["id"]).limit(1).execute().data)
        mine = (db.table("study_guides").select("id,created_at").eq("user_id", viewer).eq("forked_from_guide_id", guide["id"])
                .order("created_at", desc=True).limit(1).execute().data or [])
        out["my_copy_id"] = mine[0]["id"] if mine else None
    return out


def profile_guides(db, viewer: Optional[str], owner_id: str, limit: int = 50) -> list[dict]:
    """The owner's public, named guides for their profile's Guides tab (anonymous ones never show
    up there: that would name the author)."""
    try:
        rows = (db.table("study_guides").select(GUIDE_COLUMNS).eq("user_id", owner_id).eq("visibility", "public")
                .eq("attribution", "named").eq("review_status", "ok").order("created_at", desc=True).limit(limit).execute().data or [])
    except Exception:  # before the Stage 3 migration
        return []
    return [{"id": g["id"], "title": g.get("title") or "Untitled", "question_count": question_count(g), "created_at": g.get("created_at")}
            for g in rows if can_view(db, viewer, g)]
