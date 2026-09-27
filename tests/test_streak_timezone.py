import sys
from datetime import datetime, timedelta
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers import stats


class Query:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return MagicMock(data=self.rows)


class StreakTimezoneTests(unittest.TestCase):
    def streak(self, session_times, tz_offset):
        tables = {
            "user_streaks": [{"current_streak": 2, "longest_streak": 2, "last_study_date": "2000-01-01"}],
            "study_sessions": [{"started_at": t} for t in session_times],
        }
        database = MagicMock()
        database.table.side_effect = lambda name: Query(tables[name])
        with patch.object(stats, "get_user_id", return_value="student-1"), \
             patch.object(stats, "get_supabase", return_value=database):
            return stats.get_streak("Bearer token", tz_offset=tz_offset)

    def test_evening_study_counts_for_the_users_local_day(self):
        # 8pm local (UTC-5) is already tomorrow in UTC; it must still count as "today" locally.
        now = datetime.utcnow()
        result = self.streak([(now - timedelta(minutes=1)).isoformat() + "+00:00"], tz_offset=-300)
        self.assertTrue(result["studied_today"])
        self.assertEqual(result["current_streak"], 1)
        self.assertEqual(sum(day["active"] for day in result["week"]), 1)

    def test_gap_day_breaks_the_streak(self):
        now = datetime.utcnow()
        times = [(now - timedelta(days=d)).isoformat() + "+00:00" for d in (0, 1, 3)]
        self.assertEqual(self.streak(times, tz_offset=0)["current_streak"], 2)

    def test_yesterday_keeps_streak_alive_before_studying_today(self):
        now = datetime.utcnow()
        times = [(now - timedelta(days=d)).isoformat() + "+00:00" for d in (1, 2)]
        result = self.streak(times, tz_offset=0)
        self.assertFalse(result["studied_today"])
        self.assertEqual(result["current_streak"], 2)


if __name__ == "__main__":
    unittest.main()
