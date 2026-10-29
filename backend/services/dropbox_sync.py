"""Dropbox as a material source, through Composio: the same as Google Drive (services.drive_sync).

A class can be linked to one Dropbox folder. New or changed files in it come into the class's
Library folder (services.library_import) every 30 minutes, and right away when linked. The link is
a connector_links row: connector "dropbox", kind "file", cordia_id "folder:<Library folder id>",
external_id the Dropbox folder id ("id:..."; it survives renames and moves), container_id its name.
Single files import the same way as Drive's, through /connectors/dropbox/files and /import.
"""

import base64
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, file_extraction as files, library_import, sync_state

log = logging.getLogger(__name__)
FILES_PER_RUN = 15
MAX_BYTES = 20 * 1024 * 1024
# Files Dropbox can hand over and Cordia can read as text; the rest (video, images, zips) are skipped.
READABLE = (".pdf", ".docx", ".pptx", ".txt", ".md", ".rtf", ".csv", ".html")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def account(user_id: str) -> str:
    return composio.account_for(user_id, "dropbox")


def _meta(item: dict) -> dict:
    """Search results wrap each entry ({metadata: {metadata: {...}}}); listings don't."""
    meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else item
    return meta.get("metadata") if isinstance(meta.get("metadata"), dict) else meta


def _tag(entry: dict) -> str:
    return str(entry.get(".tag") or entry.get("tag") or "")


def _entries(data: dict) -> list[dict]:
    found = data.get("entries") or data.get("matches") or (data.get("result") or {}).get("entries") or data.get("items") or []
    return [_meta(item) for item in found if isinstance(item, dict)]


def search_folders(user_id: str, query: str) -> list[dict]:
    """Folders to link: matching the search, or the top-level ones when there's no search."""
    acct = account(user_id)
    query = query.strip()[:100]
    if query:
        data = composio.run(acct, user_id, "DROPBOX_FILES_SEARCH", {"query": query})
    else:
        data = composio.run(acct, user_id, "DROPBOX_LIST_FILES_IN_FOLDER", {"path": "", "limit": 200})
    out = []
    for entry in _entries(data):
        if _tag(entry) != "folder" or not (entry.get("id") or entry.get("path_lower")):
            continue
        out.append({"id": entry.get("id") or entry.get("path_lower"), "name": entry.get("name") or "Folder",
                    "path": entry.get("path_display") or entry.get("path_lower") or ""})
    return out[:25]


def links(user_id: str) -> list[dict]:
    rows = get_supabase().table("connector_links").select("cordia_id,external_id,container_id,updated_at").eq("user_id", user_id) \
        .eq("connector", "dropbox").eq("kind", "file").like("cordia_id", "folder:%").execute().data or []
    return [{"library_folder_id": r["cordia_id"].split(":", 1)[1], "drive_folder_id": r["external_id"],
             "drive_folder_name": r.get("container_id") or "Dropbox folder", "linked_at": r.get("updated_at")} for r in rows]


def link(user_id: str, library_folder_id: str, folder_id: str, name: str) -> dict:
    db = get_supabase()
    # One Dropbox folder per class and one class per folder: replace any older link either way.
    db.table("connector_links").delete().eq("user_id", user_id).eq("connector", "dropbox").eq("kind", "file") \
        .eq("cordia_id", f"folder:{library_folder_id}").execute()
    db.table("connector_links").delete().eq("user_id", user_id).eq("connector", "dropbox").eq("external_id", folder_id).execute()
    db.table("connector_links").insert({
        "user_id": user_id, "connector": "dropbox", "kind": "file", "cordia_id": f"folder:{library_folder_id}",
        "external_id": folder_id[:300], "container_id": (name or "Dropbox folder")[:300], "updated_at": _now().isoformat(),
    }).execute()
    stats = sync_state.get(user_id, "dropbox").get("stats") or {}
    checked = {k: v for k, v in (stats.get("folders_checked") or {}).items() if k != folder_id}
    sync_state.update_stats(user_id, "dropbox", {"linked": True, "folders_checked": checked})
    return sync_folders(user_id, only=folder_id)


def unlink(user_id: str, library_folder_id: str) -> None:
    get_supabase().table("connector_links").delete().eq("user_id", user_id).eq("connector", "dropbox").eq("kind", "file") \
        .eq("cordia_id", f"folder:{library_folder_id}").execute()
    if not links(user_id):
        sync_state.update_stats(user_id, "dropbox", {"linked": False})


def file_text(acct: str, user_id: str, path: str, name: str) -> str:
    """A Dropbox file's text. The file comes back as base64 bytes or as a download link."""
    data = composio.run(acct, user_id, "DROPBOX_READ_FILE", {"path": path})
    content = data.get("content") if isinstance(data.get("content"), dict) else data
    raw = b""
    encoded = content.get("file_content_bytes") or data.get("file_content_bytes")
    if isinstance(encoded, str) and encoded:
        try:
            raw = base64.b64decode(encoded, validate=False)
        except ValueError as error:
            raise HTTPException(status_code=502, detail="That file couldn't be read.") from error
    else:
        url = content.get("s3url") or (data.get("downloaded_file_content") or {}).get("s3url") or ""
        raw = composio.download(url)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That file is over 20 MB.")
    return files.text_from_file(name, raw)


def search_files(user_id: str, query: str) -> list[dict]:
    """Files to import one at a time (the Import button), newest first when there's no search."""
    acct = account(user_id)
    query = query.strip()[:200]
    data = composio.run(acct, user_id, "DROPBOX_FILES_SEARCH", {"query": query}) if query \
        else composio.run(acct, user_id, "DROPBOX_LIST_FILES_IN_FOLDER", {"path": "", "recursive": True, "limit": 400})
    found = [e for e in _entries(data) if _tag(e) == "file" and str(e.get("name") or "").lower().endswith(READABLE)]
    found.sort(key=lambda e: str(e.get("server_modified") or ""), reverse=True)
    return [{"id": e.get("id") or e.get("path_lower"), "title": e.get("name") or "Untitled", "kind": str(e.get("name") or "").rsplit(".", 1)[-1].lower(),
             "edited": str(e.get("server_modified") or "")[:10]} for e in found[:20]]


def sync_folders(user_id: str, only: Optional[str] = None) -> dict:
    """Bring new and changed files from each linked folder into its class, FILES_PER_RUN at a time."""
    acct = composio.active_accounts(user_id).get("dropbox")
    if not acct:
        sync_state.record(user_id, "dropbox", error="Dropbox isn't connected anymore.", needs_reconnect=True)
        return {"imported": 0, "error": "reconnect"}
    stats = sync_state.get(user_id, "dropbox").get("stats") or {}
    checked = dict(stats.get("folders_checked") or {})
    imported = 0
    for entry in links(user_id):
        folder = entry["drive_folder_id"]
        if only and folder != only:
            continue
        since = checked.get(folder) or ""
        started = _now().strftime("%Y-%m-%dT%H:%M:%SZ")
        data = composio.run(acct, user_id, "DROPBOX_LIST_FILES_IN_FOLDER", {"path": folder, "limit": 500})
        fresh = sorted((e for e in _entries(data) if _tag(e) == "file" and str(e.get("name") or "").lower().endswith(READABLE)
                        and str(e.get("server_modified") or "") > since and int(e.get("size") or 0) <= MAX_BYTES),
                       key=lambda e: str(e.get("server_modified") or ""))
        for item in fresh[:FILES_PER_RUN]:
            path = item.get("id") or item.get("path_lower")  # Dropbox reads "id:..." as a path too.
            try:
                text = file_text(acct, user_id, path, item.get("name") or "")
            except HTTPException as error:
                log.info("dropbox file skipped: %s", error.detail)
                continue
            if library_import.upsert_source(
                    user_id, ref=f"dropbox:{path}", connector="dropbox", title=item.get("name") or "Dropbox file",
                    text=text, folder_id=entry["library_folder_id"], source_type="dropbox",
                    source_title=f"Dropbox · {entry['drive_folder_name']}"):
                imported += 1
        if len(fresh) <= FILES_PER_RUN:
            checked[folder] = started
    sync_state.record(user_id, "dropbox", stats={"folders_checked": checked, "files": int(stats.get("files") or 0) + imported})
    return {"imported": imported}
