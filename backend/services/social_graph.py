"""Follows, friendships, notifications and the daily social limits (social plan, Stage 2).

The backend writes with the service role, which bypasses RLS, so the rules live here: blocks
(services/blocks.py) are checked by every caller, friendships are stored once per pair with
user_a < user_b, and accepting a friend request makes both people follow each other.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

DAILY_LIMITS = {"follow": 100, "friend_request": 30}
NOTIFY_KINDS = ("follow", "follow_request", "friend_request", "friend_accepted")
PAGE = 30


def now() -> datetime:
    return datetime.now(timezone.utc)


def pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


# People -------------------------------------------------------------------------------------------
def first_name(profile: dict) -> str:
    return (profile.get("name") or "").strip().split(" ")[0]


def shown_name(profile: dict) -> str:
    return (profile.get("display_name") or "").strip() or first_name(profile) or profile.get("username") or ""


def initials(profile: dict) -> str:
    words = [w for w in shown_name(profile).replace(".", " ").replace("_", " ").split() if w]
    return "".join(w[0] for w in words[:2]).upper() or "?"


def cards(db, user_ids) -> dict:
    """{user_id: {user_id, username, display_name, initials}} for people who have a profile."""
    ids = list(dict.fromkeys(i for i in user_ids if i))
    if not ids:
        return {}
    rows = db.table("user_profiles").select("id,username,display_name,name").in_("id", ids).execute().data or []
    return {r["id"]: {"user_id": r["id"], "username": r.get("username"), "display_name": shown_name(r) or "Someone",
                      "initials": initials(r)} for r in rows}


# Follows and friendships --------------------------------------------------------------------------
def follow_row(db, follower: str, followee: str) -> Optional[dict]:
    return _one(db.table("follows").select("*").eq("follower_id", follower).eq("followee_id", followee).limit(1).execute())


def friendship(db, a: str, b: str) -> Optional[dict]:
    lo, hi = pair(a, b)
    return _one(db.table("friendships").select("*").eq("user_a", lo).eq("user_b", hi).limit(1).execute())


def are_friends(db, a: str, b: str) -> bool:
    row = friendship(db, a, b) if a and b and a != b else None
    return bool(row and row.get("status") == "accepted")


def friend_ids(db, user_id: str) -> set[str]:
    out = set()
    for column, other in (("user_a", "user_b"), ("user_b", "user_a")):
        rows = db.table("friendships").select(other).eq(column, user_id).eq("status", "accepted").execute().data or []
        out |= {r[other] for r in rows}
    return out


def relationship(db, viewer: str, owner: str) -> dict:
    """How the viewer stands with the owner, for the profile's Follow and Friend buttons."""
    mine = follow_row(db, viewer, owner)
    theirs = follow_row(db, owner, viewer)
    row = friendship(db, viewer, owner)
    if not row:
        friend_state = "none"
    elif row.get("status") == "accepted":
        friend_state = "friends"
    else:
        friend_state = "outgoing" if row.get("requested_by") == viewer else "incoming"
    return {
        "following": (mine or {}).get("status") or "none",
        "follows_you": bool(theirs and theirs.get("status") == "active"),
        "friendship": friend_state,
    }


def may_request_friend(db, requester: str, target_profile: dict) -> Optional[str]:
    """Why the requester can't send this person a friend request; None when they can."""
    rule = target_profile.get("allow_friend_requests") or "everyone"
    if rule == "nobody":
        return "They aren't taking friend requests."
    if rule == "friends_of_friends" and not (friend_ids(db, requester) & friend_ids(db, target_profile["id"])):
        return "They take friend requests only from friends of friends."
    return None


def counts(db, user_id: str) -> dict:
    followers = db.table("follows").select("follower_id").eq("followee_id", user_id).eq("status", "active").execute().data or []
    following = db.table("follows").select("followee_id").eq("follower_id", user_id).eq("status", "active").execute().data or []
    return {"followers": len(followers), "following": len(following), "friends": len(friend_ids(db, user_id))}


def remove_between(db, a: str, b: str) -> None:
    """A block: no follows (active or pending) either way, and no friendship in any state."""
    db.table("follows").delete().eq("follower_id", a).eq("followee_id", b).execute()
    db.table("follows").delete().eq("follower_id", b).eq("followee_id", a).execute()
    lo, hi = pair(a, b)
    db.table("friendships").delete().eq("user_a", lo).eq("user_b", hi).execute()


# Daily limits -------------------------------------------------------------------------------------
def spend(db, user_id: str, action: str) -> None:
    """Count one follow or friend request against today's limit (a rolling 24 hours), or 429."""
    since = (now() - timedelta(days=1)).isoformat()
    used = db.table("social_rate_events").select("id").eq("user_id", user_id).eq("action", action).gte("created_at", since).execute().data or []
    if len(used) >= DAILY_LIMITS[action]:
        raise HTTPException(status_code=429, detail="You've reached today's limit. Try again tomorrow.")
    db.table("social_rate_events").insert({"user_id": user_id, "action": action, "created_at": now().isoformat()}).execute()


# Notifications ------------------------------------------------------------------------------------
def notify(db, user_id: str, kind: str, actor_id: str) -> None:
    """One notification, unless the same person already caused an unread one like it today
    (so follow, unfollow, follow again doesn't spam)."""
    since = (now() - timedelta(days=1)).isoformat()
    recent = (db.table("notifications").select("id").eq("user_id", user_id).eq("kind", kind).is_("read_at", "null")
              .eq("payload->>actor_id", actor_id).gte("created_at", since).limit(1).execute().data or [])
    if recent:
        return
    db.table("notifications").insert({"user_id": user_id, "kind": kind, "payload": {"actor_id": actor_id},
                                      "created_at": now().isoformat()}).execute()


def page(rows: list, key: str = "created_at") -> tuple[list, Optional[str]]:
    """The first PAGE rows and the cursor for the next page (None when this is the last)."""
    if len(rows) > PAGE:
        return rows[:PAGE], rows[PAGE - 1].get(key)
    return rows, None
