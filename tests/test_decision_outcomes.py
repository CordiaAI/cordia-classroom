"""What happened after each adaptive decision (personalization plan step 0.3)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
import unittest
import unittest.mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fake_supabase import FakeDB  # noqa: E402
from services import decision_outcomes as d  # noqa: E402

MADE = datetime(2026, 10, 1, 15, 0, tzinfo=timezone.utc)
NOW = MADE + timedelta(days=5)
ITEM = "g1:what organelle makes atp"
DECISION = {"id": "dec-1", "user_id": "u1", "item_id": ITEM, "created_at": MADE.isoformat()}


def answer(hours, fmt="typed", outcome="right", confidence=None, same_day=False, item=ITEM, mode="learn", id_=1):
    return {"id": id_, "user_id": "u1", "item_id": item, "occurred_at": (MADE + timedelta(hours=hours)).isoformat(),
            "format": fmt, "outcome": outcome, "confidence": confidence, "same_day": same_day, "mode": mode}


def by_type(rows):
    return {row["outcome_type"]: row for row in rows}


class OutcomeTests(unittest.TestCase):
    def test_delayed_recall_is_the_next_first_try_recall_a_day_or_more_later(self):
        rows = by_type(d.outcomes_for([DECISION], [
            answer(1, id_=1),                                  # same sitting: too soon
            answer(30, fmt="choice", id_=2),                    # recognition: not recall
            answer(31, same_day=True, id_=3),                   # not the first try that day
            answer(32, outcome="partly", id_=4),                # this one
            answer(60, id_=5),
        ], set(), NOW))
        recall = rows["delayed_recall"]
        self.assertEqual((recall["value"], recall["learning_event_id"]), (0.5, 4))
        self.assertIsNone(recall["p_pred"])
        self.assertIsNone(recall["residual"])

    def test_a_correct_guess_is_not_a_recall_win(self):
        rows = by_type(d.outcomes_for([DECISION], [answer(30, confidence="guess")], set(), NOW))
        self.assertEqual(rows["delayed_recall"]["value"], 0.0)

    def test_return_needs_a_later_sitting_within_48_hours_and_waits_until_it_is_known(self):
        rows = by_type(d.outcomes_for([DECISION], [answer(1, item="other"), answer(20, item="other", fmt="flashcard")], set(), NOW))
        self.assertEqual(rows["returned_within_48h"]["value"], 1.0)
        rows = by_type(d.outcomes_for([DECISION], [answer(1, item="other"), answer(50, item="other")], set(), NOW))
        self.assertEqual(rows["returned_within_48h"]["value"], 0.0)
        rows = by_type(d.outcomes_for([DECISION], [], set(), MADE + timedelta(hours=40)))
        self.assertNotIn("returned_within_48h", rows)

    def test_nothing_is_written_twice_and_backfill_is_ignored(self):
        done = {("dec-1", "delayed_recall"), ("dec-1", "returned_within_48h")}
        self.assertEqual(d.outcomes_for([DECISION], [answer(30)], done, NOW), [])
        rows = by_type(d.outcomes_for([DECISION], [answer(30, mode="backfill")], set(), NOW))
        self.assertNotIn("delayed_recall", rows)


class RunTests(unittest.TestCase):
    def test_run_writes_rows_then_nothing_new(self):
        db = FakeDB()
        db.tables["decision_outcomes"] = []
        db.tables["decision_events"] = [DECISION]
        db.tables["learning_events"] = [answer(30, id_=7)]
        self.assertEqual(d.run(db, NOW), 2)
        self.assertEqual(sorted(r["outcome_type"] for r in db.rows("decision_outcomes")), ["delayed_recall", "returned_within_48h"])
        self.assertEqual(d.run(db, NOW), 0)

    def test_before_the_migration_it_does_nothing(self):
        class Missing:
            def table(self, name):
                raise RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.decision_outcomes'\"}")
        self.assertEqual(d.run(Missing(), NOW), 0)

    def test_runs_once_a_day_after_the_hour(self):
        calls = []
        d._last_run_day = None
        with unittest.mock.patch.object(d, "run", side_effect=lambda db, now: calls.append(now) or 0):
            d.run_if_due(lambda: None, datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc))
            d.run_if_due(lambda: None, datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc))
            d.run_if_due(lambda: None, datetime(2026, 11, 5, 23, 0, tzinfo=timezone.utc))
            d.run_if_due(lambda: None, datetime(2026, 11, 6, 8, 30, tzinfo=timezone.utc))
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
