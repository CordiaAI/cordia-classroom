"""Notifications (social plan, Stage 2): follows, follow requests, friend requests, accepted
friend requests, and classroom invites from friends (Stage 5). Written by services/social_graph.notify; read and marked here. Anything from a
person either side has blocked, or who no longer has a profile, is left out."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import access
from access import Ctx
from rate_limit import ai_rate_limit
from services import social_graph as graph
from services.blocks import hidden_from

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(cursor: Optional[str] = Query(default=None, max_length=64), ctx: Ctx = Depends(access.own())):
    """Your notifications, newest first, with who did it."""
    user_id, db = ctx.user_id, ctx.db
    query = db.table("notifications").select("id,kind,payload,read_at,created_at").eq("user_id", user_id)
    if cursor:
        query = query.lt("created_at", cursor)
    rows = query.order("created_at", desc=True).limit(graph.PAGE + 1).execute().data or []
    hidden = hidden_from(db, user_id)
    rows = [r for r in rows if (r.get("payload") or {}).get("actor_id") not in hidden]
    people = graph.cards(db, [(r.get("payload") or {}).get("actor_id") for r in rows])
    items = []
    for row in rows:
        actor = people.get((row.get("payload") or {}).get("actor_id"))
        if not actor or row.get("kind") not in graph.NOTIFY_KINDS:
            continue
        item = {"id": row["id"], "kind": row["kind"], "read": bool(row.get("read_at")), "created_at": row.get("created_at"), "actor": actor}
        if row["kind"] == "classroom_invite":  # Stage 5: the classroom and its one-time invite
            payload = row.get("payload") or {}
            item["classroom"] = {"id": payload.get("classroom_id"), "name": payload.get("name"), "token": payload.get("token")}
        items.append(item)
    shown, next_cursor = graph.page(items)
    return {"items": shown, "next_cursor": next_cursor}


class ReadRequest(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=200)
    all: bool = False


@router.post("/read", dependencies=[Depends(ai_rate_limit(60, 60))])
def mark_read(body: ReadRequest, ctx: Ctx = Depends(access.own())):
    """Mark some of your notifications read, or all of them."""
    user_id, db = ctx.user_id, ctx.db
    query = db.table("notifications").update({"read_at": graph.now().isoformat()}).eq("user_id", user_id).is_("read_at", "null")
    if not body.all:
        if not body.ids:
            return {"read": 0}
        query = query.in_("id", body.ids)
    return {"read": len(query.execute().data or [])}
