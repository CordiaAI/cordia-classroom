"""The onboarding and day 2-7 questions the backend accepts answers to (personalization plan 1.2).

Wording and options come from docs/research/10-onboarding-questions.md; when and where each is asked
follows the owner's G2 decision (plans/pending/personalization.md). The web app shows the wording;
this file only names each question, its version and the answers it accepts, so a stored answer
always says which version of which question it answered. Changing a question's options means a new
version, never an edit in place.

memory_style and interests (About-you screen) shape the "Help me remember" hooks a student gets
after a missed question (llm.memory_hook): the kinds of hook they like (any number, since version 2;
version 1 was one choice and is still accepted from older pages), and up to three interests a hook
may draw on.

Not here on purpose: anxiety and exam-nerves items (out of v1, Washington MHMDA), demographics, and
personality "types". Answers are starting settings the student can change.
"""

from __future__ import annotations

import re
from datetime import date

# id -> (version, kind, allowed values for choice and multi kinds)
QUESTIONS: dict[str, tuple[int, str, tuple[str, ...]]] = {
    # While the guide builds (G2)
    "major": (1, "major", ()),
    "year": (1, "choice", ("first", "second", "third", "fourth", "fifth_plus", "grad", "other")),
    "exam_date": (1, "exam", ()),
    "night_before": (1, "choice", ("reread", "highlight_rewrite", "quiz_flashcards", "practice_problems", "start_from_scratch")),
    # On the reveal (G2): "Pick your study trigger: right after ___ I'll open Cordia ___."
    "study_trigger": (1, "trigger", ()),
    # About-you screen: how the student heard about Cordia (required there)
    "heard_from": (1, "choice", ("tiktok", "instagram", "reddit", "x", "linkedin", "friend", "professor_class",
                                 "discord", "other")),
    # About-you screen: for "Help me remember" hooks after a miss
    "memory_style": (2, "multi", ("funny", "link", "rhyme", "picture", "letters")),
    "interests": (1, "multi", ("sports", "music", "gaming", "movies_tv", "food", "outdoors", "art_design",
                               "fashion", "tech", "animals", "books", "travel")),
    # Day 2 (G2, report 10 Q2/Q5/Q8/Q15)
    "expected_grade": (1, "choice", ("a", "b", "c", "not_sure")),
    "target_grade": (1, "choice", ("a", "b", "c", "not_sure")),
    "chronotype": (1, "choice", ("definitely_morning", "somewhat_morning", "somewhat_evening", "definitely_evening")),
    "weekday_minutes": (1, "choice", ("10", "20", "30", "45_plus")),
    "licensure_exam": (1, "choice", ("nclex", "mcat", "lsat", "bar", "cpa", "not_yet")),  # ACT removed (Never list)
    # Day 3: the Assistant's Mini-IPIP conscientiousness items, one answer per item (1-5)
    "conscientiousness": (1, "likert4", ()),
    # Day 4
    "start_timing": (1, "choice", ("day_1_2", "middle", "last_2_3_days", "night_before")),
    "setback": (1, "choice", ("different_way", "test_unfair", "not_good_at_subject", "work_harder_same")),
    # Day 5
    "hard_topic_start": (1, "choice", ("diagram", "listen", "notes", "real_example", "mix")),
    "woop_obstacle": (1, "choice", ("too_tired", "other_classes_work", "phone_social", "forgetting", "not_sure_where_to_start")),
    # Day 7
    "plan_fit": (1, "choice", ("too_much", "about_right", "too_little")),
}

# Older versions still accepted, for a page loaded before the change: (id, version) -> kind.
EARLIER = {("memory_style", 1): "choice"}
# How many a "multi" question takes (default 3).
MULTI_MAX = {"memory_style": 5}

_TEXT = re.compile(r"^[^\x00-\x1f]{1,80}$")


class InvalidAnswer(ValueError):
    pass


def check(question_id: str, version: int, answer) -> dict:
    """The answer as stored ({"value": ...} plus fields per kind), or InvalidAnswer."""
    spec = QUESTIONS.get(question_id)
    if spec is None:
        raise InvalidAnswer(f"Unknown question: {question_id}")
    expected, kind, options = spec
    if version != expected:
        kind = EARLIER.get((question_id, version))
        if not kind:
            raise InvalidAnswer(f"{question_id} is at version {expected}")
    if not isinstance(answer, dict):
        raise InvalidAnswer("Send the answer as an object")
    if answer.get("skipped") is True:
        return {"skipped": True}
    value = answer.get("value")
    if kind == "choice":
        if value not in options:
            raise InvalidAnswer(f"{question_id} takes one of: {', '.join(options)}")
        return {"value": value}
    if kind == "multi":
        most = MULTI_MAX.get(question_id, 3)
        if not isinstance(value, list) or not 1 <= len(value) <= most or len(set(value)) != len(value) \
                or any(item not in options for item in value):
            raise InvalidAnswer(f"{question_id} takes one to {most} of: {', '.join(options)}")
        return {"value": list(value)}
    if kind == "major":
        # The major's id from the curated list (step 1.3), or free text for "Other"; a second major
        # is optional.
        out = {}
        for key in ("value", "second", "other_text"):
            item = answer.get(key)
            if item is None:
                continue
            if not isinstance(item, str) or not _TEXT.match(item.strip()):
                raise InvalidAnswer(f"major.{key} must be short text")
            out[key] = item.strip()
        if not out.get("value"):
            raise InvalidAnswer("Pick a major or Other")
        return out
    if kind == "exam":
        if value == "none_yet":
            return {"value": "none_yet"}
        try:
            when = date.fromisoformat(str(value))
        except ValueError:
            raise InvalidAnswer("exam_date takes a date (YYYY-MM-DD) or none_yet")
        out = {"value": when.isoformat()}
        course = answer.get("course")
        if course is not None:
            if not isinstance(course, str) or not _TEXT.match(course.strip()):
                raise InvalidAnswer("exam_date.course must be short text")
            out["course"] = course.strip()
        return out
    if kind == "trigger":
        cue, place = answer.get("cue"), answer.get("place")
        for name, item in (("cue", cue), ("place", place)):
            if not isinstance(item, str) or not _TEXT.match(item.strip()):
                raise InvalidAnswer(f"study_trigger.{name} must be short text")
        return {"cue": cue.strip(), "place": place.strip()}
    if kind == "likert4":
        items = answer.get("items")
        if not isinstance(items, list) or len(items) != 4 or not all(isinstance(i, int) and 1 <= i <= 5 for i in items):
            raise InvalidAnswer("conscientiousness takes four answers from 1 to 5")
        return {"items": items}
    raise InvalidAnswer(f"Unsupported question kind {kind}")
