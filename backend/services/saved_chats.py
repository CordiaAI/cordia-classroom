"""Saved Tutor chats (redesign T5): every Tutor conversation is a chat with an id, a title, an
optional class, and a delete the student can undo. Served by routers/chats.py (/chats).

Storage. No new table. public.tutor_chats already holds the student's saved chats; migration
20261130120000_saved_chats.sql (NOT APPLIED until the owner runs it) adds class_id, renamed, live
and deleted_at to it. public.tutor_sessions is unchanged: it is still the one live conversation the
web app shares, and the Chrome extension never touches it (it sends its own history to POST /chat).
  * The live chat is the tutor_chats row with live = true (one per student). While it is live its
    messages are read from tutor_sessions; the row takes a copy when the conversation moves on.
  * Every other chat is a row with live = false; deleted ones have deleted_at set. A chat is never both:
    the migration has a database check (live and deleted_at) so a racing write fails instead of making
    that state, and every write below also filters on it and checks that it changed a row.
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
PURGE_BATCH = 100
PURGE_MAX_BATCHES = 100      # per run: 10,000 chats; anything left goes tomorrow
PURGE_HOUR_UTC = 9           # the daily job runs on the first worker pass at or after this hour (UTC)
PURGE_RETRY = timedelta(hours=1)
CONFLICT_DETAIL = "Tutor conversation changed. Refresh and try again."
SUMMARY = "id,guide_id,class_id,title,renamed,live,created_at,updated_at"
LEGACY_SUMMARY = "id,guide_id,title,created_at,updated_at"
NOT_AVAILABLE = {"detail": "Saved chats aren't set up yet.", "code": "chats_not_available"}


class NotAvailable(Exception):
    """The saved-chats migration has not run: rename, move, delete and undo cannot be done yet."""


def _db():
    return get_supabase()


def _conflict() -> HTTPException:
    return HTTPException(status_code=409, detail=CONFLICT_DETAIL)


def _is_conflict(error: Exception) -> bool:
    """A database rule stopped a racing write: the one-live-chat index (23505) or the live-and-deleted check (23514)."""
    code = str(getattr(error, "code", "") or "")
    text = str(error)
    return code in {"23505", "23514"} or any(mark in text for mark in ("23505", "23514", "duplicate key value", "violates check constraint"))


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
        "class_id": _guide_class(user_id, session.get("active_guide_id")), "title": "", "renamed": False, "live": True,
        "messages": session.get("messages") or [], "created_at": session.get("updated_at") or session.get("created_at"),
        "updated_at": session.get("updated_at") or session.get("created_at"), "_virtual": True,
    }


def _live_now(user_id: str):
    found = _chats().select("*").eq("user_id", user_id).eq("live", True).is_("deleted_at", "null").limit(1).execute().data
    return found[0] if found else None


def _live_row(user_id: str, session):
    """The live chat's row (never a deleted one). A conversation with no row yet (it began before saved
    chats) gets one. Raises the database error when the migration has not run."""
    found = _live_now(user_id)
    if found:
        return found
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
        found = _live_now(user_id)  # made by a parallel request
        if found:
            return found
        if _is_conflict(error):
            return None  # that one went away again: the caller treats it as a race
        raise
    if not made:
        raise _conflict()
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
    """Replace the Tutor's conversation, only if nobody moved it on since `session` was read. This is the
    claim every change of the live chat makes first: of two overlapping requests only one gets past it,
    and the other changes nothing."""
    version = session.get("conversation_version") or 0
    return (
        _db().table("tutor_sessions")
        .update({
            "messages": messages, "active_guide_id": guide_id, "current_goal": "", "status": "idle", "run_id": None,
            "run_started_at": None, "conversation_version": version + 1, "updated_at": stamp,
        })
        .eq("id", session["id"]).eq("user_id", user_id).eq("conversation_version", version).execute().data
    )


def _restore_session(user_id: str, before: dict, claimed: dict) -> bool:
    """A request that had already reset the Tutor could not finish: put the conversation back. True when
    that worked. It only applies if nobody moved the session on again since the reset."""
    try:
        version = claimed.get("conversation_version") or 0
        done = _db().table("tutor_sessions").update({
            "messages": list(before.get("messages") or []), "active_guide_id": before.get("active_guide_id"),
            "conversation_version": version + 1, "updated_at": before.get("updated_at") or _now(),
        }).eq("id", before["id"]).eq("user_id", user_id).eq("conversation_version", version).execute().data
        return bool(done)
    except Exception:
        logger.error("Saved chats: could not put the Tutor conversation back", exc_info=True)
        return False


def _save_copy(user_id: str, row, session: dict) -> None:
    """The conversation cannot go into its own chat row (it was deleted or went elsewhere meanwhile): keep it
    as a saved chat of its own, so a conversation the student was in is never lost."""
    row = row or {}
    fields = _archive_fields(row, session)
    _chats().insert({
        "user_id": user_id, "guide_id": session.get("active_guide_id"), "class_id": row.get("class_id"),
        "created_at": row.get("created_at") or fields["updated_at"], **fields,
    }).execute()


def _reopen(user_id: str, before: dict) -> None:
    """Make the chat a request had saved the live chat again (as it was). If something else is live by now,
    or the chat was deleted meanwhile, it stays saved: the conversation is in the Tutor session either way."""
    try:
        _chats().update({
            "live": True, "messages": before.get("messages") or [], "title": before.get("title") or "",
            "updated_at": before.get("updated_at"),
        }).eq("id", before["id"]).eq("user_id", user_id).eq("live", False).is_("deleted_at", "null").execute()
    except Exception:
        logger.warning("Saved chats: could not make the chat live again", exc_info=True)


def _gone_or_conflict(user_id: str, chat_id: str) -> HTTPException:
    """A guarded write changed no row: the chat is gone or deleted (404), or it changed under us (409)."""
    rows = _chats().select("id,deleted_at").eq("id", chat_id).eq("user_id", user_id).limit(1).execute().data
    if not rows or rows[0].get("deleted_at"):
        return HTTPException(status_code=404, detail="That chat is already gone.")
    return _conflict()


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
    claimed = None
    if live:
        if _busy(session):
            raise HTTPException(status_code=409, detail="Wait for Cordia Tutor to finish before deleting this chat")
        claimed = _reset_session(user_id, session, [], None, _now())
        if not claimed:
            raise _conflict()  # the conversation moved on first (another tab): nothing was changed
        changes.update(_archive_fields(row, session))
    def undo():  # the Tutor was already cleared: put the conversation back, or keep it as a chat of its own
        if claimed and not _restore_session(user_id, session, claimed[0]) and (session.get("messages") or []):
            _save_copy(user_id, row, session)

    try:
        # A chat that was read as live is only deleted while it is still live, one that was not only while it is not,
        # and never one that is already deleted: no chat is ever both live and deleted.
        done = (_chats().update(changes).eq("id", row["id"]).eq("user_id", user_id).eq("live", live)
                .is_("deleted_at", "null").execute().data)
    except Exception as error:
        undo()
        if is_missing_schema(error):
            raise NotAvailable from error
        if _is_conflict(error):
            raise _conflict() from error
        raise
    if not done:
        undo()
        raise _gone_or_conflict(user_id, row["id"])
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
def _fresh_live(user_id: str, fields: dict, stamp: str, reuse):
    """The live chat for a new, empty conversation: the empty one already there, else a new row.
    Returns (row, settled) where settled means a parallel request's empty live chat was used instead."""
    if reuse:
        done = (_chats().update(fields).eq("id", reuse["id"]).eq("user_id", user_id).eq("live", True)
                .is_("deleted_at", "null").execute().data)
        if done:
            return done[0], False
    for _ in range(2):
        try:
            made = _chats().insert({"user_id": user_id, **fields, "title": "", "messages": [], "live": True,
                                    "created_at": stamp, "updated_at": stamp}).execute().data
        except Exception as error:
            if not _is_conflict(error):
                raise
            # The one-live-chat index says another request made a live chat first. This request already holds
            # the Tutor's (now empty) conversation, so that chat is the one to use.
            found = _live_now(user_id)
            if found:
                done = (_chats().update(fields).eq("id", found["id"]).eq("user_id", user_id).eq("live", True)
                        .is_("deleted_at", "null").execute().data)
                if done:
                    return done[0], True
            continue
        if made:
            return made[0], False
        raise _conflict()
    raise _conflict()


def start_chat(user_id: str, session_id=None, guide_id=None, class_id=None, resume_id=None):
    """Start a new chat (about a guide, in a class, or general), or open a saved one, as the Tutor's
    current conversation. The conversation it replaces is saved as a chat. Returns
    (chat summary, the Tutor session row); the chat's id is the one for the URL, so navigate to it.

    The Tutor session is reset first, with its version check: of two overlapping requests only one gets
    past it and the other changes nothing (409). Everything after that is a guarded write on the chat
    rows; if one of them cannot be done, the session is put back and the request answers 409, so the
    student's conversation is never lost, saved twice, or filed under a deleted chat."""
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
        if resume_id and resume_id == session["id"]:
            return _summary(_virtual(user_id, session), session), session  # the live conversation: already open
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
    if current and not live:  # _live_row gives every conversation with messages a row, so this is a race
        raise _conflict()
    reuse = live if (live and not current and not resumed) else None
    if resumed:
        messages, guide, stamp, fields = list(resumed.get("messages") or []), resumed.get("guide_id"), resumed.get("updated_at") or _now(), None
    else:
        messages, guide, stamp = [], guide_id, _now()
        fields = {"guide_id": guide_id, "class_id": class_id or _guide_class(user_id, guide_id)}

    claimed = _reset_session(user_id, session, messages, guide, stamp)
    if not claimed:
        raise _conflict()  # another request moved the conversation on first: nothing was changed
    archived = False
    settled = False
    try:
        if current:
            saved = (_chats().update(_archive_fields(live, session)).eq("id", live["id"]).eq("user_id", user_id)
                     .eq("live", True).is_("deleted_at", "null").execute().data)
            if saved:
                archived = True
            else:  # the live chat was deleted or went elsewhere while this ran
                _save_copy(user_id, live, session)
        elif live and resumed:
            _chats().delete().eq("id", live["id"]).eq("user_id", user_id).eq("live", True).is_("deleted_at", "null").execute()  # an empty chat nobody wrote in
        if resumed:
            made = (_chats().update({"live": True}).eq("id", resumed["id"]).eq("user_id", user_id).eq("live", False)
                    .is_("deleted_at", "null").execute().data)
            if not made:  # deleted (or opened elsewhere) since it was read
                raise _gone_or_conflict(user_id, resumed["id"])
            target = made[0]
        else:
            target, settled = _fresh_live(user_id, fields, stamp, reuse)
    except Exception as error:
        if _restore_session(user_id, session, claimed[0]) and archived:
            _reopen(user_id, live)  # the conversation is the live one again; if it could not be put back it stays saved
        if not isinstance(error, HTTPException) and _is_conflict(error):
            raise _conflict() from error
        raise
    current_session = claimed[0]
    if settled:
        try:
            current_session = sessions._owned_session(user_id, session["id"])
        except Exception:
            logger.warning("Saved chats: could not re-read the Tutor session", exc_info=True)
    _purge_deleted(user_id)
    return _summary({**target, "live": True}, current_session), current_session


# Removing deleted chats for good -------------------------------------------------------------------
def _cutoff(now=None) -> datetime:
    return (now or datetime.now(timezone.utc)) - timedelta(days=DELETED_KEEP_DAYS)


def _expired(query, cutoff: datetime):
    """The one filter for what may be removed for good, used by the daily job and by the purge on a
    student's next chat so they cannot drift: deleted, deleted before the cutoff, and not live.
    A chat that is not deleted (deleted_at null) can never match."""
    return query.not_.is_("deleted_at", "null").lt("deleted_at", cutoff.isoformat()).eq("live", False)


def _purge_batches(cutoff: datetime, user_id=None):
    """Remove expired chats in batches of PURGE_BATCH (all students, or one); yields how many each batch removed."""
    for _ in range(PURGE_MAX_BATCHES):
        pick = _expired(_chats().select("id"), cutoff)
        if user_id:
            pick = pick.eq("user_id", user_id)
        ids = [row["id"] for row in pick.order("deleted_at").limit(PURGE_BATCH).execute().data or []]
        if not ids:
            return
        remove = _expired(_chats().delete(), cutoff)  # the same filter again: only rows still expired go
        if user_id:
            remove = remove.eq("user_id", user_id)
        gone = remove.in_("id", ids).execute().data or []
        yield len(gone)
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
