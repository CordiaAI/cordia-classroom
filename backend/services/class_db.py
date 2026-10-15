"""Shared class database: schools, classes, terms, memberships and the Library folder for each class.

All calls use the service-role client; callers have already verified the user.
"""
from __future__ import annotations

from typing import Optional

from services.class_catalog import normalize_course_code, similar_codes


def _first(result) -> Optional[dict]:
    return (result.data or [None])[0]


def ensure_school(db, name: str, canvas_domain: Optional[str] = None) -> dict:
    if canvas_domain:
        found = _first(db.table("schools").select("*").eq("canvas_domain", canvas_domain).limit(1).execute())
        if found:
            return found
    else:
        found = _first(db.table("schools").select("*").eq("name", name).limit(1).execute())
        if found:
            return found
    row = {"name": name[:200] or (canvas_domain or "School")}
    if canvas_domain:
        row["canvas_domain"] = canvas_domain
    return _first(db.table("schools").insert(row).execute())


def ensure_class(db, school_id: str, raw_code: str, display_name: str = "") -> Optional[dict]:
    """Find or create the class for a raw course code. Ambiguous codes create a merge proposal
    for admin review; nothing is merged automatically. Returns None when no code is found."""
    normalized = normalize_course_code(raw_code)
    if not normalized.code:
        return None
    existing = db.table("classes").select("*").eq("school_id", school_id).execute().data or []
    by_code = {row["course_code_normalized"]: row for row in existing}
    row = by_code.get(normalized.code)
    created = False
    if not row:
        row = _first(db.table("classes").insert({
            "school_id": school_id,
            "course_code_normalized": normalized.code,
            "display_name": (display_name or "")[:200],
        }).execute())
        created = True
    elif display_name and not row.get("display_name"):
        db.table("classes").update({"display_name": display_name[:200]}).eq("id", row["id"]).execute()
        row = {**row, "display_name": display_name[:200]}
    if created or normalized.ambiguous:
        for other in similar_codes(normalized.code, by_code):
            db.table("class_merge_proposals").insert({
                "school_id": school_id, "raw_code": raw_code[:200], "from_class_id": row["id"],
                "into_class_id": by_code[other]["id"], "confidence": 0.7, "status": "pending",
            }).execute()
        if normalized.ambiguous and created:
            db.table("class_merge_proposals").insert({
                "school_id": school_id, "raw_code": raw_code[:200], "from_class_id": row["id"],
                "into_class_id": None, "confidence": 0.5, "status": "pending",
            }).execute()
    return row


def ensure_term(db, class_id: str, term: str) -> dict:
    found = _first(db.table("class_terms").select("*").eq("class_id", class_id).eq("term", term).limit(1).execute())
    return found or _first(db.table("class_terms").insert({"class_id": class_id, "term": term}).execute())


def add_membership(db, user_id: str, class_row: dict, term: str, source: str) -> dict:
    term_row = ensure_term(db, class_row["id"], term)
    db.table("class_memberships").upsert(
        {"user_id": user_id, "class_term_id": term_row["id"], "source": source},
        on_conflict="user_id,class_term_id",
    ).execute()
    ensure_folder(db, user_id, class_row)
    return term_row


def ensure_folder(db, user_id: str, class_row: dict) -> dict:
    """The Library folder that stands for this class."""
    found = _first(db.table("folders").select("*").eq("user_id", user_id).eq("class_id", class_row["id"]).limit(1).execute())
    if found:
        return found
    name = class_row["course_code_normalized"]
    if class_row.get("display_name"):
        name = f"{name} {class_row['display_name']}"[:100]
    return _first(db.table("folders").insert({"user_id": user_id, "name": name, "class_id": class_row["id"]}).execute())


def user_class_ids(db, user_id: str) -> list[str]:
    terms = [m["class_term_id"] for m in db.table("class_memberships").select("class_term_id").eq("user_id", user_id).execute().data or []]
    if not terms:
        return []
    rows = db.table("class_terms").select("class_id").in_("id", terms).execute().data or []
    return list(dict.fromkeys(row["class_id"] for row in rows))


def is_member(db, user_id: str, class_id: str) -> bool:
    return class_id in user_class_ids(db, user_id)


def remove_membership(db, user_id: str, class_id: str) -> None:
    terms = [row["id"] for row in db.table("class_terms").select("id").eq("class_id", class_id).execute().data or []]
    if terms:
        db.table("class_memberships").delete().eq("user_id", user_id).in_("class_term_id", terms).execute()
