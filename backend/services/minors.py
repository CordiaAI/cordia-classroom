"""Accounts marked as minors (user_profiles.is_minor). The one place that reads the flag.

What it changes, all enforced here on the server:
  - People search (Discover) never lists them;
  - their profile page is visible only to themselves and accepted friends (everyone else: 404);
  - their public sets name them "A classmate" on cards, in search and in Discover;
  - a new set they make starts private, even from the generator that makes others' public;
  - only accepted friends can follow them.
A missing profile, or a database before the Stage 1 migration, counts as not a minor.
"""

from __future__ import annotations

from typing import Iterable

CLASSMATE = {"username": None, "display_name": "A classmate", "initials": "AC"}


def minor_ids(db, user_ids: Iterable[str]) -> set[str]:
    ids = list(dict.fromkeys(i for i in user_ids if i))
    if not ids:
        return set()
    try:
        rows = db.table("user_profiles").select("id,is_minor").in_("id", ids).execute().data or []
    except Exception:  # before the Stage 1 migration
        return set()
    return {r["id"] for r in rows if r.get("is_minor") is True}


def is_minor(db, user_id: str) -> bool:
    return bool(user_id) and user_id in minor_ids(db, [user_id])
