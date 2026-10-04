"""Retain question types: which format fits each idea, and how each answer is checked.

Every idea in a guide is asked once, in the best-fitting format the student turned on:
  term (a word or short phrase) -> matching (in sets of 4-6) or fill in the blank
  one sentence                  -> multiple choice
  two+ sentences / "explain"    -> written, marked by AI with partial credit
Anything that fits no selected format falls back to multiple choice. Matching, fill in the
blank and multiple choice are checked here without AI; written answers carry a signed grade
from the marking endpoint so the score cannot be edited in the browser.
"""

import hashlib
import hmac
import os
import re
import unicodedata

TYPES = ("mc", "written", "fill", "matching")
FREE_TYPES = {"mc", "written"}
PRO_TYPES = {"fill", "matching"}
CREDITS = (0.0, 0.5, 1.0)

TERM_MAX_WORDS = 5
MATCH_MIN, MATCH_MAX = 4, 6
FIT = {
    "term": ("matching", "fill", "mc"),
    "sentence": ("mc",),
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


def plan_session(questions: list, selected) -> list:
    """Cards in guide order: {"type", "concepts": [index, ...]}, one first ask per idea."""
    chosen = [kind for kind in TYPES if kind in set(selected or ())] or ["mc"]
    assigned = {}
    for index, question in enumerate(questions):
        shape = answer_shape(question.get("question", ""), concept_answer(question))
        assigned[index] = next((kind for kind in FIT[shape] if kind in chosen), "mc")

    def fallback(index):
        return "fill" if "fill" in chosen else "mc"

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


def _signing_key() -> bytes:
    secret = os.getenv("RETAIN_SIGNING_KEY") or os.getenv("SUPABASE_JWT_SECRET") or os.getenv("SUPABASE_KEY") or ""
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
        return 1.0 if fill_matches(response, answer) else 0.0
    if kind == "written":
        return verified_credit(user_id, guide_id, attempt.get("concept"), attempt.get("credit"), attempt.get("token"))
    return 0.0
