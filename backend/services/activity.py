"""The Activity tab on /friends (social plan, Stage 10): what happened lately around a student.

Three kinds of item, newest first, from the last 30 days:
  - guide_published   a public, named guide from someone they follow (never an anonymous one, a
                      guide held for review, or one the student can't see);
  - classroom_guide   a guide or folder added to a classroom they're an active member of (not one
                      held for review); a guide shows only when the student can see it;
  - streak            a friend reached a 7, 30, 100 or 365-day streak, only when that friend shows
                      their streak (user_profiles.show_streak).
Anyone either side has blocked, and profiles held for review, are left out. There are no comments
and no messages: the feed only links to things the student can already open. Built on read from
existing tables; nothing is stored.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from services import classrooms as rooms
from services import guide_access, social_graph
from services.blocks import hidden_from
from services.moderation import held_profile_ids

DAYS = 30
PAGE = 30
MILESTONES = (7, 30, 100, 365)
STREAK_DAYS = 14  # a milestone shows for two weeks


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> str:
    return str(value or "")


def _following(db, viewer: str) -> list:
    return [r["followee_id"] for r in db.table("follows").select("followee_id,status").eq("follower_id", viewer)
            .eq("status", "active").execute().data or []]


def published_guides(db, viewer: str, people: list, since: str) -> list:
    if not people:
        return []
    columns = guide_access.GUIDE_COLUMNS
    try:
        rows = db.table("study_guides").select(columns + ",published_at").in_("user_id", people).eq("visibility", "public") \
            .eq("attribution", "named").eq("review_status", "ok").execute().data or []
        when = lambda g: _iso(g.get("published_at") or g.get("created_at"))  # noqa: E731
    except Exception:  # before migration 20261128120000 (no published_at)
        rows = db.table("study_guides").select(columns).in_("user_id", people).eq("visibility", "public") \
            .eq("attribution", "named").eq("review_status", "ok").execute().data or []
        when = lambda g: _iso(g.get("created_at"))  # noqa: E731
    out = []
    for guide in rows:
        at = when(guide)
        if at >= since and guide_access.can_view(db, viewer, guide):
            out.append({"kind": "guide_published", "at": at, "actor_id": guide["user_id"],
                        "guide": {"id": guide["id"], "title": guide.get("title") or "Untitled",
                                  "question_count": guide_access.question_count(guide)}})
    return out


def classroom_additions(db, viewer: str, since: str) -> list:
    if not rooms.enabled():
        return []
    mine = [m["classroom_id"] for m in db.table("classroom_members").select("classroom_id").eq("user_id", viewer)
            .eq("status", "active").execute().data or []]
    if not mine:
        return []
    found = {r["id"]: r for r in db.table("classrooms").select("*").in_("id", mine).execute().data or []
             if not r.get("archived_at") and (r.get("review_status") or "ok") == "ok"}
    if not found:
        return []
    events = db.table("classroom_activity").select("classroom_id,actor_id,kind,payload,created_at") \
        .in_("classroom_id", list(found)).in_("kind", ["guide_added", "folder_added"]).execute().data or []
    out = []
    for event in events:
        at = _iso(event.get("created_at"))
        item_id = (event.get("payload") or {}).get("item_id")
        if at < since or not item_id or event.get("actor_id") == viewer:
            continue
        room = found[event["classroom_id"]]
        entry = {"kind": "classroom_guide", "at": at, "actor_id": event.get("actor_id"),
                 "classroom": {"id": room["id"], "name": room["name"]}}
        if event["kind"] == "guide_added":
            guide = guide_access.load(db, item_id)
            if not guide or not guide_access.can_view(db, viewer, guide):
                continue
            entry["guide"] = {"id": guide["id"], "title": guide.get("title") or "Untitled", "question_count": guide_access.question_count(guide)}
        else:
            folder = (db.table("folders").select("id,name").eq("id", item_id).limit(1).execute().data or [None])[0]
            if not folder:
                continue
            entry["folder"] = {"id": folder["id"], "name": folder.get("name") or "Folder"}
        out.append(entry)
    return out


def streak_milestones(db, viewer: str, today: Optional[date] = None) -> list:
    """Friends who reached a milestone in the last two weeks and still have that streak going."""
    today = today or _now().date()
    friends = list(social_graph.friend_ids(db, viewer))
    if not friends:
        return []
    shows = {r["id"] for r in db.table("user_profiles").select("id,show_streak").in_("id", friends).execute().data or []
             if r.get("show_streak") is True}
    if not shows:
        return []
    out = []
    for row in db.table("user_streaks").select("user_id,current_streak,last_study_date").in_("user_id", list(shows)).execute().data or []:
        try:
            last = date.fromisoformat(str(row.get("last_study_date"))[:10])
        except ValueError:
            continue
        streak = int(row.get("current_streak") or 0)
        if (today - last).days > 1 or streak < MILESTONES[0]:
            continue  # lapsed
        for milestone in MILESTONES:
            reached = last - timedelta(days=streak - milestone)
            if streak >= milestone and (today - reached).days <= STREAK_DAYS:
                out.append({"kind": "streak", "at": f"{reached.isoformat()}T23:59:59+00:00", "actor_id": row["user_id"], "days": milestone})
    return out


def feed(db, viewer: str, before: Optional[str] = None) -> dict:
    since = (_now() - timedelta(days=DAYS)).isoformat()
    items = published_guides(db, viewer, _following(db, viewer), since) + classroom_additions(db, viewer, since) + streak_milestones(db, viewer)
    hidden = hidden_from(db, viewer) | held_profile_ids(db, [i["actor_id"] for i in items])
    items = [i for i in items if i.get("actor_id") not in hidden]
    people = social_graph.cards(db, [i["actor_id"] for i in items])
    items = [{**i, "actor": people[i["actor_id"]]} for i in items if i.get("actor_id") in people]
    items.sort(key=lambda i: i["at"], reverse=True)
    if before:
        items = [i for i in items if i["at"] < before]
    shown = items[:PAGE]
    for item in shown:
        item.pop("actor_id", None)
    return {"items": shown, "next_cursor": shown[-1]["at"] if len(items) > PAGE else None}
