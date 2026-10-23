"""Google Drive as a material source, through Composio.

- A class can be linked to one Drive folder. New or changed files in it come into the class's
  Library folder (services.library_import) every 30 minutes, and right away when linked.
  The link is a connector_links row: kind "file", cordia_id "folder:<Library folder id>",
  external_id the Drive folder id, container_id its name.
- Save to Drive puts a copy of a guide (or its cards as CSV) in a "Cordia" folder in the
  student's Drive, so they own a copy outside the app. Saving again replaces that copy (the old
  one goes to Drive's trash) instead of making a second one.
"""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, library_import, sync_state

log = logging.getLogger(__name__)
FOLDER = "application/vnd.google-apps.folder"
CONTAINER_NAME = "Cordia"
FILES_PER_RUN = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quote(text: str) -> str:
    return text.replace("\\", "\\\\").replace("'", "\\'")


def account(user_id: str) -> str:
    return composio.account_for(user_id, "gdrive")


def search_folders(user_id: str, query: str) -> list[dict]:
    q = f"mimeType = '{FOLDER}' and trashed = false" + (f" and name contains '{_quote(query.strip()[:100])}'" if query.strip() else "")
    data = composio.run(account(user_id), user_id, "GOOGLEDRIVE_FIND_FILE", {
        "q": q, "pageSize": 25, "orderBy": "modifiedTime desc", "fields": "files(id,name,modifiedTime)",
    })
    return [{"id": f.get("id"), "name": f.get("name") or "Untitled folder", "edited": (f.get("modifiedTime") or "")[:10]}
            for f in data.get("files") or [] if f.get("id")]


def links(user_id: str) -> list[dict]:
    rows = get_supabase().table("connector_links").select("cordia_id,external_id,container_id,updated_at").eq("user_id", user_id) \
        .eq("connector", "gdrive").eq("kind", "file").like("cordia_id", "folder:%").execute().data or []
    return [{"library_folder_id": r["cordia_id"].split(":", 1)[1], "drive_folder_id": r["external_id"],
             "drive_folder_name": r.get("container_id") or "Drive folder", "linked_at": r.get("updated_at")} for r in rows]


def link(user_id: str, library_folder_id: str, drive_folder_id: str, name: str) -> dict:
    db = get_supabase()
    # One Drive folder per class and one class per Drive folder: replace any older link either way.
    db.table("connector_links").delete().eq("user_id", user_id).eq("connector", "gdrive").eq("kind", "file") \
        .eq("cordia_id", f"folder:{library_folder_id}").execute()
    db.table("connector_links").delete().eq("user_id", user_id).eq("connector", "gdrive").eq("external_id", drive_folder_id).execute()
    db.table("connector_links").insert({
        "user_id": user_id, "connector": "gdrive", "kind": "file", "cordia_id": f"folder:{library_folder_id}",
        "external_id": drive_folder_id[:300], "container_id": (name or "Drive folder")[:300], "updated_at": _now().isoformat(),
    }).execute()
    stats = sync_state.get(user_id, "gdrive").get("stats") or {}
    checked = {k: v for k, v in (stats.get("folders_checked") or {}).items() if k != drive_folder_id}
    sync_state.update_stats(user_id, "gdrive", {"linked": True, "folders_checked": checked})
    return sync_folders(user_id, only=drive_folder_id)


def unlink(user_id: str, library_folder_id: str) -> None:
    get_supabase().table("connector_links").delete().eq("user_id", user_id).eq("connector", "gdrive").eq("kind", "file") \
        .eq("cordia_id", f"folder:{library_folder_id}").execute()
    if not links(user_id):
        sync_state.update_stats(user_id, "gdrive", {"linked": False})


def _drive_text(acct: str, user_id: str, file_id: str) -> str:
    from routers.connectors import _drive_text  # Shared with one-off imports: Docs, Slides and Sheets export as text.
    return _drive_text(acct, user_id, file_id)


def sync_folders(user_id: str, only: Optional[str] = None) -> dict:
    """Bring new and changed files from each linked folder into its class. Skips files Drive can't
    turn into text (images, video) and leaves the rest for the next run past FILES_PER_RUN."""
    acct = composio.active_accounts(user_id).get("gdrive")
    if not acct:
        sync_state.record(user_id, "gdrive", error="Google Drive isn't connected anymore.", needs_reconnect=True)
        return {"imported": 0, "error": "reconnect"}
    stats = sync_state.get(user_id, "gdrive").get("stats") or {}
    checked = dict(stats.get("folders_checked") or {})
    imported = 0
    for entry in links(user_id):
        folder = entry["drive_folder_id"]
        if only and folder != only:
            continue
        since = checked.get(folder)
        q = f"'{_quote(folder)}' in parents and trashed = false and mimeType != '{FOLDER}'"
        if since:
            q += f" and modifiedTime > '{since}'"
        started = _now().strftime("%Y-%m-%dT%H:%M:%S")
        data = composio.run(acct, user_id, "GOOGLEDRIVE_FIND_FILE", {
            "q": q, "pageSize": 50, "orderBy": "modifiedTime", "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
        })
        done_all = True
        for count, item in enumerate(data.get("files") or []):
            if count >= FILES_PER_RUN:
                done_all = False
                break
            try:
                text = _drive_text(acct, user_id, item["id"])
            except HTTPException as error:
                log.info("drive file skipped: %s", error.detail)
                continue
            if library_import.upsert_source(
                    user_id, ref=f"gdrive:{item['id']}", connector="gdrive", title=item.get("name") or "Drive file", text=text,
                    folder_id=entry["library_folder_id"], source_type="gdrive", source_title=f"Google Drive · {entry['drive_folder_name']}",
                    source_url=item.get("webViewLink")):
                imported += 1
        if done_all:
            checked[folder] = started
    sync_state.record(user_id, "gdrive", stats={"folders_checked": checked, "files": int(stats.get("files") or 0) + imported})
    return {"imported": imported}


def _cordia_folder(user_id: str, acct: str) -> str:
    saved = sync_state.get(user_id, "gdrive").get("container_id")
    if saved:
        return saved
    found = composio.run(acct, user_id, "GOOGLEDRIVE_FIND_FILE", {
        "q": f"name = '{CONTAINER_NAME}' and mimeType = '{FOLDER}' and 'root' in parents and trashed = false", "pageSize": 1, "fields": "files(id)",
    }).get("files") or []
    folder = found[0]["id"] if found else composio.run(acct, user_id, "GOOGLEDRIVE_CREATE_FOLDER", {"name": CONTAINER_NAME}).get("id")
    if not folder:
        raise HTTPException(status_code=502, detail="Google Drive didn't make the Cordia folder. Try again.")
    sync_state.set_container(user_id, "gdrive", folder)
    return folder


def save_copy(user_id: str, guide_id: str, kind: str, title: str, content: str) -> dict:
    """A copy of a guide (Markdown) or its cards (CSV) in the Cordia folder, replacing the last one saved."""
    acct = account(user_id)
    folder = _cordia_folder(user_id, acct)
    name = f"{(title or 'Study guide').strip()[:150]}{' - cards.csv' if kind == 'cards' else '.md'}"
    db = get_supabase()
    cordia_id = f"export:{guide_id}:{kind}"
    old = (db.table("connector_links").select("external_id").eq("user_id", user_id).eq("connector", "gdrive")
           .eq("kind", "file").eq("cordia_id", cordia_id).limit(1).execute().data or [None])[0]
    made = composio.run(acct, user_id, "GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", {
        "file_name": name, "text_content": content, "mime_type": "text/csv" if kind == "cards" else "text/markdown", "parent_id": folder,
    })
    file_id = made.get("id") or (made.get("file") or {}).get("id")
    if not file_id:
        raise HTTPException(status_code=502, detail="Google Drive didn't save the file. Try again.")
    if old and old["external_id"] != file_id:
        try:
            composio.run(acct, user_id, "GOOGLEDRIVE_TRASH_FILE", {"file_id": old["external_id"]})
        except HTTPException:
            log.info("old Drive copy not trashed")
    db.table("connector_links").upsert({
        "user_id": user_id, "connector": "gdrive", "kind": "file", "cordia_id": cordia_id, "external_id": file_id,
        "container_id": folder, "synced_hash": hashlib.sha256(content.encode()).hexdigest()[:32], "updated_at": _now().isoformat(),
    }, on_conflict="user_id,connector,kind,cordia_id").execute()
    return {"file_id": file_id, "name": name, "url": made.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"}


def due(now: datetime, every: timedelta = timedelta(minutes=30)) -> list[dict]:
    """Students with linked folders whose last Drive sync is older than `every`."""
    cutoff = (now - every).isoformat()
    return get_supabase().table("connector_settings").select("user_id,last_synced_at").eq("connector", "gdrive") \
        .eq("stats->>linked", "true").or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(20).execute().data or []
