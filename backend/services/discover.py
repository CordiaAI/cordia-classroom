"""Discover: search across everyone's public guides (social plan, Stage 7).

Only public guides that aren't held or hidden are ever candidates (the discover_guides RPC, or a
plain title match before migration 20261118120000). On top of that, every result is re-checked
here, because the backend reads with the service role:
  - guides in a course whose instructor turned sharing off are left out;
  - guides by anyone the viewer blocked, or who blocked the viewer, are left out;
  - an anonymous guide never says who made it, and a minor's guide says "A classmate"
    (services/minors.py). Filters that would reveal something about the author (creator type,
    from my classrooms) skip both.

Rank = text relevance x quality. Quality comes from the guide_quality materialized view (how many
people studied it, how well they know it, whether they came back after a week, reports, how
recently it changed, and whether the author is a verified instructor); without the view it is 1.
Near-duplicates (same course, mostly the same words) fold into the best one, "+N similar".
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Iterable, Optional

from services import classrooms as rooms
from services import guide_access as access
from services import minors
from services.blocks import hidden_from
from services.social_graph import cards

CANDIDATES = 200
PAGE = 20
SIMILAR = 0.6
SIZES = {"short": (0, 19), "medium": (20, 60), "long": (61, 10 ** 6)}
CREATOR_TYPES = ("instructor", "student")
GUIDE_COLUMNS = "id,user_id,title,notes,study_guide,flashcards,folder_id,visibility,attribution,review_status,created_at"
SEASONS = {"spring": "Spring", "summer": "Summer", "fall": "Fall", "autumn": "Fall", "winter": "Winter"}


# Candidates -------------------------------------------------------------------------------------
def candidates(db, q: str) -> list[tuple[str, float]]:
    """(guide id, text relevance) for public guides that aren't held, best first."""
    q = (q or "").strip()[:200]
    try:
        rows = db.rpc("discover_guides", {"q": q, "max_results": CANDIDATES}).execute().data or []
        return [(r["id"], float(r.get("relevance") or 0)) for r in rows]
    except Exception:  # before migration 20261118120000: a title match, newest first
        query = db.table("study_guides").select("id,title").eq("visibility", "public").eq("review_status", "ok")
        if q:
            query = query.ilike("title", f"%{_like(q)}%")
        try:
            rows = query.order("created_at", desc=True).limit(CANDIDATES).execute().data or []
        except Exception:  # before the Stage 3 migration: nothing is public yet
            return []
        return [(r["id"], 1.0) for r in rows]


def _like(text: str) -> str:
    return re.sub(r"[%_\\,()]", " ", text)


# Terms ------------------------------------------------------------------------------------------
def term_label(text: str) -> str:
    """'2026 Fall', 'Fall 2026', 'FALL-2026' -> 'Fall 2026'; anything else as written."""
    raw = (text or "").strip()
    season = next((SEASONS[w] for w in re.findall(r"[a-z]+", raw.lower()) if w in SEASONS), None)
    year = re.search(r"(20\d\d)", raw)
    return f"{season} {year.group(1)}" if season and year else raw


def semester_of(created_at) -> str:
    """Spring Jan-May, Summer Jun-Jul, Fall Aug-Dec."""
    when = _when(created_at) or datetime.now(timezone.utc)
    season = "Spring" if when.month <= 5 else "Summer" if when.month <= 7 else "Fall"
    return f"{season} {when.year}"


def guide_term(guide: dict, class_terms: list[str]) -> str:
    """The guide's term: from its folder's class and that class's terms; outside a class (or when
    the class has several terms and none is the semester it was made in), the semester of
    created_at."""
    made = semester_of(guide.get("created_at"))
    labels = [term_label(t) for t in class_terms if t]
    if len(labels) == 1:
        return labels[0]
    return made


def _when(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# Quality ----------------------------------------------------------------------------------------
def quality_rows(db, ids: list[str]) -> dict:
    if not ids:
        return {}
    try:
        rows = db.table("guide_quality").select("*").in_("guide_id", ids).execute().data or []
    except Exception:  # before the migration, or before the first refresh
        return {}
    return {r["guide_id"]: r for r in rows}


def quality(row: Optional[dict], now: Optional[datetime] = None) -> float:
    """A multiplier around 1: more studiers, better mastery and retention, fewer reports, recent
    changes and a verified-instructor author each raise it. No row: 1."""
    if not row:
        return 1.0
    studied = max(0, int(row.get("studied_by") or 0))
    score = 1 + math.log1p(studied) / 2
    mastery = row.get("mastery")
    score *= 0.85 + 0.3 * (float(mastery) if mastery is not None else 0.5)
    retention = row.get("retention_7d")
    score *= 0.9 + 0.2 * (float(retention) if retention is not None else 0.5)
    report_rate = (row.get("reports") or 0) / max(studied, 1)
    score *= max(0.2, 1 - 2 * report_rate)
    changed = _when(row.get("changed_at"))
    if changed:
        days = ((now or datetime.now(timezone.utc)) - changed).days
        score *= 1.0 if days <= 90 else max(0.8, 1 - 0.2 * (days - 90) / 640)
    if row.get("verified_instructor"):
        score *= 1.1
    return score


# Near-duplicates --------------------------------------------------------------------------------
def words(guide: dict) -> set[str]:
    text = f"{guide.get('title') or ''} {(guide.get('notes') or '')[:600]}".lower()
    return {w for w in re.findall(r"[a-z0-9]+", text) if len(w) >= 3}


def similarity(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def cluster(ranked: list[dict]) -> list[dict]:
    """Fold each result into an earlier, better one from the same course with mostly the same words."""
    kept: list[dict] = []
    for item in ranked:
        home = next((k for k in kept if item["class_id"] and k["class_id"] == item["class_id"]
                     and similarity(k["words"], item["words"]) >= SIMILAR), None)
        if home:
            home["similar"].append(item)
        else:
            kept.append({**item, "similar": []})
    return kept


# Search -----------------------------------------------------------------------------------------
def search_guides(db, viewer: str, q: str = "", school: str = "", course: str = "", term: str = "",
                  creator_type: str = "", size: str = "", updated_within: int = 0, from_my_classrooms: bool = False,
                  offset: int = 0, limit: int = PAGE, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    found = candidates(db, q)
    relevance = dict(found)
    ids = [gid for gid, _ in found]
    guides = [g for g in (db.table("study_guides").select(GUIDE_COLUMNS).in_("id", ids).execute().data or []) if _listed(g)] if ids else []

    folders = _by_id(db, "folders", "id,class_id", [g.get("folder_id") for g in guides])
    classes = _by_id(db, "classes", "id,school_id,course_code_normalized,display_name,sharing_blocked",
                     [f.get("class_id") for f in folders.values()])
    schools = _by_id(db, "schools", "id,name", [c.get("school_id") for c in classes.values()])
    terms = _class_terms(db, list(classes))
    hidden = hidden_from(db, viewer)
    young = minors.minor_ids(db, [g["user_id"] for g in guides])
    rows = quality_rows(db, [g["id"] for g in guides])
    peers = _classroom_peers(db, viewer) if from_my_classrooms else set()
    top = max(relevance.values() or [0]) or 1.0

    ranked = []
    for guide in guides:
        klass = classes.get((folders.get(guide.get("folder_id")) or {}).get("class_id"))
        if klass and klass.get("sharing_blocked"):
            continue
        if guide["user_id"] in hidden:
            continue
        named = guide.get("attribution") != "anonymous" and guide["user_id"] not in young
        row = rows.get(guide["id"])
        verified = bool(row and row.get("verified_instructor"))
        label = guide_term(guide, terms.get(klass["id"], []) if klass else [])
        changed = _when((row or {}).get("changed_at")) or _when(guide.get("created_at"))
        count = access.question_count(guide)
        if school and (not klass or klass.get("school_id") != school):
            continue
        if course and (not klass or klass["id"] != course):
            continue
        if term and label.lower() != term_label(term).lower():
            continue
        if creator_type in CREATOR_TYPES and (not named or verified != (creator_type == "instructor")):
            continue
        if size in SIZES and not (SIZES[size][0] <= count <= SIZES[size][1]):
            continue
        if updated_within and (not changed or (now - changed).days > updated_within):
            continue
        if from_my_classrooms and (not named or guide["user_id"] not in peers):
            continue
        text = (relevance.get(guide["id"], 0) / top) if q.strip() else 1.0
        ranked.append({"guide": guide, "class_id": klass["id"] if klass else None, "klass": klass, "term": label,
                       "named": named, "verified": verified and named, "row": row, "changed": changed, "count": count,
                       "words": words(guide), "score": text * quality(row, now)})
    ranked.sort(key=lambda r: (-r["score"], -(r["changed"] or now).timestamp()))
    clusters = cluster(ranked)
    page = clusters[offset:offset + limit]

    authors = cards(db, [r["guide"]["user_id"] for r in page if r["named"]])
    out = []
    for item in page:
        out.append(_card(db, item, authors, schools))
    return {"guides": out, "total": len(clusters), "facets": _facets(ranked, schools, course)}


def _listed(guide: dict) -> bool:
    return (guide.get("visibility") or "private") == "public" and (guide.get("review_status") or "ok") == "ok"


def _by_id(db, table: str, columns: str, ids: Iterable[Optional[str]]) -> dict:
    wanted = list(dict.fromkeys(i for i in ids if i))
    if not wanted:
        return {}
    try:
        return {r["id"]: r for r in db.table(table).select(columns).in_("id", wanted).execute().data or []}
    except Exception:
        return {}


def _class_terms(db, class_ids: list[str]) -> dict:
    if not class_ids:
        return {}
    out: dict = {}
    try:
        for row in db.table("class_terms").select("class_id,term").in_("class_id", class_ids).execute().data or []:
            out.setdefault(row["class_id"], []).append(row.get("term") or "")
    except Exception:
        return {}
    return out


def _classroom_peers(db, viewer: str) -> set[str]:
    """Everyone active in a classroom the viewer is active in."""
    if not rooms.enabled():
        return set()
    try:
        mine = [r["classroom_id"] for r in db.table("classroom_members").select("classroom_id").eq("user_id", viewer).eq("status", "active").execute().data or []]
        if not mine:
            return set()
        rows = db.table("classroom_members").select("user_id").in_("classroom_id", mine).eq("status", "active").execute().data or []
    except Exception:  # before the classrooms migration
        return set()
    return {r["user_id"] for r in rows if r["user_id"] != viewer}


def _card(db, item: dict, authors: dict, schools: dict) -> dict:
    guide, klass, row = item["guide"], item["klass"], item["row"]
    if guide.get("attribution") == "anonymous":
        author = None
    elif not item["named"]:
        author = dict(minors.CLASSMATE)
    else:
        card = authors.get(guide["user_id"])
        author = {"username": card.get("username"), "display_name": card["display_name"], "initials": card["initials"]} if card else None
    studied = int(row["studied_by"]) if row and row.get("studied_by") is not None else access.studied_by(db, guide["id"])
    return {
        "id": guide["id"],
        "title": guide.get("title") or "Untitled",
        "question_count": item["count"],
        "outline": access.outline_preview(guide.get("notes") or "", 2),
        "studied_by": studied,
        "author": author,
        "verified": item["verified"],
        "course": {"id": klass["id"], "code": klass.get("display_name") or klass.get("course_code_normalized"),
                   "school": (schools.get(klass.get("school_id")) or {}).get("name")} if klass else None,
        "term": item["term"],
        "changed_at": item["changed"].isoformat() if item["changed"] else None,
        "similar": [{"id": s["guide"]["id"], "title": s["guide"].get("title") or "Untitled"} for s in item["similar"]],
    }


def _facets(ranked: list[dict], schools: dict, course: str) -> dict:
    """Schools and courses among the matches (for the filter menus), and terms once a course is picked."""
    school_counts: dict = {}
    course_counts: dict = {}
    term_counts: dict = {}
    for item in ranked:
        klass = item["klass"]
        if klass:
            school_counts[klass.get("school_id")] = school_counts.get(klass.get("school_id"), 0) + 1
            course_counts[klass["id"]] = (klass.get("display_name") or klass.get("course_code_normalized"), course_counts.get(klass["id"], (None, 0))[1] + 1)
        if not course or (klass and klass["id"] == course):
            term_counts[item["term"]] = term_counts.get(item["term"], 0) + 1
    return {
        "schools": [{"id": sid, "name": (schools.get(sid) or {}).get("name") or "School", "count": n}
                    for sid, n in sorted(school_counts.items(), key=lambda kv: -kv[1]) if sid][:20],
        "courses": [{"id": cid, "name": name, "count": n} for cid, (name, n) in sorted(course_counts.items(), key=lambda kv: -kv[1][1])][:30],
        "terms": [{"name": name, "count": n} for name, n in sorted(term_counts.items(), key=lambda kv: -kv[1])][:12],
    }


# Classrooms and people --------------------------------------------------------------------------
def search_classrooms(db, viewer: str, q: str = "", school: str = "", course: str = "", limit: int = 30) -> list[dict]:
    """Public classrooms (listed on a course page) whose name matches, minus blocked owners."""
    if not rooms.enabled():
        return []
    query = db.table("classrooms").select("*").eq("visibility", "public").is_("archived_at", "null")
    if (q or "").strip():
        query = query.ilike("name", f"%{_like(q.strip()[:100])}%")
    if course:
        query = query.eq("class_id", course)
    try:
        found = query.limit(100).execute().data or []
    except Exception:  # before the classrooms migration
        return []
    classes = _by_id(db, "classes", "id,school_id,course_code_normalized,display_name", [r.get("class_id") for r in found])
    if school:
        found = [r for r in found if (classes.get(r.get("class_id")) or {}).get("school_id") == school]
    hidden = hidden_from(db, viewer)
    found = [r for r in found if r["owner_id"] not in hidden][:limit]
    owners = cards(db, [r["owner_id"] for r in found])
    young = minors.minor_ids(db, [r["owner_id"] for r in found])
    out = []
    for room in found:
        klass = classes.get(room.get("class_id"))
        me = rooms.membership(db, room["id"], viewer)
        out.append({"id": room["id"], "name": room["name"], "kind": room.get("kind"), "member_count": rooms.active_count(db, room["id"]),
                    "owner": dict(minors.CLASSMATE) if room["owner_id"] in young else owners.get(room["owner_id"]),
                    "course": klass.get("display_name") or klass.get("course_code_normalized") if klass else None,
                    "join_policy": room.get("join_policy"),
                    "my_status": me.get("status") if me and me.get("status") != "removed" else None})
    return out


def search_people(db, viewer: str, q: str, limit: int = 30) -> list[dict]:
    """Public profiles whose username or name matches. Never minors, never blocked pairs."""
    term = _like((q or "").strip().lstrip("@")[:60]).strip()
    if len(term) < 2:
        return []
    columns = "id,username,display_name,profile_visibility,is_minor,show_school,university"
    try:
        by_name = db.table("user_profiles").select(columns).eq("profile_visibility", "public").ilike("username", f"%{term}%").limit(50).execute().data or []
        by_shown = db.table("user_profiles").select(columns).eq("profile_visibility", "public").ilike("display_name", f"%{term}%").limit(50).execute().data or []
    except Exception:  # before the Stage 1 migration
        return []
    hidden = hidden_from(db, viewer)
    rows = {r["id"]: r for r in by_name + by_shown}
    people = [r for r in rows.values() if r["id"] != viewer and r["id"] not in hidden and r.get("is_minor") is not True
              and (r.get("profile_visibility") or "public") == "public" and r.get("username")]
    people.sort(key=lambda r: (not str(r.get("username") or "").lower().startswith(term.lower()), str(r.get("username") or "")))
    shown = cards(db, [r["id"] for r in people[:limit]])
    from services.instructors import verified_ids
    verified = verified_ids(db, [r["id"] for r in people[:limit]])
    out = []
    for row in people[:limit]:
        card = shown.get(row["id"])
        if not card:
            continue
        out.append({"username": card.get("username"), "display_name": card["display_name"], "initials": card["initials"],
                    "school": row.get("university") if row.get("show_school") else None, "verified": row["id"] in verified})
    return out
