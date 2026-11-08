"""Who counts as a minor, and what changes for them. The one place that reads the flag and the age.

Someone is a minor when (user_profiles):
  - is_minor is set (by hand); or
  - birth_month (from sign-up, Stage 9) is less than 18 years ago, so they age out on their own; or
  - the account was made on or after AGE_CHECK_FROM and hasn't answered the age question yet (the
    safe default until they do; the web asks them once).
A missing profile, or a database before the Stage 1 / Stage 9 migrations, counts as not a minor.

Always on, enforced on the server:
  - People search (Discover) never lists them;
  - their profile page is visible only to themselves and accepted friends (everyone else: 404);
  - their public sets name them "A classmate" on cards, in search and in Discover;
  - a new set they make starts private, even from the generator that makes others' public;
  - only accepted friends can follow them.
Strict rules, behind MINOR_SAFETY (off unless set; strict()):
  - their profile is private, whatever the setting says;
  - they can't make a guide public;
  - they're never on a leaderboard (may_join_leaderboards);
  - no one can send them a friend request (they can still send one);
  - they can't join an instructor class unless a verified instructor at that course's school runs
    it (services/instructors.py runs_verified_class).
Under 13 never gets an account (routers/auth.py POST /auth/age); there's no parental consent flow.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from typing import Iterable, Optional

CLASSMATE = {"username": None, "display_name": "A classmate", "initials": "AC"}
ADULT_AGE = 18
MIN_AGE = 13
# Accounts made from this day on are asked their age; until they answer they count as minors.
AGE_CHECK_FROM = "2026-11-07"


def strict() -> bool:
    return os.getenv("MINOR_SAFETY", "").strip().lower() in ("1", "true", "yes", "on")


def age_on(birth_month, today: Optional[date] = None) -> Optional[int]:
    """Whole years from a birth month (the 1st of it) to today. Counting from the 1st can make
    someone a month older than they are at most; never younger."""
    if not birth_month:
        return None
    try:
        born = date.fromisoformat(str(birth_month)[:10])
    except ValueError:
        return None
    today = today or datetime.now(timezone.utc).date()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _young(row: dict, today: Optional[date] = None) -> bool:
    if row.get("is_minor") is True:
        return True
    age = age_on(row.get("birth_month"), today)
    if age is not None:
        return age < ADULT_AGE
    return "birth_month" in row and age_needed(row)


def age_needed(row: dict) -> bool:
    """A new account (made on or after AGE_CHECK_FROM) that hasn't answered the age question."""
    return not row.get("birth_month") and str(row.get("created_at") or "")[:10] >= AGE_CHECK_FROM


def minor_ids(db, user_ids: Iterable[str]) -> set[str]:
    ids = list(dict.fromkeys(i for i in user_ids if i))
    if not ids:
        return set()
    try:
        rows = db.table("user_profiles").select("id,is_minor,birth_month,created_at").in_("id", ids).execute().data or []
    except Exception:  # before the Stage 9 migration (no birth_month)
        try:
            rows = db.table("user_profiles").select("id,is_minor").in_("id", ids).execute().data or []
        except Exception:  # before the Stage 1 migration
            return set()
    return {r["id"] for r in rows if _young(r)}


def is_minor(db, user_id: str) -> bool:
    return bool(user_id) and user_id in minor_ids(db, [user_id])


def strict_minor(db, user_id: str) -> bool:
    """The strict rules apply to this person: the flag is on and they're a minor."""
    return strict() and is_minor(db, user_id)


def may_join_leaderboards(db, user_id: str) -> bool:
    """Leaderboards (Stage 10) never show a minor while the strict rules are on."""
    return not strict_minor(db, user_id)
