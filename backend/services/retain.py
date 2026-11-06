"""Retain question types: which format fits each idea, and how each answer is checked.

Every idea in a guide is asked once, in the best-fitting format the student turned on:
  term (a word or short phrase) -> matching (in sets of 4-6) or fill in the blank
  one sentence                  -> multiple choice
  two+ sentences / "explain"    -> written, marked by AI with partial credit
Anything that fits no selected format falls back to multiple choice. Matching, fill in the
blank and multiple choice are checked here without AI; written answers carry a signed grade
from the marking endpoint so the score cannot be edited in the browser.
"""

import random
import hashlib
import hmac
import os
import re
import unicodedata

TYPES = ("mc", "written", "fill", "matching")
PRO_TYPES = {"fill", "matching"}
CREDITS = (0.0, 0.5, 1.0)

TERM_MAX_WORDS = 5
MATCH_MIN, MATCH_MAX = 4, 6
# Formats that can ask each answer shape, best first. Written is graded by AI, so it can ask any
# answer; it comes last for short ones, so it is only used when the student didn't pick a better fit.
FIT = {
    "term": ("matching", "fill", "mc", "written"),
    "sentence": ("mc", "written"),
    "long": ("written", "mc"),
}
_EXPLAIN = re.compile(r"^\s*(why|how|explain|describe|compare|contrast|discuss|what (role|effect|impact))\b", re.I)


def _sentences(text: str) -> int:
    return len([part for part in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if len(part.split()) >= 3])


def answer_shape(question: str, answer: str) -> str:
    """'term', 'sentence' or 'long' — a one-sentence answer is never treated as long."""
    words = len((answer or "").split())
    if words <= TERM_MAX_WORDS:
        return "term"
    if words >= 25 or _sentences(answer) >= 2 or (words >= 12 and _EXPLAIN.search(question or "")):
        return "long"
    return "sentence"


def concept_answer(question: dict) -> str:
    options = question.get("options") or []
    index = question.get("correct_index")
    return str(options[index]) if isinstance(index, int) and 0 <= index < len(options) else ""


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "").replace("\u2019", "'")).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"['\u2019]|(?<!\d)\.|\.(?!\d)", "", text)  # U.S. = US, Newton's = Newtons
    text = re.sub(r"[^a-z0-9.%+\- ]+", " ", text)
    text = re.sub(r"^(the|a|an)\s+", "", re.sub(r"\s+", " ", text).strip())
    return text


def _accepted(answer: str) -> set:
    """The answer plus its written alternatives: 'X (Y)', 'X or Y', 'X / Y'."""
    raw = str(answer or "")
    parts = {raw, re.sub(r"\([^)]*\)", "", raw)}
    parts |= set(re.findall(r"\(([^)]*)\)", raw))
    for separator in (r"\s+or\s+", r"\s*/\s*", r"\s*;\s*"):
        parts |= set(re.split(separator, raw))
    values = {normalize(part) for part in parts if normalize(part)}
    return values | {value[:-1] for value in values if value.endswith("s") and len(value) > 3}


def _distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, 1):
        current = [i]
        for j, char_b in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char_a != char_b)))
        previous = current
    return previous[-1]


def fill_matches(response: str, answer: str) -> bool:
    """Same meaning-preserving tolerance as the browser: case, articles, plurals, small typos."""
    given = normalize(response)
    if not given:
        return False
    candidates = {given} | ({given[:-1]} if given.endswith("s") and len(given) > 3 else set())
    for accepted in _accepted(answer):
        for value in candidates:
            if value == accepted:
                return True
            if not re.search(r"\d", accepted) and len(accepted) >= 5 and _distance(value, accepted) <= len(accepted) // 6:
                return True
    return False


_FILLER = {"the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "is", "are", "was", "were", "by", "with", "its", "it"}


def _key_words(text: str) -> list:
    return [word for word in str(text or "").split(" ") if word and word not in _FILLER]


def _same_word(a: str, b: str) -> bool:
    if a == b or re.sub(r"s$", "", a) == re.sub(r"s$", "", b):
        return True
    return len(a) >= 5 and len(b) >= 5 and not re.search(r"\d", a + b) and _distance(a, b) <= max(len(a), len(b)) // 5


def fill_verdict(response: str, answer: str) -> str:
    """'right' (fill_matches), 'close' (part of the answer, nothing contradicting it: "Alpha Sigma"
    for "Oregon Alpha Sigma") or 'wrong'. Close: every number in the answer is there, the typed
    words cover at least half of the answer's key words, at most one typed word isn't in it.
    Mirrors web/lib/retainEngine.mjs fillVerdict; the student decides whether close counts."""
    if fill_matches(response, answer):
        return "right"
    given = _key_words(normalize(response))
    if not given:
        return "wrong"
    for accepted in _accepted(answer):
        target = _key_words(accepted)
        if not target:
            continue
        if any(re.search(r"\d", word) and word not in given for word in target):
            continue
        covered = sum(1 for word in target if any(_same_word(typed, word) for typed in given))
        extra = sum(1 for typed in given if not any(_same_word(typed, word) for word in target))
        if covered and covered * 2 >= len(target) and extra <= 1:
            return "close"
    return "wrong"


def mentions_answer(text: str, answer: str) -> bool:
    """Whether a piece of writing (a memory hook) states the answer: every number in it, and all of
    its key words (at least half when it has more than six), allowing plurals and small typos."""
    words = _key_words(normalize(text))
    if not words:
        return False
    for accepted in _accepted(answer):
        target = _key_words(accepted)
        if not target or any(re.search(r"\d", word) and word not in words for word in target):
            continue
        covered = sum(1 for word in target if any(_same_word(given, word) for given in words))
        if covered == len(target) or (len(target) > 6 and covered * 2 >= len(target)):
            return True
    return False


def plan_session(questions: list, selected, indices=None) -> list:
    """Cards in guide order: {"type", "concepts": [index, ...]}, one first ask per idea.
    indices: only these questions (a quiz with fewer questions than the guide has)."""
    chosen = [kind for kind in TYPES if kind in set(selected or ())] or ["mc"]
    assigned = {}
    wanted = set(indices) if indices is not None else None
    for index, question in enumerate(questions):
        if wanted is not None and index not in wanted:
            continue
        shape = answer_shape(question.get("question", ""), concept_answer(question))
        assigned[index] = next((kind for kind in FIT[shape] if kind in chosen), "mc")

    def fallback(index):
        return next((kind for kind in ("fill", "mc", "written") if kind in chosen), "mc")

    matching = [index for index, kind in assigned.items() if kind == "matching"]
    groups, current, seen = [], [], set()
    for index in matching:
        key = normalize(concept_answer(questions[index]))
        if key in seen:  # identical answers cannot be told apart in one matching set
            assigned[index] = fallback(index)
            continue
        current.append(index)
        seen.add(key)
        if len(current) == MATCH_MAX:
            groups.append(current)
            current, seen = [], set()
    if len(current) >= MATCH_MIN:
        groups.append(current)
    else:
        for index in current:
            assigned[index] = fallback(index)

    cards = [{"type": "matching", "concepts": group} for group in groups]
    cards += [{"type": kind, "concepts": [index]} for index, kind in assigned.items() if kind != "matching"]
    return sorted(cards, key=lambda card: card["concepts"][0])


MAX_QUIZ_QUESTIONS = 50  # the most a guide's quiz holds (routers/quiz.py builds from the first 50 pairs)


def askable(questions: list) -> list:
    """Indexes of questions that have an answer to check."""
    return [index for index, question in enumerate(questions) if concept_answer(question)]


def pick_questions(questions: list, count=None, rng=None) -> list:
    """Which questions a quiz asks: all of them, or `count` chosen at random."""
    pool = askable(questions)
    if not count or count >= len(pool):
        return pool
    return sorted((rng or random).sample(pool, count))


def shuffled_cards(cards: list, rng=None) -> list:
    """The session's cards in random order (a matching set stays together)."""
    out = list(cards)
    (rng or random).shuffle(out)
    return out


def _signing_key() -> bytes:
    secret = (os.getenv("RETAIN_SIGNING_KEY") or os.getenv("SUPABASE_JWT_SECRET")
              or os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "")
    if not secret:
        # An empty key would let anyone forge written-answer credit: refuse to grade instead.
        raise RuntimeError("RETAIN_SIGNING_KEY is not set")
    return hashlib.sha256(("cordia-retain-grade:" + secret).encode()).digest()


def sign_grade(user_id: str, guide_id: str, concept: int, credit: float) -> str:
    message = f"{user_id}|{guide_id}|{concept}|{credit:.1f}".encode()
    return hmac.new(_signing_key(), message, hashlib.sha256).hexdigest()


def verified_credit(user_id: str, guide_id: str, concept: int, credit, token: str) -> float:
    """The written grade's credit if its signature matches, otherwise 0."""
    try:
        credit = float(credit)
    except (TypeError, ValueError):
        return 0.0
    if credit not in CREDITS or not token:
        return 0.0
    expected = sign_grade(user_id, guide_id, concept, credit)
    return credit if hmac.compare_digest(expected, str(token)) else 0.0


def first_try_credit(question: dict, attempt: dict, user_id: str, guide_id: str) -> float:
    """Credit for one first attempt, checked against the saved question."""
    kind = attempt.get("type")
    answer = concept_answer(question)
    response = str(attempt.get("response") or "")
    if kind in ("mc", "matching"):
        return 1.0 if normalize(response) and normalize(response) == normalize(answer) else 0.0
    if kind == "fill":
        if fill_matches(response, answer):
            return 1.0
        # The student looked at the right answer and said theirs meant the same ("Count it as
        # right" / "I was right"). Their call, like a flashcard's Got it: it only moves their own score.
        return 1.0 if attempt.get("self_marked") and attempt.get("credit") == 1 else 0.0
    if kind == "written":
        return verified_credit(user_id, guide_id, attempt.get("concept"), attempt.get("credit"), attempt.get("token"))
    return 0.0
