"""Study time is capped: one sitting counts at most three hours and never more than its start-to-end span."""
from datetime import date, datetime, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from routers import stats  # noqa: E402

TODAY = date(2026, 10, 26)


def minutes(rows):
    return sum(day["minutes"] for day in stats.build_activity(rows, [], {}, {}, TODAY)["days"])


class Inserts:
    def __init__(self):
        self.rows = []

    def table(self, name):
        query = MagicMock()
        query.insert.side_effect = lambda row: self.rows.append((name, row)) or query
        query.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        return query


class SessionDurationTests(unittest.TestCase):
    def test_session_row_caps_and_spans_the_active_time(self):
        row = stats.session_row("u1", "read", 86400, "g1")
        self.assertEqual(row["duration_seconds"], stats.MAX_SESSION_SECONDS)
        started = datetime.fromisoformat(row["started_at"])
        ended = datetime.fromisoformat(row["ended_at"])
        self.assertEqual(ended - started, timedelta(seconds=3 * 3600))
        self.assertEqual(stats.session_row("u1", "read", -5)["duration_seconds"], 0)
        self.assertEqual(stats.session_row("u1", "read", "junk")["duration_seconds"], 0)
        self.assertNotIn("guide_id", stats.session_row("u1", "browse", 10))

    def test_log_session_and_beacon_store_capped_rows(self):
        database = Inserts()
        with patch.object(stats, "get_user_id", return_value="u1"), \
             patch.object(stats, "get_supabase", return_value=database), \
             patch.object(stats, "_update_streak"):
            stats.log_session(stats.LogSessionRequest(session_type="flashcard", duration_seconds=66515), "Bearer t")
            stats._log_beacon_session({"authorization": "Bearer t", "session_type": "read", "duration_seconds": 86400})
        durations = [row["duration_seconds"] for name, row in database.rows if name == "study_sessions"]
        self.assertEqual(durations, [stats.MAX_SESSION_SECONDS, stats.MAX_SESSION_SECONDS])

    def test_a_row_counts_no_more_than_its_start_to_end_span(self):
        row = {"started_at": "2026-10-24T10:00:00+00:00", "ended_at": "2026-10-24T10:20:00+00:00",
               "duration_seconds": 3600, "session_type": "read"}
        self.assertEqual(minutes([row]), 20)

    def test_new_rows_count_from_start_to_end(self):
        row = {"started_at": "2026-10-24T09:30:00+00:00", "ended_at": "2026-10-24T10:00:00+00:00",
               "duration_seconds": 1800, "session_type": "read"}
        result = stats.build_activity([row], [], {}, {}, TODAY)
        self.assertEqual(result["hours"][9], 30)

    def test_old_outliers_are_clamped_when_summed(self):
        rows = [{"started_at": "2026-10-20T12:00:00Z", "duration_seconds": 86400, "session_type": "browse"},
                {"started_at": "2026-10-22T12:00:00Z", "duration_seconds": 66515, "session_type": "flashcard"}]
        self.assertEqual(minutes(rows), 2 * 180)

    def test_overview_minutes_today_are_clamped(self):
        tables = {"study_sessions": [{"duration_seconds": 86400}, {"duration_seconds": 600}]}
        database = MagicMock()

        def table(name):
            query = MagicMock()
            for method in ("select", "eq", "gte"):
                getattr(query, method).return_value = query
            query.execute.return_value = MagicMock(data=tables.get(name, []))
            return query
        database.table.side_effect = table
        with patch.object(stats, "get_user_id", return_value="u1"), patch.object(stats, "get_supabase", return_value=database):
            self.assertEqual(stats.get_overview("Bearer t")["minutes_today"], (3 * 3600 + 600) // 60)


if __name__ == "__main__":
    unittest.main()
