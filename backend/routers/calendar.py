"""Account-scoped, read-only Canvas calendar feed connection."""

import ipaddress
import re
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth_utils import get_user_id
from database import get_supabase

router = APIRouter(prefix="/calendar", tags=["calendar"])
MAX_FEED_BYTES = 2_000_000


class CalendarPreviewRequest(BaseModel):
    url: str = Field(..., max_length=2_048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        parsed = urlparse(value.strip())
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("Use the HTTPS calendar-feed link from Canvas")
        return value.strip()


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


def _download_feed(url: str) -> str:
    current = _public_url(url)
    for _ in range(4):
        response = requests.get(
            current,
            headers={"Accept": "text/calendar", "User-Agent": "CordiaClassroom Calendar/1.0"},
            timeout=10,
            allow_redirects=False,
            stream=True,
        )
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


@router.post("/preview")
def preview_calendar(body: CalendarPreviewRequest, authorization: str = Header(default="")):
    get_user_id(authorization)
    return _calendar_payload(body.url)
