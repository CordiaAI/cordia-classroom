"""Canvas access-token connection. Every Canvas call goes through services.canvas_client."""
from __future__ import annotations

import logging
import time
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from services import canvas_client
from services.canvas_client import CanvasClient, CanvasDenied, CanvasError, CanvasForbiddenRequest, CanvasUnauthorized
from services.class_catalog import clean_term, school_name_from_domain, topic_summary
from services.class_db import add_membership, ensure_class, ensure_school
from services import file_extraction, library_import, mail_watch, sync_state
from services.grades import canvas_scale, estimate
from services.llm import read_announcement
from services.text_processing import html_to_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/canvas", tags=["canvas"])

SYNC_EVERY = timedelta(minutes=20)
FILES_EVERY = timedelta(hours=6)    # Module files and pages change rarely; they're read less often.
IMPORT_PER_RUN = 10                 # New files imported per class per run; the rest come next time.
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
    try:
        modules = client.modules(course_id)
    except CanvasDenied:
        modules = []  # Modules hidden from students: summarise from the syllabus alone.
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
    assignments = [item for item in client.assignments(course_id) or [] if item.get("id")]
    rows = [_assignment_row(user_id, course_id, item) for item in assignments]
    # Updated in place, not replaced, so first_seen_at keeps the day Cordia first saw each one.
    if rows:
        db.table("canvas_assignments").upsert(rows, on_conflict="user_id,canvas_assignment_id").execute()
    current = {row["canvas_assignment_id"] for row in rows}
    stale = [row["canvas_assignment_id"] for row in db.table("canvas_assignments").select("canvas_assignment_id")
             .eq("user_id", user_id).eq("canvas_course_id", course_id).execute().data or [] if row["canvas_assignment_id"] not in current]
    if stale:
        db.table("canvas_assignments").delete().eq("user_id", user_id).in_("canvas_assignment_id", stale).execute()
    _check_grade(db, user_id, client, row)


EXAM = re.compile(r"\b(exam|midterm|final|test)\b", re.I)


def _rubric(item: dict) -> Optional[list]:
    criteria = [{
        "description": str(c.get("description") or "")[:300],
        "long_description": str(c.get("long_description") or "")[:1000],
        "points": c.get("points"),
        "ratings": [{"description": str(r.get("description") or "")[:200], "points": r.get("points")} for r in (c.get("ratings") or [])[:8]],
    } for c in (item.get("rubric") or [])[:30] if isinstance(c, dict)]
    return criteria or None


def _assignment_row(user_id: str, course_id: int, item: dict) -> dict:
    sub = item.get("submission") or {}
    title = str(item.get("name") or "")[:300]
    return {
        "user_id": user_id, "canvas_assignment_id": int(item["id"]), "canvas_course_id": course_id,
        "title": title, "due_at": item.get("due_at"), "submitted": _submitted(item),
        "points_possible": item.get("points_possible"),
        "submission_types": [str(t)[:40] for t in item.get("submission_types") or []][:10],
        "description": html_to_text(str(item.get("description") or ""))[:20000] or None,
        "rubric": _rubric(item),
        "html_url": str(item.get("html_url") or "")[:1000] or None,
        "missing": bool(sub.get("missing")),
        "score": sub.get("score"),
        "is_exam": bool(EXAM.search(title)) or bool(item.get("is_quiz_assignment") and EXAM.search(title)),
        "canvas_updated_at": item.get("updated_at"),
    }


def _check_grade(db, user_id: str, client: CanvasClient, row: dict) -> None:
    """Saves the class's current grade; a drop of 2+ points since the last check goes on the alerts list."""
    try:
        enrollments = client.my_enrollments(row["canvas_course_id"])
    except CanvasError:
        return
    grades = next((e.get("grades") for e in enrollments or [] if e.get("type") == "StudentEnrollment" and e.get("grades")), None) or {}
    score = grades.get("current_score")
    if not isinstance(score, (int, float)):
        return
    before = (db.table("canvas_courses").select("current_score").eq("user_id", user_id)
              .eq("canvas_course_id", row["canvas_course_id"]).limit(1).execute().data or [{}])[0].get("current_score")
    db.table("canvas_courses").update({
        "current_score": score, "current_grade": str(grades.get("current_grade") or "")[:10] or None, "grade_checked_at": _now().isoformat(),
    }).eq("user_id", user_id).eq("canvas_course_id", row["canvas_course_id"]).execute()
    if isinstance(before, (int, float)) and before - score >= 2:
        sync_state.add_alert(user_id, "canvas", {
            "kind": "grade_drop", "course_id": row["canvas_course_id"], "course": row.get("name") or "",
            "from": round(float(before), 1), "to": round(float(score), 1), "at": _now().isoformat(),
        })


def auto_import_courses(user_id: str) -> set[int]:
    return {int(c) for c in (sync_state.get(user_id, "canvas").get("stats") or {}).get("auto_import") or []}


def _sync_modules(db, user_id: str, client: CanvasClient, courses: dict, *, force: bool = False) -> int:
    """Every 6 hours: module files and pages of classes set to auto-import go into the class's
    Library folder, and a module the student finished gets a "make a review set" alert once."""
    stats = sync_state.get(user_id, "canvas").get("stats") or {}
    last = _parse_time(stats.get("files_checked_at"))
    if not courses or (not force and last and _now() - last < FILES_EVERY):
        return 0
    auto = auto_import_courses(user_id)
    done_before = set(stats.get("modules_done") or [])
    done_now, imported = set(done_before), 0
    known = library_import.existing_refs(user_id, "canvas:") if auto & set(courses) else set()
    # Pages imported as just their link text get another go now that linked files are read.
    thin = library_import.thin_refs(user_id, "canvas:page:") if auto & set(courses) else set()
    for course_id, row in courses.items():
        try:
            modules = client.modules(course_id) or []
        except CanvasError:
            continue
        for module in modules:
            key = f"{course_id}:{module.get('id')}"
            if module.get("state") == "completed" and key not in done_before:
                done_now.add(key)
                sync_state.add_alert(user_id, "canvas", {
                    "kind": "module_done", "course_id": course_id, "course": row.get("name") or "",
                    "module": str(module.get("name") or "")[:200], "at": _now().isoformat(),
                })
        if course_id not in auto:
            continue
        class_id = (db.table("canvas_courses").select("class_id").eq("user_id", user_id)
                    .eq("canvas_course_id", course_id).limit(1).execute().data or [{}])[0].get("class_id")
        folder_id = library_import.class_folder(user_id, class_id)
        count = 0
        for module in modules:
            for item in module.get("items") or []:
                if count >= IMPORT_PER_RUN:
                    break
                ref = _item_ref(course_id, item)
                if not ref or (ref in known and ref not in thin):
                    continue
                again = ref in known
                text, files_read = _item_text(client, course_id, item)
                known.add(ref)
                thin.discard(ref)
                # A file a page already brought in isn't imported again as its own guide.
                known.update(files_read)
                if text and library_import.upsert_source(
                        user_id, ref=ref, connector="canvas", title=str(item.get("title") or "Canvas material"), text=text,
                        folder_id=folder_id, source_type="canvas_module",
                        source_title=f"{row.get('name') or 'Canvas'} · {module.get('name') or 'Module'}", source_url=item.get("html_url")) and not again:
                    count += 1
        imported += count
    sync_state.update_stats(user_id, "canvas", {"files_checked_at": _now().isoformat(), "modules_done": sorted(done_now)[-200:],
                                                "imported_files": int(stats.get("imported_files") or 0) + imported})
    return imported


def _item_ref(course_id: int, item: dict) -> Optional[str]:
    if item.get("type") == "File" and item.get("content_id"):
        return f"canvas:file:{int(item['content_id'])}"
    if item.get("type") == "Page" and item.get("page_url"):
        return f"canvas:page:{course_id}:{item['page_url']}"[:300]
    return None


# A Page is often only a link to the slides or reading ("Chapters 18 - 20.pptx"). Its text alone
# would make a guide that says just the file name, so the files it links are read too.
MAX_PAGE_FILES = 3
THIN_PAGE_CHARS = 300


def _page_file_ids(html: str) -> list[int]:
    ids: list[int] = []
    for match in canvas_client._FILE_ID.finditer(html or ""):
        file_id = int(match.group(1))
        if file_id not in ids:
            ids.append(file_id)
    return ids


def _item_text(client: CanvasClient, course_id: int, item: dict) -> tuple[str, list[str]]:
    """The item's readable text, and the refs of the files read for it."""
    try:
        if item.get("type") == "Page":
            body = str(client.page(course_id, item["page_url"]).get("body") or "")
            page_text = html_to_text(body)
            files, refs = [], []
            for file_id in _page_file_ids(body)[:MAX_PAGE_FILES]:
                try:
                    name, data = client.download_file(course_id, file_id)
                    text = file_extraction.text_from_file(name, data)
                except (CanvasError, HTTPException) as exc:
                    logger.info("canvas page file skipped: %s", type(exc).__name__)
                    continue
                if text.strip():
                    files.append(text)
                    refs.append(f"canvas:file:{file_id}")
            # A page that is little more than its links is replaced by what they link to.
            parts = files if files and len(page_text.strip()) < THIN_PAGE_CHARS else [page_text, *files]
            return "\n\n".join(part for part in parts if part.strip()), refs
        name, body = client.download_file(course_id, int(item["content_id"]))
        return file_extraction.text_from_file(name, body), []
    except (CanvasError, HTTPException) as exc:
        logger.info("canvas module item skipped: %s", type(exc).__name__)
        return "", []


def _sync_announcements(db, user_id: str, client: CanvasClient, courses: dict) -> None:
    """The last two weeks of announcements in imported classes; new ones get a summary and a flag."""
    if not courses:
        return
    since = (_now() - timedelta(days=14)).date().isoformat()
    try:
        found = client.announcements(list(courses), since)
    except CanvasError as exc:
        logger.info("canvas announcements skipped: %s", type(exc).__name__)
        return
    known = {row["canvas_announcement_id"] for row in db.table("canvas_announcements").select("canvas_announcement_id")
             .eq("user_id", user_id).execute().data or []}
    for item in found or []:
        if not item.get("id") or int(item["id"]) in known:
            continue
        course_id = int(str(item.get("context_code") or "course_0").split("_")[-1] or 0)
        message = html_to_text(str(item.get("message") or ""))[:20000]
        title = str(item.get("title") or "")[:500]
        read = {}
        try:
            read = read_announcement(title, (courses.get(course_id) or {}).get("name") or "", message)
        except Exception as exc:
            logger.info("announcement summary failed: %s", type(exc).__name__)
        changes = read.get("changes") if read.get("changes") in ("none", "deadline", "new_work") else "none"
        db.table("canvas_announcements").upsert({
            "user_id": user_id, "canvas_announcement_id": int(item["id"]), "canvas_course_id": course_id,
            "title": title, "message": message, "posted_at": item.get("posted_at"),
            "summary": str(read.get("summary") or "")[:600] or None, "changes": changes,
        }, on_conflict="user_id,canvas_announcement_id").execute()
        if changes == "deadline":
            # Flow 3: a date the announcement moves becomes a change the student confirms.
            mail_watch.propose(user_id, source="canvas_announcement", source_id=str(item["id"]),
                               sender=(courses.get(course_id) or {}).get("name") or "Canvas", subject=title, text=message)


def _submitted(item: dict) -> bool:
    """Canvas counts it as turned in (or already graded)."""
    sub = item.get("submission") or {}
    return bool(sub.get("submitted_at")) or sub.get("workflow_state") in ("submitted", "graded", "pending_review") or bool(sub.get("excused"))


def sync(db, user_id: str, *, client: Optional[CanvasClient] = None) -> None:
    """Refresh courses and imported classes. Raises CanvasUnauthorized after disconnecting."""
    connection = _connection(db, user_id)
    if not connection or connection.get("status") != "connected":
        return
    client = client or _client(db, user_id, connection)
    try:
        school = ensure_school(db, (_policy_for(db, client.host) or {}).get("school_name") or school_name_from_domain(client.host), client.host)
        existing = {row["canvas_course_id"]: row for row in db.table("canvas_courses").select("*").eq("user_id", user_id).execute().data or []}
        imported = {}
        for course in client.courses() or []:
            if not course.get("id") or course.get("access_restricted_by_date"):
                continue
            row = _course_row(user_id, course, school["id"])
            row["imported"] = bool(existing.get(row["canvas_course_id"], {}).get("imported"))
            db.table("canvas_courses").upsert(row, on_conflict="user_id,canvas_course_id").execute()
            if row["imported"]:
                _import_course(db, user_id, client, row, school)
                imported[row["canvas_course_id"]] = row
        _sync_announcements(db, user_id, client, imported)
        _sync_modules(db, user_id, client, imported)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        sync_state.record(user_id, "canvas", error="Canvas stopped accepting your token.", needs_reconnect=True)
        raise
    except CanvasError as exc:
        sync_state.record(user_id, "canvas", error="Canvas couldn't be reached.")
        raise exc
    cutoff = (_now() - timedelta(days=ACTIVITY_DAYS)).isoformat()
    db.table("canvas_activity").delete().eq("user_id", user_id).lt("created_at", cutoff).execute()
    db.table("canvas_connections").update({"last_synced_at": _now().isoformat()}).eq("user_id", user_id).execute()
    sync_state.record(user_id, "canvas", stats=_canvas_counts(db, user_id))


def _canvas_counts(db, user_id: str) -> dict:
    count = lambda table: db.table(table).select("user_id", count="exact").eq("user_id", user_id).limit(1).execute().count or 0  # noqa: E731
    return {"assignments": count("canvas_assignments"), "announcements": count("canvas_announcements")}


def _status(db, user_id: str) -> dict:
    connection = _connection(db, user_id)
    if not connection:
        return {"connected": False, "status": "none"}
    token = (db.table("canvas_tokens").select("last4,expires_at").eq("user_id", user_id).limit(1).execute().data or [None])[0]
    courses = db.table("canvas_courses").select("canvas_course_id,name,course_code,term,imported,class_id").eq("user_id", user_id).execute().data or []
    expires = token.get("expires_at") if token else None
    days = (date.fromisoformat(str(expires)[:10]) - date.today()).days if expires else None
    host = connection["canvas_domain"]
    auto = auto_import_courses(user_id)
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
        "stats": {k: v for k, v in (sync_state.get(user_id, "canvas").get("stats") or {}).items()
                  if isinstance(v, (int, float)) and not isinstance(v, bool)},
        "sync_error": sync_state.get(user_id, "canvas").get("last_error"),
        "courses": [{
            "id": row["canvas_course_id"], "name": row["name"], "code": row["course_code"],
            "term": row["term"], "imported": bool(row.get("imported")), "class_id": row.get("class_id"),
            "auto_import": row["canvas_course_id"] in auto,
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


class AutoImportRequest(BaseModel):
    on: bool


@router.put("/courses/{course_id}/auto-import")
def set_auto_import(course_id: int, body: AutoImportRequest, authorization: str = Header(default="")):
    """Bring this class's module files and pages into its Library folder automatically (or stop)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _imported_course(db, user_id, course_id)
    auto = auto_import_courses(user_id)
    auto = auto | {course_id} if body.on else auto - {course_id}
    sync_state.update_stats(user_id, "canvas", {"auto_import": sorted(auto)})
    imported = 0
    if body.on:
        try:
            row = (db.table("canvas_courses").select("*").eq("user_id", user_id).eq("canvas_course_id", course_id).limit(1).execute().data or [{}])[0]
            imported = _sync_modules(db, user_id, _client(db, user_id, connection), {course_id: row}, force=True)
        except CanvasUnauthorized:
            _auto_disconnect(db, user_id)
            raise HTTPException(status_code=409, detail="Reconnect Canvas")
        except CanvasError:
            pass
    return {"auto_import": sorted(auto), "imported": imported}


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
    started = time.monotonic()
    try:
        client = _client(db, user_id, connection)
        try:
            files = client.files(course_id)
        except CanvasDenied as exc:
            logger.info("canvas files.list denied course=%s (%s); using linked files", course_id, exc)
            files = []
        # Many classes hide or don't use the Files page; their files are linked from Modules,
        # Pages and assignments instead.
        if not files:
            files = client.linked_files(course_id)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasDenied:
        raise HTTPException(status_code=403, detail="This class doesn't share its files with students in Canvas.")
    except CanvasError as exc:
        logger.warning("canvas files.list failed course=%s: %s", course_id, exc)
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    logger.info("canvas files course=%s count=%s seconds=%.1f", course_id, len(files or []), time.monotonic() - started)
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


@router.get("/courses/{course_id}/grades")
def course_grades(course_id: int, authorization: str = Header(default="")):
    """The student's own grade in one class, and what upcoming work would take to move it."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    connection = _imported_course(db, user_id, course_id)
    client = _client(db, user_id, connection)
    try:
        course = client.course(course_id)
        groups = client.assignment_groups(course_id)
        enrollments = client.my_enrollments(course_id)
    except CanvasUnauthorized:
        _auto_disconnect(db, user_id)
        raise HTTPException(status_code=409, detail="Reconnect Canvas")
    except CanvasDenied:
        raise HTTPException(status_code=403, detail="This class doesn't share grades with students in Canvas.")
    except CanvasError as exc:
        logger.warning("canvas grades failed course=%s: %s", course_id, exc)
        raise HTTPException(status_code=502, detail="Canvas could not be reached.")
    grades = next((e.get("grades") for e in enrollments or [] if e.get("type") == "StudentEnrollment" and e.get("grades")), None) or {}
    # The class's own letter scale, when Canvas shares it with students (many classes don't).
    scale = None
    try:
        scale = canvas_scale(client.grading_scheme(course_id, course.get("grading_standard_id")))
    except CanvasDenied:
        pass
    except CanvasError as exc:
        logger.info("canvas grading scheme unavailable course=%s: %s", course_id, exc)
    anchor = grades.get("current_score")
    result = estimate(groups or [], bool(course.get("apply_assignment_group_weights")),
                      anchor=float(anchor) if isinstance(anchor, (int, float)) else None, scale=scale)
    result["scale_source"] = "canvas" if scale else "default"
    # Each upcoming item opens in Canvas; built from the school's host when Canvas leaves the link out.
    host = connection.get("canvas_domain")
    for row in result.get("upcoming") or []:
        link = str(row.pop("html_url", "") or "")
        row["url"] = link if link.startswith(f"https://{host}/") else (f"https://{host}/courses/{course_id}/assignments/{row['id']}" if host else None)
    # Canvas's own number and letter win for display; the what-ifs are anchored to that number.
    result["canvas_score"] = anchor
    result["canvas_letter"] = grades.get("current_grade")
    return result
