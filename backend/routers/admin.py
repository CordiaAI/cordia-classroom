"""Admin review queue: reports, held sets, merge proposals, takedowns, school policy."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from services.canvas_client import CanvasForbiddenRequest, normalize_domain

router = APIRouter(prefix="/admin", tags=["admin"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _id(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID")


def require_admin(authorization: str) -> tuple[str, object]:
    user_id = get_user_id(authorization)
    db = get_supabase()
    if not (db.table("app_admins").select("user_id").eq("user_id", user_id).limit(1).execute().data or []):
        raise HTTPException(status_code=403, detail="Admins only")
    return user_id, db


@router.get("/me")
def admin_me(authorization: str = Header(default="")):
    require_admin(authorization)
    return {"admin": True}


@router.get("/queue")
def queue(authorization: str = Header(default="")):
    _, db = require_admin(authorization)
    reports = db.table("shared_set_reports").select("set_id,reason,created_at").eq("status", "open").execute().data or []
    by_set: dict[str, dict] = {}
    for r in reports:
        entry = by_set.setdefault(r["set_id"], {"set_id": r["set_id"], "count": 0, "reasons": {}})
        entry["count"] += 1
        entry["reasons"][r["reason"]] = entry["reasons"].get(r["reason"], 0) + 1
    flagged_ids = list(by_set)
    sets = {}
    held = db.table("shared_sets").select("id,title,class_id,status,hold_reason,card_count,updated_at").in_("status", ["held", "hidden", "taken_down"]).execute().data or []
    for s in held:
        sets[s["id"]] = s
    missing = [i for i in flagged_ids if i not in sets]
    if missing:
        for s in db.table("shared_sets").select("id,title,class_id,status,hold_reason,card_count,updated_at").in_("id", missing).execute().data or []:
            sets[s["id"]] = s
    class_ids = list({s["class_id"] for s in sets.values()})
    classes = {c["id"]: c["course_code_normalized"] for c in (db.table("classes").select("id,course_code_normalized").in_("id", class_ids).execute().data or [] if class_ids else [])}
    merges = db.table("class_merge_proposals").select("*").eq("status", "pending").execute().data or []
    merge_class_ids = list({m[k] for m in merges for k in ("from_class_id", "into_class_id") if m.get(k)})
    merge_classes = {c["id"]: c["course_code_normalized"] for c in (db.table("classes").select("id,course_code_normalized").in_("id", merge_class_ids).execute().data or [] if merge_class_ids else [])}
    return {
        "sets": [{**s, "class": classes.get(s["class_id"]), "reports": by_set.get(s["id"])} for s in sets.values()],
        "merges": [{**m, "from": merge_classes.get(m.get("from_class_id")), "into": merge_classes.get(m.get("into_class_id"))} for m in merges],
        "takedowns": db.table("copyright_takedowns").select("*").eq("status", "received").order("created_at").execute().data or [],
        "policy": db.table("canvas_school_policy").select("*").order("domain").execute().data or [],
    }


class SetDecision(BaseModel):
    status: Literal["visible", "hidden"]


@router.post("/sets/{set_id}")
def decide_set(set_id: str, body: SetDecision, authorization: str = Header(default="")):
    _, db = require_admin(authorization)
    set_id = _id(set_id)
    db.table("shared_sets").update({"status": body.status, "hold_reason": None, "updated_at": _now()}).eq("id", set_id).execute()
    db.table("shared_set_reports").update({"status": "dismissed" if body.status == "visible" else "upheld"}).eq("set_id", set_id).eq("status", "open").execute()
    return {"ok": True}


class MergeDecision(BaseModel):
    approve: bool


@router.post("/merges/{proposal_id}")
def decide_merge(proposal_id: str, body: MergeDecision, authorization: str = Header(default="")):
    admin_id, db = require_admin(authorization)
    proposal = (db.table("class_merge_proposals").select("*").eq("id", _id(proposal_id)).limit(1).execute().data or [None])[0]
    if not proposal or proposal.get("status") != "pending":
        raise HTTPException(status_code=404, detail="Proposal not found")
    if body.approve:
        source, target = proposal.get("from_class_id"), proposal.get("into_class_id")
        if not source or not target:
            raise HTTPException(status_code=400, detail="Pick a class to merge into")
        target_terms = {t["term"]: t["id"] for t in db.table("class_terms").select("id,term").eq("class_id", target).execute().data or []}
        for term in db.table("class_terms").select("id,term").eq("class_id", source).execute().data or []:
            into = target_terms.get(term["term"])
            if not into:
                db.table("class_terms").update({"class_id": target}).eq("id", term["id"]).execute()
                continue
            for m in db.table("class_memberships").select("*").eq("class_term_id", term["id"]).execute().data or []:
                db.table("class_memberships").upsert({**m, "class_term_id": into}, on_conflict="user_id,class_term_id").execute()
        for table in ("folders", "shared_sets", "canvas_courses"):
            db.table(table).update({"class_id": target}).eq("class_id", source).execute()
        db.table("classes").delete().eq("id", source).execute()
    db.table("class_merge_proposals").update({"status": "approved" if body.approve else "rejected", "reviewed_by": admin_id, "reviewed_at": _now()}).eq("id", proposal["id"]).execute()
    return {"ok": True}


class TakedownDecision(BaseModel):
    action: Literal["actioned", "rejected"]


@router.post("/takedowns/{takedown_id}")
def decide_takedown(takedown_id: str, body: TakedownDecision, authorization: str = Header(default="")):
    _, db = require_admin(authorization)
    row = (db.table("copyright_takedowns").select("*").eq("id", _id(takedown_id)).limit(1).execute().data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Takedown not found")
    if row.get("set_id") and body.action == "rejected":
        db.table("shared_sets").update({"status": "visible"}).eq("id", row["set_id"]).eq("status", "taken_down").execute()
    db.table("copyright_takedowns").update({"status": body.action, "actioned_at": _now()}).eq("id", row["id"]).execute()
    return {"ok": True}


class PolicyRequest(BaseModel):
    domain: str = Field(..., max_length=200)
    school_name: str = Field(default="", max_length=200)
    tokens_allowed: bool
    source_url: Optional[str] = Field(default=None, max_length=500)


@router.put("/policy")
def put_policy(body: PolicyRequest, authorization: str = Header(default="")):
    admin_id, db = require_admin(authorization)
    try:
        domain = normalize_domain(body.domain)
    except CanvasForbiddenRequest as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if body.source_url and not body.source_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Use an https link")
    db.table("canvas_school_policy").upsert({
        "domain": domain, "school_name": body.school_name.strip(), "tokens_allowed": body.tokens_allowed,
        "source_url": body.source_url, "updated_at": _now(), "updated_by": admin_id,
    }, on_conflict="domain").execute()
    return {"ok": True}


@router.delete("/policy/{domain}")
def delete_policy(domain: str, authorization: str = Header(default="")):
    _, db = require_admin(authorization)
    db.table("canvas_school_policy").delete().eq("domain", domain.lower()).execute()
    return {"ok": True}
