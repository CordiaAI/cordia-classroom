"""The instructor dashboard for an instructor class (social plan, Stage 8).

Only staff (owner, instructor, admin) of an approved instructor class see it, and only members who
chose to share their progress with staff (classroom_members.progress_visible_to_staff) are counted.
Everyone else appears in the member list with their sharing status and nothing more.
  - readiness per guide: the sharing members' progress pooled (same scale as Stage 6)
  - weakest ideas: across all the classroom's guides, the ideas the sharing members know least
  - milestones: the upcoming ones, soonest first, with days left
  - members: name, role, joined, sharing or not, and readiness only when sharing
The CSV export (csv_text) holds the sharing members' rows only.
"""

from __future__ import annotations

import csv
import io
from datetime import date

from services import classroom_study as cstudy
from services import social_graph as graph

WEAKEST = 10
MILESTONES = 5
LEVELS = ("new", "learning", "familiar", "mastered")


def _score(counts: dict) -> int:
    total = sum(counts.get(k, 0) for k in LEVELS)
    if not total:
        return 0
    return round(((counts.get("mastered", 0) + counts.get("familiar", 0) * 0.5 + counts.get("learning", 0) * 0.15) / total) * 100)


def _days(today: str, when: str) -> int:
    try:
        return (date.fromisoformat(str(when)[:10]) - date.fromisoformat(today)).days
    except ValueError:
        return 0


def milestones(db, room_id: str, today: str, titles: dict) -> list:
    rows = db.table("classroom_items").select("item_type,item_id,milestone_label,milestone_date").eq("classroom_id", room_id).execute().data or []
    upcoming = sorted((r for r in rows if r.get("milestone_date") and str(r["milestone_date"])[:10] >= today), key=lambda r: str(r["milestone_date"]))
    return [{"label": r.get("milestone_label") or "Milestone", "date": str(r["milestone_date"])[:10], "days_left": _days(today, r["milestone_date"]),
             "item_type": r["item_type"], "item_title": titles.get(r["item_id"])} for r in upcoming[:MILESTONES]]


def build(db, viewer_id: str, room: dict) -> dict:
    today = cstudy.today_iso()
    members = db.table("classroom_members").select("user_id,role,progress_visible_to_staff,joined_at") \
        .eq("classroom_id", room["id"]).eq("status", "active").execute().data or []
    others = [m for m in members if m["user_id"] != viewer_id]
    sharing = [m["user_id"] for m in others if m.get("progress_visible_to_staff")]
    guides = cstudy.classroom_guides(db, viewer_id, room["id"])

    per_member = {uid: [] for uid in sharing}
    guide_rows, idea_rows = [], []
    for guide in guides:
        content, questions, ideas_list = cstudy.guide_ideas(guide)
        pooled = {k: 0 for k in LEVELS}
        per_idea = {idea["idea_id"]: {k: 0 for k in LEVELS} for idea in ideas_list}
        studied = 0
        for uid in sharing:
            progress = cstudy.member_ideas(db, uid, guide, content, questions)
            per_member[uid].append({"id": guide["id"], "title": guide.get("title") or "Untitled", **cstudy.tally(ideas_list, progress, today)})
            if cstudy.studied(progress):
                studied += 1
            for idea in ideas_list:
                level = cstudy.level_of(progress.get(idea["idea_id"]), today)
                pooled[level] += 1
                per_idea[idea["idea_id"]][level] += 1
        guide_rows.append({"id": guide["id"], "title": guide.get("title") or "Untitled", "ideas": len(ideas_list),
                           "studied": studied, "readiness": _score(pooled) if sharing else None, **pooled})
        for idea in ideas_list:
            counts = per_idea[idea["idea_id"]]
            if sharing:
                idea_rows.append({"guide_id": guide["id"], "guide_title": guide.get("title") or "Untitled", "question": idea["question"],
                                  "readiness": _score(counts), "knows": counts["familiar"] + counts["mastered"],
                                  "learning": counts["learning"], "new": counts["new"]})

    weakest = sorted((r for r in idea_rows if r["readiness"] < 100), key=lambda r: (r["readiness"], -r["new"], r["question"]))[:WEAKEST]
    people = graph.cards(db, [m["user_id"] for m in others])
    member_rows = []
    for m in sorted(others, key=lambda m: (people.get(m["user_id"], {}).get("display_name") or "").lower()):
        card = people.get(m["user_id"]) or {"user_id": m["user_id"], "username": None, "display_name": "A member", "initials": "?"}
        shares = bool(m.get("progress_visible_to_staff"))
        member_rows.append({**card, "role": m.get("role"), "joined_at": m.get("joined_at"), "sharing": shares,
                            "readiness": cstudy.combined(per_member[m["user_id"]]) if shares else None})
    titles = {g["id"]: g.get("title") or "Untitled" for g in guides}
    return {
        "classroom": {"id": room["id"], "name": room["name"]},
        "sharing": len(sharing), "members": member_rows, "not_sharing": len(others) - len(sharing),
        "readiness": cstudy.combined([{"readiness": g["readiness"] or 0, "total": g["ideas"] * max(1, len(sharing))} for g in guide_rows]) if sharing else None,
        "guides": guide_rows, "weakest": weakest, "milestones": milestones(db, room["id"], today, titles),
        "_per_member": per_member,
    }


def _cell(value) -> str:
    """A CSV cell that a spreadsheet won't run as a formula."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_text(dashboard: dict) -> str:
    """One row per sharing member and guide. Members who don't share never appear."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Member", "Username", "Guide", "Readiness %", "Mastered", "Familiar", "Learning", "New"])
    names = {m["user_id"]: m for m in dashboard["members"] if m.get("sharing")}
    for uid, rows in dashboard["_per_member"].items():
        member = names.get(uid)
        if not member:
            continue
        for row in rows:
            writer.writerow([_cell(member.get("display_name")), _cell(member.get("username") or ""), _cell(row["title"]),
                             row["readiness"], row["mastered"], row["familiar"], row["learning"], row["new"]])
    return out.getvalue()


def public(dashboard: dict) -> dict:
    return {k: v for k, v in dashboard.items() if not k.startswith("_")}
