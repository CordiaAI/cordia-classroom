"""Classes, class suggestions and class sharing."""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from services.class_catalog import normalize_course_code, suggest_class, term_for
from services.class_db import add_membership, ensure_class, ensure_folder, ensure_school, is_member, remove_membership, user_class_ids
from services.sharing import ranked_entries, upsert_share

logger = logging.getLogger(__name__)
router = APIRouter(tags=["classes"])


def _uuid(value: str, name: str = "ID") -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {name}")


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def _guide(db, user_id: str, guide_id: str, fields: str = "*") -> dict:
    guide = _one(db.table("study_guides").select(fields).eq("id", _uuid(guide_id, "guide ID")).eq("user_id", user_id).limit(1).execute())
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")
    return guide


def _class(db, class_id: str) -> dict:
    row = _one(db.table("classes").select("*").eq("id", _uuid(class_id, "class ID")).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Class not found")
    return row


def _member_class(db, user_id: str, class_id: str) -> dict:
    row = _class(db, class_id)
    if not is_member(db, user_id, row["id"]):
        raise HTTPException(status_code=403, detail="Join this class to see its sets")
    return row


def _label(row: dict) -> str:
    return row["course_code_normalized"]


def _user_classes(db, user_id: str) -> list[dict]:
    ids = user_class_ids(db, user_id)
    if not ids:
        return []
    classes = db.table("classes").select("*").in_("id", ids).execute().data or []
    schools = {s["id"]: s for s in db.table("schools").select("id,name").in_("id", list({c["school_id"] for c in classes})).execute().data or []}
    sets = db.table("shared_sets").select("class_id,cluster_id,id").in_("class_id", ids).eq("visibility", "class").eq("status", "visible").execute().data or []
    folders = {f["class_id"]: f["id"] for f in db.table("folders").select("id,class_id").eq("user_id", user_id).in_("class_id", ids).execute().data or []}
    courses = db.table("canvas_courses").select("class_id,topic_summary").eq("user_id", user_id).in_("class_id", ids).execute().data or []
    summaries = {c["class_id"]: c.get("topic_summary") or "" for c in courses}
    out = []
    for c in classes:
        clusters = {s.get("cluster_id") or s["id"] for s in sets if s["class_id"] == c["id"]}
        out.append({
            "id": c["id"], "code": c["course_code_normalized"], "name": c.get("display_name") or "",
            "school": schools.get(c["school_id"], {}).get("name"), "shared_count": len(clusters),
            "sharing_blocked": bool(c.get("sharing_blocked")), "folder_id": folders.get(c["id"]),
            "summary": summaries.get(c["id"], ""),
        })
    return sorted(out, key=lambda c: c["code"])


# ---------------------------------------------------------------------------
# Classes
# ---------------------------------------------------------------------------
class AddClassRequest(BaseModel):
    school_id: Optional[str] = None
    school_name: Optional[str] = Field(default=None, max_length=200)
    code: str = Field(..., min_length=2, max_length=60)
    name: str = Field(default="", max_length=200)
    term: Optional[str] = Field(default=None, max_length=60)


@router.get("/classes")
def list_classes(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    classes = _user_classes(get_supabase(), user_id)
    for c in classes:
        c.pop("summary", None)
    return {"classes": classes}


@router.get("/classes/schools")
def search_schools(q: str = "", authorization: str = Header(default="")):
    get_user_id(authorization)
    q = re.sub(r"[%_,()]", " ", q).strip()
    if len(q) < 2:
        return {"schools": []}
    rows = get_supabase().table("schools").select("id,name,canvas_domain").ilike("name", f"%{q}%").limit(8).execute().data or []
    return {"schools": rows}


@router.get("/classes/catalog")
def search_catalog(school_id: str, q: str = "", authorization: str = Header(default="")):
    get_user_id(authorization)
    code = re.sub(r"[^A-Za-z0-9 ]", " ", q).upper().strip()
    query = get_supabase().table("classes").select("id,course_code_normalized,display_name").eq("school_id", _uuid(school_id, "school ID"))
    if code:
        spaced = re.sub(r"([A-Z]+)\s*([0-9])", r"\1 \2", code)
        query = query.ilike("course_code_normalized", spaced + "%")
    rows = query.limit(8).execute().data or []
    return {"classes": [{"id": r["id"], "code": r["course_code_normalized"], "name": r.get("display_name") or ""} for r in rows]}


@router.post("/classes")
def add_class(body: AddClassRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    if body.school_id:
        school = _one(db.table("schools").select("*").eq("id", _uuid(body.school_id, "school ID")).limit(1).execute())
        if not school:
            raise HTTPException(status_code=404, detail="School not found")
    elif body.school_name and body.school_name.strip():
        school = ensure_school(db, body.school_name.strip())
    else:
        raise HTTPException(status_code=400, detail="Pick a school")
    if not normalize_course_code(body.code).code:
        raise HTTPException(status_code=400, detail="Use a course code like MGT 300")
    class_row = ensure_class(db, school["id"], body.code, body.name.strip())
    add_membership(db, user_id, class_row, (body.term or "").strip() or term_for(), "manual")
    return {"class": next(c for c in _user_classes(db, user_id) if c["id"] == class_row["id"])}


@router.delete("/classes/{class_id}")
def leave_class(class_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    remove_membership(get_supabase(), user_id, _uuid(class_id, "class ID"))
    return {"ok": True}


@router.get("/classes/{class_id}")
def class_page(class_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _member_class(db, user_id, class_id)
    sets = db.table("shared_sets").select("id,owner_id,title,card_count,updated_at,owner_name,cluster_id,version,status,visibility") \
        .eq("class_id", row["id"]).eq("visibility", "class").eq("status", "visible").execute().data or []
    school = _one(db.table("schools").select("name").eq("id", row["school_id"]).limit(1).execute()) or {}
    return {
        "class": {"id": row["id"], "code": row["course_code_normalized"], "name": row.get("display_name") or "",
                  "school": school.get("name"), "sharing_blocked": bool(row.get("sharing_blocked"))},
        "sets": [] if row.get("sharing_blocked") else ranked_entries(db, sets, user_id),
    }


@router.get("/classes/{class_id}/deadlines")
def class_deadlines(class_id: str, authorization: str = Header(default="")):
    """Your own Canvas deadlines for this class. Never anyone else's."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _member_class(db, user_id, class_id)
    courses = [c["canvas_course_id"] for c in db.table("canvas_courses").select("canvas_course_id").eq("user_id", user_id).eq("class_id", row["id"]).execute().data or []]
    items = []
    if courses:
        items = db.table("canvas_assignments").select("title,due_at").eq("user_id", user_id).in_("canvas_course_id", courses).order("due_at").execute().data or []
    now = datetime.now(timezone.utc).isoformat()
    return {"deadlines": [i for i in items if i.get("due_at") and i["due_at"] >= now][:50]}


# ---------------------------------------------------------------------------
# Suggestions and filing
# ---------------------------------------------------------------------------
def _file(db, user_id: str, guide: dict, class_row: dict) -> dict:
    folder = ensure_folder(db, user_id, class_row)
    db.table("study_guides").update({"folder_id": folder["id"]}).eq("id", guide["id"]).eq("user_id", user_id).execute()
    default = _one(db.table("class_share_defaults").select("share").eq("user_id", user_id).eq("class_id", class_row["id"]).limit(1).execute())
    shared = None
    if default and default.get("share") and not class_row.get("sharing_blocked"):
        full = _guide(db, user_id, guide["id"], "id,title,study_guide,flashcards")
        shared = upsert_share(db, user_id, full, class_row["id"], "class")
    return {
        "folder_id": folder["id"], "class_id": class_row["id"], "code": _label(class_row),
        "ask_share": default is None and not class_row.get("sharing_blocked"),
        "sharing_blocked": bool(class_row.get("sharing_blocked")),
        "shared": bool(shared and shared.get("visibility") == "class"),
        "held": bool(shared and shared.get("status") == "held"),
    }


@router.get("/classes/suggest/{guide_id}")
def suggest(guide_id: str, authorization: str = Header(default="")):
    """One class for a new guide. At >= 90% with one plausible class it is filed automatically."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, guide_id, "id,title,study_guide,notes,folder_id,linked_set_id")
    if guide.get("linked_set_id") or _guide_class(db, user_id, guide):
        return {"suggestion": None}
    classes = _user_classes(db, user_id)
    if not classes:
        return {"suggestion": None}
    match = suggest_class(guide.get("title") or "", f"{guide.get('study_guide') or ''}\n{guide.get('notes') or ''}"[:60000],
                          [{"id": c["id"], "code": c["code"], "name": c["name"], "summary": c["summary"]} for c in classes])
    if not match:
        return {"suggestion": None}
    chosen = next(c for c in classes if c["id"] == match.class_id)
    out = {"class_id": chosen["id"], "code": chosen["code"], "name": chosen["name"], "confidence": match.confidence, "auto": match.auto}
    if match.auto:
        out["previous_folder_id"] = guide.get("folder_id")
        out.update(_file(db, user_id, guide, _class(db, chosen["id"])))
    return {"suggestion": out}


class FileRequest(BaseModel):
    guide_id: str
    class_id: str


@router.post("/classes/file")
def file_guide(body: FileRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    class_row = _member_class(db, user_id, body.class_id)
    return _file(db, user_id, _guide(db, user_id, body.guide_id, "id,folder_id"), class_row)


class UndoFileRequest(BaseModel):
    guide_id: str
    folder_id: Optional[str] = None


@router.post("/classes/unfile")
def unfile_guide(body: UndoFileRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, body.guide_id, "id")
    folder_id = _uuid(body.folder_id, "folder ID") if body.folder_id else None
    if folder_id and not _one(db.table("folders").select("id").eq("id", folder_id).eq("user_id", user_id).limit(1).execute()):
        raise HTTPException(status_code=404, detail="Folder not found")
    db.table("study_guides").update({"folder_id": folder_id}).eq("id", guide["id"]).eq("user_id", user_id).execute()
    db.table("shared_sets").update({"visibility": "private"}).eq("guide_id", guide["id"]).eq("owner_id", user_id).execute()
    return {"ok": True}


class ShareDefaultRequest(BaseModel):
    share: bool
    guide_id: Optional[str] = None


@router.post("/classes/{class_id}/share-default")
def share_default(class_id: str, body: ShareDefaultRequest, authorization: str = Header(default="")):
    """The one-time "Share with MGT 300?" answer; it becomes the default for this class."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    class_row = _member_class(db, user_id, class_id)
    db.table("class_share_defaults").upsert({"user_id": user_id, "class_id": class_row["id"], "share": body.share}, on_conflict="user_id,class_id").execute()
    result = {"share": body.share}
    if body.guide_id:
        guide = _guide(db, user_id, body.guide_id, "id,title,study_guide,flashcards")
        saved = upsert_share(db, user_id, guide, class_row["id"], "class" if body.share else "private")
        result.update({"visibility": saved.get("visibility"), "status": saved.get("status")})
    return result


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------
class VisibilityRequest(BaseModel):
    visibility: Literal["private", "class"]


def _guide_class(db, user_id: str, guide: dict) -> Optional[dict]:
    if not guide.get("folder_id"):
        return None
    folder = _one(db.table("folders").select("class_id").eq("id", guide["folder_id"]).eq("user_id", user_id).limit(1).execute())
    return _class(db, folder["class_id"]) if folder and folder.get("class_id") else None


@router.get("/sharing/guides/{guide_id}")
def guide_sharing(guide_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, guide_id, "id,folder_id,linked_set_id,linked_set_version")
    class_row = _guide_class(db, user_id, guide)
    shared = _one(db.table("shared_sets").select("id,visibility,status,version").eq("guide_id", guide["id"]).limit(1).execute())
    update_available = False
    if guide.get("linked_set_id"):
        source = _one(db.table("shared_sets").select("version,status,visibility").eq("id", guide["linked_set_id"]).limit(1).execute())
        update_available = bool(source and source.get("status") == "visible" and int(source.get("version") or 1) > int(guide.get("linked_set_version") or 1))
    return {
        "class": {"id": class_row["id"], "code": _label(class_row), "sharing_blocked": bool(class_row.get("sharing_blocked"))} if class_row else None,
        "visibility": shared.get("visibility") if shared else "private",
        "status": shared.get("status") if shared else None,
        "linked": bool(guide.get("linked_set_id")),
        "update_available": update_available,
    }


@router.put("/sharing/guides/{guide_id}")
def set_visibility(guide_id: str, body: VisibilityRequest, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, guide_id, "id,title,study_guide,flashcards,folder_id,linked_set_id")
    if guide.get("linked_set_id") and body.visibility == "class":
        raise HTTPException(status_code=400, detail="Saved copies can't be shared again")
    class_row = _guide_class(db, user_id, guide)
    if not class_row:
        raise HTTPException(status_code=400, detail="Add this guide to a class first")
    if body.visibility == "class" and class_row.get("sharing_blocked"):
        raise HTTPException(status_code=403, detail="Sharing is off for this class")
    saved = upsert_share(db, user_id, guide, class_row["id"], body.visibility)
    return {"visibility": saved.get("visibility"), "status": saved.get("status")}


class SharingSettings(BaseModel):
    show_first_name: bool


@router.get("/sharing/settings")
def get_sharing_settings(authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    row = _one(get_supabase().table("sharing_settings").select("show_first_name").eq("user_id", user_id).limit(1).execute())
    return {"show_first_name": bool(row and row.get("show_first_name"))}


@router.put("/sharing/settings")
def put_sharing_settings(body: SharingSettings, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    db.table("sharing_settings").upsert({"user_id": user_id, "show_first_name": body.show_first_name}, on_conflict="user_id").execute()
    from services.sharing import owner_name
    db.table("shared_sets").update({"owner_name": owner_name(db, user_id)}).eq("owner_id", user_id).execute()
    return {"show_first_name": body.show_first_name}


def _readable_set(db, user_id: str, set_id: str) -> dict:
    row = _one(db.table("shared_sets").select("*").eq("id", _uuid(set_id, "set ID")).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Set not found")
    if row["owner_id"] == user_id:
        return row
    if row.get("visibility") != "class" or row.get("status") != "visible" or not is_member(db, user_id, row["class_id"]):
        raise HTTPException(status_code=404, detail="Set not found")
    return row


@router.get("/sharing/sets/{set_id}")
def get_set(set_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    row = _readable_set(get_supabase(), user_id, set_id)
    return {"set": {k: row.get(k) for k in ("id", "title", "study_guide", "flashcards", "card_count", "owner_name", "version", "updated_at")}}


@router.post("/sharing/sets/{set_id}/save")
def save_copy(set_id: str, authorization: str = Header(default="")):
    """A linked copy in your Library. Your progress on it is yours."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _readable_set(db, user_id, set_id)
    existing = _one(db.table("study_guides").select("id").eq("user_id", user_id).eq("linked_set_id", row["id"]).limit(1).execute())
    if existing:
        return {"guide_id": existing["id"]}
    folder = ensure_folder(db, user_id, _class(db, row["class_id"]))
    guide = _one(db.table("study_guides").insert({
        "user_id": user_id, "title": row["title"], "study_guide": row["study_guide"], "flashcards": row["flashcards"],
        "folder_id": folder["id"], "linked_set_id": row["id"], "linked_set_version": row.get("version") or 1,
    }).execute())
    return {"guide_id": guide["id"]}


@router.post("/sharing/guides/{guide_id}/update")
def update_copy(guide_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, guide_id, "id,linked_set_id")
    if not guide.get("linked_set_id"):
        raise HTTPException(status_code=400, detail="This guide isn't a saved copy")
    row = _readable_set(db, user_id, guide["linked_set_id"])
    db.table("study_guides").update({
        "title": row["title"], "study_guide": row["study_guide"], "flashcards": row["flashcards"], "linked_set_version": row.get("version") or 1,
    }).eq("id", guide["id"]).eq("user_id", user_id).execute()
    return {"ok": True}


class ReportRequest(BaseModel):
    reason: Literal["wrong", "copied_exam", "copyright", "inappropriate"]


@router.post("/sharing/sets/{set_id}/report")
def report_set(set_id: str, body: ReportRequest, authorization: str = Header(default="")):
    """Three distinct reports hide a set until reviewed (a database trigger enforces it)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    row = _readable_set(db, user_id, set_id)
    if row["owner_id"] == user_id:
        raise HTTPException(status_code=400, detail="You can't report your own set")
    db.table("shared_set_reports").upsert({"set_id": row["id"], "reporter_id": user_id, "reason": body.reason}, on_conflict="set_id,reporter_id").execute()
    # The database trigger does this too; repeating it here keeps the rule if the trigger is ever missing.
    open_reports = db.table("shared_set_reports").select("reporter_id").eq("set_id", row["id"]).eq("status", "open").execute().data or []
    if len({r["reporter_id"] for r in open_reports}) >= 3:
        db.table("shared_sets").update({"status": "hidden"}).eq("id", row["id"]).eq("status", "visible").execute()
    return {"ok": True}


class StudiedRequest(BaseModel):
    accuracy: Optional[float] = Field(default=None, ge=0, le=100)


@router.post("/sharing/guides/{guide_id}/studied")
def studied(guide_id: str, body: StudiedRequest, authorization: str = Header(default="")):
    """Counts you as a studier of the set your saved copy came from (for ranking only)."""
    user_id = get_user_id(authorization)
    db = get_supabase()
    guide = _guide(db, user_id, guide_id, "id,linked_set_id")
    if not guide.get("linked_set_id"):
        return {"ok": True}
    db.table("shared_set_studiers").upsert({
        "set_id": guide["linked_set_id"], "user_id": user_id, "accuracy": body.accuracy,
        "last_studied_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="set_id,user_id").execute()
    return {"ok": True}
