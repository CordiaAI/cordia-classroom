"""Phase 1 logging: every answer and format decision, raw values only, never in the way of studying."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from routers import learning  # noqa: E402
from services import learning_events as le  # noqa: E402

USER = "11111111-1111-4111-8111-111111111111"
GUIDE = "22222222-2222-4222-8222-222222222222"
DECISION = "33333333-3333-4333-8333-333333333333"
PRINT = "what organelle makes atp"


def event(**extra):
    return {"guide_id": GUIDE, "fingerprint": PRINT, "mode": "learn", "format": "typed", "outcome": "right", **extra}


def decision(**extra):
    # As the endpoint passes it on: the request model with its defaults filled in.
    return {"id": DECISION, "guide_id": GUIDE, "fingerprint": PRINT, "session_id": None, "decision_type": "format",
            "policy_version_id": "format-rules-v0", "seed": 0, "source": "rule",
            "candidates": ["choice", "typed", "written"], "mask_reasons": {"choice": "needs_recall", "written": "short_answer"},
            "eligible": ["typed"], "probs": {"typed": 1}, "chosen": "typed", "propensity": 1, "context": {"level": 2}, **extra}


class FingerprintTests(unittest.TestCase):
    def test_matches_learn_engine(self):
        # learnEngine.fingerprint: lower-case, non-alphanumerics to one space, trim, 48 characters.
        self.assertEqual(le.fingerprint("What organelle makes ATP?"), PRINT)
        self.assertEqual(le.fingerprint("  Café — résumé!! "), "caf r sum")
        self.assertEqual(le.fingerprint("Why does the market price fall when supply rises and demand stays flat?"),
                         "why does the market price fall when supply rises")
        # The 48-character cut can end on a space, as it does in JavaScript.
        cut = le.fingerprint("A" * 47 + " bee")
        self.assertEqual(cut, "a" * 47 + " ")
        self.assertTrue(le.valid_fingerprint(cut))
        self.assertFalse(le.valid_fingerprint("What organelle"))
        self.assertFalse(le.valid_fingerprint(""))

    def test_item_id(self):
        self.assertEqual(le.item_id(GUIDE, PRINT), f"{GUIDE}:{PRINT}")


class SameDayTests(unittest.TestCase):
    def test_same_local_day_counts_earlier_rows_and_earlier_answers_in_the_batch(self):
        item = le.item_id(GUIDE, PRINT)
        # 23:30 UTC on the 28th is 18:30 on the 28th at UTC-5; 04:00 UTC on the 29th is 23:00 on the 28th.
        earlier = [{"item_id": item, "occurred_at": "2026-10-28T23:30:00+00:00"}]
        first = {"item_id": item, "occurred_at": datetime(2026, 10, 29, 4, 0, tzinfo=timezone.utc)}
        self.assertEqual(le.same_day_flags([first], earlier, tz_offset=-300), [True])
        self.assertEqual(le.same_day_flags([first], earlier, tz_offset=0), [False])
        second = {"item_id": item, "occurred_at": datetime(2026, 10, 29, 5, 0, tzinfo=timezone.utc)}
        other = {"item_id": "other", "occurred_at": datetime(2026, 10, 29, 5, 1, tzinfo=timezone.utc)}
        self.assertEqual(le.same_day_flags([first, second, other], [], tz_offset=0), [False, True, False])

    def test_answer_times_are_believed_only_within_a_week(self):
        now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(le._utc(now - timedelta(hours=2), now), now - timedelta(hours=2))
        self.assertEqual(le._utc(now + timedelta(hours=2), now), now)
        self.assertEqual(le._utc(now - timedelta(days=8), now), now)
        self.assertEqual(le._utc(None, now), now)


class WriteBatchTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.env = patch.dict(os.environ, {"LEARNING_EVENTS_ENABLED": "true"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_raw_values_and_server_defaults(self):
        result = le.write_batch(self.db, USER, [decision()], [event(decision_id=DECISION, confidence="sure", first_key_ms=900, submit_ms=4200, hidden_ms=0, answer_chars=12)])
        self.assertEqual(result, {"logged": True, "decisions": 1, "events": 1})
        [row] = self.db.rows("learning_events")
        self.assertEqual(row["item_id"], f"{GUIDE}:{PRINT}")
        self.assertEqual(row["decision_id"], DECISION)
        self.assertEqual((row["first_key_ms"], row["submit_ms"], row["answer_chars"], row["confidence"]), (900, 4200, 12, "sure"))
        self.assertEqual((row["rapid_guess"], row["fsrs_rating"], row["arm"], row["params_version"], row["same_day"]), (False, None, "fsrs", "none", False))
        [logged] = self.db.rows("decision_events")
        self.assertEqual((logged["policy_version_id"], logged["propensity"], logged["source"], logged["user_id"]), ("format-rules-v0", 1, "rule", USER))

    def test_second_answer_the_same_day_is_marked(self):
        le.write_batch(self.db, USER, [], [event()])
        le.write_batch(self.db, USER, [], [event(format="choice")])
        self.assertEqual([row["same_day"] for row in self.db.rows("learning_events")], [False, True])

    def test_a_decision_that_never_arrived_is_unlinked_not_an_error(self):
        le.write_batch(self.db, USER, [], [event(decision_id=DECISION)])
        self.assertIsNone(self.db.rows("learning_events")[0]["decision_id"])

    def test_flag_off_logs_nothing(self):
        with patch.dict(os.environ, {"LEARNING_EVENTS_ENABLED": "false"}):
            self.assertEqual(le.write_batch(self.db, USER, [decision()], [event()])["logged"], False)
        self.assertEqual(self.db.rows("learning_events"), [])
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(le.learning_events_enabled())

    def test_missing_tables_are_skipped_quietly(self):
        class Missing:
            def table(self, _name):
                raise RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.learning_events'\"}")
        with self.assertNoLogs("services.learning_events", level="WARNING"):
            self.assertEqual(le.write_batch(Missing(), USER, [decision()], [event()]), {"logged": False, "decisions": 0, "events": 0})


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.client = TestClient(main.app)
        self.patches = [
            patch.object(learning, "get_user_id", return_value=USER),
            patch.object(learning, "get_supabase", return_value=self.db),
            patch.dict(os.environ, {"LEARNING_EVENTS_ENABLED": "true"}),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def post(self, body):
        return self.client.post("/learning-events", json=body, headers={"Authorization": "Bearer t"})

    def test_batch_is_saved(self):
        response = self.post({"tz_offset": -300, "decisions": [decision()], "events": [event(decision_id=DECISION), event(format="choice", outcome="wrong", confidence="guess")]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"logged": True, "decisions": 1, "events": 2})
        self.assertEqual(len(self.db.rows("learning_events")), 2)

    def test_invalid_values_are_refused(self):
        self.assertEqual(self.post({"events": [event(format="multiple_choice")]}).status_code, 422)
        self.assertEqual(self.post({"events": [event(fingerprint="What organelle")]}).status_code, 422)
        self.assertEqual(self.post({"events": [event(guide_id="not-a-guide")]}).status_code, 422)
        self.assertEqual(self.post({"events": [event(confidence="think")]}).status_code, 422)
        self.assertEqual(self.post({"decisions": [decision(propensity=0)]}).status_code, 422)
        self.assertEqual(self.post({"decisions": [decision(policy_version_id="bandit-v1")]}).status_code, 422)
        self.assertEqual(self.post({"events": [event()] * 51}).status_code, 422)
        self.assertEqual(self.db.rows("learning_events"), [])

    def test_logging_off_still_answers_200(self):
        with patch.dict(os.environ, {"LEARNING_EVENTS_ENABLED": "off"}):
            response = self.post({"events": [event()]})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["logged"])


if __name__ == "__main__":
    unittest.main()
