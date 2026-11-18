"""Saved Tutor chats (redesign T5): every Tutor conversation is a chat with an id, a title, an
optional class, and a delete the student can undo. Served by routers/chats.py (/chats).

Storage. No new table. public.tutor_chats already holds the student's saved chats; migration
20261130120000_saved_chats.sql (NOT APPLIED until the owner runs it) adds class_id, renamed and
deleted_at to it, and live_chat_id to public.tutor_sessions. tutor_sessions is still the one live
conversation the web app shares; the Chrome extension never touches it (it sends its own history to
POST /chat).
  * The live chat is the one tutor_sessions.live_chat_id names. That column is the single record of
    which chat is live: it is written in the same row update as the conversation it belongs to, so
    no reader can ever see one chat's messages paired with another chat's id. Every reader derives
    "live" from it (a pointer at a deleted or missing chat counts as no live chat).
  * While a chat is live its messages are read from tutor_sessions; its row keeps a copy that is only
    ever a snapshot of what the session already holds.
  * A conversation that began before this existed (messages in tutor_sessions, no chat) gets an empty
    row and the pointer the first time it is listed, opened or moved on, so it has a stable id.

Changing which chat is live (new chat, open, delete the live chat, the old panel's new/resume) follows
one order, so a crash or another tab can at worst leave a duplicate, never a gap:
  1. read the session row (messages, version, pointer, last write time) and the row it points at;
  2. SAVE: copy the messages into that row (messages and last activity only; only while the row is
     not deleted and nobody saved it since it was read, so an older copy never overwrites a newer one);
  3. RESET: one compare-and-set on the session row as read (version, updated_at, status, run_id and
     live_chat_id all unchanged) that puts in the new conversation and the new pointer together;
  4. TIDY: remove an empty chat nobody used, purge old deleted chats. Failures here are only logged.
If the reset changes no row another request won: re-read and decide again (a few times), else 409.

Before the migration runs, each function detects the missing column the way learning_events does
(the error names the column) and falls back: the list is the saved chats plus the live conversation
(id = the Tutor session's id), titles come from the first message, new and open go through the old
tutor_sessions.start_tutor_chat, and rename, move, delete and undo raise NotAvailable, which the router
answers with a 503 body the UI can recognise.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from postgrest.types import CountMethod, ReturnMethod

from database import get_supabase
from services import tutor_sessions as sessions
from services.tutor_sessions import _chat_title, _run_is_stale

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 30
MAX_LIMIT = 100
LEGACY_FETCH = 200
DELETED_KEEP_DAYS = 30
PURGE_BATCH = 100
PURGE_MAX_BATCHES = 100      # per run: 10,000 chats; anything left goes tomorrow
PURGE_HOUR_UTC = 9           # the daily job runs on the first worker pass at or after this hour (UTC)
PURGE_RETRY = timedelta(hours=1)
ATTEMPTS = 3                 # a change of the live chat re-reads and decides again this often before 409
CONFLICT_DETAIL = "Tutor conversation changed. Refresh and try again."
GONE_DETAIL = "That chat is already gone."
BUSY_DETAIL = "Wait for Cordia Tutor to finish before starting a new chat"
SUMMARY = "id,guide_id,class_id,title,renamed,created_at,updated_at"
LEGACY_SUMMARY = "id,guide_id,title,created_at,updated_at"
SESSION = "id,messages,active_guide_id,conversation_version,status,run_id,run_started_at,live_chat_id,created_at,updated_at"
LEGACY_SESSION = "id,messages,active_guide_id,conversation_version,status,run_started_at,created_at,updated_at"
NOT_AVAILABLE = {"detail": "Saved chats aren't set up yet.", "code": "chats_not_available"}


class NotAvailable(Exception):
    """The saved-chats migration has not run: rename, move, delete and undo cannot be done yet."""


def _db():
    return get_supabase()


def _conflict() -> HTTPException:
    return HTTPException(status_code=409, detail=CONFLICT_DETAIL)


def _gone() -> HTTPException:
    return HTTPException(status_code=404, detail=GONE_DETAIL)


def _is_fk(error: Exception) -> bool:
    """The session was pointed at a chat row that no longer exists (removed by the old panel's hard delete)."""
    return str(getattr(error, "code", "") or "") == "23503" or "23503" in str(error) or "violates foreign key" in str(error)


def _chats():
    return _db().table("tutor_chats")


def _sessions():
    return _db().table("tutor_sessions")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


is_missing_schema = sessions.is_missing_saved_chats_schema


def _when(value) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


def _same(query, column: str, value):
    """Filter on a column being exactly `value` (null included)."""
    return query.is_(column, "null") if value is None else query.eq(column, value)


# Reading ------------------------------------------------------------------------------------------
def _session(user_id: str):
    """The Tutor session row with its live-chat pointer. Raises the missing-column error before the migration."""
    rows = _sessions().select(SESSION).eq("user_id", user_id).limit(1).execute().data
    return rows[0] if rows else None


def _legacy_session(user_id: str):
    rows = _sessions().select(LEGACY_SESSION).eq("user_id", user_id).limit(1).execute().data
    return rows[0] if rows else None


def _row(user_id: str, chat_id):
    """One of the student's chat rows, deleted or not; None when it is not there or not theirs."""
    if not chat_id:
        return None
    found = _chats().select("*").eq("id", chat_id).eq("user_id", user_id).limit(1).execute().data
    return found[0] if found else None


def _usable(row) -> bool:
    return bool(row) and not row.get("deleted_at")


def _guide_classes(user_id: str, guide_ids) -> dict:
    """{guide_id: class_id} for the student's own guides that sit in one of the student's own classes.
    A guide row can carry a folder id that is not the student's, so each class is checked against folders."""
    ids = sorted({g for g in guide_ids if g})
    if not ids:
        return {}
    try:
        rows = _db().table("study_guides").select("id,folder_id").eq("user_id", user_id).in_("id", ids).execute().data or []
        in_class = {row["id"]: row["folder_id"] for row in rows if row.get("folder_id")}
        if not in_class:
            return {}
        mine = {
            row["id"] for row in
            _db().table("folders").select("id").eq("user_id", user_id).in_("id", sorted(set(in_class.values()))).execute().data or []
        }
    except Exception:
        logger.warning("Saved chats: guide classes unavailable", exc_info=True)
        return {}
    return {guide: folder for guide, folder in in_class.items() if folder in mine}


def _guide_class(user_id: str, guide_id):
    return _guide_classes(user_id, [guide_id]).get(guide_id) if guide_id else None


def _virtual(user_id: str, session: dict) -> dict:
    """The live conversation as a chat when it has no row: before the migration, id = the session's."""
    return {
        "id": session["id"], "guide_id": session.get("active_guide_id"),
        "class_id": _guide_class(user_id, session.get("active_guide_id")), "title": "", "renamed": False,
        "messages": session.get("messages") or [], "created_at": session.get("updated_at") or session.get("created_at"),
        "updated_at": session.get("updated_at") or session.get("created_at"), "_virtual": True,
    }


def _discard(user_id: str, row) -> None:
    """Remove an empty row this request made and nobody used: only while nobody saved into it (its
    updated_at is still the one it was made with, and only a save changes that) or renamed it."""
    if not row:
        return
    try:
        (_chats().delete().eq("id", row["id"]).eq("user_id", user_id).eq("renamed", False)
         .is_("deleted_at", "null").eq("updated_at", row["updated_at"]).execute())
    except Exception:
        logger.warning("Saved chats: could not remove an unused empty chat", exc_info=True)


def _home(user_id: str, session: dict):
    """Give the session's conversation a chat row when it has none (a conversation from before saved
    chats, or one whose row was deleted or removed in a race): a new empty row, then the pointer set in
    one compare-and-set that only applies while the pointer is still what was read. The messages stay in
    the session (it is live), so nothing is copied and nothing can be lost. Returns (row, session), or
    None when another request gave it a row first (this request's row is removed again)."""
    stamp = _now()
    guide_id = session.get("active_guide_id")
    made = _chats().insert({
        "user_id": user_id, "guide_id": guide_id, "class_id": _guide_class(user_id, guide_id), "title": "",
        "renamed": False, "messages": [], "created_at": session.get("updated_at") or stamp, "updated_at": stamp,
    }).execute().data
    if not made:
        return None
    query = _sessions().update({"live_chat_id": made[0]["id"]}).eq("id", session["id"]).eq("user_id", user_id)
    try:
        done = _same(query, "live_chat_id", session.get("live_chat_id")).execute().data
    except Exception as error:
        if not _is_fk(error):
            raise  # the answer is unknown: the row may be live now, so it stays
        done = []
    if not done:
        _discard(user_id, made[0])
        return None
    return made[0], done[0]


def _live_row(user_id: str, session):
    """(the live chat's row or None, the session). The row is the not-deleted chat the session points at;
    a conversation with messages and no such row gets one (_home). Never creates a second row for a
    conversation that has one. Raises the missing-column error before the migration."""
    for _ in range(2):
        if not session:
            return None, session
        row = _row(user_id, session.get("live_chat_id"))
        if _usable(row):
            return row, session
        if not (session.get("messages") or []):
            return None, session
        homed = _home(user_id, session)
        if homed:
            return homed
        session = _session(user_id)
    return None, session


def _is_live(row: dict, session) -> bool:
    if row.get("_virtual"):
        return True
    return bool(session) and not row.get("deleted_at") and session.get("live_chat_id") == row.get("id")


def _title(row: dict, messages, live: bool) -> str:
    """The student's title, else a saved title, else the first message."""
    if row.get("title") and (row.get("renamed") or not live):
        return row["title"]
    return _chat_title(messages or [])


def _summary(row: dict, session=None) -> dict:
    """A chat as the list and the chat page show it. The live chat's messages and last activity are the Tutor session's."""
    live = _is_live(row, session)
    messages = session.get("messages") if live and session else row.get("messages")
    return {
        "id": row["id"],
        "title": _title(row, messages, live),
        "guide_id": row.get("guide_id"),
        "class_id": row.get("class_id"),
        "live": live,
        "created_at": row.get("created_at"),
        "updated_at": (session.get("updated_at") if live and session else None) or row.get("updated_at"),
    }


def _fill_titles(user_id: str, rows: list) -> list:
    """A saved chat with no title takes it from its first message; an untitled chat with no messages (an
    empty chat a request made and could not use) is not listed."""
    missing = [row["id"] for row in rows if not row.get("title")]
    if not missing:
        return rows
    found = _chats().select("id,messages").eq("user_id", user_id).in_("id", missing).execute().data or []
    said = {row["id"]: row.get("messages") or [] for row in found}
    kept = []
    for row in rows:
        if not row.get("title"):
            if not said.get(row["id"]):
                continue
            row["title"] = _chat_title(said[row["id"]])
        kept.append(row)
    return kept


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
        row["class_id"], row["renamed"] = classes.get(row.get("guide_id")), False
    return rows


def list_chats(user_id: str, limit: int = DEFAULT_LIMIT, class_id=None) -> dict:
    """The student's chats, newest first: {"chats": [...], "editable": bool}. editable is false until
    the migration runs (the chats can be read and opened, not renamed, moved or deleted)."""
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    try:
        session = _session(user_id)
        live, session = _live_row(user_id, session)
        query = _chats().select(SUMMARY).eq("user_id", user_id).is_("deleted_at", "null")
        if session and session.get("live_chat_id"):
            query = query.neq("id", session["live_chat_id"])
        if class_id:
            query = query.eq("class_id", class_id)
        rows = query.order("updated_at", desc=True).limit(limit).execute().data or []
        editable = True
    except Exception as error:
        if not is_missing_schema(error):
            raise
        session = _legacy_session(user_id)
        rows, live, editable = _legacy_rows(user_id), None, False
        if session and (session.get("messages") or []):
            live = _virtual(user_id, session)
    rows = _fill_titles(user_id, rows)
    chats = [_summary(row) for row in rows]
    if live and session and (session.get("messages") or []):
        chats.append(_summary(live, session))
    if class_id:
        chats = [chat for chat in chats if chat["class_id"] == class_id]
    chats.sort(key=lambda chat: _when(chat["updated_at"]), reverse=True)
    return {"chats": chats[:limit], "editable": editable}


def _legacy_resolve(user_id: str, chat_id: str):
    session = _legacy_session(user_id)
    found = _chats().select("*").eq("id", chat_id).eq("user_id", user_id).limit(1).execute().data
    if found:
        return found[0], session, False
    if session and session["id"] == chat_id:
        return _virtual(user_id, session), session, False
    return None, session, False


def _resolve(user_id: str, chat_id: str, include_deleted: bool = False):
    """(row, session, editable) for one of the student's chats; row is None when it is not theirs, not
    there, or deleted. The Tutor session's own id also finds the live conversation."""
    try:
        session = _session(user_id)
    except Exception as error:
        if not is_missing_schema(error):
            raise
        return _legacy_resolve(user_id, chat_id)
    row = _row(user_id, chat_id)
    if row is not None:
        if row.get("deleted_at") and not include_deleted:
            return None, session, True
        return row, session, "deleted_at" in row
    if session and session["id"] == chat_id:
        try:
            live, session = _live_row(user_id, session)
        except Exception as error:
            if not is_missing_schema(error):
                raise
            return _virtual(user_id, session), session, False  # migrated, but PostgREST has not reloaded its schema yet
        return (live, session, True) if live else (_virtual(user_id, session), session, True)
    return None, session, False


def get_chat(user_id: str, chat_id: str) -> dict:
    """One chat with its messages: {"chat": {..., "messages": [...]}, "editable": bool}. The live
    chat also carries session_id and conversation_version, what POST /chat needs to continue it."""
    row, session, editable = _resolve(user_id, chat_id)
    if row is None:
        raise _gone()
    chat = _summary(row, session)
    if chat["live"] and session:
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
        raise _gone()
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
        raise _gone()
    return {"chat": _summary(done[0], session), "editable": True}


def _busy(session: dict) -> bool:
    return session.get("status") in {"running", "waiting_browser"} and not _run_is_stale(session)


def _snapshot(user_id: str):
    """(session, live row or None): one read of the session row that decides, and the row it points at,
    read before it. A chat row's copy is written from a session read that came before it, so a row read
    before the session can only hold an older (or the same) copy of the session's conversation: saving
    the session into it never goes backwards. live is None when the pointer is empty or names a chat
    that is deleted or gone."""
    for _ in range(ATTEMPTS):
        first = _session(user_id)
        pointer = first.get("live_chat_id") if first else None
        if not pointer:
            return first, None
        row = _row(user_id, pointer)
        session = _session(user_id)
        if session and session.get("live_chat_id") == pointer:
            return session, (row if _usable(row) else None)
    raise _conflict()


def _settled(user_id: str):
    """_snapshot, after giving a conversation that has messages and no usable row a row of its own."""
    for _ in range(ATTEMPTS):
        session, live = _snapshot(user_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Tutor session not found")
        if live is None and (session.get("messages") or []):
            _home(user_id, session)  # this request's or a parallel one's: read again either way
            continue
        return session, live
    raise _conflict()


def _save(user_id: str, session: dict, live) -> bool:
    """SAVE (step 2): copy the session's messages into the live chat's row before anything replaces them.
    Writes the messages and the last activity only (never the title, renamed or class, so a rename or a
    move in another tab survives), only while the row is not deleted and has not been saved since it
    was read. True when the row holds this conversation (also when there was nothing to save)."""
    messages = list(session.get("messages") or [])
    if not messages or live is None or (live.get("messages") or []) == messages:
        return True
    done = (_chats().update({"messages": messages, "updated_at": session.get("updated_at") or _now()})
            .eq("id", live["id"]).eq("user_id", user_id).is_("deleted_at", "null")
            .eq("updated_at", live["updated_at"]).execute().data)
    return bool(done)


def _reset(user_id: str, session: dict, messages: list, chat_id, guide_id, stamp: str):
    """RESET (step 3): replace the conversation and the pointer to its chat in one row update, only if the
    session row is exactly as it was read. conversation_version changes when a turn completes, but a turn
    that is claimed (status, run_id), fails (back to idle with the student's message kept) or a reply
    posted outside a turn does not change it; every one of them writes updated_at, so updated_at is what
    makes sure no message sent after the read is ever dropped. Returns the updated row(s); [] = another
    request moved first and nothing was changed."""
    query = (_sessions().update({
        "messages": messages, "live_chat_id": chat_id, "active_guide_id": guide_id, "current_goal": "", "status": "idle",
        "run_id": None, "run_started_at": None, "conversation_version": (session.get("conversation_version") or 0) + 1,
        "updated_at": stamp,
    }).eq("id", session["id"]).eq("user_id", user_id).eq("conversation_version", session.get("conversation_version") or 0))
    for column in ("updated_at", "status", "run_id", "live_chat_id"):
        query = _same(query, column, session.get(column))
    return query.execute().data


def _tidy(user_id: str, session: dict, live, keep) -> None:
    """TIDY (step 4): the chat that was live is removed when it is empty and was never used (no messages,
    not renamed, not saved into since it was read). Failures are logged; nothing depends on this."""
    if (live and live["id"] != keep and not (session.get("messages") or []) and not (live.get("messages") or [])
            and not live.get("renamed")):
        _discard(user_id, live)
    _purge_deleted(user_id)


def _full_session(user_id: str, session_id: str):
    return sessions._owned_session(user_id, session_id)


def _start_new(user_id: str, session_id: str, guide_id, class_id):
    """New chat: an empty row of its own first, then save the current conversation, then point the session
    at the new row with an empty conversation."""
    fields = {"guide_id": guide_id, "class_id": class_id or _guide_class(user_id, guide_id)}
    made = None
    for _ in range(ATTEMPTS):
        try:
            session, live = _settled(user_id)
        except HTTPException:
            _discard(user_id, made)
            raise
        if made and session.get("live_chat_id") == made["id"]:
            return made, _full_session(user_id, session_id)  # an earlier reset went through; its answer was lost
        if _busy(session):
            _discard(user_id, made)
            raise HTTPException(status_code=409, detail=BUSY_DETAIL)
        if made is None:
            stamp = _now()
            made = (_chats().insert({"user_id": user_id, **fields, "title": "", "renamed": False, "messages": [],
                                     "created_at": stamp, "updated_at": stamp}).execute().data or [None])[0]
            if made is None:
                raise _conflict()
        try:
            saved = _save(user_id, session, live)
        except Exception:
            _discard(user_id, made)
            raise
        if not saved:
            continue
        try:
            done = _reset(user_id, session, [], made["id"], guide_id, _now())
        except Exception as error:
            if not _is_fk(error):
                raise  # the answer is unknown: the new row may be live now, so it stays
            made = None  # the new row was removed meanwhile (the old panel's delete): make another
            continue
        if done:
            _tidy(user_id, session, live, made["id"])
            return made, done[0]
    _discard(user_id, made)
    raise _conflict()


def _back_to_empty(user_id: str, session: dict) -> None:
    """An open lost its race with a delete of the same chat in another tab: the Tutor holds exactly that
    chat's saved messages (the reset's own state, checked by the compare-and-set), so emptying it loses
    nothing and does not bring the deleted chat back. If anything changed since, the session is left as
    it is and the next read gives its conversation a chat of its own."""
    try:
        _reset(user_id, session, [], None, None, _now())
    except Exception:
        logger.warning("Saved chats: could not empty the Tutor after an open lost to a delete", exc_info=True)


def _start_open(user_id: str, session_id: str, chat_id: str):
    """Open a saved chat: save the current conversation into its own row, then put the chat's messages
    and its id into the session together."""
    for _ in range(ATTEMPTS):
        session, live = _settled(user_id)
        if chat_id == session["id"]:  # the id GET /chats gave a conversation that had no row yet
            if live:
                return live, _full_session(user_id, session_id)
            return _virtual(user_id, session), _full_session(user_id, session_id)
        if live and live["id"] == chat_id:
            return live, _full_session(user_id, session_id)  # already the current conversation
        target = _row(user_id, chat_id)
        if not _usable(target):
            raise HTTPException(status_code=404, detail="Chat not found")
        if _busy(session):
            raise HTTPException(status_code=409, detail=BUSY_DETAIL)
        if not _save(user_id, session, live):
            continue
        try:
            done = _reset(user_id, session, list(target.get("messages") or []), target["id"], target.get("guide_id"),
                          target.get("updated_at") or _now())
        except Exception as error:
            if _is_fk(error):
                raise HTTPException(status_code=404, detail="Chat not found") from error
            raise
        if done:
            break
    else:
        raise _conflict()
    after = _row(user_id, chat_id)
    if not _usable(after):
        _back_to_empty(user_id, done[0])
        raise HTTPException(status_code=404, detail="That chat was deleted in another tab.")
    _tidy(user_id, session, live, chat_id)
    return after, done[0]


def start_chat(user_id: str, session_id=None, guide_id=None, class_id=None, resume_id=None):
    """Start a new chat (about a guide, in a class, or general), or open a saved one, as the Tutor's
    current conversation. The conversation it replaces is saved as a chat first. Returns
    (chat summary, the Tutor session row); the chat's id is the one for the URL, so navigate to it."""
    session = sessions.get_or_create_tutor_session(user_id)
    if session_id and session_id != session["id"]:
        raise HTTPException(status_code=404, detail="Tutor session not found")
    if _busy(session):
        raise HTTPException(status_code=409, detail=BUSY_DETAIL)
    if guide_id and not _db().table("study_guides").select("id").eq("id", guide_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Guide not found")
    if class_id and not _db().table("folders").select("id").eq("id", class_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Class not found")
    try:
        if resume_id:
            chat, current = _start_open(user_id, session["id"], resume_id)
        else:
            chat, current = _start_new(user_id, session["id"], guide_id, class_id)
    except Exception as error:
        if not is_missing_schema(error):
            raise
        # Before the migration (or right after it, while PostgREST still has the old schema cached and
        # refuses to write the new columns): the old save and resume. Every new-column write comes before
        # any other write in the code above, so nothing of the new path has been written at this point.
        if resume_id and resume_id == session["id"]:
            return _summary(_virtual(user_id, session), session), session  # the live conversation: already open
        row = sessions.start_tutor_chat(user_id, session["id"], guide_id, resume_id)
        return _summary(_virtual(user_id, row), row), row
    return _summary(chat, current), current


def _mark_deleted(user_id: str, chat_id: str) -> dict:
    """Soft-delete a chat that is not the live one. If another tab opened it between the check and the
    mark, the mark is taken back and the answer is 409: no chat is ever left live and deleted."""
    stamp = _now()
    done = _chats().update({"deleted_at": stamp}).eq("id", chat_id).eq("user_id", user_id).is_("deleted_at", "null").execute().data
    if not done:
        current = _row(user_id, chat_id)
        if not current or not current.get("deleted_at") or _when(current["deleted_at"]) != _when(stamp):
            raise _gone()
        done = [current]  # this request's own mark (its first answer was lost)
    session = _session(user_id)
    if session and session.get("live_chat_id") == chat_id:
        try:
            _chats().update({"deleted_at": None}).eq("id", chat_id).eq("user_id", user_id).eq("deleted_at", stamp).execute()
        except Exception:
            logger.error("Saved chats: a chat that became live could not be undeleted", exc_info=True)
        raise _conflict()
    return {"chat": {**_summary(done[0]), "deleted_at": stamp}, "editable": True}


def delete_chat(user_id: str, chat_id: str) -> dict:
    """Delete one chat the student can still bring back (restore_chat). Deleting the live chat saves its
    conversation into it, empties the Tutor (and its pointer) in one step, and only then marks it deleted:
    a crash in between leaves it a saved chat holding the conversation."""
    row, _, _ = _resolve(user_id, chat_id)
    if row is None:
        raise _gone()
    if row.get("_virtual") or "deleted_at" not in row:
        raise NotAvailable
    chat_id = row["id"]
    try:
        for _ in range(ATTEMPTS):
            session, live = _snapshot(user_id)
            if not live or live["id"] != chat_id:
                break  # not the live chat (any more): only the mark is needed
            if _busy(session):
                raise HTTPException(status_code=409, detail="Wait for Cordia Tutor to finish before deleting this chat")
            if not _save(user_id, session, live):
                continue
            if _reset(user_id, session, [], None, None, _now()):
                break
        else:
            raise _conflict()
        return _mark_deleted(user_id, chat_id)
    except Exception as error:
        if is_missing_schema(error):
            raise NotAvailable from error
        raise


def restore_chat(user_id: str, chat_id: str) -> dict:
    """Undo a delete. The chat comes back as a saved chat (open it to continue it)."""
    row, session, _ = _resolve(user_id, chat_id, include_deleted=True)
    if row is None:
        raise _gone()
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
            raise _gone()
        row = restored[0]
    return {"chat": _summary(row, session), "editable": True}


# Removing deleted chats for good -------------------------------------------------------------------
def _cutoff(now=None) -> datetime:
    return (now or datetime.now(timezone.utc)) - timedelta(days=DELETED_KEEP_DAYS)


def _expired(query, cutoff: datetime):
    """The one filter for what may be removed for good, used by the daily job and by the purge on a
    student's next chat so they cannot drift: deleted, and deleted before the cutoff. A chat that is not
    deleted (deleted_at null) can never match. _purge_batches also leaves out any chat a Tutor session
    points at."""
    return query.not_.is_("deleted_at", "null").lt("deleted_at", cutoff.isoformat())


def _pointed_at(ids: list) -> set:
    """The chats among `ids` that a Tutor session points at (the live chat is never purged)."""
    rows = _sessions().select("live_chat_id").in_("live_chat_id", ids).execute().data or []
    return {row["live_chat_id"] for row in rows}


def _purge_batches(cutoff: datetime, user_id=None):
    """Remove expired chats in batches of PURGE_BATCH (all students, or one); yields how many each batch removed.
    A chat a Tutor session points at is never removed: a pick that finds one picks again without it (that
    pick is not a batch; the number of picks is bounded too)."""
    keep, batches = set(), 0
    for _ in range(2 * PURGE_MAX_BATCHES):
        if batches >= PURGE_MAX_BATCHES:
            return
        pick = _expired(_chats().select("id"), cutoff)
        if user_id:
            pick = pick.eq("user_id", user_id)
        if keep:
            pick = pick.not_.in_("id", sorted(keep))
        ids = [row["id"] for row in pick.order("deleted_at").limit(PURGE_BATCH).execute().data or []]
        if not ids:
            return
        live = _pointed_at(ids)
        if live:
            keep |= live
            continue
        remove = _expired(_chats().delete(count=CountMethod.exact, returning=ReturnMethod.minimal), cutoff)
        if user_id:
            remove = remove.eq("user_id", user_id)
        gone = remove.in_("id", ids).execute().count or 0  # the same filter again: only rows still expired go
        batches += 1
        yield gone
        if len(ids) < PURGE_BATCH or not gone:
            return


def _purge_deleted(user_id: str) -> None:
    """Deleted chats stay for DELETED_KEEP_DAYS (so Undo still works), then go for good. This is the
    student's own purge, run when they next start a chat; purge_expired_chats does it for everyone daily."""
    try:
        for _ in _purge_batches(_cutoff(), user_id):
            pass
    except Exception:
        logger.warning("Saved chats: purge failed", exc_info=True)


def _purge_all(now=None):
    """(rows removed, finished without an error). Before the migration (no deleted_at column) it removes
    nothing and says so once. Any other database error is logged and not raised."""
    removed = 0
    try:
        for count in _purge_batches(_cutoff(now)):
            removed += count
    except Exception as error:
        if is_missing_schema(error):
            logger.info("Saved chats purge skipped: the saved-chats migration has not been applied yet")
            return removed, True
        logger.warning("Saved chats purge failed after removing %d chats", removed, exc_info=True)
        return removed, False
    if removed:
        logger.info("Saved chats purge removed %d deleted chats", removed)  # a count only, never what was in them
    return removed, True


def purge_expired_chats(now=None) -> int:
    """Permanently delete, for every student, the chats deleted more than DELETED_KEEP_DAYS ago. Safe to
    run twice or on two machines at once. Never raises. Returns how many chats it removed."""
    return _purge_all(now)[0]


_last_purge_day = None
_purge_retry_at = None


def run_purge_if_due(now=None) -> int:
    """Once a day, from the sync worker's loop (services/sync_worker.py), on its first pass at or after
    PURGE_HOUR_UTC. A run that hit a database error is tried again an hour later, not every minute."""
    global _last_purge_day, _purge_retry_at
    now = now or datetime.now(timezone.utc)
    if now.hour < PURGE_HOUR_UTC or _last_purge_day == now.date() or (_purge_retry_at and now < _purge_retry_at):
        return 0
    removed, finished = _purge_all(now)
    if finished:
        _last_purge_day, _purge_retry_at = now.date(), None
    else:
        _purge_retry_at = now + PURGE_RETRY
    return removed
