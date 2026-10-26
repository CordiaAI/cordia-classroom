"""Notion, for students who already live there, through Composio.

Notion only lets Cordia see pages the student shared with it (when connecting, or later from a
page's ••• menu > Connections). The student picks one shared page as Cordia's home; under it:
- a "Cordia assignments" database, two-way: Cordia writes each upcoming deadline as a row (Name,
  Course, Due, Status, Link) and keeps its date and title current (Canvas owns them); setting
  Status to Done in Notion checks it off in Cordia and the reverse. A row the student deletes
  isn't put back. Rows map to deadlines through connector_links (kind "page").
- exported guides: a page with the outline, and each question as a toggle that hides its answer,
  for self-quizzing.
The home page id is stats.parent_page_id; the database id is connector_settings.container_id.
"""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state
from services.deadlines import marks

log = logging.getLogger(__name__)
DB_TITLE = "Cordia assignments"
STATUS_DONE, STATUS_OPEN = "Done", "Not started"
PROPERTIES = [
    {"name": "Name", "type": "title"}, {"name": "Course", "type": "rich_text"}, {"name": "Due", "type": "date"},
    {"name": "Status", "type": "select"}, {"name": "Link", "type": "url"},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(*parts) -> str:
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode()).hexdigest()[:32]


def search_pages(user_id: str, query: str) -> list[dict]:
    from routers.connectors import _notion_title
    account = composio.account_for(user_id, "notion")
    data = composio.run(account, user_id, "NOTION_SEARCH_NOTION_PAGE", {"query": query.strip()[:100], "filter_value": "page", "page_size": 25})
    return [{"id": r.get("id"), "title": _notion_title(r), "edited": (r.get("last_edited_time") or "")[:10]}
            for r in data.get("results") or [] if r.get("id") and r.get("object") != "database"]


def setup(user_id: str, parent_page_id: str, parent_title: str) -> dict:
    """Make Cordia's database under the page the student picked, then fill it."""
    account = composio.account_for(user_id, "notion")
    state = sync_state.get(user_id, "notion")
    if state.get("container_id") and (state.get("stats") or {}).get("parent_page_id") == parent_page_id:
        return sync_db(user_id)
    made = composio.run(account, user_id, "NOTION_CREATE_DATABASE", {"parent_id": parent_page_id, "title": DB_TITLE, "properties": PROPERTIES})
    database_id = made.get("id") or (made.get("database") or {}).get("id")
    if not database_id:
        raise HTTPException(status_code=502, detail="Notion didn't make the database. Check that Cordia can see that page.")
    sync_state.set_container(user_id, "notion", database_id)
    sync_state.update_stats(user_id, "notion", {"parent_page_id": parent_page_id, "parent_title": (parent_title or "")[:200]})
    get_supabase().table("connector_links").delete().eq("user_id", user_id).eq("connector", "notion").eq("kind", "page").execute()
    return sync_db(user_id)


def _prop(row: dict, name: str) -> dict:
    return (row.get("properties") or {}).get(name) or {}


def _status(row: dict) -> str:
    value = _prop(row, "Status")
    return ((value.get("select") or value.get("status") or {}) or {}).get("name") or ""


def _values(item: dict, done: bool) -> list[dict]:
    due = str(item["due_at"])
    return [
        {"name": "Name", "type": "title", "value": str(item.get("title") or "Assignment")[:300]},
        {"name": "Course", "type": "rich_text", "value": str(item.get("course") or "")[:200]},
        {"name": "Due", "type": "date", "value": due},
        {"name": "Status", "type": "select", "value": STATUS_DONE if done else STATUS_OPEN},
        *([{"name": "Link", "type": "url", "value": item["url"]}] if item.get("url") and not item.get("internal") else []),
    ]


def sync_db(user_id: str) -> dict:
    from routers.calendar import calendar_for
    from services.google_sync import links, save_link
    state = sync_state.get(user_id, "notion")
    database_id = state.get("container_id")
    if not database_id:
        return {"on": False}
    account = composio.active_accounts(user_id).get("notion")
    if not account:
        sync_state.record(user_id, "notion", error="Notion isn't connected anymore.", needs_reconnect=True)
        return {"on": True, "error": "reconnect"}
    db = get_supabase()
    now = _now()
    remote = {}
    cursor = None
    for _ in range(10):
        args = {"database_id": database_id, "page_size": 100, **({"start_cursor": cursor} if cursor else {})}
        data = composio.run(account, user_id, "NOTION_QUERY_DATABASE", args)
        for row in data.get("results") or []:
            if row.get("id") and not row.get("archived") and not row.get("in_trash"):
                remote[row["id"]] = row
        cursor = data.get("next_cursor") if data.get("has_more") else None
        if not cursor:
            break
    linked = links(user_id, "notion")
    marked = marks(db, user_id)
    items = [i for i in calendar_for(user_id).get("items") or []
             if i.get("due_at") and now - timedelta(days=7) <= datetime.fromisoformat(str(i["due_at"]).replace("Z", "+00:00")) <= now + timedelta(days=120)]
    done_in_notion = written = 0
    for item in items:
        key = item["id"]
        link = linked.get(("page", key))
        if link and link.get("removed_by_student"):
            continue
        done = bool(item.get("done") or marked.get(key))
        if link:
            row = remote.get(link["external_id"])
            if row is None:  # Deleted in Notion: the student's call, so it stays gone.
                save_link(user_id, "notion", "page", key, link["external_id"], database_id, link.get("synced_hash") or "", removed=True)
                continue
            if _status(row) == STATUS_DONE and not done:
                db.table("deadline_marks").upsert({"user_id": user_id, "item_key": key, "done": True, "updated_at": now.isoformat()},
                                                  on_conflict="user_id,item_key").execute()
                done, done_in_notion = True, done_in_notion + 1
            digest = _hash(item.get("title"), item["due_at"], done)
            if link.get("synced_hash") != digest:
                composio.run(account, user_id, "NOTION_UPDATE_ROW_DATABASE", {"row_id": link["external_id"], "properties": _values(item, done)})
                save_link(user_id, "notion", "page", key, link["external_id"], database_id, digest)
            continue
        if done:
            continue
        made = composio.run(account, user_id, "NOTION_INSERT_ROW_DATABASE", {"database_id": database_id, "properties": _values(item, False)})
        row_id = made.get("id") or (made.get("page") or {}).get("id")
        if row_id:
            save_link(user_id, "notion", "page", key, row_id, database_id, _hash(item.get("title"), item["due_at"], False))
            written += 1
    sync_state.record(user_id, "notion", stats={"rows": len(remote) + written, "done_in_notion": done_in_notion})
    return {"on": True, "added": written, "done_in_notion": done_in_notion}


def export_guide(user_id: str, guide_id: str, title: str, outline: str, pairs: list[dict]) -> dict:
    """The guide as a Notion page under Cordia's home page: its outline, then each question as a
    toggle holding the answer. Exporting again archives the last copy instead of adding another."""
    account = composio.account_for(user_id, "notion")
    stats = sync_state.get(user_id, "notion").get("stats") or {}
    parent = stats.get("parent_page_id")
    if not parent:
        raise HTTPException(status_code=409, detail="Pick a Notion page for Cordia first: Settings › Connectors › Notion.")
    toggles = "\n".join(
        f"<details>\n<summary>{_md(p.get('question'))}</summary>\n\t{_md(p.get('answer'))}\n</details>" for p in pairs[:200] if p.get("question"))
    markdown = "\n\n".join(filter(None, [outline.strip(), "## Quiz yourself\nOpen each question to check your answer." if toggles else "", toggles]))
    made = composio.run(account, user_id, "NOTION_CREATE_NOTION_PAGE", {"parent_id": parent, "title": (title or "Study guide")[:200], "markdown": markdown[:100_000]})
    page_id = made.get("id") or (made.get("page") or {}).get("id")
    if not page_id:
        raise HTTPException(status_code=502, detail="Notion didn't make the page. Try again.")
    from services.google_sync import links, save_link
    old = links(user_id, "notion").get(("file", f"export:{guide_id}"))
    if old and old["external_id"] != page_id:
        try:
            composio.run(account, user_id, "NOTION_UPDATE_PAGE", {"page_id": old["external_id"], "archived": True})
        except HTTPException:
            log.info("old Notion export not archived")
    save_link(user_id, "notion", "file", f"export:{guide_id}", page_id, parent, _hash(markdown))
    return {"page_id": page_id, "url": made.get("url") or f"https://www.notion.so/{page_id.replace('-', '')}"}


def _md(text) -> str:
    """One line of plain text, safe inside the toggle markup."""
    return " ".join(str(text or "").replace("<", "‹").replace(">", "›").split())[:1900]


def due(now: datetime) -> list[dict]:
    cutoff = (now - timedelta(minutes=30)).isoformat()
    return get_supabase().table("connector_settings").select("user_id,last_synced_at").eq("connector", "notion") \
        .not_.is_("container_id", "null").or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(20).execute().data or []


def parent(user_id: str) -> Optional[dict]:
    stats = sync_state.get(user_id, "notion").get("stats") or {}
    return {"id": stats["parent_page_id"], "title": stats.get("parent_title") or "Notion page"} if stats.get("parent_page_id") else None
