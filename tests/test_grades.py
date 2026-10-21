import pathlib
import sys
import unittest
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services import grades  # noqa: E402
from services import canvas_client as cc  # noqa: E402

NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)


def item(id_, points, score=None, due="2026-11-01T00:00:00Z", **sub):
    submission = {"score": score, **sub}
    return {"id": id_, "name": f"A{id_}", "points_possible": points, "due_at": due, "submission": submission}


class GradeMath(unittest.TestCase):
    def test_unweighted_current_and_needed(self):
        groups = [{"name": "All", "assignments": [item(1, 100, 85), item(2, 100)]}]
        result = grades.estimate(groups, False, now=NOW)
        self.assertEqual(result["score"], 85.0)
        self.assertEqual(result["letter"], "B")
        nxt = result["upcoming"][0]
        # (85 + x) / 200 >= 90%  ->  x = 95
        self.assertEqual(nxt["up"], {"letter": "A", "points": 95.0, "percent": 95, "reachable": True, "already": False})
        # (85 + x) / 200 >= 80%  ->  x = 75
        self.assertEqual(nxt["keep"]["points"], 75.0)

    def test_weighted_groups_renormalize(self):
        groups = [
            {"name": "Exams", "group_weight": 60, "assignments": [item(1, 100, 70), item(2, 100)]},
            {"name": "Homework", "group_weight": 40, "assignments": [item(3, 10, 10)]},
        ]
        result = grades.estimate(groups, True, now=NOW)
        self.assertAlmostEqual(result["score"], 82.0)  # 0.6*70 + 0.4*100
        exam = result["upcoming"][0]
        # 0.6*(70+x)/200 + 0.4 >= 0.9  ->  x = 96.67
        self.assertEqual(exam["up"]["letter"], "A")
        self.assertAlmostEqual(exam["up"]["points"], 96.7)
        self.assertTrue(exam["up"]["reachable"])

    def test_unreachable_and_already_safe(self):
        groups = [{"name": "All", "assignments": [item(1, 100, 50), item(2, 10)]}]
        row = grades.estimate(groups, False, now=NOW)["upcoming"][0]
        self.assertEqual(row["up"]["letter"], "D")
        self.assertFalse(row["up"]["reachable"])
        groups = [{"name": "All", "assignments": [item(1, 100, 99), item(2, 1)]}]
        row = grades.estimate(groups, False, now=NOW)["upcoming"][0]
        self.assertNotIn("up", row)  # already an A
        self.assertTrue(row["keep"]["already"])

    def test_skips_past_excused_omitted_and_zero_point(self):
        groups = [{"name": "All", "assignments": [
            item(1, 100, 90), item(2, 100, due="2026-10-01T00:00:00Z"), item(3, 100, excused=True),
            {**item(4, 100), "omit_from_final_grade": True}, item(5, 0), item(6, 50),
        ]}]
        result = grades.estimate(groups, False, now=NOW)
        self.assertEqual([row["id"] for row in result["upcoming"]], [6])

    def test_no_grades_yet(self):
        result = grades.estimate([{"name": "All", "assignments": [item(1, 100)]}], False, now=NOW)
        self.assertIsNone(result["score"])
        self.assertNotIn("up", result["upcoming"][0])


class CanvasAllowlist(unittest.TestCase):
    def test_grade_reads_are_allowed_only_for_self(self):
        cc.check_request("GET", "/api/v1/courses/5/assignment_groups", [("include[]", "assignments"), ("include[]", "submission")])
        cc.check_request("GET", "/api/v1/courses/5/enrollments", [("user_id", "self")])
        cc.check_request("GET", "/api/v1/courses/5/assignments", [("include[]", "submission")])
        with self.assertRaises(cc.CanvasForbiddenRequest):
            cc.check_request("GET", "/api/v1/courses/5/enrollments", [("user_id", "42")])
        with self.assertRaises(cc.CanvasForbiddenRequest):
            cc.check_request("GET", "/api/v1/courses/5/enrollments", [])
        with self.assertRaises(cc.CanvasForbiddenRequest):
            cc.check_request("GET", "/api/v1/courses/5/assignment_groups", [("include[]", "all_submissions")])


if __name__ == "__main__":
    unittest.main()
