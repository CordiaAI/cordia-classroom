"""Download my data (Settings › Account): the student's own data as one JSON file.

Every section is read with the student's id (the backend uses the service role, so the filter here
is what keeps it to their rows), with named columns so internal fields (search indexes, moderation
notes, sync state) stay out. Large tables are read in pages. A section that can't be read (a table
not created yet, say) is listed under "unavailable" instead of failing the whole download.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from services.saved_chats import DELETED_KEEP_DAYS, is_missing_schema

logger = logging.getLogger(__name__)

FORMAT = "cordia-classroom-export/1"
PAGE = 1000

# (section, table, columns, the column that holds the student's id, many rows?)
SECTIONS = (
    ("profile", "user_profiles", "id, email, name, display_name, username, university, major, education_level, timezone, "
     "birth_month, created_at, profile_visibility, show_real_name, show_school, show_streak, allow_follows, "
     "allow_friend_requests, find_by_classmates, leaderboard_opt_in, honor_code_accepted_at, acquisition", "id", False),
    ("learning_preferences", "learning_preferences", "style, explain_preference, updated_at", "user_id", False),
    ("folders", "folders", "id, name, class_id, created_at", "user_id", True),
    ("study_guides", "study_guides", "id, folder_id, title, notes, study_guide, flashcards, quiz_questions, source_type, "
     "source_title, source_url, visibility, attribution, flashcard_progress, created_at", "user_id", True),
    ("notes", "smart_notes", "id, folder_id, title, content, created_at, updated_at", "user_id", True),
    ("lectures", "lectures", "id, folder_id, title, lecture_date, duration_ms, transcript, analysis, created_at", "user_id", True),
    ("quiz_attempts", "quiz_attempts", "id, guide_id, score, total_questions, correct_answers, answers, completed_at", "user_id", True),
    ("study_sessions", "study_sessions", "id, guide_id, session_type, started_at, ended_at, duration_seconds", "user_id", True),
    # The Tutor: the chat in progress, the saved chats, and what it remembers about the student.
    ("tutor_current_chat", "tutor_sessions", "messages, active_guide_id, updated_at", "user_id", False),
    ("tutor_chats", "tutor_chats", "id, guide_id, title, messages, created_at, updated_at", "user_id", True),
    ("tutor_memory", "student_memory", "id, source, category, value, created_at, updated_at", "user_id", True),
)

# Saved chats the student deleted stay in the export until they are purged. `deleted_at` only exists after
# the saved-chats migration (20261130120000), so it is asked for on top of the columns above, and a
# database without it is read exactly as before.
DELETED_CHATS_NOTE = (
    "A Tutor chat with \"deleted\": true was deleted by the student and is kept only so the deletion can be undone. "
    "\"deleted_at\" is when it was deleted; \"purge_on\" is the date it is permanently deleted "
    f"({DELETED_KEEP_DAYS} days after deletion). A clean-up that runs once a day removes it, so the chat is gone "
    "within a day of that date. Chats without these fields are not deleted."
)


def _when(value):
    try:
        when = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _mark_deleted(chat: dict) -> dict:
    """A live chat loses the helper column (it looks exactly as before); a deleted one says so and when it goes."""
    deleted_at = chat.pop("deleted_at", None)
    if deleted_at:
        when = _when(deleted_at)
        chat["deleted"] = True
        chat["deleted_at"] = deleted_at
        chat["purge_on"] = (when + timedelta(days=DELETED_KEEP_DAYS)).isoformat() if when else None
    return chat


def _rows(db, table: str, columns: str, owner: str, user_id: str) -> list:
    rows, start = [], 0
    while True:
        page = (db.table(table).select(columns).eq(owner, user_id).order("id")
                .range(start, start + PAGE - 1).execute().data or [])
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def _tutor_chats(db, table: str, columns: str, owner: str, user_id: str) -> list:
    try:
        rows = _rows(db, table, columns + ", deleted_at", owner, user_id)
    except Exception as error:
        if not is_missing_schema(error):
            raise
        return _rows(db, table, columns, owner, user_id)  # before the migration: nothing can be deleted yet
    return [_mark_deleted(row) for row in rows]


def build(db, user_id: str) -> dict:
    out = {"format": FORMAT, "exported_at": datetime.now(timezone.utc).isoformat(), "unavailable": []}
    for section, table, columns, owner, many in SECTIONS:
        try:
            if section == "tutor_chats":
                out[section] = _tutor_chats(db, table, columns, owner, user_id)
                if any(chat.get("deleted") for chat in out[section]):
                    out["deleted_chats_note"] = DELETED_CHATS_NOTE  # not "notes": that is the student's notes section
            elif many:
                out[section] = _rows(db, table, columns, owner, user_id)
            else:
                found = db.table(table).select(columns).eq(owner, user_id).limit(1).execute().data or []
                out[section] = found[0] if found else None
        except Exception:
            logger.warning("Data export: %s unavailable", section, exc_info=True)
            out[section] = [] if many else None
            out["unavailable"].append(section)
    return out
