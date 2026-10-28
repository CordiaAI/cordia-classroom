"""Course material from Canvas and Google Drive, filed into the class's Library folder.

Each imported file or page becomes a notes guide: its text as an outline ("## Heading", "- point"),
ready to read and to make cards, a quiz or practice from. No AI runs at import time.

- One guide per source: study_guides.external_source_id ("canvas:file:12", "gdrive:<id>") keys it,
  so nothing is imported twice.
- The source owns the text until the student edits it: connector_links keeps a hash of what Cordia
  last wrote, and a newer version of the file only replaces the notes while they still match it.
"""

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from database import get_supabase
from services.llm import guide_title
from services.text_processing import text_to_outline

log = logging.getLogger(__name__)


def _hash(text: str) -> str:
    return hashlib.sha256((text or "").encode()).hexdigest()[:32]


def existing_refs(user_id: str, prefix: str) -> set[str]:
    rows = get_supabase().table("study_guides").select("external_source_id").eq("user_id", user_id) \
        .like("external_source_id", f"{prefix}%").limit(5000).execute().data or []
    return {row["external_source_id"] for row in rows if row.get("external_source_id")}


_FILE_NAME_LINE = re.compile(r"^[-*•\s]*\S.*\.(?:pptx?|pdf|docx?|txt)\s*$", re.IGNORECASE)


def thin_refs(user_id: str, prefix: str) -> set[str]:
    """Imported guides that hold only file names (a page that was just links to its slides), to read again."""
    rows = get_supabase().table("study_guides").select("external_source_id,notes").eq("user_id", user_id) \
        .like("external_source_id", f"{prefix}%").limit(5000).execute().data or []
    def names_only(notes: str) -> bool:
        lines = [line for line in (notes or "").splitlines() if line.strip()]
        return bool(lines) and all(_FILE_NAME_LINE.match(line) for line in lines)
    return {row["external_source_id"] for row in rows if row.get("external_source_id") and names_only(row.get("notes"))}


def class_folder(user_id: str, class_id: Optional[str]) -> Optional[str]:
    """The Library folder that stands for a class, if the student has one."""
    if not class_id:
        return None
    rows = get_supabase().table("folders").select("id").eq("user_id", user_id).eq("class_id", class_id).limit(1).execute().data or []
    return rows[0]["id"] if rows else None


def upsert_source(user_id: str, *, ref: str, connector: str, title: str, text: str, folder_id: Optional[str],
                  source_type: str, source_title: str, source_url: Optional[str] = None) -> Optional[dict]:
    """Create or refresh the guide for one source. Returns the guide, or None when there's no text."""
    outline = text_to_outline(text)
    if not outline:
        return None
    db = get_supabase()
    found = (db.table("study_guides").select("id,notes,title,folder_id").eq("user_id", user_id)
             .eq("external_source_id", ref).limit(1).execute().data or [None])[0]
    now = datetime.now(timezone.utc).isoformat()
    if found:
        link = (db.table("connector_links").select("synced_hash").eq("user_id", user_id).eq("connector", connector)
                .eq("kind", "file").eq("cordia_id", found["id"]).limit(1).execute().data or [{}])[0]
        untouched = link.get("synced_hash") == _hash(found.get("notes") or "")
        if untouched and (found.get("notes") or "") != outline:
            db.table("study_guides").update({"notes": outline}).eq("id", found["id"]).eq("user_id", user_id).execute()
            _link(user_id, connector, found["id"], ref, outline, now)
        return found
    row = {
        "user_id": user_id, "title": guide_title(title or "Imported material", outline)[:300], "notes": outline, "study_guide": "",
        "external_source_id": ref, "source_type": source_type[:40], "source_title": source_title[:300],
    }
    if folder_id:
        row["folder_id"] = folder_id
    if source_url:
        row["source_url"] = source_url[:2000]
    made = (db.table("study_guides").insert(row).execute().data or [None])[0]
    if made:
        _link(user_id, connector, made["id"], ref, outline, now)
    return made


def _link(user_id: str, connector: str, guide_id: str, ref: str, outline: str, now: str) -> None:
    get_supabase().table("connector_links").upsert({
        "user_id": user_id, "connector": connector, "kind": "file", "cordia_id": guide_id, "external_id": ref[:300],
        "synced_hash": _hash(outline), "removed_by_student": False, "updated_at": now,
    }, on_conflict="user_id,connector,kind,cordia_id").execute()


def folder_material(user_id: str, folder_id: str, *, source_title_prefix: Optional[str] = None, limit_chars: int = 120_000) -> list[dict]:
    """The guides in a class folder (imports and the student's own), newest first, for a review set."""
    q = get_supabase().table("study_guides").select("id,title,notes,study_guide,source_type,source_title,created_at") \
        .eq("user_id", user_id).eq("folder_id", folder_id)
    if source_title_prefix:
        q = q.like("source_title", f"{source_title_prefix}%")
    rows = [row for row in q.order("created_at", desc=True).limit(200).execute().data or [] if row.get("source_type") != "review"]
    picked, used = [], 0
    for row in rows:
        size = len(row.get("notes") or "") + len(row.get("study_guide") or "")
        if size and used + size <= limit_chars:
            picked.append(row)
            used += size
    return picked
