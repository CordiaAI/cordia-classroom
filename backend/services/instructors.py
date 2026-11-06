"""Verified instructors and course opt-outs (social plan, Stage 8).

A verified instructor is someone whose confirmed account email is on an instructor_blocks row: they
proved a school email through the opt-out flow (routers/public_forms.py POST /instructors/block),
which also set classes.sharing_blocked on that course. No new flag (Stage 7 decision).

What an opt-out does:
  - the course's guides (guides in a folder linked to the course) leave Discover
    (services/discover.py already skips classes.sharing_blocked);
  - nobody can add guides or folders to a classroom linked to the course, or add the course's guides
    to any course-linked classroom, except the course's own verified instructors;
  - instructors can see what their opt-out currently hides (opt_out_report).
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

logger = logging.getLogger(__name__)


def _confirmed_email(db, user_id: str) -> Optional[str]:
    """The account's email when it's confirmed, else None."""
    try:
        user = db.auth.admin.get_user_by_id(user_id).user
    except Exception:
        return None
    email = getattr(user, "email", None)
    if not email or not getattr(user, "email_confirmed_at", None):
        return None
    return str(email).strip().lower()


def verified_class_ids(db, user_id: str) -> set:
    """The courses this person is a verified instructor of."""
    email = _confirmed_email(db, user_id) if user_id else None
    if not email:
        return set()
    try:
        rows = db.table("instructor_blocks").select("class_id,email").execute().data or []
    except Exception:  # before the Canvas migration
        return set()
    return {r["class_id"] for r in rows if str(r.get("email") or "").strip().lower() == email}


def is_verified(db, user_id: str) -> bool:
    return bool(verified_class_ids(db, user_id))


def verified_ids(db, user_ids: Iterable[str]) -> set:
    """Which of these people are verified instructors. Matches instructor_blocks emails against
    profile emails first (one query each), then confirms only those candidates with the auth API."""
    ids = list(dict.fromkeys(i for i in user_ids if i))
    if not ids:
        return set()
    try:
        emails = {str(r.get("email") or "").strip().lower() for r in db.table("instructor_blocks").select("email").execute().data or []}
    except Exception:
        return set()
    emails.discard("")
    if not emails:
        return set()
    try:
        rows = db.table("user_profiles").select("id,email").in_("id", ids).execute().data or []
    except Exception:
        return set()
    candidates = [r["id"] for r in rows if str(r.get("email") or "").strip().lower() in emails]
    return {uid for uid in candidates if (_confirmed_email(db, uid) or "") in emails}


def _blocked_classes(db, class_ids: Iterable[str]) -> dict:
    ids = [c for c in dict.fromkeys(class_ids) if c]
    if not ids:
        return {}
    try:
        rows = db.table("classes").select("id,course_code_normalized,display_name,sharing_blocked").in_("id", ids).execute().data or []
    except Exception:
        return {}
    return {r["id"]: r for r in rows if r.get("sharing_blocked")}


def guide_class_id(db, guide: dict) -> Optional[str]:
    folder_id = guide.get("folder_id")
    if not folder_id:
        return None
    try:
        row = (db.table("folders").select("class_id").eq("id", folder_id).limit(1).execute().data or [None])[0]
    except Exception:
        return None
    return (row or {}).get("class_id")


def add_problem(db, user_id: str, room: dict, guide: Optional[dict] = None, folder: Optional[dict] = None) -> Optional[str]:
    """Why this person can't add this guide or folder to this classroom because of a course opt-out;
    None when they can. Checks the classroom's course, and the item's own course when the classroom is
    linked to a course."""
    room_class = room.get("class_id")
    item_class = None
    if guide:
        item_class = guide_class_id(db, guide)
    elif folder:
        item_class = folder.get("class_id")
    courses = [room_class] + ([item_class] if room_class and item_class else [])
    blocked = _blocked_classes(db, courses)
    if not blocked:
        return None
    mine = verified_class_ids(db, user_id)
    for class_id, course in blocked.items():
        if class_id in mine:
            continue
        code = course.get("course_code_normalized") or course.get("display_name") or "this course"
        if class_id == room_class:
            return f"The instructor of {code} turned off sharing, so guides can't be added to this classroom."
        return f"The instructor of {code} turned off sharing, so its guides can't be added to course classrooms."
    return None


def opt_out_report(db, user_id: str) -> list:
    """For each course this instructor opted out: what the opt-out hides right now."""
    out = []
    for class_id in sorted(verified_class_ids(db, user_id)):
        course = (db.table("classes").select("id,course_code_normalized,display_name,sharing_blocked").eq("id", class_id).limit(1).execute().data or [None])[0]
        if not course:
            continue
        folders = [r["id"] for r in db.table("folders").select("id").eq("class_id", class_id).execute().data or []]
        hidden_public = 0
        for start in range(0, len(folders), 200):
            try:
                rows = db.table("study_guides").select("id,visibility").in_("folder_id", folders[start:start + 200]).execute().data or []
            except Exception:
                rows = []
            hidden_public += len([r for r in rows if r.get("visibility") in ("public", "link")])
        try:
            private_sets = len(db.table("shared_sets").select("id").eq("class_id", class_id).execute().data or [])
        except Exception:
            private_sets = 0
        try:
            rooms_linked = len([r for r in db.table("classrooms").select("id,archived_at").eq("class_id", class_id).execute().data or [] if not r.get("archived_at")])
        except Exception:
            rooms_linked = 0
        out.append({"class_id": class_id, "code": course.get("course_code_normalized") or "", "name": course.get("display_name") or "",
                    "sharing_blocked": bool(course.get("sharing_blocked")), "hidden_from_discover": hidden_public,
                    "class_sets_kept_private": private_sets, "classrooms_locked": rooms_linked})
    return out
