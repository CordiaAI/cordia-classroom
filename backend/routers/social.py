"""Social graph (social plan): blocks (Stage 1), follows and friends (Stage 2).

The service role bypasses RLS, so every route here checks blocks itself, and every list leaves out
anyone either side has blocked. Lists are the signed-in student's own; profiles show counts only.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import minors
from services import social_graph as graph
from services.blocks import hidden_from, is_blocked

router = APIRouter(prefix="/social", tags=["social"])
WRITE = [Depends(ai_rate_limit(20, 60))]


def _target(db, user_id: str, target_id: str) -> dict:
    """The other person's profile row, or 404 (also when either has blocked the other)."""
    target_id = require_uuid(target_id, "user ID")
    if target_id == user_id:
        raise HTTPException(status_code=400, detail="That's you")
    row = (db.table("user_profiles").select("id,allow_follows,allow_friend_requests").eq("id", target_id).limit(1).execute().data or [None])[0]
    if not row or is_blocked(db, user_id, target_id):
        raise HTTPException(status_code=404, detail="User not found")
    return row


# Blocks -------------------------------------------------------------------------------------------
@router.get("/blocks")
def list_blocks(authorization: str = Header(default="")):
    """People you blocked, newest first (for Settings › Privacy)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = db.table("user_blocks").select("blocked_id,created_at").eq("blocker_id", user_id).order("created_at", desc=True).limit(500).execute().data or []
    people = graph.cards(db, [row["blocked_id"] for row in rows])
    return {"blocks": [{**people.get(row["blocked_id"], {"user_id": row["blocked_id"], "username": None, "display_name": "Someone", "initials": "?"}),
                        "blocked_at": row.get("created_at")} for row in rows]}


@router.post("/blocks/{target_id}", dependencies=WRITE)
def block_user(target_id: str, authorization: str = Header(default="")):
    """Block someone: neither of you sees the other, follows and friendships between you end, and
    pending requests are cancelled. They aren't told."""
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    if target_id == user_id:
        raise HTTPException(status_code=400, detail="You can't block yourself")
    db = get_supabase()
    if not db.table("user_profiles").select("id").eq("id", target_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="User not found")
    db.table("user_blocks").upsert({"blocker_id": user_id, "blocked_id": target_id, "created_at": graph.now().isoformat()},
                                   on_conflict="blocker_id,blocked_id", ignore_duplicates=True).execute()
    graph.remove_between(db, user_id, target_id)
    return {"blocked": True}


@router.delete("/blocks/{target_id}", dependencies=WRITE)
def unblock_user(target_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    get_supabase().table("user_blocks").delete().eq("blocker_id", user_id).eq("blocked_id", target_id).execute()
    return {"blocked": False}


# Follows ------------------------------------------------------------------------------------------
@router.post("/follow/{target_id}", dependencies=WRITE)
def follow(target_id: str, authorization: str = Header(default="")):
    """Follow someone; it waits for their OK when they approve followers."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    target = _target(db, user_id, target_id)
    existing = graph.follow_row(db, user_id, target["id"])
    if existing:
        return {"status": existing["status"]}
    if minors.is_minor(db, target["id"]) and not graph.are_friends(db, user_id, target["id"]):
        raise HTTPException(status_code=403, detail="Only friends can follow this account.")
    graph.spend(db, user_id, "follow")
    status = "pending" if (target.get("allow_follows") or "everyone") == "approval" else "active"
    db.table("follows").insert({"follower_id": user_id, "followee_id": target["id"], "status": status, "created_at": graph.now().isoformat()}).execute()
    graph.notify(db, target["id"], "follow_request" if status == "pending" else "follow", user_id)
    return {"status": status}


@router.delete("/follow/{target_id}", dependencies=WRITE)
def unfollow(target_id: str, authorization: str = Header(default="")):
    """Stop following, or take back a follow request."""
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    get_supabase().table("follows").delete().eq("follower_id", user_id).eq("followee_id", target_id).execute()
    return {"status": "none"}


def _pending_follow(db, follower_id: str, user_id: str) -> dict:
    follower_id = require_uuid(follower_id, "user ID")
    row = graph.follow_row(db, follower_id, user_id)
    if not row or row.get("status") != "pending":
        raise HTTPException(status_code=404, detail="No follow request from them")
    return row


@router.post("/follow-requests/{follower_id}/approve", dependencies=WRITE)
def approve_follow(follower_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _pending_follow(db, follower_id, user_id)
    db.table("follows").update({"status": "active"}).eq("follower_id", row["follower_id"]).eq("followee_id", user_id).execute()
    return {"status": "active"}


@router.post("/follow-requests/{follower_id}/decline", dependencies=WRITE)
def decline_follow(follower_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _pending_follow(db, follower_id, user_id)
    db.table("follows").delete().eq("follower_id", row["follower_id"]).eq("followee_id", user_id).execute()
    return {"status": "none"}


@router.delete("/followers/{follower_id}", dependencies=WRITE)
def remove_follower(follower_id: str, authorization: str = Header(default="")):
    """Remove someone who follows you (they aren't told)."""
    user_id = get_user_id(authorization)
    follower_id = require_uuid(follower_id, "user ID")
    get_supabase().table("follows").delete().eq("follower_id", follower_id).eq("followee_id", user_id).execute()
    return {"removed": True}


# Friends ------------------------------------------------------------------------------------------
def _befriend(db, user_id: str, other_id: str) -> None:
    """Accept: the friendship becomes accepted and each follows the other (pending follows too)."""
    lo, hi = graph.pair(user_id, other_id)
    now = graph.now().isoformat()
    db.table("friendships").update({"status": "accepted", "accepted_at": now}).eq("user_a", lo).eq("user_b", hi).execute()
    for follower, followee in ((user_id, other_id), (other_id, user_id)):
        db.table("follows").upsert({"follower_id": follower, "followee_id": followee, "status": "active", "created_at": now},
                                   on_conflict="follower_id,followee_id").execute()
    graph.notify(db, other_id, "friend_accepted", user_id)


@router.post("/friends/{target_id}", dependencies=WRITE)
def request_friend(target_id: str, authorization: str = Header(default="")):
    """Send a friend request (their settings decide who may). If they already asked you, this
    accepts theirs."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    target = _target(db, user_id, target_id)
    row = graph.friendship(db, user_id, target["id"])
    if row and row.get("status") == "accepted":
        return {"friendship": "friends"}
    if row and row.get("requested_by") == user_id:
        return {"friendship": "outgoing"}
    if row:  # they asked first
        _befriend(db, user_id, target["id"])
        return {"friendship": "friends"}
    problem = graph.may_request_friend(db, user_id, target)
    if problem:
        raise HTTPException(status_code=403, detail=problem)
    graph.spend(db, user_id, "friend_request")
    lo, hi = graph.pair(user_id, target["id"])
    db.table("friendships").insert({"user_a": lo, "user_b": hi, "requested_by": user_id, "status": "pending",
                                    "created_at": graph.now().isoformat()}).execute()
    graph.notify(db, target["id"], "friend_request", user_id)
    return {"friendship": "outgoing"}


def _incoming(db, user_id: str, requester_id: str) -> dict:
    requester_id = require_uuid(requester_id, "user ID")
    row = graph.friendship(db, user_id, requester_id) if requester_id != user_id else None
    if not row or row.get("status") != "pending" or row.get("requested_by") != requester_id:
        raise HTTPException(status_code=404, detail="No friend request from them")
    return row


@router.post("/friends/{requester_id}/accept", dependencies=WRITE)
def accept_friend(requester_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    _incoming(db, user_id, requester_id)
    if is_blocked(db, user_id, requester_id):
        raise HTTPException(status_code=404, detail="No friend request from them")
    _befriend(db, user_id, requester_id)
    return {"friendship": "friends"}


@router.post("/friends/{requester_id}/decline", dependencies=WRITE)
def decline_friend(requester_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _incoming(db, user_id, requester_id)
    db.table("friendships").delete().eq("user_a", row["user_a"]).eq("user_b", row["user_b"]).execute()
    return {"friendship": "none"}


@router.delete("/friends/{target_id}", dependencies=WRITE)
def remove_friend(target_id: str, authorization: str = Header(default="")):
    """Remove a friend or take back your request. Follows stay; either of you can unfollow."""
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    lo, hi = graph.pair(user_id, target_id)
    get_supabase().table("friendships").delete().eq("user_a", lo).eq("user_b", hi).execute()
    return {"friendship": "none"}


# Lists --------------------------------------------------------------------------------------------
def _people(db, user_id: str, rows: list, other_key: str, since_key: str = "created_at") -> dict:
    """Rows -> people cards, minus blocked pairs and people without a profile, paged."""
    hidden = hidden_from(db, user_id)
    rows = [r for r in rows if r[other_key] not in hidden]
    people = graph.cards(db, [r[other_key] for r in rows])
    items = [{**people[r[other_key]], "since": r.get(since_key)} for r in rows if r[other_key] in people]
    shown, cursor = graph.page(items, "since")
    return {"items": shown, "next_cursor": cursor}


def _newest(query, cursor: Optional[str], key: str = "created_at"):
    if cursor:
        query = query.lt(key, cursor)
    return query.order(key, desc=True).limit(graph.PAGE + 1).execute().data or []


@router.get("/followers")
def list_followers(cursor: Optional[str] = Query(default=None, max_length=64), authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = _newest(db.table("follows").select("follower_id,created_at").eq("followee_id", user_id).eq("status", "active"), cursor)
    return _people(db, user_id, rows, "follower_id")


@router.get("/following")
def list_following(cursor: Optional[str] = Query(default=None, max_length=64), authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = _newest(db.table("follows").select("followee_id,created_at,status").eq("follower_id", user_id).eq("status", "active"), cursor)
    return _people(db, user_id, rows, "followee_id")


def _friend_rows(db, user_id: str, status: str, cursor: Optional[str], key: str) -> list:
    rows = []
    for column, other in (("user_a", "user_b"), ("user_b", "user_a")):
        found = _newest(db.table("friendships").select(f"{other},requested_by,{key}").eq(column, user_id).eq("status", status), cursor, key)
        rows += [{"other": r[other], "requested_by": r.get("requested_by"), key: r.get(key)} for r in found]
    return sorted(rows, key=lambda r: str(r.get(key) or ""), reverse=True)


@router.get("/friends")
def list_friends(cursor: Optional[str] = Query(default=None, max_length=64), authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    return _people(db, user_id, _friend_rows(db, user_id, "accepted", cursor, "accepted_at"), "other", "accepted_at")


@router.get("/requests")
def list_requests(kind: Literal["friend", "follow"] = "friend", direction: Literal["incoming", "outgoing"] = "incoming",
                  cursor: Optional[str] = Query(default=None, max_length=64), authorization: str = Header(default="")):
    """Friend requests (in or out) and follow requests (to you, or yours waiting)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    if kind == "follow":
        mine, other = ("followee_id", "follower_id") if direction == "incoming" else ("follower_id", "followee_id")
        rows = _newest(db.table("follows").select(f"{other},created_at").eq(mine, user_id).eq("status", "pending"), cursor)
        return _people(db, user_id, rows, other)
    rows = _friend_rows(db, user_id, "pending", cursor, "created_at")
    rows = [r for r in rows if (r["requested_by"] != user_id) == (direction == "incoming")]
    return _people(db, user_id, rows, "other")


@router.get("/summary")
def summary(authorization: str = Header(default="")):
    """Counts for the badges: requests waiting on you and unread notifications."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    hidden = hidden_from(db, user_id)
    friend_in = [r for r in _friend_rows(db, user_id, "pending", None, "created_at") if r["requested_by"] != user_id and r["other"] not in hidden]
    follow_in = [r for r in (db.table("follows").select("follower_id").eq("followee_id", user_id).eq("status", "pending").execute().data or [])
                 if r["follower_id"] not in hidden]
    unread = db.table("notifications").select("id,payload").eq("user_id", user_id).is_("read_at", "null").limit(100).execute().data or []
    unread = [n for n in unread if (n.get("payload") or {}).get("actor_id") not in hidden]
    return {"incoming_friend_requests": len(friend_in), "incoming_follow_requests": len(follow_in), "unread_notifications": len(unread)}
