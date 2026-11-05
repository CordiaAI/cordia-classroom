"""Blocking (social plan, Stage 1). A block works both ways: if either person blocked the other, each
is hidden from the other everywhere. The backend uses the service role, which bypasses RLS, so every
social endpoint checks here (public.is_blocked() is the same rule for future RLS policies)."""

from __future__ import annotations


def is_blocked(db, a: str, b: str) -> bool:
    """True when either user blocked the other."""
    if not a or not b or a == b:
        return False
    for blocker, blocked in ((a, b), (b, a)):
        if db.table("user_blocks").select("blocker_id").eq("blocker_id", blocker).eq("blocked_id", blocked).limit(1).execute().data:
            return True
    return False


def hidden_from(db, user_id: str) -> set[str]:
    """Everyone this user must not see or be seen by: people they blocked and people who blocked them."""
    mine = db.table("user_blocks").select("blocked_id").eq("blocker_id", user_id).execute().data or []
    theirs = db.table("user_blocks").select("blocker_id").eq("blocked_id", user_id).execute().data or []
    return {row["blocked_id"] for row in mine} | {row["blocker_id"] for row in theirs}
