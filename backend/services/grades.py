"""
Grade estimates from a student's own Canvas assignment groups.

Pure functions, no I/O: canvas.py fetches the groups and passes them in. The math follows
Canvas's "current grade": only graded, non-excused work counts, and with group weights on,
each group's percentage is weighted and re-normalized over the groups that have grades.
Drop rules and extra credit are not modelled; when Canvas reports the current score, the estimate
is anchored to it (the gap is carried into every what-if) and the class's own grading scale is
used when Canvas shares it.
"""

from datetime import datetime, timezone
from typing import Optional

# The common US scale; Canvas's own letter is shown instead when the course has one.
SCALE = (("A", 90.0), ("B", 80.0), ("C", 70.0), ("D", 60.0))


def letter(score: Optional[float], scale=SCALE) -> Optional[str]:
    if score is None:
        return None
    for name, cutoff in scale:
        if score >= cutoff:
            return name
    return "F"


def canvas_scale(scheme: Optional[list]) -> Optional[tuple]:
    """A Canvas grading scheme ([{"name": "A", "value": 0.94}, ...], values as fractions) as a
    scale of (letter, percent cutoff), highest first; None when it isn't usable."""
    rows = []
    for row in scheme or []:
        try:
            rows.append((str(row["name"]).strip(), round(float(row["value"]) * 100, 4)))
        except (KeyError, TypeError, ValueError):
            return None
    rows = [row for row in rows if row[0]]
    return tuple(sorted(rows, key=lambda row: -row[1])) if len(rows) >= 2 else None


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


def estimate(groups: list, weighted: bool, *, now: Optional[datetime] = None, limit: int = 6,
             anchor: Optional[float] = None, scale=None) -> dict:
    """Current grade plus, for each upcoming ungraded assignment, what it takes to move up a letter
    or keep the current one.

    anchor: Canvas's own current score. Our recalculation can differ from it (dropped scores,
    extra credit), so the letter comes from the anchor and each target is shifted by the gap.
    scale: the class's grading scale from canvas_scale(), else the common one."""
    now = now or datetime.now(timezone.utc)
    scale = scale or SCALE
    model = current_score(groups, weighted)
    score = anchor if anchor is not None else model
    gap = anchor - model if anchor is not None and model is not None else 0.0
    mine = letter(score, scale)
    cutoffs = dict(scale)
    names = [name for name, _ in scale]
    index = names.index(mine) if mine in names else len(names)
    up = names[index - 1] if index > 0 else None
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
            submission = item.get("submission") or {}
            row = {
                "id": item["id"], "name": str(item.get("name") or "Assignment")[:300], "due_at": due,
                # Turned in, waiting on a grade: nothing left to study for.
                "submitted": bool(submission.get("submitted_at")) or submission.get("workflow_state") in {"submitted", "pending_review"},
                "points": float(item["points_possible"]), "group": str(group.get("name") or ""),
                "weight": float(group.get("group_weight") or 0) if weighted else None,
            }
            if score is not None and model is not None:
                if up:
                    row["up"] = {"letter": up, **(_needed(groups, weighted, item, cutoffs[up] - gap) or {})}
                if mine in cutoffs and cutoffs[mine] > 0:
                    row["keep"] = {"letter": mine, **(_needed(groups, weighted, item, cutoffs[mine] - gap) or {})}
            upcoming.append(row)
    upcoming.sort(key=lambda row: (row["due_at"] is None, row["due_at"] or ""))
    return {"score": None if score is None else round(score, 1), "letter": mine, "weighted": weighted,
            "scale": [{"letter": name, "cutoff": cutoff} for name, cutoff in scale], "upcoming": upcoming[:limit]}
