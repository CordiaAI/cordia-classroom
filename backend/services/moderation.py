"""What's held for review or hidden by an admin (social plan, Stage 9), for lists that show many
things at once. A held item is hidden everywhere except from its owner (and a classroom's staff):
single items are checked in access.py; these leave held ones out of search, suggestions and lists.
Before migration 20261126120000 nothing is held (the columns don't exist yet).
"""

from __future__ import annotations

from typing import Iterable


def _held(db, table: str, ids: Iterable[str]) -> set:
    ids = list(dict.fromkeys(i for i in ids if i))
    if not ids:
        return set()
    try:
        rows = db.table(table).select("id,review_status").in_("id", ids).execute().data or []
    except Exception:  # before the Stage 9 migration
        return set()
    return {r["id"] for r in rows if (r.get("review_status") or "ok") != "ok"}


def held_profile_ids(db, user_ids: Iterable[str]) -> set:
    return _held(db, "user_profiles", user_ids)


def held_classroom_ids(db, classroom_ids: Iterable[str]) -> set:
    return _held(db, "classrooms", classroom_ids)
