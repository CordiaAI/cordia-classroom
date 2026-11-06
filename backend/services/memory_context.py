"""The student's own material that a "Help me remember" trick can link to (feedback item 6).

Looks across the student's other study guides (ones they already know well first), their lecture
transcripts and their Tutor chats for passages that share the question's key words, and returns
the top few as short snippets. Every query is filtered to the student's own rows; anything that
fails or finds nothing gives an empty list, and the trick is written without context.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

MAX_LINKS = 3
_SNIPPET = 240
_STOP = {
    "about", "after", "also", "among", "and", "because", "been", "before", "being", "between", "both",
    "called", "could", "does", "during", "each", "from", "have", "into", "many", "more", "most", "much",
    "only", "other", "over", "same", "some", "such", "than", "that", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "under", "until", "used", "very", "were", "what",
    "when", "where", "which", "while", "whose", "will", "with", "would", "your", "years", "year",
}


def key_terms(question: str, answer: str, limit: int = 6) -> list:
    """Distinctive words from the question and answer, longest first (names and terms beat filler)."""
    seen, terms = set(), []
    for word in re.findall(r"[A-Za-z][A-Za-z'\-]{3,}", f"{question} {answer}"):
        low = word.lower().strip("'-")
        if low in _STOP or low in seen:
            continue
        seen.add(low)
        terms.append(low)
    return sorted(terms, key=len, reverse=True)[:limit]


def _snippet(text: str, terms: list) -> tuple:
    """(hits, the sentence that shares the most key words), from plain text."""
    best, best_hits = "", 0
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", re.sub(r"<[^>]+>|\[IMG:[^\]]*\]", " ", text or "")[:20000]):
        low = sentence.lower()
        hits = sum(1 for term in terms if term in low)
        if hits > best_hits:
            best, best_hits = sentence.strip(), hits
    return best_hits, best[:_SNIPPET]


def _familiar(entry) -> bool:
    """An idea at Familiar or Mastered, read the way classroom_study.level_of reads it (not imported:
    that module reaches class and LMS code, which the MCP routes that load this must never reach)."""
    if not isinstance(entry, dict) or entry.get("archived"):
        return False
    level = entry.get("l")
    return level >= 2 if isinstance(level, int) else entry.get("known") is True


def _known_well(db, user_id: str, guide_ids: list) -> dict:
    """Per guide, how many of its ideas the student has at Familiar or Mastered."""
    if not guide_ids:
        return {}
    try:
        rows = db.table("guide_progress").select("guide_id, progress").eq("user_id", user_id).in_("guide_id", guide_ids).execute().data or []
    except Exception:
        return {}
    return {
        row["guide_id"]: sum(1 for entry in (row.get("progress") or {}).values() if _familiar(entry))
        for row in rows if isinstance(row.get("progress"), dict)
    }


def _search(db, table: str, columns: str, user_id: str, terms: list, exclude: str = ""):
    query = (db.table(table).select(columns).eq("user_id", user_id)
             .text_search("search_doc", " or ".join(terms), options={"type": "websearch", "config": "english"}))
    if exclude:
        query = query.neq("id", exclude)
    return query.limit(6).execute().data or []


def related_material(db, user_id: str, guide_id: str, question: str, answer: str) -> list:
    """Up to three [{kind, id, title, snippet}] from the student's other material, best first."""
    terms = key_terms(question, answer)
    if not terms:
        return []
    found = []
    try:
        guides = _search(db, "study_guides", "id, title, notes, study_guide", user_id, terms, exclude=guide_id)
        known = _known_well(db, user_id, [g["id"] for g in guides])
        for guide in guides:
            hits, text = _snippet(guide.get("notes") or guide.get("study_guide") or "", terms)
            if hits:
                # A guide the student already knows well is the better anchor: one bonus hit.
                found.append({"kind": "guide", "id": guide["id"], "title": guide.get("title") or "Study guide",
                              "snippet": text, "_score": hits + (1 if known.get(guide["id"]) else 0)})
    except Exception:
        logger.warning("Memory context: guides unavailable", exc_info=True)
    try:
        for lecture in _search(db, "lectures", "id, title, transcript", user_id, terms):
            hits, text = _snippet(lecture.get("transcript") or "", terms)
            if hits:
                found.append({"kind": "lecture", "id": lecture["id"], "title": lecture.get("title") or "Lecture",
                              "snippet": text, "_score": hits})
    except Exception:
        logger.warning("Memory context: lectures unavailable", exc_info=True)
    try:
        chats = (db.table("tutor_chats").select("id, title, messages").eq("user_id", user_id)
                 .order("updated_at", desc=True).limit(20).execute().data or [])
        for chat in chats:
            said = " ".join(str(m.get("content") or "") for m in (chat.get("messages") or []) if isinstance(m, dict))
            hits, text = _snippet(said, terms)
            if hits >= 2:  # a passing word in a long chat is not a link
                found.append({"kind": "tutor", "id": chat["id"], "title": chat.get("title") or "Tutor chat",
                              "snippet": text, "_score": hits})
    except Exception:
        logger.warning("Memory context: Tutor chats unavailable", exc_info=True)
    found.sort(key=lambda item: item["_score"], reverse=True)
    return [{key: value for key, value in item.items() if key != "_score"} for item in found[:MAX_LINKS]]
