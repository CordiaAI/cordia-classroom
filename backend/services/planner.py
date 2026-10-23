"""Assignment kickoff: an effort estimate, steps with staggered due dates, and study blocks placed
in the student's free time before the deadline. Exams get spaced review sessions instead.

Pure functions here (no database), so the scheduling rules are easy to test:
- estimate_effort: a fallback when the model gives nothing usable.
- stagger: step due dates spread back from the deadline, so there are milestones, not one cliff.
- free_slots / place_blocks: fit work into free time, at most one block per assignment per day,
  spread across the days that are left.
- exam_sessions: review sessions in the days before an exam, shorter as it gets closer.
"""

import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

DAY_START = 9    # Default study window (local hours) until the student's own edits say otherwise.
DAY_END = 22
MIN_BLOCK = 25
MAX_BLOCK = 90
# Days before an exam and minutes for each review session: longer early, shorter close to it.
EXAM_SESSIONS = ((7, 60), (5, 50), (3, 45), (2, 30), (1, 25))


def estimate_effort(title: str, points, submission_types: list, description: str, is_exam: bool) -> int:
    """Minutes a typical student needs, from the assignment's shape alone."""
    types = set(submission_types or [])
    if is_exam:
        return sum(minutes for _, minutes in EXAM_SESSIONS)
    if "online_quiz" in types:
        base = 45
    elif "discussion_topic" in types:
        base = 45
    elif types & {"online_text_entry", "online_upload"}:
        base = 120
    else:
        base = 60
    if isinstance(points, (int, float)) and points > 0:
        base = base * min(3.0, max(0.5, points / 50))
    words = len((description or "").split())
    if words > 400:
        base *= 1.25
    return int(max(15, min(1200, round(base / 5) * 5)))


def default_steps(effort: int, submission_types: list, is_exam: bool) -> list[dict]:
    """Generic steps when the model gives none; worded to fit any subject."""
    if is_exam:
        return [{"title": f"Review session {i + 1}", "minutes": minutes} for i, (_, minutes) in enumerate(EXAM_SESSIONS)]
    if effort <= 45:
        return [{"title": "Read the instructions and do it", "minutes": effort}]
    shares = (("Read the instructions and gather what you need", 0.2), ("Do the main work", 0.6), ("Check it against the instructions and submit", 0.2))
    return [{"title": title, "minutes": max(5, int(round(effort * share / 5) * 5))} for title, share in shares]


def clean_steps(raw, effort: int) -> list[dict]:
    """The model's steps, trimmed and bounded; [] when there's nothing usable."""
    steps = []
    for item in (raw or [])[:6]:
        if not isinstance(item, dict):
            continue
        title = " ".join(str(item.get("title") or "").split())[:200]
        try:
            minutes = int(item.get("minutes") or 0)
        except (TypeError, ValueError):
            minutes = 0
        if title:
            steps.append({"title": title, "minutes": max(5, min(3000, minutes or effort // 3 or 5))})
    return steps


def stagger(count: int, due_at: datetime, now: datetime) -> list[datetime]:
    """Due times for `count` steps: the last one at the deadline, the others evenly before it."""
    if count <= 0:
        return []
    span = max(due_at - now, timedelta(0))
    out = []
    for index in range(count):
        share = (index + 1) / count
        out.append(max(now, now + span * share) if index < count - 1 else due_at)
    return out


def _local(dt: datetime, zone: ZoneInfo) -> datetime:
    return dt.astimezone(zone)


def free_slots(busy: list[tuple[datetime, datetime]], start: datetime, end: datetime, zone: ZoneInfo,
               day_start: int = DAY_START, day_end: int = DAY_END) -> list[tuple[datetime, datetime]]:
    """Free intervals between start and end, inside each day's study window, around busy times."""
    busy = sorted((b0, b1) for b0, b1 in busy if b1 > start and b0 < end)
    slots = []
    day = _local(start, zone).date()
    last = _local(end, zone).date()
    while day <= last:
        window_start = max(start, datetime.combine(day, time(day_start), zone))
        window_end = min(end, datetime.combine(day, time(day_end) if day_end < 24 else time(23, 59), zone))
        cursor = window_start
        for b0, b1 in busy:
            if b1 <= cursor or b0 >= window_end:
                continue
            if b0 > cursor:
                slots.append((cursor, min(b0, window_end)))
            cursor = max(cursor, b1)
        if cursor < window_end:
            slots.append((cursor, window_end))
        day += timedelta(days=1)
    return [(a, b) for a, b in slots if (b - a) >= timedelta(minutes=MIN_BLOCK)]


def _round_up(dt: datetime, minutes: int = 15) -> datetime:
    extra = (-dt.minute) % minutes
    return (dt + timedelta(minutes=extra)).replace(second=0, microsecond=0)


def place_blocks(minutes: int, slots: list[tuple[datetime, datetime]], zone: ZoneInfo,
                 preferred_hour: Optional[int] = None) -> list[tuple[datetime, datetime]]:
    """Blocks that add up to `minutes` (as near as the free time allows), one per day, spread out."""
    if minutes <= 0 or not slots:
        return []
    by_day: dict[date, list[tuple[datetime, datetime]]] = {}
    for a, b in slots:
        by_day.setdefault(_local(a, zone).date(), []).append((a, b))
    days = sorted(by_day)
    count = min(len(days), max(1, math.ceil(minutes / MAX_BLOCK)))
    # Spread the chosen days across what's left instead of front-loading them all.
    picks = [days[round(i * (len(days) - 1) / max(1, count - 1))] if count > 1 else days[0] for i in range(count)]
    size = max(MIN_BLOCK, min(MAX_BLOCK, math.ceil(minutes / count / 5) * 5))
    blocks = []
    for day in dict.fromkeys(picks):
        options = by_day[day]
        if preferred_hour is not None:
            options = sorted(options, key=lambda s: abs(_local(s[0], zone).hour - preferred_hour))
        for a, b in options:
            if preferred_hour is not None:
                wanted = datetime.combine(day, time(preferred_hour), zone)
                a = max(a, min(wanted, b - timedelta(minutes=size)))
            start = _round_up(a)
            if start + timedelta(minutes=size) <= b:
                blocks.append((start, start + timedelta(minutes=size)))
                break
    return blocks


def exam_sessions(exam_at: datetime, now: datetime) -> list[tuple[int, int]]:
    """(days before, minutes) for the review sessions still ahead of now."""
    return [(days, minutes) for days, minutes in EXAM_SESSIONS if exam_at - timedelta(days=days) > now]


def preferred_hour(moved_starts: list[datetime], zone: ZoneInfo) -> Optional[int]:
    """The hour the student keeps moving blocks to (3+ moves), else None."""
    if len(moved_starts) < 3:
        return None
    hours = sorted(_local(dt, zone).hour for dt in moved_starts)
    return hours[len(hours) // 2]


def utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc)
