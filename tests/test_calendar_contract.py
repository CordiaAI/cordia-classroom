import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers.calendar import _events


class CalendarContractTests(unittest.TestCase):
    def test_parser_unfolds_and_classifies_canvas_events(self):
        exam_due = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y%m%dT%H%M%SZ")
        quiz_due = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y%m%d")
        feed = f"""BEGIN:VCALENDAR
BEGIN:VEVENT
UID:exam-1
SUMMARY:Exam 1 - Discrete Math
DTSTART:{exam_due}
LOCATION:MA-267
URL:https://school.instructure.com/calendar?event_id=1
END:VEVENT
BEGIN:VEVENT
UID:quiz-1
SUMMARY:Quiz 2
DTSTART;VALUE=DATE:{quiz_due}
END:VEVENT
END:VCALENDAR
"""
        items = _events(feed)
        self.assertEqual([item["type"] for item in items], ["exam", "quiz"])
        self.assertEqual(items[0]["course"], "MA-267")
        self.assertFalse(items[0]["all_day"])
        self.assertTrue(items[1]["all_day"])

    def test_parser_keeps_earlier_days_of_the_current_week(self):
        earlier = (datetime.now(timezone.utc) - timedelta(days=6)).strftime("%Y%m%d")
        stale = (datetime.now(timezone.utc) - timedelta(days=9)).strftime("%Y%m%d")
        feed = f"""BEGIN:VCALENDAR
BEGIN:VEVENT
UID:earlier
SUMMARY:Lab 1
DTSTART;VALUE=DATE:{earlier}
END:VEVENT
BEGIN:VEVENT
UID:stale
SUMMARY:Lab 0
DTSTART;VALUE=DATE:{stale}
END:VEVENT
END:VCALENDAR
"""
        self.assertEqual([item["id"] for item in _events(feed)], ["earlier"])


if __name__ == "__main__":
    unittest.main()
