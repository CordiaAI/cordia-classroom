"""Settings > Connectors: Google Calendar, Google Tasks, Google Drive, Google Docs, Notion and the
apps Cordia Assistant uses by text (Sheets, Gmail, Outlook, Slack, YNAB, Dropbox, GitHub) through
Composio, and Apple Calendar through a subscribed calendar feed. One connection serves both apps."""

import hashlib
import hmac
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from ids import is_uuid
from rate_limit import limiter
from routers.calendar import calendar_for
from services import composio
from services import connector_settings, google_sync, sync_state
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
# Apps the Tutor can read from when a student names them; every Composio app works in the Assistant.
TUTOR_APPS = ("gcal", "gtasks", "gdrive", "gdocs", "notion")


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
    saved = connector_settings.for_user(user_id)
    states = sync_state.for_user(user_id)
    return {"connectors": [{
        **item,
        "available": item["id"] == "apple_calendar" or composio.configured(),
        "connected": item["id"] in active,
        # Which of the two can use it; only for apps that work there.
        "uses": {use: on for use, on in (saved.get(item["id"]) or {"tutor": True, "assistant": True}).items()
                 if (use == "tutor" and item["id"] in TUTOR_APPS) or (use == "assistant" and item["id"] in COMPOSIO_IDS)},
        "health": _health(states.get(item["id"]) or {}),
    } for item in CONNECTORS]}


def _health(state: dict) -> dict:
    """What the card shows beyond "Connected": sync on, last sync, counts, and any problem."""
    stats = {key: value for key, value in (state.get("stats") or {}).items() if key not in ("alerts", "time_zone")}
    return {
        "sync_on": bool(state.get("container_id")),
        "last_synced_at": state.get("last_synced_at"),
        "error": state.get("last_error"),
        "needs_reconnect": bool(state.get("needs_reconnect")),
        "stats": stats,
    }


class UsesRequest(BaseModel):
    tutor: Optional[bool] = None
    assistant: Optional[bool] = None


@router.patch("/connectors/{connector}/uses")
@limiter.limit("30/minute")
def set_uses(connector: str, body: UsesRequest, request: Request, authorization: str = Header(default="")):
    """Switch a connected app on or off for the Tutor or Cordia Assistant; it stays connected."""
    user_id = get_user_id(authorization)
    _known(connector)
    changes = {use: value for use, value in body.model_dump().items() if value is not None}
    if "tutor" in changes and connector not in TUTOR_APPS:
        raise HTTPException(status_code=400, detail="The Tutor doesn't use this app.")
    try:
        return {"uses": connector_settings.save(user_id, connector, changes)}
    except Exception:
        raise HTTPException(status_code=503, detail="This setting isn't available yet. Try again later.")


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


# ---- Deadlines (the Apple Calendar feed); Google sync lives in services.google_sync ----

def _upcoming(user_id: str) -> list[dict]:
    """Deadlines from now through the next 60 days that aren't checked off."""
    now = datetime.now(timezone.utc)
    items = calendar_for(user_id).get("items") or []
    return [item for item in items if not item.get("done")
            and now <= datetime.fromisoformat(item["due_at"]) <= now + timedelta(days=60)]


def _title(item: dict) -> str:
    return f"Due: {item['title']}"[:200]


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


# ---- The Tutor reads an app the student names ----

# What a student calls each app. Plain "calendar" is left to Classroom's own calendar.
APP_NAMES = {
    "notion": re.compile(r"\bnotion\b", re.I),
    "gdocs": re.compile(r"\bgoogle docs?\b|\bgdocs?\b", re.I),
    "gdrive": re.compile(r"\bgoogle drive\b|\bmy drive\b|\bgdrive\b", re.I),
    "gcal": re.compile(r"\bgoogle calendar\b|\bgcal\b", re.I),
    "gtasks": re.compile(r"\bgoogle tasks?\b|\bgtasks\b", re.I),
}
NAMES = {item["id"]: item["name"] for item in CONNECTORS}
FILLER = set("""a an and about at be can could do does find for from get give go have help how i in into is it its
    me my of on open page pages please pull read file files doc docs document show summarize tell that the
    there this to up use using what whats what's where which with would you your quiz explain notes note""".split())


def named_app(question: str) -> Optional[str]:
    return next((connector for connector, pattern in APP_NAMES.items() if pattern.search(question)), None)


def _search_terms(question: str, connector: str) -> list[str]:
    """What to search the app for: quoted words, else the words after called/named/titled, else the rest."""
    quoted = re.findall(r"[\"“]([^\"”]{2,80})[\"”]", question)
    if quoted:
        return [quoted[0].strip()]
    named = re.search(r"\b(?:called|named|titled)\s+(.{2,80}?)(?:[.?!,]|\s+(?:in|on|from)\s|$)", question, re.I)
    if named:
        return [named.group(1).strip()]
    rest = APP_NAMES[connector].sub(" ", question)
    words = [word for word in re.findall(r"[\w'-]+", rest) if word.lower() not in FILLER and len(word) > 1]
    if not words:
        return []
    # The phrase first, then its longest words on their own (Drive and Docs match names literally).
    return list(dict.fromkeys([" ".join(words[:5]), *sorted(words, key=len, reverse=True)[:2]]))


def _upcoming_from_app(account: str, user_id: str, connector: str) -> str:
    now = datetime.now(timezone.utc)
    if connector == "gcal":
        data = composio.run(account, user_id, "GOOGLECALENDAR_EVENTS_LIST", {
            "calendarId": "primary", "timeMin": now.isoformat(), "timeMax": (now + timedelta(days=14)).isoformat(),
            "singleEvents": True, "orderBy": "startTime", "maxResults": 50,
        })
        events = [item for item in data.get("items") or [] if item.get("status") != "cancelled"]
        return "\n".join(
            f"- {(event.get('start') or {}).get('dateTime') or (event.get('start') or {}).get('date')}: {event.get('summary') or 'Busy'}"
            for event in events) or "No events in the next 14 days."
    data = composio.run(account, user_id, "GOOGLETASKS_LIST_TASKS", {"tasklist_id": "@default", "showCompleted": False, "maxResults": 40})
    tasks = [task for task in data.get("tasks") or data.get("items") or [] if task.get("status") != "completed"]
    return "\n".join(f"- {task.get('title') or 'Untitled'}" + (f" (due {str(task['due'])[:10]})" if task.get("due") else "")
                     for task in tasks) or "No open tasks."


def tutor_material(user_id: str, question: str) -> Optional[dict]:
    """When the question names a Tutor app: {"connector", "name"} plus "title"/"text" read from it,
    or "problem" saying why not (not connected, switched off for the Tutor, nothing found). None otherwise."""
    connector = named_app(question)
    if not connector:
        return None
    name = NAMES[connector]
    found = {"connector": connector, "name": name}
    if not composio.configured():
        return None
    account = composio.active_accounts(user_id).get(connector)
    if not account:
        return {**found, "problem": f"{name} isn't connected. Connect it in Settings › Connectors, then ask again."}
    if not connector_settings.uses(user_id, connector)["tutor"]:
        return {**found, "problem": f"{name} is switched off for the Tutor. Turn it on in Settings › Connectors › {name}."}
    if connector in {"gcal", "gtasks"}:
        title = "Your next 14 days" if connector == "gcal" else "Your open tasks"
        return {**found, "title": f"{name}: {title}", "text": _upcoming_from_app(account, user_id, connector)}
    for terms in _search_terms(question, connector):
        if connector == "gdrive":
            data = composio.run(account, user_id, "GOOGLEDRIVE_FIND_FILE", {
                "q": _drive_query(terms), "pageSize": 5, "orderBy": "modifiedTime desc", "fields": "files(id,name,mimeType)",
            })
            hits = [(f.get("id"), f.get("name")) for f in data.get("files") or [] if not str(f.get("mimeType", "")).endswith("folder")]
        elif connector == "gdocs":
            data = composio.run(account, user_id, "GOOGLEDOCS_SEARCH_DOCUMENTS", {
                "query": terms, "max_results": 5, "response_detail": "minimal", "order_by": "modifiedTime desc",
            })
            hits = [(f.get("id"), f.get("name")) for f in data.get("files") or data.get("documents") or []]
        else:
            data = composio.run(account, user_id, "NOTION_SEARCH_NOTION_PAGE", {"query": terms, "page_size": 5})
            hits = [(r.get("id"), _notion_title(r)) for r in data.get("results") or [] if r.get("object") != "database"]
        hits = [hit for hit in hits if hit[0]]
        if not hits:
            continue
        file_id, title = hits[0]
        if connector == "gdocs":
            text = str(composio.run(account, user_id, "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT", {"document_id": file_id, "include_tables": True}).get("plain_text") or "")
        elif connector == "notion":
            text = _notion_text(account, user_id, file_id)
        else:
            try:
                text = _drive_text(account, user_id, file_id)
            except HTTPException as error:
                return {**found, "problem": f"Found {title or 'a file'} in {name}, but {error.detail[0].lower()}{error.detail[1:]}"}
        if text.strip():
            return {**found, "title": f"{name}: {title or 'Untitled'}", "text": text[:files.MAX_TEXT_CHARS]}
    return {**found, "problem": f"I couldn't find that in {name}. Put the page's name in quotes, like “Week 3 notes”."}


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
             "X-WR-CALNAME:Cordia", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"]
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
    # Study blocks too, so Apple, Outlook or any calendar shows the plan without signing in to Google.
    now = datetime.now(timezone.utc)
    blocks = get_supabase().table("study_blocks").select("*").eq("user_id", user_id).neq("status", "removed") \
        .gte("ends_at", (now - timedelta(days=1)).isoformat()).lte("starts_at", (now + timedelta(days=60)).isoformat()).execute().data or []
    titles = google_sync._block_titles(user_id, blocks) if blocks else {}
    for block in blocks:
        start, end = (datetime.fromisoformat(block[key]).astimezone(timezone.utc) for key in ("starts_at", "ends_at"))
        lines += ["BEGIN:VEVENT", f"UID:block-{block['id']}@cordiaai.io", f"DTSTAMP:{stamp}",
                  f"DTSTART:{start.strftime('%Y%m%dT%H%M%SZ')}", f"DTEND:{end.strftime('%Y%m%dT%H%M%SZ')}",
                  f"SUMMARY:{_ics_text(titles.get(block['id'], 'Study'))}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=900"})
