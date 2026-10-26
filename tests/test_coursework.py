"""Dashboard course work: Canvas assignments split into upcoming, missing and completed."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers.calendar import build_coursework  # noqa: E402

NOW = datetime(2026, 10, 26, 15, tzinfo=timezone.utc)


def row(aid, days, **extra):
    due = (NOW + timedelta(days=days)).isoformat() if days is not None else None
    return {"canvas_assignment_id": aid, "canvas_course_id": 7, "title": f"Item {aid}", "due_at": due, **extra}


class CourseworkTests(unittest.TestCase):
    def split(self, rows, marked=None, changes=None):
        return build_coursework(rows, marked or {}, changes or {}, {7: "MUL-101"}, "school.instructure.com", NOW)

    def test_three_lists_and_counts(self):
        result = self.split([
            row(1, 1), row(2, 5), row(3, None),            # upcoming (no due date sorts last)
            row(4, -2), row(5, 3, missing=True),           # missing: past due, or Canvas says so
            row(6, -1, submitted=True), row(7, 2, submitted=True),
        ])
        self.assertEqual(result["counts"], {"upcoming": 3, "missing": 2, "completed": 2})
        self.assertEqual([item["id"] for item in result["upcoming"]], ["canvas-1", "canvas-2", "canvas-3"])
        self.assertEqual(result["upcoming"][0]["course"], "MUL-101")
        self.assertEqual(result["upcoming"][0]["url"], "https://school.instructure.com/courses/7/assignments/1")

    def test_checking_off_here_counts_as_completed_and_unchecking_wins(self):
        result = self.split([row(1, -3), row(2, -3, submitted=True)], marked={"canvas-1": True, "canvas-2": False})
        self.assertEqual([item["id"] for item in result["completed"]], ["canvas-1"])
        self.assertEqual([item["id"] for item in result["missing"]], ["canvas-2"])

    def test_a_moved_deadline_is_no_longer_missing(self):
        change = {"canvas-1": {"kind": "moved", "new_due": (NOW + timedelta(days=4)).isoformat(), "decided_at": NOW.isoformat()}}
        result = self.split([row(1, -1)], changes=change)
        self.assertEqual(result["counts"]["upcoming"], 1)

    def test_cancelled_work_is_left_out(self):
        change = {"canvas-1": {"kind": "cancelled", "decided_at": NOW.isoformat()}}
        self.assertEqual(self.split([row(1, 2)], changes=change)["counts"], {"upcoming": 0, "missing": 0, "completed": 0})


if __name__ == "__main__":
    unittest.main()
