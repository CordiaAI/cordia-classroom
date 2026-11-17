"""Saved Tutor chats (redesign T5): every Tutor conversation is a chat with an id, a title, an
optional class, and a delete the student can undo. Served by routers/chats.py (/chats).

Storage. No new table. public.tutor_chats already holds the student's saved chats; migration
20261130120000_saved_chats.sql (NOT APPLIED until the owner runs it) adds class_id, renamed, live
and deleted_at to it. public.tutor_sessions is unchanged: it is still the one live conversation the
web app shares, and the Chrome extension never touches it (it sends its own history to POST /chat).
  * The live chat is the tutor_chats row with live = true (one per student). While it is live its
    messages are read from tutor_sessions; the row takes a copy when the conversation moves on.
  * Every other chat is a row with live = false; deleted ones have deleted_at set.
  * A conversation that began before this existed (messages in tutor_sessions, no live row) gets
    its live row the first time it is listed or opened, so it has a stable id and is listed once.

Before the migration runs, each function detects the missing column the way learning_events does
(the error names the column) and falls back: the list is the saved chats plus the live conversation
(id = the Tutor session's id), titles come from the first message, and rename, move, delete and
undo raise NotAvailable, which the router answers with a 503 body the UI can recognise.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from database import get_supabase
from services import tutor_sessions as sessions
from services.tutor_sessions import _chat_title, _run_is_stale

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 30
MAX_LIMIT = 100
LEGACY_FETCH = 200
DELETED_KEEP_DAYS = 30
SUMMARY = "id,guide_id,class_id,title,renamed,live,created_at,updated_at"
LEGACY_SUMMARY = "id,guide_id,title,created_at,updated_at"
NOT_AVAILABLE = {"detail": "Saved chats aren't set up yet.", "code": "chats_not_available"}


class NotAvailable(Exception):
    """The saved-chats migration has not run: rename, move, delete and undo cannot be done yet."""


def _db():
    return get_supabase()


def _chats():
    return _db().table("tutor_chats")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


is_missing_schema = sessions.is_missing_saved_chats_schema


def _when(value) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


# Reading ------------------------------------------------------------------------------------------
def _session(user_id: str):
    rows = (
        _db().table("tutor_sessions")
        .select("id,messages,active_guide_id,conversation_version,status,run_started_at,created_at,updated_at")
        .eq("user_id", user_id).limit(1).execute().data
    )
    return rows[0] if rows else None


def _guide_classes(user_id: str, guide_ids) -> dict:
    """{guide_id: class_id} for the student's guides that sit in a class."""
    ids = sorted({g for g in guide_ids if g})
    if not ids:
        return {}
    try:
        rows = _db().table("study_guides").select("id,folder_id").eq("user_id", user_id).in_("id", ids).execute().data or []
    except Exception:
        logger.warning("Saved chats: guide classes unavailable", exc_info=True)
        return {}
    return {row["id"]: row["folder_id"] for row in rows if row.get("folder_id")}


def _guide_class(user_id: str, guide_id):
    return _guide_classes(user_id, [guide_id]).get(guide_id) if guide_id else None


def _virtual(user_id: str, session: dict) -> dict:
    """The live conversation as a chat when it has no row: before the migration, id = the session's."""
    return {
        "id": session["id"], "guide_id": session.get("active_guide_id"),
        "class_id": _guide_class(user_id, session.get("active_guide_id")), "title": "", "renamed": False, "live": True,
        "messages": session.get("messages") or [], "created_at": session.get("updated_at") or session.get("created_at"),
        "updated_at": session.get("updated_at") or session.get("created_at"), "_virtual": True,
    }


def _live_row(user_id: str, session):
    """The live chat's row. A conversation with no row yet (it began before saved chats) gets one.
    Raises the database error when the migration has not run."""
    found = _chats().select("*").eq("user_id", user_id).eq("live", True).limit(1).execute().data
    if found:
        return found[0]
    if not session or not (session.get("messages") or []):
        return None
    stamp = session.get("updated_at") or _now()
    guide_id = session.get("active_guide_id")
    try:
        made = _chats().insert({
            "user_id": user_id, "guide_id": guide_id, "class_id": _guide_class(user_id, guide_id), "title": "",
            "messages": [], "live": True, "created_at": stamp, "updated_at": stamp,
        }).execute().data
    except Exception as error:
        if is_missing_schema(error):
            raise
        found = _chats().select("*").eq("user_id", user_id).eq("live", True).limit(1).execute().data  # made by a parallel request
        if not found:
            raise
        return found[0]
    return made[0]


def _title(row: dict, messages) -> str:
    """The student's title, else the saved title, else the first message."""
    if row.get("title") and (row.get("renamed") or not row.get("live")):
        return row["title"]
    return _chat_title(messages or [])


def _summary(row: dict, session=None) -> dict:
    """A chat as the list and the chat page show it. The live chat's messages and last activity are the Tutor session's."""
    live = bool(row.get("live")) and session is not None
    messages = session.get("messages") if live else row.get("messages")
    return {
        "id": row["id"],
        "title": _title(row, messages),
        "guide_id": row.get("guide_id"),
        "class_id": row.get("class_id"),
        "live": bool(row.get("live")),
        "created_at": row.get("created_at"),
        "updated_at": (session.get("updated_at") if live else None) or row.get("updated_at"),
    }


def _fill_titles(user_id: str, rows: list) -> None:
    """A saved chat with no title takes it from its first message."""
    missing = [row["id"] for row in rows if not row.get("title")]
    if not missing:
        return
    found = _chats().select("id,messages").eq("user_id", user_id).in_("id", missing).execute().data or []
    first = {row["id"]: _chat_title(row.get("messages") or []) for row in found}
    for row in rows:
        if not row.get("title"):
            row["title"] = first.get(row["id"], "Tutor chat")


def _legacy_rows(user_id: str) -> list:
    try:
        rows = (
            _chats().select(LEGACY_SUMMARY).eq("user_id", user_id)
            .order("updated_at", desc=True).limit(LEGACY_FETCH).execute().data or []
        )
    except Exception as error:
        if not is_missing_schema(error):
            raise
        return []
    classes = _guide_classes(user_id, [row.get("guide_id") for row in rows])
    for row in rows:
        row["class_id"], row["live"], row["renamed"] = classes.get(row.get("guide_id")), False, False
    return rows


def list_chats(user_id: str, limit: int = DEFAULT_LIMIT, class_id=None) -> dict:
    """The student's chats, newest first: {"chats": [...], "editable": bool}. editable is false until
    the migration runs (the chats can be read and opened, not renamed, moved or deleted)."""
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    session = _session(user_id)
    has_messages = bool(session and (session.get("messages") or []))
    try:
        live = _live_row(user_id, session)
        query = _chats().select(SUMMARY).eq("user_id", user_id).neq("live", True).is_("deleted_at", "null")
        if class_id:
            query = query.eq("class_id", class_id)
        rows = query.order("updated_at", desc=True).limit(limit).execute().data or []
        editable = True
    except Exception as error:
        if not is_missing_schema(error):
            raise
        rows, live, editable = _legacy_rows(user_id), None, False
        if has_messages:
            live = _virtual(user_id, session)
    _fill_titles(user_id, rows)
    chats = [_summary(row) for row in rows]
    if live and has_messages:
        chats.append(_summary(live, session))
    if class_id:
        chats = [chat for chat in chats if chat["class_id"] == class_id]
    chats.sort(key=lambda chat: _when(chat["updated_at"]), reverse=True)
    return {"chats": chats[:limit], "editable": editable}


def _resolve(user_id: str, chat_id: str, include_deleted: bool = False):
    """(row, session, editable) for one of the student's chats; row is None when it is not theirs, not
    there, or deleted. The Tutor session's own id also finds the live conversation."""
    session = _session(user_id)
    try:
        found = _chats().select("*").eq("id", chat_id).eq("user_id", user_id).limit(1).execute().data
    except Exception as error:
        if not is_missing_schema(error):
            raise
        found = []
    row = found[0] if found else None
    if row is not None:
        if row.get("deleted_at") and not include_deleted:
            return None, session, True
        return row, session, "live" in row
    if session and session["id"] == chat_id:
        try:
            live = _live_row(user_id, session)
        except Exception as error:
            if not is_missing_schema(error):
                raise
            return _virtual(user_id, session), session, False
        return (live, session, True) if live else (_virtual(user_id, session), session, True)
    return None, session, False


def get_chat(user_id: str, chat_id: str) -> dict:
    """One chat with its messages: {"chat": {..., "messages": [...]}, "editable": bool}. The live
    chat also carries session_id and conversation_version, what POST /chat needs to continue it."""
    row, session, editable = _resolve(user_id, chat_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    chat = _summary(row, session)
    if row.get("live") and session:
        chat.update({"messages": session.get("messages") or [], "session_id": session["id"],
                     "conversation_version": session.get("conversation_version") or 0})
    else:
        chat["messages"] = row.get("messages") or []
    return {"chat": chat, "editable": editable}


# Changing ------------------------------------------------------------------------------------------
def edit_chat(user_id: str, chat_id: str, changes: dict) -> dict:
    """Rename and/or move one chat: changes has "title" and/or "class_id" (None moves it out of its class)."""
    row, session, _ = _resolve(user_id, chat_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    if row.get("_virtual") or "deleted_at" not in row:
        raise NotAvailable
    payload = {}
    if "title" in changes:
        payload.update({"title": changes["title"], "renamed": True})
    if "class_id" in changes:
        if changes["class_id"] and not (
            _db().table("folders").select("id").eq("id", changes["class_id"]).eq("user_id", user_id).limit(1).execute().data
        ):
            raise HTTPException(status_code=404, detail="Class not found")
        payload["class_id"] = changes["class_id"]
    try:
        done = _chats().update(payload).eq("id", row["id"]).eq("user_id", user_id).is_("deleted_at", "null").execute().data
    except Exception as error:
        if is_missing_schema(error):
            raise NotAvailable from error
        raise
    if not done:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    return {"chat": _summary(done[0], session), "editable": True}


def _archive_fields(row: dict, session: dict) -> dict:
    """What the live chat's row keeps when its conversation moves on: a copy of the messages, the
    title (the first message unless the student renamed it) and the last activity."""
    messages = list(session.get("messages") or [])
    return {
        "live": False, "messages": messages, "updated_at": session.get("updated_at") or _now(),
        "title": row["title"] if row.get("renamed") and row.get("title") else _chat_title(messages),
    }


def _busy(session: dict) -> bool:
    return session.get("status") in {"running", "waiting_browser"} and not _run_is_stale(session)


def _reset_session(user_id: str, session: dict, messages: list, guide_id, stamp: str):
    version = session.get("conversation_version") or 0
    return (
        _db().table("tutor_sessions")
        .update({
            "messages": messages, "active_guide_id": guide_id, "current_goal": "", "status": "idle", "run_id": None,
            "run_started_at": None, "conversation_version": version + 1, "updated_at": stamp,
        })
        .eq("id", session["id"]).eq("user_id", user_id).eq("conversation_version", version).execute().data
    )


def delete_chat(user_id: str, chat_id: str) -> dict:
    """Delete one chat the student can still bring back (restore_chat). Deleting the live chat also
    clears the Tutor's current conversation."""
    row, session, _ = _resolve(user_id, chat_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    if row.get("_virtual") or "deleted_at" not in row:
        raise NotAvailable
    changes = {"deleted_at": _now()}
    live = bool(row.get("live"))
    if live:
        if _busy(session):
            raise HTTPException(status_code=409, detail="Wait for Cordia Tutor to finish before deleting this chat")
        changes.update(_archive_fields(row, session))
    try:
        done = _chats().update(changes).eq("id", row["id"]).eq("user_id", user_id).is_("deleted_at", "null").execute().data
    except Exception as error:
        if is_missing_schema(error):
            raise NotAvailable from error
        raise
    if not done:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    if live and not _reset_session(user_id, session, [], None, _now()):
        _chats().update({"deleted_at": None, "live": True}).eq("id", row["id"]).eq("user_id", user_id).execute()
        raise HTTPException(status_code=409, detail="Tutor conversation changed. Refresh and try again.")
    return {"chat": {**_summary(done[0]), "deleted_at": changes["deleted_at"]}, "editable": True}


def restore_chat(user_id: str, chat_id: str) -> dict:
    """Undo a delete. The chat comes back as a saved chat (open it to continue it)."""
    row, session, _ = _resolve(user_id, chat_id, include_deleted=True)
    if row is None:
        raise HTTPException(status_code=404, detail="That chat is already gone.")
    if row.get("_virtual") or "deleted_at" not in row:
        raise NotAvailable
    if row.get("deleted_at"):
        try:
            restored = _chats().update({"deleted_at": None}).eq("id", row["id"]).eq("user_id", user_id).execute().data
        except Exception as error:
            if is_missing_schema(error):
                raise NotAvailable from error
            raise
        if not restored:
            raise HTTPException(status_code=404, detail="That chat is already gone.")
        row = restored[0]
    return {"chat": _summary(row, session), "editable": True}


# Starting and opening ------------------------------------------------------------------------------
def start_chat(user_id: str, session_id=None, guide_id=None, class_id=None, resume_id=None):
    """Start a new chat (about a guide, in a class, or general), or open a saved one, as the Tutor's
    current conversation. The conversation it replaces is saved as a chat. Returns
    (chat summary, the Tutor session row); the chat's id is the one for the URL, so navigate to it."""
    session = sessions.get_or_create_tutor_session(user_id)
    if session_id and session_id != session["id"]:
        raise HTTPException(status_code=404, detail="Tutor session not found")
    if _busy(session):
        raise HTTPException(status_code=409, detail="Wait for Cordia Tutor to finish before starting a new chat")
    if guide_id and not _db().table("study_guides").select("id").eq("id", guide_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Guide not found")
    if class_id and not _db().table("folders").select("id").eq("id", class_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Class not found")
    try:
        live = _live_row(user_id, session)
    except Exception as error:
        if not is_missing_schema(error):
            raise
        row = sessions.start_tutor_chat(user_id, session["id"], guide_id, resume_id)
        return _summary(_virtual(user_id, row), row), row

    resumed = None
    if resume_id:
        resumed, _, _ = _resolve(user_id, resume_id)
        if resumed is None or resumed.get("_virtual"):
            raise HTTPException(status_code=404, detail="Chat not found")
        if resumed.get("live"):
            return _summary(resumed, session), session  # already the current conversation

    current = list(session.get("messages") or [])
    if current:
        if not live:  # _live_row gives every conversation with messages a row, so this is a race
            raise HTTPException(status_code=409, detail="Tutor conversation changed. Refresh and try again.")
        _chats().update(_archive_fields(live, session)).eq("id", live["id"]).eq("user_id", user_id).execute()
    reuse = live if (live and not current and not resumed) else None
    if live and not current and resumed:
        _chats().delete().eq("id", live["id"]).eq("user_id", user_id).execute()  # an empty chat nobody wrote in

    stamp = _now()
    if resumed:
        target = _chats().update({"live": True}).eq("id", resumed["id"]).eq("user_id", user_id).execute().data[0]
        messages, guide, stamp = list(resumed.get("messages") or []), resumed.get("guide_id"), resumed.get("updated_at") or stamp
    else:
        messages, guide = [], guide_id
        fields = {"guide_id": guide_id, "class_id": class_id or _guide_class(user_id, guide_id)}
        if reuse:
            target = _chats().update(fields).eq("id", reuse["id"]).eq("user_id", user_id).execute().data[0]
        else:
            target = _chats().insert({"user_id": user_id, **fields, "title": "", "messages": [], "live": True,
                                      "created_at": stamp, "updated_at": stamp}).execute().data[0]

    updated = _reset_session(user_id, session, messages, guide, stamp)
    if not updated:
        # Someone else moved the conversation on first: put everything back as it was.
        if resumed:
            _chats().update({"live": False}).eq("id", resumed["id"]).eq("user_id", user_id).execute()
        elif not reuse:
            _chats().delete().eq("id", target["id"]).eq("user_id", user_id).execute()
        if current:
            _chats().update({"live": True}).eq("id", live["id"]).eq("user_id", user_id).execute()
        raise HTTPException(status_code=409, detail="Tutor conversation changed. Refresh and try again.")
    _purge_deleted(user_id)
    return _summary({**target, "live": True}, updated[0]), updated[0]


def _purge_deleted(user_id: str) -> None:
    """Deleted chats stay for DELETED_KEEP_DAYS (so Undo still works), then go for good."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DELETED_KEEP_DAYS)).isoformat()
    try:
        _chats().delete().eq("user_id", user_id).lt("deleted_at", cutoff).execute()
    except Exception:
        logger.warning("Saved chats: purge failed", exc_info=True)
