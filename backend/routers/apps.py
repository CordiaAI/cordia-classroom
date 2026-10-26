"""Phase 5 apps in Classroom: Dropbox class folders, GitHub repos on assignments, Sheets exports and
Slack channels. The work happens in services.dropbox_sync, github_sync, sheets_export and slack_sync."""

from typing import Optional

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, Field

from auth_utils import get_user_id
from rate_limit import limiter
from routers.drive import _own_folder
from routers.plans import ITEM_KEY, _key
from services import dropbox_sync, github_sync, sheets_export, slack_sync

router = APIRouter(tags=["apps"])


# ---- Dropbox: class folders ----

@router.get("/dropbox/folders")
@limiter.limit("30/minute")
def dropbox_folders(request: Request, q: str = "", authorization: str = Header(default="")):
    return {"folders": dropbox_sync.search_folders(get_user_id(authorization), q)}


@router.get("/dropbox/links")
def dropbox_links(authorization: str = Header(default="")):
    return {"links": dropbox_sync.links(get_user_id(authorization))}


class DropboxLink(BaseModel):
    library_folder_id: str = Field(..., max_length=36)
    drive_folder_id: str = Field(..., min_length=2, max_length=300)
    drive_folder_name: str = Field(default="", max_length=300)


@router.put("/dropbox/links")
@limiter.limit("10/minute")
def dropbox_link(body: DropboxLink, request: Request, authorization: str = Header(default="")):
    """Link a Dropbox folder to a class; its files come into the class now and as they change."""
    user_id = get_user_id(authorization)
    _own_folder(user_id, body.library_folder_id)
    result = dropbox_sync.link(user_id, body.library_folder_id, body.drive_folder_id, body.drive_folder_name)
    return {**result, "links": dropbox_sync.links(user_id)}


@router.delete("/dropbox/links/{library_folder_id}")
def dropbox_unlink(library_folder_id: str, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    _own_folder(user_id, library_folder_id)
    dropbox_sync.unlink(user_id, library_folder_id)
    return {"links": dropbox_sync.links(user_id)}


@router.post("/dropbox/sync")
@limiter.limit("6/minute")
def dropbox_sync_now(request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    return {**dropbox_sync.sync_folders(user_id), "links": dropbox_sync.links(user_id)}


# ---- GitHub: a repo on a programming assignment ----

@router.get("/github/repos")
@limiter.limit("30/minute")
def github_repos(request: Request, q: str = "", authorization: str = Header(default="")):
    return {"repos": github_sync.repos(get_user_id(authorization), q)}


class RepoRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=140)
    branch: str = Field(default="main", max_length=100)


@router.get("/plans/{item_key}/repo")
def get_repo(item_key: str, authorization: str = Header(default="")):
    """The linked repo with its commit activity (the slow part, so it's its own request)."""
    return {"repo": github_sync.repo_for(get_user_id(authorization), _key(item_key))}


@router.put("/plans/{item_key}/repo")
@limiter.limit("10/minute")
def link_repo(item_key: str, body: RepoRequest, request: Request, authorization: str = Header(default="")):
    return {"repo": github_sync.link_repo(get_user_id(authorization), _key(item_key), body.full_name, body.branch)}


@router.delete("/plans/{item_key}/repo")
def unlink_repo(item_key: str, authorization: str = Header(default="")):
    github_sync.unlink_repo(get_user_id(authorization), _key(item_key))
    return {"repo": None}


# ---- Google Sheets: grades and study time ----

class SheetsRequest(BaseModel):
    time_zone: Optional[str] = Field(default=None, max_length=64)


@router.get("/sheets/status")
def sheets_status(authorization: str = Header(default="")):
    return sheets_export.status(get_user_id(authorization))


@router.post("/sheets/export")
@limiter.limit("6/minute")
def sheets_export_now(body: SheetsRequest, request: Request, authorization: str = Header(default="")):
    return sheets_export.export(get_user_id(authorization), body.time_zone)


class SheetsAuto(SheetsRequest):
    on: bool


@router.put("/sheets/auto")
def sheets_auto(body: SheetsAuto, authorization: str = Header(default="")):
    return sheets_export.set_auto(get_user_id(authorization), body.on, body.time_zone)


# ---- Slack: watched channels and study sessions ----

@router.get("/slack/channels")
@limiter.limit("20/minute")
def slack_channels(request: Request, q: str = "", authorization: str = Header(default="")):
    return {"channels": slack_sync.channels(get_user_id(authorization), q)}


@router.get("/slack/watched")
def slack_watched(authorization: str = Header(default="")):
    return {"channels": slack_sync.watched(get_user_id(authorization))}


class Channel(BaseModel):
    id: str = Field(..., max_length=30)
    name: str = Field(default="", max_length=80)


class WatchRequest(BaseModel):
    channels: list[Channel] = Field(default_factory=list, max_length=10)


@router.put("/slack/watched")
def slack_set_watched(body: WatchRequest, authorization: str = Header(default="")):
    return {"channels": slack_sync.set_watched(get_user_id(authorization), [c.model_dump() for c in body.channels])}


@router.post("/slack/check")
@limiter.limit("4/minute")
def slack_check(request: Request, authorization: str = Header(default="")):
    return slack_sync.watch(get_user_id(authorization))


class SessionRequest(BaseModel):
    channel: Channel
    topic: str = Field(..., min_length=1, max_length=120)
    when: str = Field(..., max_length=40)
    when_label: str = Field(..., min_length=1, max_length=80)
    place: str = Field(default="", max_length=120)
    remind_minutes: Optional[int] = Field(default=None, ge=5, le=1440)


@router.post("/slack/session")
@limiter.limit("6/minute")
def slack_session(body: SessionRequest, request: Request, authorization: str = Header(default="")):
    """Post a study session to a channel, with an optional reminder before it."""
    return slack_sync.post_session(get_user_id(authorization), body.channel.model_dump(), body.topic, body.when,
                                   body.when_label, body.place, body.remind_minutes)


__all__ = ["router", "ITEM_KEY"]
