"""
Deadline check-offs shared by the calendar and the class page.

An item is done when the student checked it, or when Canvas says it was turned in and the
student has not unchecked it. Until the deadline_done migration runs, the submitted column and
deadline_marks table are missing; reads then fall back to "nothing done" instead of failing.
"""

import logging

logger = logging.getLogger(__name__)

_COLUMNS = "canvas_assignment_id,canvas_course_id,title,due_at"


def canvas_item_key(assignment_id) -> str:
    return f"canvas-{assignment_id}"


def select_assignments(db, user_id: str, *, course_ids=None, start=None, end=None, limit=None) -> list:
    """The student's Canvas assignments, with `submitted` when the column exists."""
    def query(columns):
        q = db.table("canvas_assignments").select(columns).eq("user_id", user_id)
        if course_ids is not None:
            q = q.in_("canvas_course_id", course_ids)
        if start:
            q = q.gte("due_at", start)
        if end:
            q = q.lte("due_at", end)
        q = q.order("due_at")
        if limit:
            q = q.limit(limit)
        return q.execute().data or []
    try:
        return query(_COLUMNS + ",submitted")
    except Exception:
        logger.warning("canvas_assignments.submitted missing; run the deadline_done migration")
        return query(_COLUMNS)


def marks(db, user_id: str) -> dict:
    """item_key -> done, from the student's own checks."""
    try:
        rows = db.table("deadline_marks").select("item_key,done").eq("user_id", user_id).limit(2000).execute().data or []
    except Exception:
        logger.warning("deadline_marks missing; run the deadline_done migration")
        return {}
    return {row["item_key"]: bool(row["done"]) for row in rows}


def is_done(key: str, marked: dict, submitted: bool = False) -> bool:
    return marked[key] if key in marked else bool(submitted)
