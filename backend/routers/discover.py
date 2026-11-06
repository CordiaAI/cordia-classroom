"""Discover (social plan, Stage 7): public guides, public classrooms and public profiles.

Signed in only. Every rule (what's listed, blocks, opt-outs, anonymity, minors) lives in
services/discover.py, which re-checks everything because the backend reads with the service role.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import discover

router = APIRouter(prefix="/discover", tags=["discover"])
READ = [Depends(ai_rate_limit(120, 60))]


def _optional_uuid(value: str, label: str) -> str:
    return require_uuid(value, label) if value else ""


@router.get("/guides", dependencies=READ)
def discover_guides(q: str = Query("", max_length=200), school: str = "", course: str = "", term: str = Query("", max_length=60),
                    creator_type: str = "", size: str = "", updated_within: int = Query(0, ge=0, le=3650),
                    from_my_classrooms: bool = False, offset: int = Query(0, ge=0, le=500), limit: int = Query(discover.PAGE, ge=1, le=50),
                    authorization: str = Header(default="")):
    """Public guides, ranked by text relevance x quality, near-duplicates folded ("+N similar").
    Filters: school and course (ids), term ("Fall 2026"), creator_type (instructor | student),
    size (short | medium | long), updated_within (days), from_my_classrooms."""
    viewer = get_user_id(authorization)
    return discover.search_guides(
        get_supabase(), viewer, q=q, school=_optional_uuid(school, "school ID"), course=_optional_uuid(course, "course ID"),
        term=term, creator_type=creator_type if creator_type in discover.CREATOR_TYPES else "",
        size=size if size in discover.SIZES else "", updated_within=updated_within,
        from_my_classrooms=from_my_classrooms, offset=offset, limit=limit)


@router.get("/classrooms", dependencies=READ)
def discover_classrooms(q: str = Query("", max_length=100), school: str = "", course: str = "", authorization: str = Header(default="")):
    """Public classrooms only (the ones listed on their course page)."""
    viewer = get_user_id(authorization)
    return {"classrooms": discover.search_classrooms(get_supabase(), viewer, q=q, school=_optional_uuid(school, "school ID"),
                                                     course=_optional_uuid(course, "course ID"))}


@router.get("/people", dependencies=READ)
def discover_people(q: str = Query("", max_length=60), authorization: str = Header(default="")):
    """Public profiles only; never minors or anyone in a block either way."""
    viewer = get_user_id(authorization)
    return {"people": discover.search_people(get_supabase(), viewer, q)}
