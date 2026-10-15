"""Account-scoped, read-only Canvas calendar feed connection."""

import ipaddress
import re
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase

router = APIRouter(prefix="/calendar", tags=["calendar"])
MAX_FEED_BYTES = 2_000_000
# Bounded repeats keep matching linear (CodeQL py/polynomial-redos); TLD letters rule out IP literals.
CANVAS_HOST = re.compile(r"(?:[a-z0-9-]{1,63}\.){1,8}[a-z]{2,24}")
CANVAS_FEED_PATH = re.compile(r"/feeds/calendars/(user_[A-Za-z0-9]+\.ics)")


def canvas_feed_url(value: str) -> str:
    """Only Canvas calendar-feed links are fetched; the URL is rebuilt from the checked host and feed name."""
    parsed = urlparse(value.strip())
    host = (parsed.hostname or "").lower()
    path = CANVAS_FEED_PATH.fullmatch(parsed.path)
    if (parsed.scheme != "https" or parsed.port or parsed.username or parsed.password
            or not CANVAS_HOST.fullmatch(host) or not path):
        raise ValueError("Use the Calendar Feed link from Canvas (it ends in .ics)")
    return f"https://{host}/feeds/calendars/{path.group(1)}"


class CalendarPreviewRequest(BaseModel):
    url: str = Field(..., max_length=2_048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        return canvas_feed_url(value)


def _public_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Use the HTTPS calendar-feed link from Canvas.")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="That calendar address could not be found.")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="That calendar address is not a public website.")
    return value


class _PublicOnlyConnection(HTTPSConnection):
    """Checks the address the socket actually reached, so a second DNS answer can't point at a private host."""

    def _new_conn(self):
        sock = super()._new_conn()
        if not ipaddress.ip_address(sock.getpeername()[0]).is_global:
            sock.close()
            raise ConnectionRefusedError("calendar feed resolved to a non-public address")
        return sock


class _PublicOnlyPool(HTTPSConnectionPool):
    ConnectionCls = _PublicOnlyConnection


class _PublicOnlyAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {"https": _PublicOnlyPool}


def _feed_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False  # never route a user-supplied URL through an environment proxy
    session.mount("https://", _PublicOnlyAdapter())
    return session


def _download_feed(url: str) -> str:
    try:
        feed = canvas_feed_url(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    current = _public_url(feed)
    with _feed_session() as session:
        return _follow_feed(session, current)


def _follow_feed(session: requests.Session, current: str) -> str:
    for _ in range(4):
        try:
            response = session.get(
                current,
                headers={"Accept": "text/calendar", "User-Agent": "CordiaClassroom Calendar/1.0"},
                timeout=10,
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException:
            raise HTTPException(status_code=400, detail="Canvas could not open that calendar feed.")
        if response.is_redirect:
            location = response.headers.get("location")
            if not location:
                break
            current = _public_url(urljoin(current, location))
            continue
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=400, detail="Canvas rejected this calendar link. Copy a fresh Calendar Feed link from Canvas settings.")
        if not response.ok:
            raise HTTPException(status_code=400, detail="Canvas could not open that calendar feed.")
        body = bytearray()
        for chunk in response.iter_content(64 * 1024):
            body.extend(chunk)
            if len(body) > MAX_FEED_BYTES:
                raise HTTPException(status_code=400, detail="That calendar feed is too large to preview.")
        text = body.decode(response.encoding or "utf-8", errors="replace")
        if "BEGIN:VCALENDAR" not in text:
            raise HTTPException(status_code=400, detail="That link is not a Canvas calendar feed.")
        return text
    raise HTTPException(status_code=400, detail="The calendar feed redirected too many times.")


def _unfold(text: str) -> list[str]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    unfolded = []
    for line in lines:
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return unfolded


def _decode(value: str) -> str:
    return value.replace("\\n", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def _date(value: str):
    value = value.strip()
    formats = (
        ("%Y%m%d", True),
        ("%Y%m%dT%H%M%SZ", False),
        ("%Y%m%dT%H%M%S", False),
        ("%Y%m%dT%H%M", False),
    )
    for pattern, all_day in formats:
        try:
            parsed = datetime.strptime(value, pattern)
            if not all_day:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed, all_day
        except ValueError:
            continue
    return None, False


def _kind(title: str) -> str:
    text = title.casefold()
    for name, pattern in (
        ("exam", r"\b(exam|midterm|final|test)\b"),
        ("quiz", r"\bquiz\b"),
        ("project", r"\b(project|presentation|paper)\b"),
        ("assignment", r"\b(assignment|homework|discussion|lab|module)\b"),
    ):
        if re.search(pattern, text):
            return name
    return "event"


def _events(text: str) -> list[dict]:
    items = []
    current = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current and current.get("SUMMARY") and current.get("DTSTART"):
                due, all_day = _date(current["DTSTART"])
                if due:
                    title = _decode(current["SUMMARY"])
                    items.append({
                        "id": current.get("UID") or f"{title}-{current['DTSTART']}",
                        "title": title,
                        "due_at": due.isoformat(),
                        "all_day": all_day,
                        "type": _kind(title),
                        "url": current.get("URL") or None,
                        "course": _decode(current.get("LOCATION") or "") or None,
                    })
            current = None
            continue
        if current is None or ":" not in line:
            continue
        raw_key, value = line.split(":", 1)
        key = raw_key.split(";", 1)[0]
        if key in {"UID", "SUMMARY", "DTSTART", "URL", "LOCATION"}:
            current[key] = value.strip()

    now = datetime.now(timezone.utc)
    # A week back so the current week view is complete in every time zone.
    start = (now - timedelta(days=7)).date()
    end = (now + timedelta(days=90)).date()
    return sorted(
        (item for item in items if start <= datetime.fromisoformat(item["due_at"]).date() <= end),
        key=lambda item: item["due_at"],
    )[:100]


def _calendar_payload(url: str) -> dict:
    items = _events(_download_feed(url))
    today = datetime.now(timezone.utc).date()
    return {
        "connected": True,
        "items": items,
        "due_today": [item for item in items if datetime.fromisoformat(item["due_at"]).date() == today],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _stored_feed(user_id: str) -> str:
    result = (
        get_supabase().table("canvas_calendar_connections")
        .select("feed_url")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return result.data[0].get("feed_url") or "" if result.data else ""


@router.get("/connection")
def get_calendar_connection(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    url = _stored_feed(user_id)
    if not url:
        return {"connected": False, "items": [], "due_today": []}
    return _calendar_payload(url)


@router.post("/connection")
def connect_calendar(body: CalendarPreviewRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    payload = _calendar_payload(body.url)
    get_supabase().table("canvas_calendar_connections").upsert(
        {
            "user_id": user_id,
            "feed_url": body.url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id",
    ).execute()
    return payload


@router.delete("/connection")
def disconnect_calendar(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    (
        get_supabase().table("canvas_calendar_connections")
        .delete()
        .eq("user_id", user_id)
        .execute()
    )
    return {"connected": False}

