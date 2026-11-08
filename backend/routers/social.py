"""Social graph (social plan): blocks (Stage 1), follows and friends (Stage 2).

The service role bypasses RLS: every route declares its check from access.py (another person: they
exist, aren't you, no block either way, not held for review; or your own lists and edges), and
every list leaves out anyone either side has blocked. Profiles show counts only.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import access
from access import Ctx
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import activity, leaderboard, minors
from services import social_graph as graph
from services.blocks import hidden_from

router = APIRouter(prefix="/social", tags=["social"])
WRITE = [Depends(ai_rate_limit(20, 60))]


# Blocks -------------------------------------------------------------------------------------------
@router.get("/blocks")
def list_blocks(ctx: Ctx = Depends(access.own())):
    """People you blocked, newest first (for Settings › Privacy)."""
    user_id, db = ctx.user_id, ctx.db
    rows = db.table("user_blocks").select("blocked_id,created_at").eq("blocker_id", user_id).order("created_at", desc=True).limit(500).execute().data or []
    people = graph.cards(db, [row["blocked_id"] for row in rows])
    return {"blocks": [{**people.get(row["blocked_id"], {"user_id": row["blocked_id"], "username": None, "display_name": "Someone", "initials": "?"}),
                        "blocked_at": row.get("created_at")} for row in rows]}


@router.post("/blocks/{target_id}", dependencies=WRITE)
def block_user(ctx: Ctx = Depends(access.person("target_id", "block"))):
    """Block someone: neither of you sees the other, follows and friendships between you end, and
    pending requests are cancelled. They aren't told."""
    user_id, db, target_id = ctx.user_id, ctx.db, ctx.person["id"]
    db.table("user_blocks").upsert({"blocker_id": user_id, "blocked_id": target_id, "created_at": graph.now().isoformat()},
                                   on_conflict="blocker_id,blocked_id", ignore_duplicates=True).execute()
    graph.remove_between(db, user_id, target_id)
    return {"blocked": True}


@router.delete("/blocks/{target_id}", dependencies=WRITE)
def unblock_user(target_id: str, ctx: Ctx = Depends(access.own())):
    user_id = ctx.user_id
    target_id = require_uuid(target_id, "user ID")
    ctx.db.table("user_blocks").delete().eq("blocker_id", user_id).eq("blocked_id", target_id).execute()
    return {"blocked": False}


# Follows ------------------------------------------------------------------------------------------
@router.post("/follow/{target_id}", dependencies=WRITE)
def follow(ctx: Ctx = Depends(access.person("target_id"))):
    """Follow someone; it waits for their OK when they approve followers."""
    user_id, db, target = ctx.user_id, ctx.db, ctx.person
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
def unfollow(target_id: str, ctx: Ctx = Depends(access.own())):
    """Stop following, or take back a follow request."""
    user_id = ctx.user_id
    target_id = require_uuid(target_id, "user ID")
    ctx.db.table("follows").delete().eq("follower_id", user_id).eq("followee_id", target_id).execute()
    return {"status": "none"}


def _pending_follow(db, follower_id: str, user_id: str) -> dict:
    follower_id = require_uuid(follower_id, "user ID")
    row = graph.follow_row(db, follower_id, user_id)
    if not row or row.get("status") != "pending":
        raise HTTPException(status_code=404, detail="No follow request from them")
    return row


@router.post("/follow-requests/{follower_id}/approve", dependencies=WRITE)
def approve_follow(ctx: Ctx = Depends(access.person("follower_id"))):
    user_id, db = ctx.user_id, ctx.db
    row = _pending_follow(db, ctx.person["id"], user_id)
    db.table("follows").update({"status": "active"}).eq("follower_id", row["follower_id"]).eq("followee_id", user_id).execute()
    return {"status": "active"}


@router.post("/follow-requests/{follower_id}/decline", dependencies=WRITE)
def decline_follow(follower_id: str, ctx: Ctx = Depends(access.own())):
    user_id, db = ctx.user_id, ctx.db
    row = _pending_follow(db, follower_id, user_id)
    db.table("follows").delete().eq("follower_id", row["follower_id"]).eq("followee_id", user_id).execute()
    return {"status": "none"}


@router.delete("/followers/{follower_id}", dependencies=WRITE)
def remove_follower(follower_id: str, ctx: Ctx = Depends(access.own())):
    """Remove someone who follows you (they aren't told)."""
    user_id = ctx.user_id
    follower_id = require_uuid(follower_id, "user ID")
    ctx.db.table("follows").delete().eq("follower_id", follower_id).eq("followee_id", user_id).execute()
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
def request_friend(ctx: Ctx = Depends(access.person("target_id"))):
    """Send a friend request (their settings decide who may). If they already asked you, this
    accepts theirs. With the strict minor rules on, no one can send a minor a request."""
    user_id, db, target = ctx.user_id, ctx.db, ctx.person
    row = graph.friendship(db, user_id, target["id"])
    if row and row.get("status") == "accepted":
        return {"friendship": "friends"}
    if row and row.get("requested_by") == user_id:
        return {"friendship": "outgoing"}
    if row:  # they asked first
        _befriend(db, user_id, target["id"])
        return {"friendship": "friends"}
    problem = graph.may_request_friend(db, user_id, target)
    if not problem and minors.strict_minor(db, target["id"]):
        problem = "This account doesn't take friend requests."
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
def accept_friend(ctx: Ctx = Depends(access.person("requester_id"))):
    user_id, db, requester_id = ctx.user_id, ctx.db, ctx.person["id"]
    _incoming(db, user_id, requester_id)
    _befriend(db, user_id, requester_id)
    return {"friendship": "friends"}


@router.post("/friends/{requester_id}/decline", dependencies=WRITE)
def decline_friend(requester_id: str, ctx: Ctx = Depends(access.own())):
    user_id, db = ctx.user_id, ctx.db
    row = _incoming(db, user_id, requester_id)
    db.table("friendships").delete().eq("user_a", row["user_a"]).eq("user_b", row["user_b"]).execute()
    return {"friendship": "none"}


@router.delete("/friends/{target_id}", dependencies=WRITE)
def remove_friend(target_id: str, ctx: Ctx = Depends(access.own())):
    """Remove a friend or take back your request. Follows stay; either of you can unfollow."""
    user_id = ctx.user_id
    target_id = require_uuid(target_id, "user ID")
    lo, hi = graph.pair(user_id, target_id)
    ctx.db.table("friendships").delete().eq("user_a", lo).eq("user_b", hi).execute()
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
def list_followers(cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    user_id, db = ctx.user_id, ctx.db
    rows = _newest(db.table("follows").select("follower_id,created_at").eq("followee_id", user_id).eq("status", "active"), cursor)
    return _people(db, user_id, rows, "follower_id")


@router.get("/following")
def list_following(cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    user_id, db = ctx.user_id, ctx.db
    rows = _newest(db.table("follows").select("followee_id,created_at,status").eq("follower_id", user_id).eq("status", "active"), cursor)
    return _people(db, user_id, rows, "followee_id")


def _friend_rows(db, user_id: str, status: str, cursor: Optional[str], key: str) -> list:
    rows = []
    for column, other in (("user_a", "user_b"), ("user_b", "user_a")):
        found = _newest(db.table("friendships").select(f"{other},requested_by,{key}").eq(column, user_id).eq("status", status), cursor, key)
        rows += [{"other": r[other], "requested_by": r.get("requested_by"), key: r.get(key)} for r in found]
    return sorted(rows, key=lambda r: str(r.get(key) or ""), reverse=True)


@router.get("/friends")
def list_friends(cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    user_id, db = ctx.user_id, ctx.db
    return _people(db, user_id, _friend_rows(db, user_id, "accepted", cursor, "accepted_at"), "other", "accepted_at")


@router.get("/requests")
def list_requests(kind: Literal["friend", "follow"] = "friend", direction: Literal["incoming", "outgoing"] = "incoming",
                  cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    """Friend requests (in or out) and follow requests (to you, or yours waiting)."""
    user_id, db = ctx.user_id, ctx.db
    if kind == "follow":
        mine, other = ("followee_id", "follower_id") if direction == "incoming" else ("follower_id", "followee_id")
        rows = _newest(db.table("follows").select(f"{other},created_at").eq(mine, user_id).eq("status", "pending"), cursor)
        return _people(db, user_id, rows, other)
    rows = _friend_rows(db, user_id, "pending", cursor, "created_at")
    rows = [r for r in rows if (r["requested_by"] != user_id) == (direction == "incoming")]
    return _people(db, user_id, rows, "other")


@router.get("/summary")
def summary(ctx: Ctx = Depends(access.own())):
    """Counts for the badges: requests waiting on you and unread notifications."""
    user_id, db = ctx.user_id, ctx.db
    hidden = hidden_from(db, user_id)
    friend_in = [r for r in _friend_rows(db, user_id, "pending", None, "created_at") if r["requested_by"] != user_id and r["other"] not in hidden]
    follow_in = [r for r in (db.table("follows").select("follower_id").eq("followee_id", user_id).eq("status", "pending").execute().data or [])
                 if r["follower_id"] not in hidden]
    unread = db.table("notifications").select("id,payload").eq("user_id", user_id).is_("read_at", "null").limit(100).execute().data or []
    unread = [n for n in unread if (n.get("payload") or {}).get("actor_id") not in hidden]
    return {"incoming_friend_requests": len(friend_in), "incoming_follow_requests": len(follow_in), "unread_notifications": len(unread)}


# Activity and the weekly leaderboard (Stage 10) ---------------------------------------------------
@router.get("/activity", dependencies=[Depends(ai_rate_limit(60, 60))])
def activity_feed(cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    """New public guides from people you follow, guides added to your classrooms and friends'
    streak milestones (only from friends who show their streak), newest first. Read only."""
    return activity.feed(ctx.db, ctx.user_id, cursor)


@router.get("/leaderboard", dependencies=[Depends(ai_rate_limit(60, 60))])
def weekly_leaderboard(ctx: Ctx = Depends(access.own())):
    """This week's effort (active minutes and reviews, never scores) for you and your friends who
    joined. Empty until you join (PATCH /profiles/me leaderboard_opt_in); never for minors."""
    return leaderboard.board(ctx.db, ctx.user_id)
