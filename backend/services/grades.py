"""
Grade estimates from a student's own Canvas assignment groups.

Pure functions, no I/O: canvas.py fetches the groups and passes them in. The math follows
Canvas's "current grade": only graded, non-excused work counts, and with group weights on,
each group's percentage is weighted and re-normalized over the groups that have grades.
Drop rules and custom grading schemes are not modelled, so callers label results estimates.
"""

from datetime import datetime, timezone
from typing import Optional

# The common US scale; Canvas's own letter is shown instead when the course has one.
SCALE = (("A", 90.0), ("B", 80.0), ("C", 70.0), ("D", 60.0))


def letter(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    for name, cutoff in SCALE:
        if score >= cutoff:
            return name
    return "F"


def _counts(assignment: dict) -> bool:
    return (assignment.get("points_possible") or 0) > 0 and not assignment.get("omit_from_final_grade")


def _graded(assignment: dict) -> Optional[float]:
    sub = assignment.get("submission") or {}
    if sub.get("excused") or sub.get("score") is None:
        return None
    return float(sub["score"])


def current_score(groups: list, weighted: bool, extra: Optional[tuple] = None) -> Optional[float]:
    """The current grade percentage. `extra` is (assignment_id, score) to treat as graded."""
    totals = []  # (weight, earned, possible) per group
    for group in groups:
        earned = possible = 0.0
        for item in group.get("assignments") or []:
            if not _counts(item):
                continue
            score = _graded(item)
            if extra and item.get("id") == extra[0]:
                score = extra[1]
            if score is None:
                continue
            earned += score
            possible += float(item["points_possible"])
        if possible > 0:
            totals.append((float(group.get("group_weight") or 0), earned, possible))
    if not totals:
        return None
    if weighted:
        weight = sum(w for w, _, _ in totals)
        if weight <= 0:
            return None
        return sum(w * e / p for w, e, p in totals) / weight * 100
    possible = sum(p for _, _, p in totals)
    return sum(e for _, e, _ in totals) / possible * 100


def _needed(groups: list, weighted: bool, item: dict, target: float) -> Optional[dict]:
    """Points on `item` for the grade to reach `target`, or None if no score can change it."""
    points = float(item["points_possible"])
    low = current_score(groups, weighted, (item["id"], 0.0))
    high = current_score(groups, weighted, (item["id"], points))
    if low is None or high is None or high <= low:
        return None
    raw = (target - low) / (high - low) * points
    if raw <= 0:
        return {"points": 0.0, "percent": 0.0, "reachable": True, "already": True}
    if raw > points:
        return {"points": round(raw, 1), "percent": round(raw / points * 100), "reachable": False, "already": False}
    return {"points": round(raw, 1), "percent": round(raw / points * 100), "reachable": True, "already": False}


def estimate(groups: list, weighted: bool, *, now: Optional[datetime] = None, limit: int = 6) -> dict:
    """Current grade plus, for each upcoming ungraded assignment, what it takes to move up a letter
    or keep the current one."""
    now = now or datetime.now(timezone.utc)
    score = current_score(groups, weighted)
    mine = letter(score)
    cutoffs = dict(SCALE)
    names = [name for name, _ in SCALE]
    up = names[names.index(mine) - 1] if mine in names and names.index(mine) > 0 else ("D" if mine == "F" else None)
    upcoming = []
    for group in groups:
        for item in group.get("assignments") or []:
            if not _counts(item) or _graded(item) is not None or (item.get("submission") or {}).get("excused"):
                continue
            due = item.get("due_at")
            try:
                when = datetime.fromisoformat(due.replace("Z", "+00:00")) if due else None
            except ValueError:
                when = None
            if when is not None and when < now:
                continue
            row = {
                "id": item["id"], "name": str(item.get("name") or "Assignment")[:300], "due_at": due,
                "points": float(item["points_possible"]), "group": str(group.get("name") or ""),
                "weight": float(group.get("group_weight") or 0) if weighted else None,
            }
            if score is not None:
                if up:
                    row["up"] = {"letter": up, **(_needed(groups, weighted, item, cutoffs[up]) or {})}
                if mine in cutoffs:
                    row["keep"] = {"letter": mine, **(_needed(groups, weighted, item, cutoffs[mine]) or {})}
            upcoming.append(row)
    upcoming.sort(key=lambda row: (row["due_at"] is None, row["due_at"] or ""))
    return {"score": None if score is None else round(score, 1), "letter": mine, "weighted": weighted, "upcoming": upcoming[:limit]}
