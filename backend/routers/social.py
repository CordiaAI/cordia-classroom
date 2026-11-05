"""Social graph (social plan). Stage 1: blocking only. Follows, friends and notifications arrive in
Stage 2 and will also be removed in both directions when someone blocks."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import ai_rate_limit

router = APIRouter(prefix="/social", tags=["social"])


@router.get("/blocks")
def list_blocks(authorization: str = Header(default="")):
    """People you blocked, newest first (for Settings › Privacy)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    rows = db.table("user_blocks").select("blocked_id,created_at").eq("blocker_id", user_id).order("created_at", desc=True).limit(500).execute().data or []
    ids = [row["blocked_id"] for row in rows]
    profiles = {p["id"]: p for p in (db.table("user_profiles").select("id,username,display_name,name").in_("id", ids).execute().data or [])} if ids else {}
    out = []
    for row in rows:
        profile = profiles.get(row["blocked_id"], {})
        shown = (profile.get("display_name") or "").strip() or (profile.get("name") or "").strip().split(" ")[0] or profile.get("username") or "Someone"
        out.append({"user_id": row["blocked_id"], "username": profile.get("username"), "display_name": shown, "blocked_at": row.get("created_at")})
    return {"blocks": out}


@router.post("/blocks/{target_id}", dependencies=[Depends(ai_rate_limit(20, 60))])
def block_user(target_id: str, authorization: str = Header(default="")):
    """Block someone: neither of you sees the other's profile (or, later, follows, friends,
    activity or classroom invites). They aren't told."""
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    if target_id == user_id:
        raise HTTPException(status_code=400, detail="You can't block yourself")
    db = get_supabase()
    if not db.table("user_profiles").select("id").eq("id", target_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="User not found")
    db.table("user_blocks").upsert({"blocker_id": user_id, "blocked_id": target_id, "created_at": datetime.now(timezone.utc).isoformat()},
                                   on_conflict="blocker_id,blocked_id", ignore_duplicates=True).execute()
    return {"blocked": True}


@router.delete("/blocks/{target_id}", dependencies=[Depends(ai_rate_limit(20, 60))])
def unblock_user(target_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    target_id = require_uuid(target_id, "user ID")
    get_supabase().table("user_blocks").delete().eq("blocker_id", user_id).eq("blocked_id", target_id).execute()
    return {"blocked": False}
