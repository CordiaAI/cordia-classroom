"""Versions of a guide and progress that follows its ideas (social plan, Stage 4).

A version is what a guide asked at one point: its flashcards, its quiz questions and its Q/A pairs,
every item carrying an idea id (services/ideas.py). The current version is always read live from
the guide; older ones are kept in guide_versions for students who chose to stay on them.

Progress lives in two shapes:
  - the owner's, unchanged: study_guides.flashcard_progress, keyed by card and question position;
  - another student's: guide_progress.progress, keyed by idea id.
When the author edits, both follow the ideas: an unchanged idea keeps everything, a changed one
(ideas.is_real_change) drops one Learn level and its flashcard goes back to the first box, a removed
one is archived (never deleted), and a new one starts fresh. The same rules run when a student
accepts an update.

No class or membership code is imported here: the guide save path (also used by the MCP worker)
calls into this module. Visibility checks live in services/guide_access.py and routers/study.py.
"""

from __future__ import annotations

import logging
import os
import random
from datetime import date
from typing import Optional

from services import ideas

logger = logging.getLogger(__name__)

MAX_QUESTIONS = 50  # a quiz holds at most 50 (routers/quiz.py _load_quiz)


def enabled() -> bool:
    """Studying other people's guides with your own progress (needs migration 20261112120000)."""
    return os.getenv("PER_VIEWER_PROGRESS", "").strip().lower() in ("1", "true", "yes", "on")


def _quiz_helpers():
    # routers.quiz imports this module; import its builders when first needed.
    from routers import quiz
    return quiz


def _today() -> str:
    return date.today().isoformat()


# --- What a version asks ------------------------------------------------------------------------

def live_content(guide: dict) -> dict:
    """The guide as it is now: {version, title, cards, quiz, qa}, every item with an idea id."""
    quiz_mod = _quiz_helpers()
    cards = guide.get("flashcards") if isinstance(guide.get("flashcards"), list) else []
    quiz = guide.get("quiz_questions") if isinstance(guide.get("quiz_questions"), list) and guide.get("quiz_questions") else None
    qa = quiz_mod._parse_qa_pairs(guide.get("study_guide") or "")[:MAX_QUESTIONS]
    cards, quiz, qa = ideas.ensure_ids(cards, quiz, qa)
    return {"version": int(guide.get("version") or 1), "title": guide.get("title") or "", "cards": cards, "quiz": quiz, "qa": qa}


def content_ideas(content: dict) -> list:
    """One entry per idea ({idea_id, question, answer, ...}) for diffs: cards first, then quiz
    questions, then Q/A pairs that are in neither."""
    out = ideas.ideas_of(content.get("cards"), content.get("quiz"))
    seen = {idea["idea_id"] for idea in out}
    for pair in content.get("qa") or []:
        if isinstance(pair, dict) and ideas.valid_id(pair.get("idea_id")) and pair["idea_id"] not in seen:
            seen.add(pair["idea_id"])
            out.append({"idea_id": pair["idea_id"], "question": pair.get("question") or "", "answer": pair.get("answer") or ""})
    return out


def questions_for(content: dict, guide_id: str) -> list:
    """The quiz another student gets for this version: its saved questions, or free ones built from
    its Q/A pairs. The same version always gives the same list (positions are how answers are
    checked), and nothing is written to the author's guide."""
    quiz_mod = _quiz_helpers()
    if content.get("quiz"):
        return [quiz_mod.even_choices(q) if isinstance(q, dict) else q for q in content["quiz"]]
    rng = random.Random(f"{guide_id}:{content.get('version')}")
    return quiz_mod._standard_questions(content.get("qa") or [], rng)


def owner_questions(content: dict, guide_id: str) -> list:
    """The owner's question list Learn levels are keyed by: the saved quiz, else its Q/A order."""
    return content.get("quiz") or questions_for(content, guide_id)


def refresh_quiz(old_quiz: Optional[list], new_qa: list, guide_id: str, version: int) -> Optional[list]:
    """After the author edits the Q/A pairs, the saved quiz keeps every question whose idea didn't
    really change (with its wrong answers and Fill-in blank) and gets free questions for new or
    changed ones, in the new order, instead of showing old questions until Regenerate."""
    if not old_quiz:
        return None
    quiz_mod = _quiz_helpers()
    kept = {}
    for question in old_quiz:
        if isinstance(question, dict) and ideas.valid_id(question.get("idea_id")):
            kept.setdefault(question["idea_id"], question)
    fresh = {q.get("idea_id"): q for q in quiz_mod._standard_questions(new_qa, random.Random(f"{guide_id}:{version}"))}
    out = []
    for pair in new_qa:
        old = kept.get(pair.get("idea_id"))
        if old and ideas.normalize(old.get("question")) == ideas.normalize(pair.get("question")) \
                and not ideas.is_real_change(*ideas.quiz_text(old), pair.get("question"), pair.get("answer")):
            out.append(old)
        elif pair.get("idea_id") in fresh:
            out.append(fresh[pair["idea_id"]])
    return out or None


# --- Stored versions (guide_versions) -------------------------------------------------------------

def snapshot(db, guide_id: str, content: dict) -> None:
    """Keep this version so students can stay on it (a no-op before the migration)."""
    try:
        db.table("guide_versions").upsert({
            "guide_id": guide_id, "version": content["version"], "title": content.get("title") or "",
            "cards": content.get("cards") or [], "quiz": content.get("quiz"), "qa": content.get("qa") or [],
        }, on_conflict="guide_id,version", ignore_duplicates=True).execute()
    except Exception as exc:
        logger.warning(f"Guide version snapshot skipped: {type(exc).__name__}")


def stored(db, guide_id: str, version: int) -> Optional[dict]:
    try:
        rows = (db.table("guide_versions").select("version,title,cards,quiz,qa").eq("guide_id", guide_id)
                .eq("version", version).limit(1).execute().data or [])
    except Exception:
        return None
    if not rows:
        return None
    row = rows[0]
    return {"version": int(row["version"]), "title": row.get("title") or "", "cards": row.get("cards") or [],
            "quiz": row.get("quiz") or None, "qa": row.get("qa") or []}


def content_at(db, guide: dict, version: int) -> dict:
    """What version `version` of the guide asked. Ideas only change in an edit of the cards or Q/A,
    which stores the version before it; so a version with no stored copy asked the same as the next
    stored one, or as the guide does now."""
    current = int(guide.get("version") or 1)
    if version >= current:
        return live_content(guide)
    try:
        rows = (db.table("guide_versions").select("version").eq("guide_id", guide["id"]).gte("version", version)
                .order("version").limit(1).execute().data or [])
    except Exception:
        rows = []
    found = stored(db, guide["id"], rows[0]["version"]) if rows else None
    if not found:
        return live_content(guide)
    return {**found, "version": version}


def prune(db, guide_id: str, current: int) -> None:
    """Drop versions older than the newest that no student is on (studying or saved)."""
    try:
        versions = [r["version"] for r in (db.table("guide_versions").select("version").eq("guide_id", guide_id).lt("version", current).execute().data or [])]
        if not versions:
            return
        pinned = {r.get("version_seen") for r in (db.table("guide_progress").select("version_seen").eq("guide_id", guide_id).execute().data or [])}
        pinned |= {r.get("pinned_version") for r in (db.table("guide_saves").select("pinned_version").eq("guide_id", guide_id).execute().data or [])}
        unused = [v for v in versions if v not in pinned]
        if unused:
            db.table("guide_versions").delete().eq("guide_id", guide_id).in_("version", unused).execute()
    except Exception as exc:
        logger.warning(f"Guide version prune skipped: {type(exc).__name__}")


# --- Following ideas through an edit --------------------------------------------------------------

def changes(old_content: dict, new_content: dict) -> dict:
    """{added, changed, removed} ideas between two versions (ideas.diff)."""
    return ideas.diff(content_ideas(old_content), content_ideas(new_content))


def merge_for_update(progress: dict, old_content: dict, new_content: dict, today: Optional[str] = None) -> dict:
    """A student's idea-keyed progress moved to a newer version: unchanged ideas keep everything,
    changed ones drop one Learn level and start their flashcard again, removed ones are archived,
    and ideas that come back are restored."""
    today = today or _today()
    delta = changes(old_content, new_content)
    changed = {idea["idea_id"]: idea for idea in delta["changed"]}
    removed = {idea["idea_id"] for idea in delta["removed"]}
    present = {idea["idea_id"] for idea in content_ideas(new_content)}
    out = {}
    for idea_id, entry in (progress or {}).items():
        if not isinstance(entry, dict):
            continue
        entry = dict(entry)
        if idea_id in changed:
            entry = _weaken(entry, changed[idea_id]["question"], today)
        if idea_id in removed:
            entry.setdefault("archived", today)
            entry.setdefault("archived_version", old_content.get("version"))
        elif idea_id in present:
            entry.pop("archived", None)
            entry.pop("archived_version", None)
        out[idea_id] = entry
    return out


def _weaken(entry: dict, question: str, today: str) -> dict:
    entry = dict(entry)
    if isinstance(entry.get("l"), int):
        entry["l"] = max(0, entry["l"] - 1)
        entry["at"] = today
        entry["q"] = ideas.fingerprint48(question)
        entry.pop("sure", None)
    if "box" in entry:
        entry["box"] = 0
        entry["due"] = today
        entry["known"] = False
    return entry


def remap_owner(progress: dict, old_content: dict, new_content: dict, old_questions: list, new_questions: list,
                today: Optional[str] = None) -> dict:
    """The owner's position-keyed flashcard_progress after their own edit, by the same rules as
    merge_for_update: each card's and question's progress follows its idea to its new position."""
    if not isinstance(progress, dict) or not progress:
        return progress
    today = today or _today()
    ideas_now = by_idea(progress, old_content["cards"], old_questions)
    archived = dict(progress.get("archived") or {}) if isinstance(progress.get("archived"), dict) else {}
    for idea_id, entry in archived.items():
        ideas_now.setdefault(idea_id, entry)
    moved = merge_for_update(ideas_now, old_content, new_content, today)
    out = {key: value for key, value in progress.items() if key not in ("schedule", "known", "unknown", "learn", "archived")}
    view = legacy_view(moved, new_content["cards"], new_questions)
    out["schedule"], out["known"], out["unknown"] = view["schedule"], view["known"], view["unknown"]
    if "last_studied" in progress:
        out["last_studied"] = progress["last_studied"]
    if isinstance(progress.get("learn"), dict) or view["learn"]["levels"]:
        learn = dict(progress.get("learn") or {})
        learn["levels"] = view["learn"]["levels"]
        out["learn"] = learn
    gone = {idea_id: entry for idea_id, entry in moved.items() if entry.get("archived")}
    if gone:
        out["archived"] = gone
    return out


# --- Between the two shapes -----------------------------------------------------------------------

def by_idea(progress: dict, cards: list, questions: list) -> dict:
    """Position-keyed progress ({schedule, known, unknown, learn.levels}) to {idea_id: entry}.
    A Learn level counts only when its fingerprint matches the question at its position, or
    another question's (as Learn's own restore does)."""
    out = {}
    schedule = progress.get("schedule") if isinstance(progress.get("schedule"), dict) else {}
    known = {int(i) for i in progress.get("known") or [] if str(i).isdigit()}
    unknown = {int(i) for i in progress.get("unknown") or [] if str(i).isdigit()}
    for index, card in enumerate(cards or []):
        idea_id = card.get("idea_id") if isinstance(card, dict) else None
        if not ideas.valid_id(idea_id):
            continue
        entry = {}
        slot = schedule.get(str(index))
        if isinstance(slot, dict) and isinstance(slot.get("box"), int):
            entry.update({"box": slot["box"], "due": slot.get("due")})
        if index in known:
            entry["known"] = True
        elif index in unknown:
            entry["known"] = False
        if entry:
            out.setdefault(idea_id, {}).update(entry)
    levels = ((progress.get("learn") or {}).get("levels") or {}) if isinstance(progress.get("learn"), dict) else {}
    by_print = {}
    for question in questions or []:
        if isinstance(question, dict) and ideas.valid_id(question.get("idea_id")):
            by_print.setdefault(ideas.fingerprint48(question.get("question")), question["idea_id"])
    for key, level in levels.items():
        if not isinstance(level, dict) or not isinstance(level.get("l"), int):
            continue
        idea_id = None
        if str(key).isdigit() and int(key) < len(questions or []):
            at = questions[int(key)]
            if isinstance(at, dict) and ideas.fingerprint48(at.get("question")) == level.get("q"):
                idea_id = at.get("idea_id")
        idea_id = idea_id or by_print.get(level.get("q"))
        if ideas.valid_id(idea_id):
            out.setdefault(idea_id, {}).update({key2: level.get(key2) for key2 in ("l", "at", "q", "sure") if level.get(key2) is not None})
    return out


def legacy_view(progress: dict, cards: list, questions: list) -> dict:
    """{idea_id: entry} to the position-keyed shape the study screens read: schedule, known,
    unknown and learn.levels for this version's cards and questions. Archived ideas are left out."""
    schedule, known, unknown, levels = {}, [], [], {}
    live = {k: v for k, v in (progress or {}).items() if isinstance(v, dict) and not v.get("archived")}
    for index, card in enumerate(cards or []):
        entry = live.get(card.get("idea_id")) if isinstance(card, dict) else None
        if not entry:
            continue
        if isinstance(entry.get("box"), int) and entry.get("due"):
            schedule[str(index)] = {"box": entry["box"], "due": entry["due"]}
        if entry.get("known") is True:
            known.append(index)
        elif entry.get("known") is False:
            unknown.append(index)
    for index, question in enumerate(questions or []):
        entry = live.get(question.get("idea_id")) if isinstance(question, dict) else None
        if not entry or not isinstance(entry.get("l"), int):
            continue
        level = {"l": entry["l"], "at": entry.get("at"), "q": ideas.fingerprint48(question.get("question"))}
        if entry.get("sure"):
            level["sure"] = True
        levels[str(index)] = level
    return {"schedule": schedule, "known": known, "unknown": unknown, "learn": {"levels": levels}}


def patch_from(cards_changes: Optional[dict], levels: Optional[dict], cards: list, questions: list) -> dict:
    """A study screen's position-keyed save ({index: {box, due, known}} and {index: {l, at, q, sure}})
    as an idea-keyed patch for merge_guide_progress. A Learn level whose fingerprint doesn't match
    the question at its position is matched by fingerprint, or dropped."""
    patch = {}
    for key, value in (cards_changes or {}).items():
        if not str(key).isdigit() or int(key) >= len(cards or []) or not isinstance(value, dict):
            continue
        idea_id = cards[int(key)].get("idea_id") if isinstance(cards[int(key)], dict) else None
        if ideas.valid_id(idea_id) and isinstance(value.get("box"), int) and 0 <= value["box"] <= 5:
            patch.setdefault(idea_id, {}).update({"box": value["box"], "due": str(value.get("due") or "")[:10], "known": bool(value.get("known"))})
    if levels:
        mapped = by_idea({"learn": {"levels": {str(k): v for k, v in levels.items() if isinstance(v, dict)}}}, [], questions)
        for idea_id, entry in mapped.items():
            if isinstance(entry.get("l"), int) and 0 <= entry["l"] <= 3:
                patch.setdefault(idea_id, {}).update({"l": entry["l"], "at": entry.get("at"), "q": str(entry.get("q") or "")[:64],
                                                       "sure": True if entry.get("sure") else None})
    return patch
