"""
Search router for CordiaClassroom.
Full-text search across study guides.
"""

import re
from fastapi import APIRouter, Header, Query
from database import get_supabase
from auth_utils import get_user_id

router = APIRouter(tags=["search"])

# Queries are sent as parameters, so only LIKE's own wildcards and escape need escaping;
# apostrophes and quotes stay, so "Newton's law" can match.
_LIKE_SPECIAL = re.compile(r'([\\%_])')


def _like_pattern(q: str) -> str:
    """The search text as a literal "contains" pattern for ilike."""
    return "%" + _LIKE_SPECIAL.sub(r"\\\1", q) + "%"


def _extract_snippet(text: str, query: str, length: int = 120) -> str:
    """Extract a snippet around the first match."""
    if not text:
        return ""
    lower = text.lower()
    idx = lower.find(query.lower())
    if idx == -1:
        return text[:length] + ("..." if len(text) > length else "")
    start = max(0, idx - 40)
    end = min(len(text), idx + len(query) + 80)
    snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
    return snippet


@router.get("/search")
def search_guides(q: str = Query(..., min_length=1, max_length=200), authorization: str = Header(default="")):
    """Search guides by title, notes, and study_guide content."""
    user_id = get_user_id(authorization)
    supabase = get_supabase()

    q = q.strip()
    if not q:
        return {"results": []}
    pattern = _like_pattern(q)

    title_results = supabase.table("study_guides") \
        .select("id, title, folder_id, notes, study_guide, created_at") \
        .eq("user_id", user_id) \
        .ilike("title", pattern) \
        .limit(20) \
        .execute()

    notes_results = supabase.table("study_guides") \
        .select("id, title, folder_id, notes, study_guide, created_at") \
        .eq("user_id", user_id) \
        .ilike("notes", pattern) \
        .limit(20) \
        .execute()

    guide_results = supabase.table("study_guides") \
        .select("id, title, folder_id, notes, study_guide, created_at") \
        .eq("user_id", user_id) \
        .ilike("study_guide", pattern) \
        .limit(20) \
        .execute()

    # Deduplicate by id
    seen = set()
    results = []
    for source, field in [(title_results, "title"), (notes_results, "notes"), (guide_results, "study_guide")]:
        for row in (source.data or []):
            if row["id"] not in seen:
                seen.add(row["id"])
                if field == "title":
                    snippet = _extract_snippet(row.get("notes") or row.get("study_guide") or "", q)
                else:
                    snippet = _extract_snippet(row.get(field, ""), q)
                results.append({
                    "id": row["id"],
                    "title": row["title"],
                    "folder_id": row.get("folder_id"),
                    "snippet": snippet,
                    "match_field": field,
                    "created_at": row["created_at"]
                })

    return {"results": results}
