"""Google Docs both ways, through Composio.

- Export: a guide becomes a formatted Google Doc (headings, lists, tables from its Markdown). With
  Drive connected too, it goes into the Cordia Drive folder and exporting again trashes the old
  copy; without Drive it stays in Docs' default place.
- Drafts: a student links the Doc they're writing for an assignment (connector_links kind "page",
  cordia_id "draft:<item key>"). The Tutor reads it next to the assignment's rubric, and its word
  count is checked every 6 hours: a draft that hasn't grown in two days with the deadline under
  five days away gets one Dashboard nudge.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state

log = logging.getLogger(__name__)
DRAFT_EVERY = timedelta(hours=6)
STALL = timedelta(hours=48)
KEEP_POINTS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def doc_url(doc_id: str) -> str:
    return f"https://docs.google.com/document/d/{doc_id}/edit"


def _link(user_id: str, connector: str, kind: str, cordia_id: str) -> Optional[dict]:
    rows = get_supabase().table("connector_links").select("*").eq("user_id", user_id).eq("connector", connector) \
        .eq("kind", kind).eq("cordia_id", cordia_id).limit(1).execute().data or []
    return rows[0] if rows else None


def _save_link(user_id: str, connector: str, kind: str, cordia_id: str, external_id: str, container_id: str = "") -> None:
    get_supabase().table("connector_links").upsert({
        "user_id": user_id, "connector": connector, "kind": kind, "cordia_id": cordia_id, "external_id": external_id[:300],
        "container_id": (container_id or "")[:300] or None, "removed_by_student": False, "updated_at": _now().isoformat(),
    }, on_conflict="user_id,connector,kind,cordia_id").execute()


def export_guide(user_id: str, guide_id: str, title: str, markdown: str) -> dict:
    account = composio.account_for(user_id, "gdocs")
    made = composio.run(account, user_id, "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", {"title": (title or "Study guide")[:200], "markdown_text": markdown})
    doc_id = made.get("documentId") or made.get("document_id") or made.get("id") or (made.get("document") or {}).get("documentId")
    if not doc_id:
        raise HTTPException(status_code=502, detail="Google Docs didn't make the document. Try again.")
    cordia_id = f"export:{guide_id}:doc"
    old = _link(user_id, "gdocs", "file", cordia_id)
    drive = composio.active_accounts(user_id).get("gdrive")
    if drive:
        # Tidy into the Cordia folder and replace the last export; skipped quietly if Drive says no.
        try:
            from services.drive_sync import _cordia_folder
            composio.run(drive, user_id, "GOOGLEDRIVE_MOVE_FILE", {"file_id": doc_id, "add_parents": _cordia_folder(user_id, drive)})
            if old and old["external_id"] != doc_id:
                composio.run(drive, user_id, "GOOGLEDRIVE_TRASH_FILE", {"file_id": old["external_id"]})
        except HTTPException:
            log.info("doc export left in place")
    _save_link(user_id, "gdocs", "file", cordia_id, doc_id)
    return {"doc_id": doc_id, "url": doc_url(doc_id)}


def link_draft(user_id: str, item_key: str, doc_id: str, title: str) -> dict:
    composio.account_for(user_id, "gdocs")
    _save_link(user_id, "gdocs", "page", f"draft:{item_key}", doc_id, title)
    words = track_draft(user_id, item_key)
    return {"doc_id": doc_id, "title": title, "url": doc_url(doc_id), "words": words}


def unlink_draft(user_id: str, item_key: str) -> None:
    get_supabase().table("connector_links").delete().eq("user_id", user_id).eq("connector", "gdocs").eq("kind", "page") \
        .eq("cordia_id", f"draft:{item_key}").execute()


def draft(user_id: str, item_key: str) -> Optional[dict]:
    link = _link(user_id, "gdocs", "page", f"draft:{item_key}")
    if not link:
        return None
    points = ((sync_state.get(user_id, "gdocs").get("stats") or {}).get("drafts") or {}).get(item_key) or []
    return {"doc_id": link["external_id"], "title": link.get("container_id") or "Draft", "url": doc_url(link["external_id"]),
            "words": points[-1][1] if points else None, "history": points[-10:]}


def draft_text(user_id: str, item_key: str) -> str:
    link = _link(user_id, "gdocs", "page", f"draft:{item_key}")
    account = composio.active_accounts(user_id).get("gdocs") if link else None
    if not account:
        return ""
    data = composio.run(account, user_id, "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", {"document_id": link["external_id"], "include_tables": True})
    return str(data.get("plain_text") or "")


def track_draft(user_id: str, item_key: str) -> Optional[int]:
    """Record the draft's word count now."""
    try:
        text = draft_text(user_id, item_key)
    except HTTPException:
        return None
    words = len(text.split())
    stats = sync_state.get(user_id, "gdocs").get("stats") or {}
    drafts = dict(stats.get("drafts") or {})
    drafts[item_key] = [*(drafts.get(item_key) or []), [_now().isoformat(), words]][-KEEP_POINTS:]
    sync_state.update_stats(user_id, "gdocs", {"drafts": drafts})
    return words


def stalled(points: list, now: datetime) -> bool:
    """No growth across the last two days of checks (at least two days of history)."""
    if len(points) < 2:
        return False
    latest = points[-1][1]
    window = [words for at, words in points if datetime.fromisoformat(at) >= now - STALL]
    older = [words for at, words in points if datetime.fromisoformat(at) <= now - STALL]
    return bool(older) and bool(window) and latest <= older[-1]


def check_drafts(user_id: str) -> int:
    """Every 6 hours: count words in linked drafts and nudge once when one stalls near its deadline."""
    from routers.calendar import calendar_for
    rows = get_supabase().table("connector_links").select("cordia_id").eq("user_id", user_id).eq("connector", "gdocs") \
        .eq("kind", "page").like("cordia_id", "draft:%").execute().data or []
    items = {i["id"]: i for i in calendar_for(user_id).get("items") or []}
    now = _now()
    nudged = 0
    for row in rows:
        key = row["cordia_id"].split(":", 1)[1]
        track_draft(user_id, key)
        item = items.get(key)
        stats = sync_state.get(user_id, "gdocs").get("stats") or {}
        due = datetime.fromisoformat(str(item["due_at"]).replace("Z", "+00:00")) if item else None
        if not item or item.get("done") or not due or not now < due <= now + timedelta(days=5):
            continue
        if stalled((stats.get("drafts") or {}).get(key) or [], now) and (stats.get("nudged") or {}).get(key) != now.date().isoformat():
            sync_state.add_alert(user_id, "gdocs", {"kind": "draft_stalled", "item_key": key, "title": item.get("title") or "Draft",
                                                   "course": item.get("course"), "at": now.isoformat(), "days": max(1, (due - now).days)})
            stats = sync_state.get(user_id, "gdocs").get("stats") or {}
            sync_state.update_stats(user_id, "gdocs", {"nudged": {**(stats.get("nudged") or {}), key: now.date().isoformat()}})
            nudged += 1
    sync_state.record(user_id, "gdocs", stats={"drafts_tracked": len(rows)})
    return nudged


def due_drafts(now: datetime) -> list[dict]:
    cutoff = (now - DRAFT_EVERY).isoformat()
    users = {r["user_id"] for r in get_supabase().table("connector_links").select("user_id").eq("connector", "gdocs").eq("kind", "page")
             .like("cordia_id", "draft:%").limit(200).execute().data or []}
    out = []
    for user_id in list(users)[:20]:
        state = sync_state.get(user_id, "gdocs")
        if not state.get("last_synced_at") or state["last_synced_at"] < cutoff:
            out.append({"user_id": user_id, "last_synced_at": state.get("last_synced_at")})
    return out
