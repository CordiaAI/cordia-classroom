"""Admin review queue: reports (guides, profiles, classrooms), held sets, merge proposals,
takedowns, school policy."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

import access
from access import Ctx
from auth_utils import get_user_id
from database import get_supabase
from services import reports as report_service
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
def queue(type: Optional[Literal["guide", "profile", "classroom"]] = None, authorization: str = Header(default="")):
    """Everything waiting on an admin. `reports` groups open reports by target (type filters it)."""
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
    try:
        requests = db.table("classrooms").select("id,name,description,owner_id,class_id,created_at") \
            .eq("instructor_request", "requested").is_("archived_at", "null").order("created_at").limit(200).execute().data or []
        owners = {p["id"]: p for p in (db.table("user_profiles").select("id,email,username,name").in_("id", list({r["owner_id"] for r in requests})).execute().data or [])} if requests else {}
        requests = [{**r, "owner": owners.get(r["owner_id"])} for r in requests]
    except Exception:  # before the Stage 5 migration
        requests = []
    return {
        "reports": report_service.queue(db, type),
        "classrooms": requests,
        "sets": [{**s, "class": classes.get(s["class_id"]), "reports": by_set.get(s["id"])} for s in sets.values()],
        "guides": guides,
        "merges": [{**m, "from": merge_classes.get(m.get("from_class_id")), "into": merge_classes.get(m.get("into_class_id"))} for m in merges],
        "takedowns": _takedown_queue(db),
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


class ClassroomDecision(BaseModel):
    approve: bool


@router.post("/classrooms/{classroom_id}")
def decide_classroom(classroom_id: str, body: ClassroomDecision, authorization: str = Header(default="")):
    """An instructor-class request: approve it (it becomes an instructor class) or decline it (it
    stays a study group)."""
    _, db = require_admin(authorization)
    room = (db.table("classrooms").select("id,instructor_request").eq("id", _id(classroom_id)).limit(1).execute().data or [None])[0]
    if not room or room.get("instructor_request") != "requested":
        raise HTTPException(status_code=404, detail="Request not found")
    change = {"instructor_request": "approved", "kind": "instructor_class"} if body.approve else {"instructor_request": "declined"}
    db.table("classrooms").update(change).eq("id", room["id"]).execute()
    return {"ok": True, **change}


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


class ReportDecision(BaseModel):
    decision: Literal["clear", "hide"]


@router.post("/reports/{target_type}/{target_id}")
def decide_reports(target_type: Literal["guide", "profile", "classroom"], target_id: str, body: ReportDecision,
                   ctx: Ctx = Depends(access.admin())):
    """Clear the reports (the target is back for everyone) or keep it hidden from everyone but its
    owner (and a classroom's staff)."""
    target_id = _id(target_id)
    try:
        report_service.decide(ctx.db, target_type, target_id, body.decision)
    except Exception:  # before migration 20261126120000 a profile or classroom has no review status
        raise HTTPException(status_code=503, detail="This needs the Stage 9 database update first.")
    return {"ok": True}


def _takedown_queue(db) -> list[dict]:
    """Open copyright reports with what staff need to decide: the reporter, the work claimed, the
    link, the item it points to (title, who can see it now, whether it's held) and its owner."""
    rows = db.table("copyright_takedowns").select("*").eq("status", "received").order("created_at").execute().data or []
    guide_ids = list({r["guide_id"] for r in rows if r.get("guide_id")})
    set_ids = list({r["set_id"] for r in rows if r.get("set_id")})
    guides, sets = {}, {}
    if guide_ids:
        try:
            guides = {g["id"]: g for g in db.table("study_guides").select("id,user_id,title,visibility,review_status,hold_reason").in_("id", guide_ids).execute().data or []}
        except Exception:  # before the Stage 3 migration
            guides = {g["id"]: g for g in db.table("study_guides").select("id,user_id,title").in_("id", guide_ids).execute().data or []}
    if set_ids:
        sets = {s["id"]: s for s in db.table("shared_sets").select("id,owner_id,title,visibility,status,hold_reason").in_("id", set_ids).execute().data or []}

    def owner_of(row):
        return (guides.get(row.get("guide_id")) or {}).get("user_id") or (sets.get(row.get("set_id")) or {}).get("owner_id") or row.get("profile_id")
    owner_ids = list({owner_of(r) for r in rows} - {None})
    owners = {p["id"]: p for p in (db.table("user_profiles").select("*").in_("id", owner_ids).execute().data or [])} if owner_ids else {}
    out = []
    for row in rows:
        guide, shared = guides.get(row.get("guide_id")), sets.get(row.get("set_id"))
        owner = owners.get(owner_of(row))
        profile = owner if row.get("profile_id") and not (guide or shared) else None
        out.append({
            **row,
            "target": {
                "kind": "profile" if profile else "guide" if (guide or shared) else None,
                "title": (guide or {}).get("title") or (shared or {}).get("title") or (f"@{profile.get('username')}" if profile and profile.get("username") else ""),
                "guide_visibility": (guide or {}).get("visibility"),
                "guide_status": (guide or {}).get("review_status"),
                "set_visibility": (shared or {}).get("visibility"),
                "set_status": (shared or {}).get("status"),
                "profile_visibility": (profile or {}).get("profile_visibility"),
                "profile_status": (profile or {}).get("review_status"),
                "found": bool(guide or shared or profile),
            },
            "owner": {key: owner.get(key) for key in ("id", "username", "name", "email")} if owner else ({"id": owner_of(row)} if owner_of(row) else None),
        })
    return out


def _open_takedown(db, takedown_id: str) -> dict:
    row = (db.table("copyright_takedowns").select("*").eq("id", _id(takedown_id)).limit(1).execute().data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Takedown not found")
    if row.get("status") != "received":
        raise HTTPException(status_code=409, detail="This report was already decided")
    return row


NEEDS_MIGRATION = "Apply migration 20261127120000 first"


@router.post("/takedowns/{takedown_id}/hold")
def hold_takedown(takedown_id: str, authorization: str = Header(default="")):
    """A temporary hold on a guide or class set while staff confirm the reporter: hidden from
    everyone but its owner. Only an item that is visible now is held, and its state is recorded so
    a rejection puts it back. Profiles aren't held from here."""
    from services import takedowns
    admin_id, db = require_admin(authorization)
    row = _open_takedown(db, takedown_id)
    if not (row.get("guide_id") or row.get("set_id")):
        raise HTTPException(status_code=400, detail="Only a guide or class set can be held from here")
    try:
        takedowns.hold(db, row, admin_id)
    except takedowns.NeedsMigration:
        raise HTTPException(status_code=503, detail=NEEDS_MIGRATION)
    return {"ok": True}


class TakedownDecision(BaseModel):
    action: Literal["actioned", "rejected"]
    # "Reporter confirmed by email from support@cordiaai.io": required to take something down.
    reporter_confirmed: bool = False


@router.post("/takedowns/{takedown_id}")
def decide_takedown(takedown_id: str, body: TakedownDecision, authorization: str = Header(default="")):
    """Take down (only once a staff member confirmed the reporter by email) or reject. Rejecting puts
    back only what this report changed; a hold for any other reason stays."""
    from services import takedowns
    admin_id, db = require_admin(authorization)
    row = _open_takedown(db, takedown_id)
    decided = {"status": body.action, "actioned_at": _now()}
    if body.action == "actioned":
        if not (body.reporter_confirmed or row.get("confirmed_at")):
            raise HTTPException(status_code=400, detail="Confirm the reporter by email from support@cordiaai.io first")
        try:
            if not row.get("confirmed_at"):
                db.table("copyright_takedowns").update({"confirmed_by": admin_id, "confirmed_at": _now()}).eq("id", row["id"]).execute()
            takedowns.take_down(db, row, admin_id)
        except takedowns.NeedsMigration:
            raise HTTPException(status_code=503, detail=NEEDS_MIGRATION)
        except Exception as error:
            if "confirmed_" in str(error) or "column" in str(error):
                raise HTTPException(status_code=503, detail=NEEDS_MIGRATION)
            raise
    else:
        takedowns.restore(db, row)
    try:
        db.table("copyright_takedowns").update({**decided, "actioned_by": admin_id}).eq("id", row["id"]).execute()
    except Exception:  # before migration 20261127120000 (no actioned_by)
        db.table("copyright_takedowns").update(decided).eq("id", row["id"]).execute()
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
