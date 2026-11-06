"""Merging two of a student's sets that cover the same material (migration 20261122120000).

Set B is merged into set A (the one kept):
  - B's cards, Q/A pairs and saved quiz questions whose idea A doesn't already have are added after
    A's, keeping their idea ids; an idea both sets have stays A's (matched by question, ideas.similarity)
  - B's notes are added under a "## From <B's title>" heading
  - the owner's progress follows each idea: B's progress on an idea A doesn't have comes along, and
    on a shared idea the stronger of the two is kept
  - B's study history (quiz attempts, study sessions, Tutor chats, visuals) moves to A; the rows that
    are deleted with a set (retain_misses, study_aids) are kept in the backup
  - a full copy of B goes to guide_merge_backups, then B is deleted the normal way, so nothing else
    that reads study_guides has to know about merges. Restore puts B back as it was (same id) and
    moves its history back; A keeps what it got.
Only a private set of the student's own that isn't shared with a class, in a classroom or linked to
someone else's set can be merged away. Any of their own sets can be the one kept.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from services import guide_versions, ideas

logger = logging.getLogger(__name__)

SAME_IDEA = 0.85          # ideas.similarity at or above this: the same question
KEEP_DAYS = 30
MOVED_TABLES = ("quiz_attempts", "study_sessions", "tutor_chats", "guide_visuals")
SAVED_TABLES = ("retain_misses", "study_aids")   # deleted with the set: kept in the backup
GENERATED = {"search_doc"}                         # study_guides columns that can't be inserted
MAX_CARDS = 500


class MergeError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# --- Pure: what the kept set becomes ----------------------------------------------------------------

def _better(a: dict, b: dict) -> dict:
    """Two progress entries for the same idea: the stronger of each part."""
    out = dict(a)
    if isinstance(b.get("box"), int) and (not isinstance(a.get("box"), int) or b["box"] > a["box"]):
        out["box"], out["due"] = b["box"], b.get("due")
    if isinstance(b.get("l"), int) and (not isinstance(a.get("l"), int) or b["l"] > a["l"]):
        for key in ("l", "at", "q", "sure"):
            if key in b:
                out[key] = b[key]
    if b.get("known") is True or ("known" not in a and "known" in b):
        out["known"] = b["known"]
    return out


def _qa_text(pairs: list) -> str:
    return "\n".join(f"Q{index}: {p.get('question', '').strip()}\nA{index}: {p.get('answer', '').strip()}"
                     for index, p in enumerate(pairs, 1))


def merged_notes(keep_notes: Optional[str], other_notes: Optional[str], other_title: str) -> str:
    keep_notes, other_notes = (keep_notes or "").rstrip(), (other_notes or "").strip()
    if not other_notes:
        return keep_notes
    heading = "## From " + (" ".join((other_title or "the merged set").split())[:120])
    return f"{keep_notes}\n\n{heading}\n{other_notes}" if keep_notes else f"{heading}\n{other_notes}"


def merge_content(keep: dict, other: dict) -> dict:
    """What the kept set becomes. keep/other: study_guides rows (id, title, notes, study_guide,
    flashcards, quiz_questions, flashcard_progress, nclex_questions, version).
    Returns {"update": columns for the kept set, "added_cards", "added_questions", "shared", "skipped"}."""
    keep_id, other_id = str(keep.get("id")), str(other.get("id"))
    a, b = guide_versions.live_content(keep), guide_versions.live_content(other)
    a_ideas, b_ideas = guide_versions.content_ideas(a), guide_versions.content_ideas(b)

    match = {}  # B idea -> A idea it repeats
    for idea in b_ideas:
        best_score, best_id = 0.0, None
        for mine in a_ideas:
            score = ideas.similarity(idea["question"], mine["question"])
            if score > best_score:
                best_score, best_id = score, mine["idea_id"]
        if best_id and best_score >= SAME_IDEA:
            match[idea["idea_id"]] = best_id
    taken = {idea["idea_id"] for idea in a_ideas}
    rename = {}
    for idea in b_ideas:
        if idea["idea_id"] not in match and idea["idea_id"] in taken:
            rename[idea["idea_id"]] = ideas.new_id()
        taken.add(rename.get(idea["idea_id"], idea["idea_id"]))

    def carried(items, room):
        out = []
        for item in items or []:
            if isinstance(item, dict) and ideas.valid_id(item.get("idea_id")) and item["idea_id"] not in match:
                if len(out) >= room:
                    break
                out.append({**item, "idea_id": rename.get(item["idea_id"], item["idea_id"])})
        return out

    new_cards = carried(b["cards"], max(0, MAX_CARDS - len(a["cards"])))
    new_qa = carried(b["qa"], max(0, guide_versions.MAX_QUESTIONS - len(a["qa"])))
    cards, qa = a["cards"] + new_cards, a["qa"] + new_qa
    quiz = None
    if a["quiz"]:
        # A has a saved quiz: B's saved questions for the added ideas, else free ones for its added pairs.
        added = {pair["idea_id"] for pair in new_qa}
        from_b = [q for q in carried(b["quiz"], len(new_qa)) if q.get("idea_id") in added] if b["quiz"] else []
        have = {q.get("idea_id") for q in from_b}
        extra = [q for q in guide_versions.questions_for({"qa": qa, "version": a["version"] + 1, "quiz": None}, keep_id)
                 if q.get("idea_id") in added and q.get("idea_id") not in have]
        quiz = (a["quiz"] + from_b + extra)[:guide_versions.MAX_QUESTIONS]

    # Progress: both sets' by idea, B's moved onto A's ids, then back to A's positions.
    progress_a = keep.get("flashcard_progress") if isinstance(keep.get("flashcard_progress"), dict) else {}
    progress_b = other.get("flashcard_progress") if isinstance(other.get("flashcard_progress"), dict) else {}
    by_a = guide_versions.by_idea(progress_a, a["cards"], guide_versions.owner_questions(a, keep_id))
    by_b = guide_versions.by_idea(progress_b, b["cards"], guide_versions.owner_questions(b, other_id))
    for idea_id, entry in by_b.items():
        target = match.get(idea_id) or rename.get(idea_id, idea_id)
        by_a[target] = _better(by_a[target], entry) if target in by_a else entry
    merged = {"cards": cards, "quiz": quiz, "qa": qa, "version": a["version"] + 1}
    view = guide_versions.legacy_view(by_a, cards, guide_versions.owner_questions(merged, keep_id))
    progress = {key: value for key, value in progress_a.items() if key not in ("schedule", "known", "unknown", "learn")}
    progress.update({"schedule": view["schedule"], "known": view["known"], "unknown": view["unknown"]})
    learn = dict(progress_a.get("learn") or {}) if isinstance(progress_a.get("learn"), dict) else {}
    if learn or view["learn"]["levels"]:
        learn["levels"] = view["learn"]["levels"]
        progress["learn"] = learn
    if progress_b.get("last_studied") and str(progress_b["last_studied"]) > str(progress_a.get("last_studied") or ""):
        progress["last_studied"] = progress_b["last_studied"]

    update = {
        "flashcards": cards,
        "study_guide": _qa_text(qa) if new_qa else keep.get("study_guide"),
        "notes": merged_notes(keep.get("notes"), other.get("notes"), other.get("title") or ""),
        "flashcard_progress": progress,
    }
    if quiz is not None:
        update["quiz_questions"] = quiz
    if isinstance(keep.get("nclex_questions"), list) and isinstance(other.get("nclex_questions"), list):
        seen = {ideas.normalize(q.get("question")) for q in keep["nclex_questions"] if isinstance(q, dict)}
        update["nclex_questions"] = keep["nclex_questions"] + [
            q for q in other["nclex_questions"] if isinstance(q, dict) and ideas.normalize(q.get("question")) not in seen]
    elif not keep.get("nclex_questions") and isinstance(other.get("nclex_questions"), list):
        update["nclex_questions"] = other["nclex_questions"]
    skipped = (len([i for i in b["cards"] if i.get("idea_id") not in match]) - len(new_cards)) \
        + (len([i for i in b["qa"] if i.get("idea_id") not in match]) - len(new_qa))
    return {"update": update, "added_cards": len(new_cards), "added_questions": len(new_qa),
            "shared": len(match), "skipped": max(0, skipped)}


# --- Which sets may be merged ----------------------------------------------------------------------

MERGE_COLUMNS = "id,user_id,title,notes,study_guide,flashcards,quiz_questions,flashcard_progress,nclex_questions,version,visibility,linked_set_id,folder_id,created_at"


def _one(result) -> Optional[dict]:
    return (result.data or [None])[0]


def available(db) -> bool:
    """The migration is applied."""
    try:
        db.table("guide_merge_backups").select("id").limit(1).execute()
        return True
    except Exception:
        return False


SHARED = "This set is shared, so it can only be the one you keep."
FOLLOWS = "This set follows someone else's set, so it can't be merged away."
IN_CLASS = "This set is shared with a class, so it can only be the one you keep."
IN_ROOM = "This set is in a classroom, so it can only be the one you keep."


def reasons(db, guides: list) -> dict:
    """{guide id: None when it may be merged away (and deleted), else why not}, in three queries."""
    ids = [g["id"] for g in guides if g.get("id")]
    shared, in_room = set(), set()
    for start in range(0, len(ids), 200):
        chunk = ids[start:start + 200]
        try:
            shared |= {r["guide_id"] for r in db.table("shared_sets").select("guide_id").in_("guide_id", chunk).execute().data or []}
        except Exception:
            pass
        try:
            in_room |= {r["item_id"] for r in db.table("classroom_items").select("item_id").eq("item_type", "guide").in_("item_id", chunk).execute().data or []}
        except Exception:
            pass
    out = {}
    for guide in guides:
        gid = guide.get("id")
        if (guide.get("visibility") or "private") != "private":
            out[gid] = SHARED
        elif guide.get("linked_set_id"):
            out[gid] = FOLLOWS
        elif gid in shared:
            out[gid] = IN_CLASS
        elif gid in in_room:
            out[gid] = IN_ROOM
        else:
            out[gid] = None
    return out


def why_not_merge_away(db, guide: dict) -> Optional[str]:
    """None when this set may be merged away (and deleted), else why not."""
    return reasons(db, [guide]).get(guide.get("id"))


def _load(db, user_id: str, guide_id: str) -> dict:
    try:
        row = _one(db.table("study_guides").select(MERGE_COLUMNS).eq("id", guide_id).eq("user_id", user_id).limit(1).execute())
    except Exception:  # before the Stage 3 migration: no version/visibility/linked_set_id
        row = _one(db.table("study_guides").select("id,user_id,title,notes,study_guide,flashcards,quiz_questions,flashcard_progress,nclex_questions,folder_id,created_at")
                   .eq("id", guide_id).eq("user_id", user_id).limit(1).execute())
    if not row:
        raise MergeError(404, "Set not found")
    return row


def history_counts(db, user_id: str, guide_id: str) -> dict:
    out = {}
    for table in ("quiz_attempts", "study_sessions"):
        try:
            out[table] = len(db.table(table).select("id").eq("guide_id", guide_id).eq("user_id", user_id).limit(1000).execute().data or [])
        except Exception:
            out[table] = 0
    return out


def preview(db, user_id: str, keep_id: str, other_id: str) -> dict:
    if keep_id == other_id:
        raise MergeError(400, "Pick two different sets")
    keep, other = _load(db, user_id, keep_id), _load(db, user_id, other_id)
    plan = merge_content(keep, other)
    history = history_counts(db, user_id, other_id)
    return {
        "keep": {"id": keep["id"], "title": keep.get("title") or "Untitled"},
        "merge": {"id": other["id"], "title": other.get("title") or "Untitled", "blocked": why_not_merge_away(db, other)},
        "added_cards": plan["added_cards"], "added_questions": plan["added_questions"], "shared": plan["shared"],
        "skipped": plan["skipped"], "notes": bool((other.get("notes") or "").strip()),
        "quiz_attempts": history["quiz_attempts"], "study_sessions": history["study_sessions"],
    }


# --- Merge and restore -----------------------------------------------------------------------------

def merge(db, user_id: str, keep_id: str, other_id: str, after_write=None) -> dict:
    """Merge `other_id` into `keep_id`. after_write(db, user_id, keep_id, before, keep_row) runs the
    usual follow-ups of an edit (versions, shared snapshots); passed in by the router."""
    if keep_id == other_id:
        raise MergeError(400, "Pick two different sets")
    if not available(db):
        raise MergeError(503, "Merging sets isn't available yet.")
    keep, other = _load(db, user_id, keep_id), _load(db, user_id, other_id)
    blocked = why_not_merge_away(db, other)
    if blocked:
        raise MergeError(409, blocked)
    full = _one(db.table("study_guides").select("*").eq("id", other_id).eq("user_id", user_id).limit(1).execute())
    if not full:
        raise MergeError(404, "Set not found")
    plan = merge_content(keep, other)

    saved = {}
    for table in SAVED_TABLES:
        try:
            saved[table] = db.table(table).select("*").eq("guide_id", other_id).eq("user_id", user_id).execute().data or []
        except Exception:
            saved[table] = []
    moved_ids = {}
    for table in MOVED_TABLES:
        try:
            moved_ids[table] = [r["id"] for r in db.table(table).select("id").eq("guide_id", other_id).eq("user_id", user_id).execute().data or []]
        except Exception:
            moved_ids[table] = []
    backup = _one(db.table("guide_merge_backups").insert({
        "id": str(uuid.uuid4()), "user_id": user_id, "kept_guide_id": keep_id, "merged_guide_id": other_id,
        "merged_guide": {k: v for k, v in full.items() if k not in GENERATED},
        "moved": moved_ids, "saved_rows": saved,
    }).execute())

    before = guide_versions.live_content(keep)
    db.table("study_guides").update(plan["update"]).eq("id", keep_id).eq("user_id", user_id).execute()
    for table, ids in moved_ids.items():
        if ids:
            try:
                db.table(table).update({"guide_id": keep_id}).in_("id", ids).eq("user_id", user_id).execute()
            except Exception:
                logger.warning("Moving %s to the kept set failed", table, exc_info=True)
    db.table("study_guides").delete().eq("id", other_id).eq("user_id", user_id).execute()
    if after_write:
        try:
            after_write(db, user_id, keep_id, before, keep)
        except Exception:
            logger.warning("Follow-ups after a merge failed for %s", keep_id, exc_info=True)
    return {"kept": keep_id, "backup_id": (backup or {}).get("id"), "added_cards": plan["added_cards"],
            "added_questions": plan["added_questions"], "shared": plan["shared"], "skipped": plan["skipped"]}


def _cutoff() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()


def purge(db, user_id: str) -> None:
    try:
        db.table("guide_merge_backups").delete().eq("user_id", user_id).lt("created_at", _cutoff()).execute()
    except Exception:
        pass


def backups_for(db, user_id: str, keep_id: str) -> list:
    """The sets merged into this one in the last 30 days that can still be restored."""
    if not available(db):
        return []
    purge(db, user_id)
    rows = db.table("guide_merge_backups").select("id,merged_guide_id,merged_guide,created_at,restored_at") \
        .eq("user_id", user_id).eq("kept_guide_id", keep_id).gte("created_at", _cutoff()).execute().data or []
    out = []
    for row in sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True):
        if row.get("restored_at"):
            continue
        guide = row.get("merged_guide") or {}
        until = None
        try:
            until = (datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00")) + timedelta(days=KEEP_DAYS)).isoformat()
        except Exception:
            pass
        out.append({"id": row["id"], "title": guide.get("title") or "Untitled", "merged_at": row.get("created_at"), "until": until})
    return out


def restore(db, user_id: str, backup_id: str) -> dict:
    if not available(db):
        raise MergeError(503, "Merging sets isn't available yet.")
    row = _one(db.table("guide_merge_backups").select("*").eq("id", backup_id).eq("user_id", user_id).limit(1).execute())
    if not row or row.get("restored_at") or str(row.get("created_at") or "") < _cutoff():
        raise MergeError(404, "This set can't be restored anymore.")
    guide = {k: v for k, v in (row.get("merged_guide") or {}).items() if k not in GENERATED}
    if not guide.get("id") or guide.get("user_id") != user_id:
        raise MergeError(404, "This set can't be restored anymore.")
    if db.table("study_guides").select("id").eq("id", guide["id"]).limit(1).execute().data:
        raise MergeError(409, "That set is already back in your Library.")
    if guide.get("folder_id"):
        try:
            if not db.table("folders").select("id").eq("id", guide["folder_id"]).eq("user_id", user_id).limit(1).execute().data:
                guide["folder_id"] = None
        except Exception:
            guide["folder_id"] = None
    db.table("study_guides").insert(guide).execute()
    for table, ids in (row.get("moved") or {}).items():
        if table in MOVED_TABLES and ids:
            try:
                db.table(table).update({"guide_id": guide["id"]}).in_("id", ids).eq("user_id", user_id).execute()
            except Exception:
                logger.warning("Moving %s back failed", table, exc_info=True)
    for table, rows in (row.get("saved_rows") or {}).items():
        if table in SAVED_TABLES and rows:
            try:
                db.table(table).upsert(rows).execute()
            except Exception:
                logger.warning("Putting %s back failed", table, exc_info=True)
    db.table("guide_merge_backups").update({"restored_at": datetime.now(timezone.utc).isoformat()}).eq("id", backup_id).execute()
    return {"restored": guide["id"], "title": guide.get("title") or "Untitled"}
