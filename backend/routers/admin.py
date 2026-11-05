"""Admin review queue: reports, held sets, merge proposals, takedowns, school policy."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query
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


@router.get("/metrics")
def metrics(days: int = Query(default=30, ge=1, le=180), authorization: str = Header(default="")):
    """Recall activation and D1/D7 return for recent signups (personalization plan step 0.4)."""
    from services.metrics import load_activation
    _, db = require_admin(authorization)
    return load_activation(db, days)


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
    try:
        guides = db.table("study_guides").select("id,title,visibility,review_status,hold_reason,created_at") \
            .in_("review_status", ["held", "hidden"]).order("created_at", desc=True).limit(200).execute().data or []
    except Exception:  # before the Stage 3 migration
        guides = []
    return {
        "sets": [{**s, "class": classes.get(s["class_id"]), "reports": by_set.get(s["id"])} for s in sets.values()],
        "guides": guides,
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
    # The guide behind the set follows the decision, so its own page agrees with Class sets.
    row = (db.table("shared_sets").select("guide_id").eq("id", set_id).limit(1).execute().data or [None])[0]
    if row and row.get("guide_id"):
        _decide_guide(db, row["guide_id"], "ok" if body.status == "visible" else "hidden")
    return {"ok": True}


def _decide_guide(db, guide_id: str, status: str) -> None:
    try:
        db.table("study_guides").update({"review_status": status, "hold_reason": None}).eq("id", guide_id).execute()
    except Exception:  # before the Stage 3 migration
        pass


class GuideDecision(BaseModel):
    status: Literal["ok", "hidden"]


@router.post("/guides/{guide_id}")
def decide_guide(guide_id: str, body: GuideDecision, authorization: str = Header(default="")):
    """Release a held guide (ok) or keep it hidden from everyone but its owner."""
    _, db = require_admin(authorization)
    guide_id = _id(guide_id)
    _decide_guide(db, guide_id, body.status)
    db.table("shared_sets").update({"status": "visible" if body.status == "ok" else "hidden", "hold_reason": None, "updated_at": _now()}) \
        .eq("guide_id", guide_id).in_("status", ["held", "hidden", "visible"]).execute()
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
    # A report holds the guide and its class set; the decision either removes them or lets them back.
    if row.get("set_id"):
        if body.action == "rejected":
            db.table("shared_sets").update({"status": "visible", "hold_reason": None}).eq("id", row["set_id"]).in_("status", ["held", "taken_down"]).execute()
        else:
            db.table("shared_sets").update({"status": "taken_down"}).eq("id", row["set_id"]).execute()
    if row.get("guide_id"):
        _decide_guide(db, row["guide_id"], "ok" if body.action == "rejected" else "hidden")
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
