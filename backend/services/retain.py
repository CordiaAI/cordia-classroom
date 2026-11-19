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
from collections import Counter

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


MIN_CHOICES = 3  # a multiple choice question needs at least this many choices (3 or 4); fewer is never asked as one


def can_choose(question: dict) -> bool:
    """Whether a question has enough choices to be asked as multiple choice. A guide-derived question
    keeps only related, fitting choices (2 to 4), so one left with two is asked by typing it or
    writing it instead: web/lib/retainEngine.mjs canChoose is the same rule."""
    options = question.get("options") if isinstance(question, dict) else None
    return isinstance(options, list) and len(options) >= MIN_CHOICES


def concept_answer(question: dict) -> str:
    """The question's answer, or "" for a row with none (a malformed saved row is never asked)."""
    if not isinstance(question, dict):
        return ""
    options = question.get("options") if isinstance(question.get("options"), list) else []
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


def _within(a: str, b: str, limit: int) -> bool:
    """Whether a and b are at most `limit` edits apart (_distance(a, b) <= limit), working only in a
    band `limit` wide around the diagonal and stopping as soon as every cell in a row is past it."""
    n, m = len(a), len(b)
    if abs(n - m) > limit:
        return False
    over = limit + 1
    previous = [j if j <= limit else over for j in range(m + 1)]
    for i in range(1, n + 1):
        current = [over] * (m + 1)
        current[0] = i if i <= limit else over
        best = current[0]
        for j in range(max(1, i - limit), min(m, i + limit) + 1):
            value = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] != b[j - 1]), over)
            current[j] = value
            best = min(best, value)
        if best > limit:
            return False
        previous = current
    return previous[m] <= limit


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
    longest = max(len(a), len(b))
    return (len(a) >= 5 and len(b) >= 5 and abs(len(a) - len(b)) <= longest // 5 and not re.search(r"\d", a + b)
            and _within(a, b, longest // 5))


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


PART_MAX_WORDS = 6
PART_MAX_COUNT = 12     # a longer list is one answer, not parts to check
ANSWER_MAX_CHARS = 1000  # a longer answer is one answer too: this is also all of it the model is shown
WORD_MAX_CHARS = 40
_SERIES_END = re.compile(r"^(?:and|or|&)\s+", re.I)
_LAST_PAIR = re.compile(r"^(.+?)\s+(?:and|or|&)\s+(.+)$", re.I)


def answer_parts(answer: str) -> list:
    """The parts of a list answer ("Sigmund Freud, Carl Jung, and Alfred Adler" -> three names;
    "Offer; acceptance; consideration"), else [answer]. A list is three or more short items split
    by semicolons, or by commas with "and"/"or" before the last one (four or more need none), so a
    sentence with commas ("Hyperkalemia, a high potassium level, causes peaked T waves") and a pair
    or title ("Romeo and Juliet") stay one part. At most PART_MAX_COUNT parts in at most
    ANSWER_MAX_CHARS characters: anything longer is returned whole, so the work never grows with
    what was saved in the guide."""
    raw = str(answer or "")
    whole = raw.strip()
    if len(raw) > ANSWER_MAX_CHARS:
        return [whole]
    text = " ".join(whole.split()).rstrip(".")
    semicolons = ";" in text
    items = [item.strip() for item in (text.split(";") if semicolons else text.split(",")) if item.strip()]
    if len(items) > PART_MAX_COUNT:
        return [whole]
    listed = semicolons and len(items) >= 3
    if not semicolons and len(items) >= 2:
        if _SERIES_END.match(items[-1]):
            listed = len(items) >= 3                     # "A, B, and C"
        elif (pair := _LAST_PAIR.match(items[-1])):
            items[-1:] = [pair.group(1), pair.group(2)]  # "A, B and C"
            listed = True
        else:
            listed = len(items) >= 4                     # "A, B, C, D"
    if not listed or len(items) > PART_MAX_COUNT:
        return [whole]
    items = [_SERIES_END.sub("", item).strip() for item in items]
    if any(not item or len(item.split()) > PART_MAX_WORDS for item in items):
        return [whole]
    return items


def _stem(word: str) -> str:
    return word[:-1] if word.endswith("s") else word


def _part_words(text: str) -> list:
    return [word[:WORD_MAX_CHARS] for word in _key_words(normalize(text))]


def missing_parts(text: str, answer: str) -> list:
    """The parts of a list answer (answer_parts) that a piece of writing (a memory trick) leaves
    out. A part counts when one of its distinguishing words is there (a word no other part uses:
    "1", "2" and "gestational" for "Type 1 diabetes, Type 2 diabetes, gestational diabetes"),
    allowing plurals, possessives and small typos, so a word the parts share cannot stand in for the
    one that was left out. A part with no word of its own ("right atrium" beside "left atrium" and
    "right ventricle") counts only when all its words are in one clause of the trick ("On the right
    side, the atrium collects blood"), not split between two ("LEFT side: atrium ...; the right
    ventricle ..."). [] for a one-part answer.
    The trick is read at most TRICK_MAX_CHARS, the answer at most PART_MAX_COUNT parts
    (answer_parts), and words are matched by lookup, with at most FUZZY_MAX_CHECKS typo comparisons
    in all (_Words), so the work stays small whatever was saved in the guide."""
    parts = answer_parts(answer)
    if len(parts) < 2:
        return []
    text = str(text or "")[:TRICK_MAX_CHARS]
    budget = _Budget()
    trick = _Words(_part_words(text), budget)
    keys = [_part_words(part) for part in parts]
    used_by = Counter(stem for group in keys for stem in {_stem(word) for word in group})
    clauses = None
    missing = []
    for index, part in enumerate(parts):
        own = [word for word in keys[index] if used_by[_stem(word)] == 1]
        if own:
            found = any(trick.names(word) for word in own)
        else:
            if clauses is None:
                clauses = [_Words(words, budget) for words in _clauses(text)]
            found = _together(clauses, list(dict.fromkeys(keys[index])))
        if not found:
            missing.append(part)
    return missing


# Where a clause ends: a sentence end, a semicolon or a line break (not the point in "3.5").
_CLAUSE_END = re.compile(r"[!?;\n]+|\.(?=\s|$)")


def _clauses(text: str) -> list:
    """The key words of each clause of a piece of writing, in order."""
    return [words for words in (_part_words(clause) for clause in _CLAUSE_END.split(text)) if words]


def _together(clauses: list, wanted: list) -> bool:
    """Whether one clause (a _Words) holds every word in `wanted` (in any order, any distance apart)."""
    return any(all(clause.names(word) for word in wanted) for clause in clauses)


TRICK_MAX_CHARS = ANSWER_MAX_CHARS * 3  # a memory trick is at most 600 characters (llm.HOOK_LIST_MAX_CHARS)
FUZZY_MAX_CHECKS = 400  # typo comparisons per check, in all: a word found by lookup costs none


class _Budget:
    def __init__(self):
        self.left = FUZZY_MAX_CHECKS


class _Words:
    """The words of a piece of writing, for asking whether it names a word (_same_word: the same
    word, its plural or a small typo; or the first half of a shared hyphen, "First-" in "First- and
    second-degree murder" naming "first-degree"). The same word and its plural are found by lookup;
    typos are compared only against words of a near length, and at most `budget.left` times across
    every _Words sharing the budget, so the cost never grows with what the writing or the answer
    holds. A word past the budget counts only when it is there as written."""

    def __init__(self, words: list, budget: "_Budget"):
        unique = list(dict.fromkeys(words))
        self.exact = set(unique) | {_stem(word) for word in unique}
        self.halves = [word for word in unique if len(word) > 2 and word.endswith("-")]
        self.by_length = {}
        for word in unique:
            if len(word) >= 5 and not re.search(r"\d", word):
                self.by_length.setdefault(len(word), []).append(word)
        self.budget = budget

    def names(self, word: str) -> bool:
        if word in self.exact or _stem(word) in self.exact:
            return True
        if any(word.startswith(half) for half in self.halves[:20]):
            return True
        if len(word) < 5 or re.search(r"\d", word):
            return False
        for length in range(len(word) - len(word) // 4 - 1, len(word) + len(word) // 4 + 2):
            for given in self.by_length.get(length, ()):
                if self.budget.left <= 0:
                    return False
                self.budget.left -= 1
                if _same_word(given, word):
                    return True
        return False


def mentions_answer(text: str, answer: str) -> bool:
    """Whether a piece of writing (a memory hook) states the answer: every number in it, and all of
    its key words (at least half when it has more than six), allowing plurals and small typos. The
    writing is read at most TRICK_MAX_CHARS and the answer at most ANSWER_MAX_CHARS, and words are
    matched as _Words does, so the cost stays small whatever the two hold."""
    words = _key_words(normalize(str(text or "")[:TRICK_MAX_CHARS]))
    if not words:
        return False
    given = _Words([word[:WORD_MAX_CHARS] for word in words], _Budget())
    for accepted in sorted(_accepted(str(answer or "")[:ANSWER_MAX_CHARS])):
        target = [word[:WORD_MAX_CHARS] for word in _key_words(accepted)]
        if not target or any(re.search(r"\d", word) and word not in given.exact for word in target):
            continue
        found = {word: given.names(word) for word in dict.fromkeys(target)}  # each word looked up once
        covered = sum(1 for word in target if found[word])
        if covered == len(target) or (len(target) > 6 and covered * 2 >= len(target)):
            return True
    return False


def _open_kind(shape: str, chosen: list) -> str:
    """The format for an idea that has too few choices to be multiple choice: a short answer is typed
    when Fill in the blank is on (it is a Pro type, so it is never turned on for the student), anything
    else is written."""
    return "fill" if shape == "term" and "fill" in chosen else "written"


def plan_session(questions: list, selected, indices=None) -> list:
    """Cards in guide order: {"type", "concepts": [index, ...]}, one first ask per idea.
    indices: only these questions (a quiz with fewer questions than the guide has). An idea with fewer
    than MIN_CHOICES choices is never asked with choices (multiple choice or matching): Fill in the blank
    or Written instead (the owner's rule)."""
    chosen = [kind for kind in TYPES if kind in set(selected or ())] or ["mc"]
    assigned = {}
    wanted = set(indices) if indices is not None else None
    for index, question in enumerate(questions):
        if (wanted is not None and index not in wanted) or (isinstance(question, dict) and question.get("hidden")):
            continue
        shape = answer_shape(question.get("question", ""), concept_answer(question))
        if can_choose(question):
            assigned[index] = next((kind for kind in FIT[shape] if kind in chosen), "mc")
        else:
            assigned[index] = next((kind for kind in FIT[shape] if kind in chosen and kind in ("fill", "written")), None) \
                or _open_kind(shape, chosen)

    def fallback(index):
        if not can_choose(questions[index]):
            return _open_kind(answer_shape(questions[index].get("question", ""), concept_answer(questions[index])), chosen)
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
    """Indexes of questions that have an answer to check and are not hidden (a question about the
    source rather than the subject, text_processing.shown_questions: it keeps its place, unasked)."""
    return [index for index, question in enumerate(questions)
            if concept_answer(question) and not (isinstance(question, dict) and question.get("hidden"))]


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
        if not attempt.get("token"):
            # The AI check didn't come back (grading failed, or the AI checks are used up), so the
            # student looked at the right answer and marked their own. Their call, like a flashcard's
            # Got it: it only moves their own score.
            return 1.0 if attempt.get("self_marked") and attempt.get("credit") == 1 else 0.0
        return verified_credit(user_id, guide_id, attempt.get("concept"), attempt.get("credit"), attempt.get("token"))
    return 0.0
