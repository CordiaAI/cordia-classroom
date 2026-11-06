"""Stable ids for a guide's ideas (social plan, Stage 4).

An idea is one Q/A pair. It shows up as a flashcard ({front, back}) and as a quiz question
({question, options, correct_index}); both carry the same `idea_id`, so progress, versions and
connected apps can point at an idea that survives edits, reordering and regeneration.

Rules, in order, for every item written to `flashcards` or `quiz_questions`:
  1. an item that already carries a known id keeps it;
  2. otherwise the same question (normalized) reuses that idea's id, then the same 48-character
     fingerprint (Learn's), then the most similar idea not yet claimed (an edit of the same idea);
  3. only a truly new idea gets a new id.
A quiz question takes the id of the card with the same question.

`is_real_change` is the one rule for "did this idea change?", used for authors' own edits and for
students who accept an update.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from difflib import SequenceMatcher
from typing import Optional

ID_PATTERN = re.compile(r"^[a-z0-9]{6,32}$")
SIMILAR_ENOUGH = 0.90   # at or above this, an edit is a typo fix, not a change
SAME_IDEA = 0.60        # an edited question still counts as the same idea at or above this
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def normalize(text) -> str:
    """Lower-case, punctuation and extra spaces gone (questionKey in web/lib/retainMisses.mjs)."""
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def fingerprint48(text) -> str:
    """Learn's question fingerprint (fingerprint() in web/lib/learnEngine.mjs)."""
    return normalize(text)[:48]


def new_id() -> str:
    return secrets.token_hex(5)


def stable_id(question) -> str:
    """An idea's first id, made from its question, so a guide whose ids were never saved gets the
    same ids on every read (no backfill needed); once saved, ids are carried through edits."""
    return hashlib.sha1(("idea:" + normalize(question)).encode()).hexdigest()[:10]


def valid_id(value) -> bool:
    return isinstance(value, str) and bool(ID_PATTERN.match(value))


def similarity(a, b) -> float:
    """How alike two texts are, 0 to 1, after normalizing: by words, and by letters for short texts
    (so "Mitocondria" and "Mitochondria" are near, but "1863" and "1864" aren't)."""
    na, nb = normalize(a), normalize(b)
    if na == nb:
        return 1.0
    if not na or not nb:
        return 0.0
    wa, wb = na.split(), _snap(na.split(), nb.split())
    words = SequenceMatcher(None, wa, wb).ratio()
    if len(wa) <= 3 and len(wb) <= 3:
        return max(words, SequenceMatcher(None, na, nb).ratio())
    return words


def _snap(old_words: list, new_words: list) -> list:
    """New words with each misspelling of an old word replaced by that word ("recieving" ->
    "receiving"): same first letter, 4+ letters, spelled almost the same. "affect"/"effect" and
    "increase"/"decrease" stay different words; numbers are never snapped."""
    known = set(old_words)
    out = []
    for word in new_words:
        if word in known or len(word) < 4 or word.isdigit():
            out.append(word)
            continue
        near = [w for w in known if len(w) >= 4 and w[0] == word[0] and not w.isdigit()
                and SequenceMatcher(None, w, word).ratio() >= 0.8]
        out.append(max(near, key=lambda w: SequenceMatcher(None, w, word).ratio()) if near else word)
    return out


def _text_changed(old, new) -> bool:
    if normalize(old) == normalize(new):
        return False
    # A different number is a different fact, however small the edit ("1863" -> "1864").
    if _NUMBER.findall(normalize(old)) != _NUMBER.findall(normalize(new)):
        return True
    return similarity(old, new) < SIMILAR_ENOUGH


def is_real_change(old_question, old_answer, new_question, new_answer) -> bool:
    """True when an idea really changed: its question or answer differs after ignoring
    punctuation, capitals and extra spaces, by more than a small typo fix (word similarity under
    90%), or any number in it changed."""
    return _text_changed(old_question, new_question) or _text_changed(old_answer, new_answer)


def card_text(card) -> tuple:
    if not isinstance(card, dict):
        return "", ""
    return str(card.get("front") or ""), str(card.get("back") or "")


def item_text(item) -> tuple:
    """(question, answer) of a card ({front, back}), quiz question ({question, options}) or Q/A pair
    ({question, answer})."""
    if not isinstance(item, dict):
        return "", ""
    if "front" in item or "back" in item:
        return card_text(item)
    if isinstance(item.get("options"), list):
        return quiz_text(item)
    return str(item.get("question") or ""), str(item.get("answer") or "")


def quiz_text(question) -> tuple:
    if not isinstance(question, dict):
        return "", ""
    options = question.get("options") if isinstance(question.get("options"), list) else []
    index = question.get("correct_index")
    answer = options[index] if isinstance(index, int) and 0 <= index < len(options) else ""
    return str(question.get("question") or ""), str(answer or "")


class _Matcher:
    """Hands out ids for one write: old ideas are matched once; duplicates share an id."""

    def __init__(self, old_items: list):
        self.old = []  # (id, question, answer)
        self.by_norm, self.by_print = {}, {}
        for idea_id, question, answer in old_items:
            if not valid_id(idea_id):
                continue
            self.old.append((idea_id, question, answer))
            self.by_norm.setdefault(normalize(question), idea_id)
            self.by_print.setdefault(fingerprint48(question), idea_id)
        self.known = {idea_id for idea_id, _, _ in self.old}
        self.claimed = {}   # id -> normalized question it was given to
        self.given = {}     # normalized question -> id (duplicates share)

    def _free(self, idea_id: str, norm: str) -> bool:
        return idea_id not in self.claimed or self.claimed[idea_id] == norm

    def exact(self, question: str, carried: Optional[str] = None) -> Optional[str]:
        """Pass 1: a carried id, the same question, or the same fingerprint."""
        norm = normalize(question)
        if norm in self.given:
            return self.given[norm]
        for candidate in (carried if valid_id(carried) else None, self.by_norm.get(norm), self.by_print.get(norm[:48])):
            if candidate and self._free(candidate, norm):
                return self._give(candidate, norm)
        return None

    def take(self, question: str, answer: str) -> str:
        """Pass 2: the most alike unclaimed old idea (an edit of it), else a new id."""
        norm = normalize(question)
        if norm in self.given:
            return self.given[norm]
        best, best_score = None, 0.0
        for idea_id, old_q, old_a in self.old:
            if not self._free(idea_id, norm):
                continue
            score = (_words(old_q, question) + _words(old_a, answer)) / 2
            if score > best_score:
                best, best_score = idea_id, score
        if best and best_score >= SAME_IDEA:
            return self._give(best, norm)
        fresh = stable_id(question)
        if fresh in self.known or fresh in self.claimed:
            fresh = new_id()
        return self._give(fresh, norm)

    def _give(self, idea_id: str, norm: str) -> str:
        self.claimed[idea_id] = norm
        self.given[norm] = idea_id
        return idea_id


def _words(a, b) -> float:
    na, nb = normalize(a), normalize(b)
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na.split(), nb.split()).ratio() if na and nb else 0.0


def assign_lists(old_lists, new_lists) -> list:
    """Copies of each new list (cards, quiz questions or Q/A pairs; None stays None) with an
    `idea_id` on every item, matched against all the old lists' items."""
    old_items = [(item.get("idea_id"), *item_text(item)) for items in old_lists for item in (items or []) if isinstance(item, dict)]
    matcher = _Matcher(old_items)
    out = [[dict(item) if isinstance(item, dict) else item for item in items] if isinstance(items, list) else None for items in new_lists]
    pending = []
    for items in out:
        for item in items or []:
            if not isinstance(item, dict):
                continue
            question, answer = item_text(item)
            found = matcher.exact(question, item.get("idea_id"))
            if found:
                item["idea_id"] = found
            else:
                pending.append((item, question, answer))
    for item, question, answer in pending:
        item["idea_id"] = matcher.take(question, answer)
    return out


def assign_idea_ids(old_cards, old_quiz, new_cards, new_quiz) -> tuple:
    """(cards, quiz) with an `idea_id` on every item, matched against the guide's previous items.
    Pass None for a list that isn't being written (it's returned as None)."""
    cards, quiz = assign_lists([old_cards, old_quiz], [new_cards, new_quiz])
    return cards, quiz


def ensure_ids(*lists) -> list:
    """The same lists with ids on every item: saved ids are kept, an item without one takes the id
    of the item with the same question, else its question's stable id. Same input, same ids."""
    return assign_lists(list(lists), list(lists))


def ideas_of(cards, quiz) -> list:
    """The guide's ideas, one per id, in order: [{idea_id, question, answer, card?, quiz?}]."""
    out, index = [], {}
    for card in cards or []:
        if isinstance(card, dict) and valid_id(card.get("idea_id")):
            front, back = card_text(card)
            if card["idea_id"] not in index:
                index[card["idea_id"]] = len(out)
                out.append({"idea_id": card["idea_id"], "question": front, "answer": back, "card": card})
    for question in quiz or []:
        if isinstance(question, dict) and valid_id(question.get("idea_id")):
            text, answer = quiz_text(question)
            at = index.get(question["idea_id"])
            if at is None:
                index[question["idea_id"]] = len(out)
                out.append({"idea_id": question["idea_id"], "question": text, "answer": answer, "quiz": question})
            elif "quiz" not in out[at]:
                out[at]["quiz"] = question
    return out


def diff(old_ideas: list, new_ideas: list) -> dict:
    """{added, changed, removed}: lists of ideas (changed ones carry `before`). Unchanged ideas,
    including typo fixes, aren't listed."""
    old = {idea["idea_id"]: idea for idea in old_ideas or []}
    new = {idea["idea_id"]: idea for idea in new_ideas or []}
    added = [idea for idea_id, idea in new.items() if idea_id not in old]
    removed = [idea for idea_id, idea in old.items() if idea_id not in new]
    changed = []
    for idea_id, idea in new.items():
        before = old.get(idea_id)
        if before and is_real_change(before["question"], before["answer"], idea["question"], idea["answer"]):
            changed.append({**idea, "before": {"question": before["question"], "answer": before["answer"]}})
    return {"added": added, "changed": changed, "removed": removed}
