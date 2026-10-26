"""Google Docs and Notion as places the student works: export guides there, link the draft they're
writing, and keep a Notion course database in sync. The work is in services.docs_sync and
services.notion_sync."""

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from database import get_supabase
from ids import require_uuid
from rate_limit import limiter
from routers.plans import ITEM_KEY, _item
from services import docs_sync, notion_sync

router = APIRouter(tags=["workspace"])


def _own_guide(user_id: str, guide_id: str) -> None:
    require_uuid(guide_id, "guide ID")
    if not get_supabase().table("study_guides").select("id").eq("id", guide_id).eq("user_id", user_id).limit(1).execute().data:
        raise HTTPException(status_code=404, detail="Guide not found")


class DocExport(BaseModel):
    guide_id: str = Field(..., max_length=36)
    title: str = Field(default="", max_length=300)
    markdown: str = Field(..., min_length=1, max_length=1_000_000)


@router.post("/docs/export")
@limiter.limit("10/minute")
def export_doc(body: DocExport, request: Request, authorization: str = Header(default="")):
    """The guide as a formatted Google Doc (in the Cordia Drive folder when Drive is connected)."""
    user_id = get_user_id(authorization)
    _own_guide(user_id, body.guide_id)
    return docs_sync.export_guide(user_id, body.guide_id, body.title, body.markdown)


class DraftLink(BaseModel):
    doc_id: str = Field(..., min_length=5, max_length=200, pattern=r"^[\w-]+$")
    title: str = Field(default="", max_length=300)


@router.put("/plans/{item_key}/draft")
@limiter.limit("10/minute")
def link_draft(item_key: str, body: DraftLink, request: Request, authorization: str = Header(default="")):
    """The Google Doc the student is writing for this assignment: the Tutor reads it with the rubric,
    and Cordia watches it grow."""
    user_id = get_user_id(authorization)
    if not ITEM_KEY.fullmatch(item_key):
        raise HTTPException(status_code=400, detail="Unknown assignment")
    _item(user_id, item_key)
    return {"draft": docs_sync.link_draft(user_id, item_key, body.doc_id, body.title)}


@router.delete("/plans/{item_key}/draft")
def unlink_draft(item_key: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if not ITEM_KEY.fullmatch(item_key):
        raise HTTPException(status_code=400, detail="Unknown assignment")
    docs_sync.unlink_draft(user_id, item_key)
    return {"draft": None}


@router.get("/notion/pages")
@limiter.limit("30/minute")
def notion_pages(request: Request, q: str = "", authorization: str = Header(default="")):
    return {"pages": notion_sync.search_pages(get_user_id(authorization), q)}


@router.get("/notion/home")
def notion_home(authorization: str = Header(default="")):
    return {"home": notion_sync.parent(get_user_id(authorization))}


class NotionHome(BaseModel):
    page_id: str = Field(..., min_length=10, max_length=60, pattern=r"^[\w-]+$")
    title: str = Field(default="", max_length=300)


@router.post("/notion/setup")
@limiter.limit("6/minute")
def notion_setup(body: NotionHome, request: Request, authorization: str = Header(default="")):
    """Make the "Cordia assignments" database under the page the student picked, and fill it."""
    user_id = get_user_id(authorization)
    result = notion_sync.setup(user_id, body.page_id, body.title)
    return {**result, "home": notion_sync.parent(user_id)}


@router.post("/notion/sync")
@limiter.limit("6/minute")
def notion_sync_now(request: Request, authorization: str = Header(default="")):
    return notion_sync.sync_db(get_user_id(authorization))


class NotionExport(BaseModel):
    guide_id: str = Field(..., max_length=36)
    title: str = Field(default="", max_length=300)
    outline: str = Field(default="", max_length=500_000)
    pairs: list[dict] = Field(default_factory=list, max_length=300)


@router.post("/notion/export")
@limiter.limit("10/minute")
def notion_export(body: NotionExport, request: Request, authorization: str = Header(default="")):
    """The guide as a Notion page with each question as a toggle."""
    user_id = get_user_id(authorization)
    _own_guide(user_id, body.guide_id)
    pairs = [{"question": str(p.get("question") or "")[:2000], "answer": str(p.get("answer") or "")[:2000]} for p in body.pairs if isinstance(p, dict)]
    return notion_sync.export_guide(user_id, body.guide_id, body.title, body.outline, pairs)
