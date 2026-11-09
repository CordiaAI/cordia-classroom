"""One memory per student, shared by the Tutor and the Assistant (public.student_memory, migration
20261121130000, NOT APPLIED until the owner runs it).

The Tutor writes here: when a student's chat message shares something lasting about them as a
learner (a goal, an interest, a course, how they like to study), Haiku pulls out at most three short
facts. The Assistant's own memories arrive through a database trigger. Help me remember reads both
(services/memory_context.py), and Settings › Tutor lists them with Forget.

Everything here fails quietly: before the migration, or on any error, nothing is saved and nothing
is recalled. Never sensitive details (health, relationships, contact details, money, location).
"""

from __future__ import annotations

import json
import logging
import re
import threading
from contextvars import copy_context
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MAX_FACTS = 3
CATEGORIES = ("goal", "interest", "course", "preference", "other")
# Only a message that talks about the student is worth a model call.
_ABOUT_ME = re.compile(r"\b(i am|i'm|im|i like|i love|i hate|i prefer|i want|i need|my|remember that|i play|i work|i study|i major)\b", re.IGNORECASE)

EXTRACT_RULES = (
    "From one message a student sent their study Tutor, pull out lasting facts about them as a learner "
    "that would help explain things to them later, for any subject: their goals or exams, courses, "
    "interests and hobbies that could anchor examples, and how they like to learn. Skip anything about "
    "the material itself, anything temporary (today's mood, this week's plan), and never record health, "
    "relationships, contact details, money, exact location or anything about other people. Each fact is "
    "one short line in the third person (\"Plays guitar\", \"Preparing for the NCLEX in March\"). "
    f"At most {MAX_FACTS}; usually none. "
    'Return JSON: {"facts": [{"key": "short_snake_case_label", "category": "goal|interest|course|preference|other", '
    '"value": "..."}]}'
)


def worth_checking(message: str) -> bool:
    text = str(message or "")
    return 12 <= len(text) <= 4000 and bool(_ABOUT_ME.search(text))


def _clean(fact) -> dict | None:
    if not isinstance(fact, dict):
        return None
    key = re.sub(r"[^a-z0-9_]+", "_", str(fact.get("key") or "").lower()).strip("_")[:120]
    value = " ".join(str(fact.get("value") or "").split())[:500]
    category = str(fact.get("category") or "other").lower()
    if not key or len(value) < 3:
        return None
    return {"key": key, "value": value, "category": category if category in CATEGORIES else "other"}


def extract(message: str) -> list:
    """The facts worth keeping from one Tutor message (Haiku, logged to usage_events)."""
    from services.llm import get_openai_client
    from services.llm_calls import chat
    response = chat(get_openai_client(), "tutor_memory",
        messages=[{"role": "system", "content": EXTRACT_RULES}, {"role": "user", "content": message[:4000]}],
        response_format={"type": "json_object"}, temperature=0)
    try:
        facts = json.loads(response.choices[0].message.content or "{}").get("facts") or []
    except (ValueError, AttributeError):
        return []
    return [fact for fact in (_clean(item) for item in facts[:MAX_FACTS]) if fact]


def remember(db, user_id: str, facts: list, source: str = "tutor", ref: str | None = None) -> int:
    """Upserts facts (newest wins for the same key). Returns how many were saved."""
    now = datetime.now(timezone.utc).isoformat()
    rows = [{"user_id": user_id, "source": source, "category": fact["category"], "key": fact["key"],
             "value": fact["value"], "source_ref": ref, "updated_at": now} for fact in facts]
    if not rows:
        return 0
    try:
        db.table("student_memory").upsert(rows, on_conflict="user_id,source,key").execute()
    except Exception:
        logger.warning("Student memory not saved", exc_info=True)
        return 0
    return len(rows)


def learn_from_tutor(user_id: str, message: str, ref: str | None = None) -> None:
    """After a Tutor reply, in the background: keep what the student shared about themselves."""
    if not worth_checking(message):
        return

    def run():
        try:
            from database import get_supabase
            remember(get_supabase(), user_id, extract(message), "tutor", ref)
        except Exception:
            logger.warning("Tutor memory skipped", exc_info=True)

    threading.Thread(target=copy_context().run, args=(run,), daemon=True).start()


def list_for(db, user_id: str, limit: int = 100) -> list:
    """[{id, source, category, value, updated_at}], newest first; [] before the migration."""
    try:
        return (db.table("student_memory").select("id, source, category, value, updated_at")
                .eq("user_id", user_id).order("updated_at", desc=True).limit(limit).execute().data or [])
    except Exception:
        logger.warning("Student memory unavailable", exc_info=True)
        return []


def forget_all(db, user_id: str) -> int:
    """Deletes all of the student's memories (Assistant ones go in the Assistant too). How many went."""
    try:
        gone = db.table("student_memory").delete().eq("user_id", user_id).execute().data
    except Exception:
        logger.warning("Student memory not cleared", exc_info=True)
        raise
    return len(gone or [])


def forget(db, user_id: str, memory_id: str) -> bool:
    """Deletes one of the student's own memories (an Assistant one goes in the Assistant too)."""
    try:
        gone = db.table("student_memory").delete().eq("user_id", user_id).eq("id", memory_id).execute().data
    except Exception:
        logger.warning("Student memory not forgotten", exc_info=True)
        return False
    return bool(gone)
