"""Studying a whole classroom, and its Progress tab (social plan, Stage 6).

A classroom's guides are its guide items plus every guide in its shared folders, as each member is
allowed to see them (services/guide_access.can_view). A member's progress on a guide is theirs:
  - on their own guide, the guide's flashcard_progress (position-keyed, as today);
  - on someone else's, their guide_progress row (idea-keyed, Stage 4).
Both are turned into {idea_id: entry} here, so readiness, the group view and the session read one
shape. Readiness uses Learn's weights (web/lib/learnEngine.mjs readiness): mastered 1, familiar 0.5
(a fading mastered idea counts as familiar), learning 0.15, new 0.

Privacy: a study group sees an anonymous "knows / still learning" count per question only where
at least GROUP_MIN members have studied that guide; an instructor class shows staff each member's
readiness only for members who chose to share it (progress_visible_to_staff). Nobody else's
progress ever leaves the server otherwise.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from services import guide_access as access
from services import guide_versions as versions

MAX_GUIDES = 30
GROUP_MIN = 3
FADE_DAYS = 5
STUDY_COLUMNS = access.GUIDE_COLUMNS + ",quiz_questions"


def classroom_guides(db, viewer: str, room_id: str, limit: int = MAX_GUIDES) -> list:
    """The guides this member can study in the classroom, in the classroom's order (guide items,
    then each folder's guides by title), at most `limit`."""
    items = db.table("classroom_items").select("item_type,item_id,position").eq("classroom_id", room_id).order("position").execute().data or []
    guide_ids = [i["item_id"] for i in items if i["item_type"] == "guide"]
    folder_ids = [i["item_id"] for i in items if i["item_type"] == "folder"]
    direct = {g["id"]: g for g in (db.table("study_guides").select(STUDY_COLUMNS).in_("id", guide_ids).execute().data or [])} if guide_ids else {}
    folders = {f["id"]: f for f in (db.table("folders").select("id,user_id").in_("id", folder_ids).execute().data or [])} if folder_ids else {}
    in_folder = {}
    if folders:
        for guide in db.table("study_guides").select(STUDY_COLUMNS).in_("folder_id", list(folders)).execute().data or []:
            folder = folders.get(guide.get("folder_id"))
            if folder and folder.get("user_id") == guide.get("user_id"):
                in_folder.setdefault(folder["id"], []).append(guide)
    out, seen = [], set()
    for item in items:
        batch = [direct.get(item["item_id"])] if item["item_type"] == "guide" else sorted(in_folder.get(item["item_id"], []), key=lambda g: str(g.get("title") or ""))
        for guide in batch:
            if guide and guide["id"] not in seen and access.can_view(db, viewer, guide):
                seen.add(guide["id"])
                out.append(guide)
                if len(out) >= limit:
                    return out
    return out


def owner_progress(db, guide: dict) -> dict:
    row = (db.table("study_guides").select("flashcard_progress").eq("id", guide["id"]).limit(1).execute().data or [{}])[0]
    return row.get("flashcard_progress") if isinstance(row.get("flashcard_progress"), dict) else {}


def member_ideas(db, user_id: str, guide: dict, content: dict, questions: list, rows: Optional[dict] = None) -> dict:
    """{idea_id: entry} of one member's progress on a guide. rows: preloaded guide_progress rows
    by user id (the group view loads them once per guide)."""
    if user_id == guide.get("user_id"):
        return versions.by_idea(owner_progress(db, guide), content["cards"], questions)
    if rows is not None:
        return (rows.get(user_id) or {}).get("progress") or {}
    try:
        found = (db.table("guide_progress").select("progress").eq("user_id", user_id).eq("guide_id", guide["id"]).limit(1).execute().data or [])
    except Exception:  # before the Stage 4 migration
        return {}
    return (found[0].get("progress") or {}) if found else {}


def _days(a: str, b: str) -> int:
    try:
        return (date.fromisoformat(str(b)[:10]) - date.fromisoformat(str(a)[:10])).days
    except ValueError:
        return 0


def level_of(entry: Optional[dict], today: str) -> str:
    """new | learning | familiar | mastered for one idea (fading mastered counts as familiar)."""
    if not isinstance(entry, dict) or entry.get("archived"):
        return "new"
    level = entry.get("l")
    if isinstance(level, int):
        if level >= 3:
            return "familiar" if entry.get("at") and _days(entry["at"], today) >= FADE_DAYS else "mastered"
        return ("new", "learning", "familiar")[max(0, level)]
    if entry.get("known") is True:
        return "familiar"
    if entry.get("known") is False or "box" in entry:
        return "learning"
    return "new"


def tally(ideas_list: list, progress: dict, today: str) -> dict:
    out = {"total": 0, "new": 0, "learning": 0, "familiar": 0, "mastered": 0}
    for idea in ideas_list:
        out["total"] += 1
        out[level_of(progress.get(idea["idea_id"]), today)] += 1
    out["readiness"] = round(((out["mastered"] + out["familiar"] * 0.5 + out["learning"] * 0.15) / out["total"]) * 100) if out["total"] else 0
    return out


def combined(guides: list) -> int:
    """Readiness across guides, weighted by each guide's number of ideas."""
    total = sum(g["total"] for g in guides)
    return round(sum(g["readiness"] * g["total"] for g in guides) / total) if total else 0


def guide_ideas(guide: dict) -> tuple:
    """(content, questions, ideas) of the guide as it is now."""
    content = versions.live_content(guide)
    questions = versions.owner_questions(content, guide["id"])
    return content, questions, versions.content_ideas(content)


def studied(progress: dict) -> bool:
    return any(isinstance(e, dict) and not e.get("archived") and (isinstance(e.get("l"), int) or "box" in e or "known" in e) for e in progress.values())


def group_view(db, guide: dict, member_ids: list, content: dict, questions: list, ideas_list: list, today: str) -> dict:
    """Anonymous counts per idea across the members who studied this guide, or a reason it's hidden."""
    rows = {}
    others = [m for m in member_ids if m != guide.get("user_id")]
    if others:
        try:
            for row in db.table("guide_progress").select("user_id,progress").eq("guide_id", guide["id"]).in_("user_id", others).execute().data or []:
                rows[row["user_id"]] = row
        except Exception:
            rows = {}
    maps = []
    for member in member_ids:
        progress = member_ideas(db, member, guide, content, questions, rows)
        if studied(progress):
            maps.append(progress)
    if len(maps) < GROUP_MIN:
        return {"shown": False, "studied": len(maps)}
    out = []
    for idea in ideas_list:
        levels = [level_of(m.get(idea["idea_id"]), today) for m in maps]
        out.append({"question": idea["question"], "knows": sum(1 for lv in levels if lv in ("familiar", "mastered")),
                    "learning": sum(1 for lv in levels if lv == "learning")})
    return {"shown": True, "studied": len(maps), "ideas": out}


def today_iso() -> str:
    return datetime.now().date().isoformat()


def nearest_milestone(db, room_id: str, today: str) -> Optional[dict]:
    rows = db.table("classroom_items").select("milestone_label,milestone_date").eq("classroom_id", room_id).execute().data or []
    upcoming = sorted((r for r in rows if r.get("milestone_date") and str(r["milestone_date"])[:10] >= today), key=lambda r: str(r["milestone_date"]))
    return {"label": upcoming[0].get("milestone_label"), "date": str(upcoming[0]["milestone_date"])[:10]} if upcoming else None


def due_count(guide: dict, progress: dict, content: dict, questions: list, today: str) -> int:
    """Cards due (new or their day has come) plus Learn ideas worth a look, as Study now counts them."""
    due = 0
    for card in content["cards"]:
        entry = progress.get(card.get("idea_id")) if isinstance(card, dict) else None
        if not entry or not entry.get("due") or str(entry["due"])[:10] <= today:
            due += 1
    for question in questions:
        entry = progress.get(question.get("idea_id")) if isinstance(question, dict) else None
        if entry and level_of(entry, today) in ("learning", "familiar"):
            due += 1
    return due
