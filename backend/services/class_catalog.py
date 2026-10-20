"""Course codes, terms, share screening and class suggestions. Pure functions, no I/O."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Optional

_CODE = re.compile(r"(?<![A-Z&])([A-Z]{1,6}(?:&[A-Z]{1,3})?)[\s_\-.]*([0-9]{1,4}[A-Z]?)(?![0-9])")


@dataclass(frozen=True)
class Normalized:
    code: str            # "MGT 300", or "" when none found
    ambiguous: bool      # cross-listed or several codes: send to admin review


def normalize_course_code(raw: str) -> Normalized:
    """"mgt-300-102" -> "MGT 300". Section suffixes and term tags are dropped."""
    text = re.sub(r"\s+", " ", (raw or "").upper()).strip()
    # Drop a leading term tag like "FA26 " or "2026FA-".
    text = re.sub(r"^(?:(?:FA|SP|SU|WI|FALL|SPRING|SUMMER|WINTER)[\s\-_]?\d{2,4}|\d{4}[\s\-_]?(?:FA|SP|SU|WI))[\s\-_:]+", "", text)
    matches = []
    for subject, number in _CODE.findall(text):
        if subject in {"SEC", "SECTION", "LEC", "LAB", "TERM", "FALL", "SPRING", "SUMMER", "WINTER", "FA", "SP", "SU", "WI"}:
            continue
        code = f"{subject} {number}"
        if code not in matches:
            matches.append(code)
    if not matches:
        return Normalized("", True)
    return Normalized(matches[0], len(matches) > 1)


def similar_codes(code: str, existing: Iterable[str]) -> list[str]:
    """Existing codes that may be the same course spelled differently (e.g. MGMT 300 / MGT 300)."""
    subject, _, number = code.partition(" ")
    out = []
    for other in existing:
        o_subject, _, o_number = other.partition(" ")
        if other == code or o_number != number:
            continue
        if o_subject.startswith(subject) or subject.startswith(o_subject) or _edit_distance(subject, o_subject) <= 1:
            out.append(other)
    return out


def _edit_distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def term_for(when: Optional[date | datetime] = None) -> str:
    when = when or date.today()
    season = "Spring" if when.month <= 5 else "Summer" if when.month <= 7 else "Fall"
    return f"{season} {when.year}"


def clean_term(name: str, fallback: Optional[date] = None) -> str:
    text = re.sub(r"\s+", " ", (name or "")).strip()
    found = re.search(r"(Spring|Summer|Fall|Winter|Autumn)\s*(\d{4})", text, re.I)
    if found:
        return f"{found.group(1).title()} {found.group(2)}"
    return term_for(fallback)[:60] if not text or text.lower() in {"default term", "default"} else text[:60]


def school_name_from_domain(host: str) -> str:
    label = host.split(".")[0]
    label = re.sub(r"^(canvas|learn|lms|elearning)[-.]?", "", label) or host.split(".")[1]
    return label.replace("-", " ").title() if len(label) > 4 else label.upper()


# ---------------------------------------------------------------------------
# Share screening: hold leaked exams / answer keys for review
# ---------------------------------------------------------------------------
_LEAK = re.compile(
    r"\b(?:(?:exam|test|midterm|final|quiz)\s*#?\s*\d*\s*(?:answers?|answer\s*key|key|solutions?)|answer\s*key|test\s*bank|solutions?\s*manual)\b",
    re.I,
)
_NUMBERED_Q = re.compile(r"^\s*(?:Q(?:uestion)?\s*)?\d{1,3}[.)]\s+\S", re.M | re.I)
_OPTION = re.compile(r"^\s*\(?[A-Ea-e][.)]\s+\S", re.M)


def screen_share(title: str, text: str, cards: list) -> Optional[str]:
    """Return a hold reason, or None when the set can go live."""
    blob = "\n".join([title or "", text or ""] + [f"{c.get('front', '')}\n{c.get('back', '')}" for c in cards or [] if isinstance(c, dict)])
    if _LEAK.search(title or "") or _LEAK.search(blob[:20000]):
        return "Looks like an exam or answer key"
    questions = len(_NUMBERED_Q.findall(text or ""))
    options = len(_OPTION.findall(text or ""))
    if questions >= 5 and options >= questions * 2:
        return "Numbered test questions copied verbatim"
    return None


# ---------------------------------------------------------------------------
# Near-duplicate sets and class suggestions (lexical; deterministic)
# ---------------------------------------------------------------------------
_STOP = set("""a an and are as at be by for from has have in is it its of on or that the this to was were will with which who what when
where how why than then there their them these those into about over under can could should would may might also not no yes""".split())


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z][a-z0-9]{2,}", (text or "").lower()) if t not in _STOP]


def set_signature(title: str, cards: list) -> set:
    fronts = " ".join(str(c.get("front", "")) for c in cards or [] if isinstance(c, dict))
    return set(_tokens(title + " " + fronts))


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


DUPLICATE_THRESHOLD = 0.6


@dataclass(frozen=True)
class Suggestion:
    class_id: str
    code: str
    confidence: float
    auto: bool


def suggest_class(guide_title: str, guide_text: str, classes: list[dict]) -> Optional[Suggestion]:
    """classes: [{id, code, name, summary}]. Returns the best class, or None.

    auto=True only at >= 0.9 with no other plausible class (runner-up below 0.5).
    """
    if not classes:
        return None
    guide = f"{guide_title}\n{guide_text}"
    upper = guide.upper()
    guide_counts = Counter(_tokens(guide))
    scored = []
    for item in classes:
        code = item.get("code") or ""
        subject, _, number = code.partition(" ")
        if code and re.search(rf"\b{re.escape(subject)}[\s\-]?{re.escape(number)}\b", upper):
            score = 0.95
        else:
            vocab = Counter(_tokens(f"{item.get('name', '')} {item.get('name', '')} {item.get('summary', '')}"))
            if not vocab or not guide_counts:
                score = 0.0
            else:
                overlap = sum(min(guide_counts[t], 3) for t in vocab if t in guide_counts)
                coverage = len([t for t in vocab if t in guide_counts]) / len(vocab)
                score = min(0.89, 1 - math.exp(-overlap / 12)) * 0.6 + coverage * 0.4
        scored.append((score, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    best, item = scored[0]
    if best < 0.35:
        return None
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    return Suggestion(item["id"], item.get("code") or item.get("name", ""), round(best, 3), best >= 0.9 and runner_up < 0.5)


_SYLLABUS_STOP = set("""grade grades grading student students course courses class classes week weeks assignment assignments exam exams
office hours policy policies late attendance email university instructor professor points due syllabus canvas semester
please must page pages final midterm quiz quizzes credit submit submission required http https www edu""".split())


def topic_summary(syllabus_html: str, module_titles: list[str], limit: int = 600) -> str:
    """A short topic summary: module titles first, then frequent syllabus terms. No raw text kept."""
    titles = [re.sub(r"\s+", " ", t).strip() for t in module_titles if t and t.strip()]
    text = re.sub(r"<[^<>]*>", " ", (syllabus_html or "")[:200000])
    common = [w for w, _ in Counter(t for t in _tokens(text) if t not in _SYLLABUS_STOP).most_common(25)]
    summary = "; ".join(dict.fromkeys(titles))
    if common:
        summary = (summary + " | " if summary else "") + ", ".join(common)
    return summary[:limit]
