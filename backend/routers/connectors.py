"""Settings > Connectors: Google Calendar, Google Tasks, Google Drive, Google Docs, Notion and the
apps Cordia Assistant uses by text (Sheets, Gmail, Outlook, Slack, YNAB, Dropbox, GitHub) through
Composio, and Apple Calendar through a subscribed calendar feed. One connection serves both apps."""

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from ids import is_uuid
from rate_limit import limiter
from routers.calendar import calendar_for
from services import composio
from services import file_extraction as files

router = APIRouter(tags=["connectors"])

# Shown in this order. ids match Cordia Assistant's, so one connection serves both apps.
CONNECTORS = [
    {"id": "gcal", "name": "Google Calendar", "tagline": "Put your deadlines on your calendar."},
    {"id": "apple_calendar", "name": "Apple Calendar", "tagline": "Subscribe to your deadlines on iPhone and Mac."},
    {"id": "gtasks", "name": "Google Tasks", "tagline": "Turn deadlines into to-dos."},
    {"id": "gdrive", "name": "Google Drive", "tagline": "Import course files into a guide."},
    {"id": "gdocs", "name": "Google Docs", "tagline": "Import notes into a guide."},
    {"id": "notion", "name": "Notion", "tagline": "Import notes into a guide."},
    {"id": "gsheets", "name": "Google Sheets", "tagline": "Text Cordia to log anything to a sheet."},
    {"id": "gmail", "name": "Gmail", "tagline": "Cordia texts you about emails that need a reply."},
    {"id": "outlook", "name": "Outlook", "tagline": "Cordia texts you about emails that need a reply."},
    {"id": "slack", "name": "Slack", "tagline": "Catch what you missed and reply by text."},
    {"id": "ynab", "name": "YNAB", "tagline": "Check your budget by text."},
    {"id": "dropbox", "name": "Dropbox", "tagline": "Find a file by text."},
    {"id": "github", "name": "GitHub", "tagline": "Check issues and pull requests by text."},
]
COMPOSIO_IDS = set(composio.TOOLKITS)


def _frontend() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _known(connector: str) -> str:
    if connector not in COMPOSIO_IDS:
        raise HTTPException(status_code=404, detail="Unknown connector")
    return connector


@router.get("/connectors")
def list_connectors(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    active = composio.active_accounts(user_id)
    return {"connectors": [{
        **item,
        "available": item["id"] == "apple_calendar" or composio.configured(),
        "connected": item["id"] in active,
    } for item in CONNECTORS]}


@router.post("/connectors/{connector}/connect")
@limiter.limit("10/minute")
def connect(connector: str, request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _known(connector)
    callback = f"{_frontend()}/settings?section=connectors&connected={connector}"
    return {"redirect_url": composio.start_link(user_id, connector, callback)}


@router.delete("/connectors/{connector}")
def disconnect(connector: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    composio.disconnect(user_id, _known(connector))
    return {"ok": True}


# ---- Deadlines to Google Calendar and Google Tasks ----

class DeadlinesRequest(BaseModel):
    time_zone: str = Field(default="UTC", max_length=64)


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _upcoming(user_id: str) -> list[dict]:
    """Deadlines from now through the next 60 days that aren't checked off."""
    now = datetime.now(timezone.utc)
    items = calendar_for(user_id).get("items") or []
    return [item for item in items if not item.get("done")
            and now <= datetime.fromisoformat(item["due_at"]) <= now + timedelta(days=60)]


def _title(item: dict) -> str:
    return f"Due: {item['title']}"[:200]


@router.post("/connectors/gcal/deadlines")
@limiter.limit("6/minute")
def deadlines_to_calendar(body: DeadlinesRequest, request: Request, authorization: str = Header(default="")):
    """Each upcoming deadline becomes a 30-minute event ending at its due time. Events already
    on the calendar with the same title and day are skipped, so it's safe to run again."""
    user_id = get_user_id(authorization)
    account = composio.account_for(user_id, "gcal")
    zone = _zone(body.time_zone)
    items = _upcoming(user_id)
    if not items:
        return {"added": 0, "skipped": 0}
    first = min(datetime.fromisoformat(item["due_at"]) for item in items) - timedelta(days=1)
    last = max(datetime.fromisoformat(item["due_at"]) for item in items) + timedelta(days=1)
    existing = composio.run(account, user_id, "GOOGLECALENDAR_EVENTS_LIST", {
        "calendarId": "primary", "q": "Due:", "timeMin": first.isoformat(), "timeMax": last.isoformat(),
        "singleEvents": True, "maxResults": 250,
    })
    seen = {(event.get("summary"), ((event.get("start") or {}).get("dateTime") or (event.get("start") or {}).get("date") or "")[:10])
            for event in existing.get("items") or []}
    added = skipped = 0
    for item in items:
        due = datetime.fromisoformat(item["due_at"]).astimezone(zone)
        start = due - timedelta(minutes=30)
        if (_title(item), start.date().isoformat()) in seen:
            skipped += 1
            continue
        composio.run(account, user_id, "GOOGLECALENDAR_CREATE_EVENT", {
            "calendar_id": "primary",
            "summary": _title(item),
            "start_datetime": start.strftime("%Y-%m-%dT%H:%M:%S"),
            "timezone": zone.key,
            "event_duration_hour": 0,
            "event_duration_minutes": 30,
            "description": "\n".join(filter(None, [item.get("course"), item.get("url"), "Added by Cordia Classroom"])),
        })
        added += 1
    return {"added": added, "skipped": skipped}


@router.post("/connectors/gtasks/deadlines")
@limiter.limit("6/minute")
def deadlines_to_tasks(body: DeadlinesRequest, request: Request, authorization: str = Header(default="")):
    """Each upcoming deadline becomes an open task due that day, unless one with its title is open."""
    user_id = get_user_id(authorization)
    account = composio.account_for(user_id, "gtasks")
    zone = _zone(body.time_zone)
    items = _upcoming(user_id)
    if not items:
        return {"added": 0, "skipped": 0}
    existing = composio.run(account, user_id, "GOOGLETASKS_LIST_TASKS", {"tasklist_id": "@default", "showCompleted": False, "maxResults": 100})
    open_titles = {task.get("title") for task in existing.get("tasks") or existing.get("items") or []}
    added = skipped = 0
    for item in items:
        if item["title"][:200] in open_titles:
            skipped += 1
            continue
        due = datetime.fromisoformat(item["due_at"]).astimezone(zone).date()
        composio.run(account, user_id, "GOOGLETASKS_INSERT_TASK", {
            "tasklist_id": "@default",
            "title": item["title"][:200],
            "status": "needsAction",
            # Google Tasks keeps only the date of a due time.
            "due": f"{due.isoformat()}T00:00:00.000Z",
            "notes": "\n".join(filter(None, [item.get("course"), item.get("url")])),
        })
        added += 1
    return {"added": added, "skipped": skipped}


# ---- Imports from Drive, Docs and Notion ----

def _drive_query(text: str) -> str:
    name = text.replace("\\", "\\\\").replace("'", "\\'")
    return f"name contains '{name}' and trashed = false" if name else "trashed = false"


def _notion_title(item: dict) -> str:
    rich = lambda value: "".join(part.get("plain_text", "") for part in value or [])  # noqa: E731
    if isinstance(item.get("title"), list):
        return rich(item["title"]) or "Untitled"
    for prop in (item.get("properties") or {}).values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            return rich(prop.get("title")) or "Untitled"
    return "Untitled"


@router.get("/connectors/{connector}/files")
@limiter.limit("30/minute")
def search_files(connector: str, request: Request, q: str = "", authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if connector not in {"gdrive", "gdocs", "notion"}:
        raise HTTPException(status_code=404, detail="Unknown connector")
    account = composio.account_for(user_id, connector)
    q = q.strip()[:200]
    if connector == "gdrive":
        data = composio.run(account, user_id, "GOOGLEDRIVE_FIND_FILE", {
            "q": _drive_query(q), "pageSize": 20, "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,modifiedTime)",
        })
        found = [{"id": f.get("id"), "title": f.get("name") or "Untitled", "kind": (f.get("mimeType") or "").split("/")[-1].split(".")[-1],
                  "edited": (f.get("modifiedTime") or "")[:10]} for f in data.get("files") or []
                 if not str(f.get("mimeType", "")).endswith("folder")]
    elif connector == "gdocs":
        data = composio.run(account, user_id, "GOOGLEDOCS_SEARCH_DOCUMENTS", {
            "query": q, "max_results": 20, "response_detail": "minimal", "order_by": "modifiedTime desc",
        })
        found = [{"id": f.get("id"), "title": f.get("name") or "Untitled", "kind": "doc", "edited": (f.get("modifiedTime") or "")[:10]}
                 for f in data.get("files") or data.get("documents") or []]
    else:
        data = composio.run(account, user_id, "NOTION_SEARCH_NOTION_PAGE", {"query": q, "page_size": 20})
        found = [{"id": r.get("id"), "title": _notion_title(r), "kind": "page", "edited": (r.get("last_edited_time") or "")[:10]}
                 for r in data.get("results") or [] if r.get("object") != "database"]
    return {"files": [item for item in found if item["id"]]}


class ImportRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=200)
    title: str = Field(default="", max_length=300)


def _notion_text(account: str, user_id: str, page_id: str) -> str:
    data = composio.run(account, user_id, "NOTION_FETCH_BLOCK_CONTENTS", {"block_id": page_id, "page_size": 100})
    lines = []
    for block in data.get("results") or []:
        kind = str(block.get("type"))
        text = "".join(part.get("plain_text", "") for part in (block.get(kind) or {}).get("rich_text") or [])
        if not text:
            continue
        lines.append(("# " if kind.startswith("heading") else "- " if "list_item" in kind or kind == "to_do" else "") + text)
    return "\n".join(lines)


def _drive_text(account: str, user_id: str, file_id: str) -> str:
    # Google Docs, Slides and Sheets are exported; other files download as they are.
    data = composio.run(account, user_id, "GOOGLEDRIVE_DOWNLOAD_FILE", {"file_id": file_id})
    content = data.get("downloaded_file_content") or {}
    mime = str(data.get("mimeType") or content.get("mimetype") or "")
    if mime.startswith("application/vnd.google-apps."):
        export = "text/csv" if mime.endswith("spreadsheet") else "text/plain"
        data = composio.run(account, user_id, "GOOGLEDRIVE_DOWNLOAD_FILE", {"file_id": file_id, "mime_type": export})
        content = data.get("downloaded_file_content") or {}
        mime = export
    raw = composio.download(content.get("s3url") or "")
    name = str(content.get("name") or data.get("name") or "")
    extension = files.extension_of(name) or {"text/plain": "txt", "text/csv": "csv", "application/pdf": "pdf"}.get(mime, "")
    if extension == "pdf":
        return files.pdf_text(files.open_pdf(raw))
    if extension == "docx":
        return files.docx_text(raw)
    if extension == "pptx":
        slides = files.pptx_slides(raw)
        return slides.get("text", "")
    if extension in {"txt", "md", "csv", "rtf", "html"} or mime.startswith("text/"):
        return files.plain_text(raw, extension or "txt")
    raise HTTPException(status_code=415, detail="Cordia can import PDFs, Word, PowerPoint, Google Docs and text files.")


@router.post("/connectors/{connector}/import")
@limiter.limit("10/minute")
def import_file(connector: str, body: ImportRequest, request: Request, authorization: str = Header(default="")):
    """The file's text, for the student to review on Create before making a guide."""
    user_id = get_user_id(authorization)
    if connector not in {"gdrive", "gdocs", "notion"}:
        raise HTTPException(status_code=404, detail="Unknown connector")
    account = composio.account_for(user_id, connector)
    if connector == "gdocs":
        data = composio.run(account, user_id, "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", {"document_id": body.id, "include_tables": True})
        text, title = str(data.get("plain_text") or ""), data.get("title") or body.title
    elif connector == "notion":
        text, title = _notion_text(account, user_id, body.id), body.title
    else:
        text, title = _drive_text(account, user_id, body.id), body.title
    if len(text.strip()) < 10:
        raise HTTPException(status_code=422, detail="That file has no readable text.")
    return {"title": (title or "Imported notes")[:300], "text": text[:files.MAX_TEXT_CHARS]}


# ---- Apple Calendar: a subscribed feed of deadlines ----

def _feed_key() -> bytes:
    secret = (os.getenv("RETAIN_SIGNING_KEY") or os.getenv("SUPABASE_JWT_SECRET")
              or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "")
    if not secret:
        raise HTTPException(status_code=503, detail="Calendar feeds aren't set up yet.")
    return hashlib.sha256(("cordia-calendar-feed:" + secret).encode()).digest()


def _feed_token(user_id: str) -> str:
    return user_id + "." + hmac.new(_feed_key(), user_id.encode(), hashlib.sha256).hexdigest()[:32]


@router.get("/connectors/apple_calendar/feed")
def apple_calendar_feed(request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    base = str(request.base_url).rstrip("/")
    if not base.startswith(("http://localhost", "http://127.0.0.1")):
        base = "https://" + base.split("://", 1)[-1]
    url = f"{base}/calendar-feed/{_feed_token(user_id)}.ics"
    return {"url": url, "webcal_url": "webcal://" + url.split("://", 1)[1]}


def _ics_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/calendar-feed/{token}.ics")
@limiter.limit("30/minute")
def calendar_feed(token: str, request: Request):
    """Public, unguessable: the token is the student's id signed with a server key."""
    user_id, _, _ = token.partition(".")
    if not is_uuid(user_id) or not hmac.compare_digest(token, _feed_token(user_id)):
        raise HTTPException(status_code=404, detail="Not found")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cordia Classroom//Deadlines//EN",
             "X-WR-CALNAME:Cordia deadlines", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
    for item in calendar_for(user_id).get("items") or []:
        if item.get("done"):
            continue
        due = datetime.fromisoformat(item["due_at"]).astimezone(timezone.utc)
        uid = hashlib.sha256(str(item.get("id")).encode()).hexdigest()[:24]
        lines += ["BEGIN:VEVENT", f"UID:{uid}@cordiaai.io", f"DTSTAMP:{stamp}",
                  f"DTSTART:{(due - timedelta(minutes=30)).strftime('%Y%m%dT%H%M%SZ')}",
                  f"DTEND:{due.strftime('%Y%m%dT%H%M%SZ')}",
                  f"SUMMARY:{_ics_text(_title(item))}"]
        if item.get("course"):
            lines.append(f"LOCATION:{_ics_text(item['course'])}")
        if item.get("url"):
            lines.append(f"URL:{item['url']}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=900"})
