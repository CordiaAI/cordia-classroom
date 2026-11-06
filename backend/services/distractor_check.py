"""Wrong answer choices that are really right answers somewhere else in the guide.

A wrong choice is rejected when it:
  1. is, or nearly is, another question's correct answer, when that answer is a description
     ("Music lacking any literary or pictorial association" offered for "What is program music?").
     A reused name, term or value ("Norwegian", "Puccini", "1831") stays: it is a fair wrong choice,
     while a reused description is a true statement about something else.
  2. answers another question: it names that question's subject and either says what the subject is
     ("Absolute music is ...") or gives that question's answer ("Grieg was from Norway" offered for a
     question about 'La donna è mobile', when another question asks Grieg's nationality).

Used wherever wrong choices are built (routers/quiz.py) and by "Refresh answer choices".
"""

import re
from difflib import SequenceMatcher
from typing import Iterable, Optional

from services.retain import normalize

_STOP = {
    "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "is", "are", "was", "were", "be",
    "by", "with", "as", "its", "it", "that", "this", "these", "those", "from", "into", "than", "then",
    "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "does", "did", "do",
    "has", "have", "had", "not", "no", "but", "his", "her", "their", "they", "he", "she", "one",
}
_COPULA = r"(?:is|are|was|were|means|meant|refers)"
_DESCRIPTION_WORDS = 3  # an answer with fewer content words is a name, term or value


def _words(text: str) -> list:
    return re.findall(r"[a-z0-9%]+", normalize(text))


def _content(text: str) -> list:
    return [word for word in _words(text) if word not in _STOP and len(word) >= 3]


def _stem(word: str) -> str:
    """Prefix stem: 'norway' and 'norwegian' meet at 'norw', 'romantic' and 'romanticism' at 'roma'."""
    return word[:4] if len(word) > 4 else word


def _phrase_in(phrase: str, text: str) -> bool:
    return bool(phrase) and re.search(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])", text) is not None


def subject_of(question: str) -> Optional[str]:
    """The term a question asks about, normalized: 'What is absolute music?' -> 'absolute music',
    "What was Grieg's nationality?" -> 'grieg', 'What does tempo rubato mean?' -> 'tempo rubato'.
    None when the question has no single short subject."""
    text = str(question or "").strip().rstrip("?").strip().replace("’", "'")
    owner = re.search(r"((?:[A-Z][\w\-]*\s+){0,3}[A-Z][\w\-]*)'s\b", text)
    if owner:
        return normalize(owner.group(1)) or None
    first = re.split(r",|\s+and\s+(?:what|which|who|how|why)\b", text, maxsplit=1)[0].strip()
    match = (re.match(r"(?i)^(?:what|who)\s+(?:is|are|was|were)\s+(.+)$", first)
             or re.match(r"(?i)^what\s+does\s+(.+?)\s+mean$", first)
             or re.match(r"(?i)^define\s+(.+)$", first))
    if not match:
        return None
    subject = normalize(match.group(1))
    return subject if subject and len(subject.split()) <= 5 and len(subject) >= 3 else None


def is_description(answer: str) -> bool:
    return len(_content(answer)) >= _DESCRIPTION_WORDS


def near_match(a: str, b: str) -> bool:
    """Same answer up to wording: identical once normalized, a close spelling, or nearly the same
    key words (at least three on each side)."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return False
    if na == nb or SequenceMatcher(None, na, nb).ratio() >= 0.85:
        return True
    ca, cb = set(map(_stem, _content(a))), set(map(_stem, _content(b)))
    if len(ca) >= 3 and len(cb) >= 3:
        return len(ca & cb) / len(ca | cb) >= 0.7
    return False


def conflict(choice: str, question: str, answer: str, others: Iterable) -> Optional[str]:
    """Why `choice` can't be a wrong option for (question, answer), or None. `others` is every other
    (question, correct answer) pair in the guide."""
    shown = normalize(choice)
    if not shown:
        return None
    own_text = normalize(question) + " " + normalize(answer)
    own_stems = set(map(_stem, _content(question) + _content(answer)))
    for other_question, other_answer in others:
        if normalize(other_question) == normalize(question):
            continue
        if is_description(other_answer) and near_match(choice, other_answer):
            return f"is the answer to: {other_question}"
        subject = subject_of(other_question)
        if not subject or _phrase_in(subject, own_text) or not (_phrase_in(subject, shown) or _phrase_in(subject + "s", shown)):
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(subject)}\s+{_COPULA}\b", shown):
            return f"describes the subject of: {other_question}"
        subject_words = set(subject.split())
        given = {_stem(word) for word in _content(choice) if word not in subject_words} - own_stems
        if given & set(map(_stem, _content(other_answer))):
            return f"answers: {other_question}"
    return None


def keep_valid(choices: Iterable, question: str, answer: str, others: list) -> tuple:
    """(kept, rejected): the choices that pass `conflict`, in order, and the ones that don't."""
    kept, rejected = [], []
    for value in choices:
        (rejected if conflict(str(value), question, answer, others) else kept).append(value)
    return kept, rejected
