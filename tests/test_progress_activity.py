"""Progress charts: the study log bucketed into the student's local days, kinds, hours and classes."""
from datetime import date
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers.stats import build_activity  # noqa: E402

TODAY = date(2026, 10, 26)
GUIDES = {"g1": {"title": "Cell biology", "folder_id": "f1"}, "g2": {"title": "Renaissance art", "folder_id": "f2"}}
FOLDERS = {"f1": "BIO 101", "f2": "ART 210"}


def session(at, minutes, kind="read", guide="g1", cards=0):
    return {"started_at": at, "duration_seconds": minutes * 60, "session_type": kind, "guide_id": guide,
            "metadata": {"cards_studied": cards} if cards else {}}


class ActivityTests(unittest.TestCase):
    def test_sessions_land_on_the_students_local_day_and_hour(self):
        # 03:30 UTC on the 26th is 22:30 on the 25th in Chicago (UTC-5 in October).
        result = build_activity([session("2026-10-26T03:30:00+00:00", 30)], [], GUIDES, FOLDERS, TODAY, tz_offset=-300)
        self.assertEqual(result["days"], [{"date": "2026-10-25", "minutes": 30, "sessions": 1, "cards": 0}])
        self.assertEqual(result["hours"][22], 30)
        self.assertEqual(result["recent"][-2], {"date": "2026-10-25", "minutes": 30, "cards": 0})

    def test_recent_is_thirty_days_with_zeros(self):
        result = build_activity([], [], GUIDES, FOLDERS, TODAY)
        self.assertEqual(len(result["recent"]), 30)
        self.assertEqual(result["recent"][0]["date"], "2026-09-27")
        self.assertEqual(result["recent"][-1], {"date": "2026-10-26", "minutes": 0, "cards": 0})

    def test_kinds_classes_and_cards(self):
        rows = [session("2026-10-20T15:00:00Z", 20, "flashcard", "g1", cards=40), session("2026-10-21T15:00:00Z", 45, "read", "g2"),
                session("2026-10-22T15:00:00Z", 10, "quiz", "g1"), session("2026-10-22T16:00:00Z", 5, "mystery", None),
                session("2026-08-01T15:00:00Z", 60, "read", "g1")]  # older than 30 days: in the year only
        result = build_activity(rows, [], GUIDES, FOLDERS, TODAY)
        self.assertEqual(result["by_kind"], {"read": 45, "flashcard": 20, "quiz": 10, "timer": 0, "browse": 5})
        self.assertEqual(result["classes"], [{"id": "f2", "name": "ART 210", "minutes": 45}, {"id": "f1", "name": "BIO 101", "minutes": 30}])
        self.assertEqual(sum(day["cards"] for day in result["days"]), 40)
        self.assertIn("2026-08-01", [day["date"] for day in result["days"]])

    def test_quizzes_oldest_first_with_titles(self):
        attempts = [{"guide_id": "g2", "score": 91.6, "completed_at": "2026-10-24T12:00:00Z"},
                    {"guide_id": "g1", "score": 70, "completed_at": "2026-10-10T12:00:00Z"},
                    {"guide_id": "gone", "score": None, "completed_at": "2026-10-11T12:00:00Z"}]
        result = build_activity([], attempts, GUIDES, FOLDERS, TODAY)
        self.assertEqual(result["quizzes"], [{"date": "2026-10-10", "score": 70, "title": "Cell biology"},
                                             {"date": "2026-10-24", "score": 92, "title": "Renaissance art"}])

    def test_bad_rows_are_skipped(self):
        rows = [{"started_at": "not a date", "duration_seconds": 60}, {"started_at": None}]
        self.assertEqual(build_activity(rows, [], {}, {}, TODAY)["days"], [])


if __name__ == "__main__":
    unittest.main()
