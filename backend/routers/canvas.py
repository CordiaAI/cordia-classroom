"""Canvas access-token connection. Every Canvas call goes through services.canvas_client."""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from services import canvas_client
from services.canvas_client import CanvasClient, CanvasError, CanvasForbiddenRequest, CanvasUnauthorized
from services.class_catalog import clean_term, school_name_from_domain, topic_summary
from services.class_db import add_membership, ensure_class, ensure_school

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/canvas", tags=["canvas"])

SYNC_EVERY = timedelta(hours=6)
SYNC_NOW_FLOOR = timedelta(seconds=60)
ACTIVITY_DAYS = 30
REMIND_DAYS = 7
NOT_ALLOWED = "Your school doesn't allow tokens"


class ConnectRequest(BaseModel):
    canvas_url: str = Field(..., max_length=300)
    token: str = Field(..., min_length=20, max_length=300)
    expires_at: Optional[date] = None
    acknowledged: bool = False

    def __repr__(self) -> str:  # never print the token
        return f"ConnectRequest(canvas_url={self.canvas_url!r})"

    __str__ = __repr__


class ImportRequest(BaseModel):
    imported: bool


class PauseRequest(BaseModel):
    paused: bool


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_time(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _policy_rows(db) -> list[dict]:
    return db.table("canvas_school_policy").select("*").execute().data or []


def _policy_for(db, host: str) -> Optional[dict]:
    return next((row for row in _policy_rows(db) if row["domain"] == host), None)


def _logger_for(db, user_id: str):
    def log(endpoint: str, status: int) -> None:
        try:
            db.table("canvas_activity").insert({"user_id": user_id, "endpoint": endpoint, "status": status}).execute()
        except Exception:
            logger.warning("Could not record Canvas activity")
    return log


def _client(db, user_id: str, connection: dict, **kwargs) -> CanvasClient:
    token_row = (db.table("canvas_tokens").select("*").eq("user_id", user_id).limit(1).execute().data or [None])[0]
    if not token_row:
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    return CanvasClient.from_store(
        user_id, token_row, connection["canvas_domain"],
        policy_domains=[row["domain"] for row in _policy_rows(db)], log=_logger_for(db, user_id), **kwargs,
    )


def _connection(db, user_id: str) -> Optional[dict]:
    return (db.table("canvas_connections").select("*").eq("user_id", user_id).limit(1).execute().data or [None])[0]


def _delete_canvas_data(db, user_id: str) -> None:
    """Hard delete: the token and every cached Canvas row."""
    db.table("canvas_tokens").delete().eq("user_id", user_id).execute()
    db.table("canvas_assignments").delete().eq("user_id", user_id).execute()
    db.table("canvas_courses").delete().eq("user_id", user_id).execute()


def _auto_disconnect(db, user_id: str) -> None:
    _delete_canvas_data(db, user_id)
    db.table("canvas_connections").update({"status": "needs_reconnect"}).eq("user_id", user_id).execute()


def _course_row(user_id: str, course: dict, school_id: Optional[str]) -> dict:
    term = course.get("term") or {}
    return {
        "user_id": user_id,
        "canvas_course_id": int(course["id"]),
        "name": str(course.get("name") or "")[:300],
        "course_code": str(course.get("course_code") or "")[:100],
        "term": clean_term(term.get("name") if isinstance(term, dict) else "", _parse_time(term.get("start_at")) if isinstance(term, dict) else None),
        "school_id": school_id,
    }


def _import_course(db, user_id: str, client: CanvasClient, row: dict, school: dict) -> None:
    course_id = row["canvas_course_id"]
    detail = client.course(course_id)
    modules = client.modules(course_id)
    titles = []
    for module in modules or []:
        titles.append(str(module.get("name") or ""))
        titles.extend(str(item.get("title") or "") for item in (module.get("items") or [])[:20])
    summary = topic_summary(str(detail.get("syllabus_body") or ""), titles)
    class_row = ensure_class(db, school["id"], row["course_code"] or row["name"], row["name"])
    update = {"topic_summary": summary, "imported": True}
    if class_row:
        add_membership(db, user_id, class_row, row["term"], "canvas")
        update["class_id"] = class_row["id"]
    db.table("canvas_courses").update(update).eq("user_id", user_id).eq("canvas_course_id", course_id).execute()
    assignments = client.assignments(course_id)
    db.table("canvas_assignments").delete().eq("user_id", user_id).eq("canvas_course_id", course_id).execute()
    rows = [{
        "user_id": user_id, "canvas_assignment_id": int(item["id"]), "canvas_course_id": course_id,
        "title": str(item.get("name") or "")[:300], "due_at": item.get("due_at"),
    } for item in assignments or [] if item.get("id")]
    if rows:
        db.table("canvas_assignments").upsert(rows, on_conflict="user_id,canvas_assignment_id").execute()


def sync(db, user_id: str, *, client: Optional[CanvasClient] = None) -> None:
    """Refresh courses and imported classes. Raises CanvasUnauthorized after disconnecting."""
    connection = _connection(db, user_id)
    if not connection or connection.get("status") != "connected":
        return
    client = client or _client(db, user_id, connection)
    try:
        school = ensure_school(db, (_policy_for(db, client.host) or {}).get("school_name") or school_name_from_domain(client.host), client.host)
        existing = {row["canvas_course_id"]: row for row in db.table("canvas_courses").select("*").eq("user_id", user_id).execute().data or []}
        for course in client.courses() or []:
            if not course.get("id") or course.get("access_restricted_by_date"):
                continue
            row = _course_row(user_id, course, school["id"])
            row["imported"] = bool(existing.get(row["canvas_course_id"], {}).get("imported"))
            db.table("canvas_courses").upsert(row, on_conflict="user_id,canvas_course_id").execute()
            if row["imported"]:
                _import_course(db, user_id, client, row, school)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise
    cutoff = (_now() - timedelta(days=ACTIVITY_DAYS)).isoformat()
    db.table("canvas_activity").delete().eq("user_id", user_id).lt("created_at", cutoff).execute()
    db.table("canvas_connections").update({"last_synced_at": _now().isoformat()}).eq("user_id", user_id).execute()


def _status(db, user_id: str) -> dict:
    connection = _connection(db, user_id)
    if not connection:
        return {"connected": False, "status": "none"}
    token = (db.table("canvas_tokens").select("last4,expires_at").eq("user_id", user_id).limit(1).execute().data or [None])[0]
    courses = db.table("canvas_courses").select("canvas_course_id,name,course_code,term,imported,class_id").eq("user_id", user_id).execute().data or []
    expires = token.get("expires_at") if token else None
    days = (date.fromisoformat(str(expires)[:10]) - date.today()).days if expires else None
    host = connection["canvas_domain"]
    return {
        "connected": connection.get("status") == "connected" and bool(token),
        "status": connection.get("status"),
        "domain": host,
        "settings_url": f"https://{host}/profile/settings",
        "last4": token.get("last4") if token else None,
        "expires_at": expires,
        "expires_in_days": days,
        "remind": days is not None and 0 <= days <= REMIND_DAYS,
        "sync_paused": bool(connection.get("sync_paused")),
        "last_synced_at": connection.get("last_synced_at"),
        "courses": [{
            "id": row["canvas_course_id"], "name": row["name"], "code": row["course_code"],
            "term": row["term"], "imported": bool(row.get("imported")), "class_id": row.get("class_id"),
        } for row in sorted(courses, key=lambda r: r.get("name") or "")],
    }


def _sync_in_background(user_id: str) -> None:
    db = get_supabase()
    try:
        sync(db, user_id)
    except CanvasUnauthorized:
        logger.info("Canvas token rejected; connection removed")
    except (CanvasError, HTTPException) as exc:
        logger.info(f"Canvas sync skipped: {type(exc).__name__}")


def _sync_due(connection: dict) -> bool:
    last = _parse_time(connection.get("last_synced_at"))
    return not connection.get("sync_paused") and connection.get("status") == "connected" and (not last or _now() - last >= SYNC_EVERY)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/policy")
def school_policy(domain: str = "", school: str = ""):
    """Whether a school allows student tokens. Public: it holds no user data."""
    db = get_supabase()
    rows = _policy_rows(db)
    match = None
    if domain:
        try:
            host = canvas_client.normalize_domain(domain)
        except CanvasForbiddenRequest:
            host = ""
        match = next((row for row in rows if row["domain"] == host), None)
    if not match and school.strip():
        needle = school.strip().lower()
        match = next((row for row in rows if row.get("school_name") and (needle in row["school_name"].lower() or row["school_name"].lower() in needle)), None)
    return {
        "tokens_allowed": bool(match["tokens_allowed"]) if match else True,
        "domain": match["domain"] if match else None,
        "school_name": match.get("school_name") if match else None,
        "source_url": match.get("source_url") if match else None,
    }


@router.get("/status")
def canvas_status(background: BackgroundTasks, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _connection(db, user_id)
    if connection and _sync_due(connection) and connection.get("last_synced_at"):
        background.add_task(_sync_in_background, user_id)
    return _status(db, user_id)


@router.post("/connect")
def connect(body: ConnectRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if not body.acknowledged:
        raise HTTPException(status_code=400, detail="Check \"I understand\" to continue.")
    token = body.token.strip()
    if re.search(r"\s", token) or not re.fullmatch(r"[A-Za-z0-9~._-]{20,300}", token):
        raise HTTPException(status_code=400, detail="That doesn't look like a Canvas token.")
    db = get_supabase()
    try:
        host = canvas_client.normalize_domain(body.canvas_url)
        policy = _policy_for(db, host)
        if policy and not policy.get("tokens_allowed"):
            raise HTTPException(status_code=403, detail=NOT_ALLOWED)
        client = CanvasClient(host, token, policy_domains=[row["domain"] for row in _policy_rows(db)], log=_logger_for(db, user_id))
        me = client.me()
    except CanvasUnauthorized:
        raise HTTPException(status_code=400, detail="Canvas didn't accept that token.")
    except CanvasForbiddenRequest as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except CanvasError:
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    if not isinstance(me, dict) or not me.get("id"):
        raise HTTPException(status_code=400, detail="Canvas didn't accept that token.")

    try:
        ciphertext, iv = canvas_client.encrypt_token(token, user_id)
    except CanvasError:
        raise HTTPException(status_code=503, detail="Canvas connections are not available yet.")
    db.table("canvas_tokens").upsert({
        "user_id": user_id, "ciphertext": canvas_client.to_bytea(ciphertext), "iv": canvas_client.to_bytea(iv),
        "last4": token[-4:], "expires_at": body.expires_at.isoformat() if body.expires_at else None,
    }, on_conflict="user_id").execute()
    del token
    school = ensure_school(db, (policy or {}).get("school_name") or school_name_from_domain(host), host)
    db.table("canvas_connections").upsert({
        "user_id": user_id, "canvas_domain": host, "school_id": school["id"], "status": "connected", "sync_paused": False,
    }, on_conflict="user_id").execute()
    try:
        sync(db, user_id, client=client)
    except CanvasUnauthorized:
        raise HTTPException(status_code=400, detail="Canvas didn't accept that token.")
    except CanvasError:
        pass
    return _status(db, user_id)


@router.put("/courses/{course_id}")
def set_import(course_id: int, body: ImportRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _connection(db, user_id)
    row = (db.table("canvas_courses").select("*").eq("user_id", user_id).eq("canvas_course_id", course_id).limit(1).execute().data or [None])[0]
    if not connection or not row:
        raise HTTPException(status_code=404, detail="Class not found")
    if not body.imported:
        db.table("canvas_courses").update({"imported": False, "topic_summary": ""}).eq("user_id", user_id).eq("canvas_course_id", course_id).execute()
        db.table("canvas_assignments").delete().eq("user_id", user_id).eq("canvas_course_id", course_id).execute()
        return _status(db, user_id)
    try:
        client = _client(db, user_id, connection)
        school = {"id": connection.get("school_id")} if connection.get("school_id") else ensure_school(db, school_name_from_domain(client.host), client.host)
        _import_course(db, user_id, client, row, school)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasError:
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    return _status(db, user_id)


@router.post("/sync")
def sync_now(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _connection(db, user_id)
    if not connection or connection.get("status") != "connected":
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    last = _parse_time(connection.get("last_synced_at"))
    if last and _now() - last < SYNC_NOW_FLOOR:
        return _status(db, user_id)
    try:
        sync(db, user_id)
    except CanvasUnauthorized:
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasError:
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    return _status(db, user_id)


@router.put("/pause")
def pause(body: PauseRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("canvas_connections").update({"sync_paused": body.paused}).eq("user_id", user_id).execute()
    return _status(db, user_id)


@router.delete("")
def disconnect(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _connection(db, user_id)
    _delete_canvas_data(db, user_id)
    db.table("canvas_connections").delete().eq("user_id", user_id).execute()
    host = connection["canvas_domain"] if connection else None
    return {"connected": False, "status": "none", "settings_url": f"https://{host}/profile/settings" if host else None}


@router.get("/activity")
def activity(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    since = (_now() - timedelta(days=ACTIVITY_DAYS)).isoformat()
    rows = db.table("canvas_activity").select("endpoint,status,created_at").eq("user_id", user_id).gte("created_at", since) \
        .order("created_at", desc=True).limit(200).execute().data or []
    return {"activity": rows}


def _imported_course(db, user_id: str, course_id: int) -> dict:
    connection = _connection(db, user_id)
    row = (db.table("canvas_courses").select("canvas_course_id,imported").eq("user_id", user_id).eq("canvas_course_id", course_id).limit(1).execute().data or [None])[0]
    if not connection or not row or not row.get("imported"):
        raise HTTPException(status_code=404, detail="Class not found")
    return connection


@router.get("/courses/{course_id}/files")
def list_files(course_id: int, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _imported_course(db, user_id, course_id)
    try:
        files = _client(db, user_id, connection).files(course_id)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasError:
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    return {"files": [{"id": f.get("id"), "name": f.get("display_name"), "size": f.get("size"), "type": f.get("content-type")} for f in files or []]}


@router.get("/courses/{course_id}/files/{file_id}")
def download_file(course_id: int, file_id: int, authorization: str = Header(default="")):
    """The one file the student picked; the browser feeds it into the normal upload flow."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _imported_course(db, user_id, course_id)
    try:
        name, body = _client(db, user_id, connection).download_file(course_id, file_id)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasForbiddenRequest:
        raise HTTPException(status_code=400, detail="Canvas served this file from another host.")
    except CanvasError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    safe = re.sub(r"[^\w.\- ]", "_", name)[:150] or "canvas-file"
    return Response(content=body, media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{safe}"'})
