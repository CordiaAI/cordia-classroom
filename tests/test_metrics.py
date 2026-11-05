"""Activation and return metrics (personalization plan step 0.4; definitions from research report 09)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from services import metrics as m  # noqa: E402

SIGNUP = datetime(2026, 10, 5, 15, 0, tzinfo=timezone.utc)  # a Monday
NOW = SIGNUP + timedelta(days=20)


def at(hours: float) -> str:
    return (SIGNUP + timedelta(hours=hours)).isoformat()


def answers(n: int, fmt: str = "typed", hours: float = 1, mode: str = "learn") -> list[dict]:
    return [{"user_id": "u1", "occurred_at": at(hours + i / 60), "format": fmt, "mode": mode} for i in range(n)]


class UserOutcomeTests(unittest.TestCase):
    def outcome(self, guides=(), events=(), sessions=(), now=NOW):
        report = m.activation_report([{"id": "u1", "created_at": SIGNUP.isoformat()}], list(guides), list(events),
                                     list(sessions), now)
        return report

    def test_activation_needs_a_guide_three_recall_answers_and_an_exam_date_in_the_first_day(self):
        guide = {"user_id": "u1", "created_at": at(0.5), "test_date": "2026-10-20"}
        report = self.outcome([guide], answers(3))
        self.assertEqual(report["overall"]["activation"]["yes"], 1)
        # Two recall answers are not enough.
        self.assertEqual(self.outcome([guide], answers(2))["overall"]["activation"]["yes"], 0)
        # No exam date: not activated.
        self.assertEqual(self.outcome([{**guide, "test_date": None}], answers(3))["overall"]["activation"]["yes"], 0)
        # The guide made after the first 24 hours doesn't count.
        self.assertEqual(self.outcome([{**guide, "created_at": at(25)}], answers(3))["overall"]["activation"]["yes"], 0)
        # Answers after the first 24 hours don't count.
        self.assertEqual(self.outcome([guide], answers(3, hours=24.5))["overall"]["activation"]["yes"], 0)

    def test_recognition_and_backfill_are_not_recall_answers(self):
        guide = {"user_id": "u1", "created_at": at(0.5), "test_date": "2026-10-20"}
        for fmt in ("flashcard", "choice", "pairs", "fill_bank", "practice"):
            self.assertEqual(self.outcome([guide], answers(5, fmt))["overall"]["activation"]["yes"], 0, fmt)
        for fmt in ("typed", "fill_free", "written"):
            self.assertEqual(self.outcome([guide], answers(3, fmt))["overall"]["activation"]["yes"], 1, fmt)
        self.assertEqual(self.outcome([guide], answers(3, mode="backfill"))["overall"]["activation"]["yes"], 0)

    def test_a_correct_guess_is_not_a_recall_win_but_a_wrong_answer_counts_as_given(self):
        guide = {"user_id": "u1", "created_at": at(0.5), "test_date": "2026-10-20"}
        guessed = [{**a, "outcome": "right", "confidence": "guess"} for a in answers(3)]
        self.assertEqual(self.outcome([guide], guessed)["overall"]["activation"]["yes"], 0)
        wrong_guesses = [{**a, "outcome": "wrong", "confidence": "guess"} for a in answers(3)]
        self.assertEqual(self.outcome([guide], wrong_guesses)["overall"]["activation"]["yes"], 1)
        sure = [{**a, "outcome": "right", "confidence": "sure"} for a in answers(3)]
        self.assertEqual(self.outcome([guide], sure)["overall"]["activation"]["yes"], 1)

    def test_d1_and_d7_count_any_study_and_only_once_those_days_are_over(self):
        report = self.outcome(events=answers(1, "flashcard", hours=30), sessions=[{"user_id": "u1", "started_at": at(24 * 7 + 2)}])
        self.assertEqual((report["overall"]["d1_return"]["yes"], report["overall"]["d7_return"]["yes"]), (1, 1))
        # Studying on day 2 or day 5 is neither.
        report = self.outcome(sessions=[{"user_id": "u1", "started_at": at(24 * 2 + 1)}, {"user_id": "u1", "started_at": at(24 * 5 + 1)}])
        self.assertEqual((report["overall"]["d1_return"]["yes"], report["overall"]["d7_return"]["yes"]), (0, 0))
        # Signed up 3 days ago: D1 is known, D7 not yet (left out, not counted as a no).
        report = self.outcome(now=SIGNUP + timedelta(days=3))
        self.assertEqual((report["overall"]["d1_return"]["n"], report["overall"]["d7_return"]["n"]), (1, 0))

    def test_weeks_and_intervals(self):
        users = [{"id": f"u{i}", "created_at": (SIGNUP + timedelta(days=i * 3)).isoformat()} for i in range(4)]
        report = m.activation_report(users, [], [], [], NOW)
        self.assertEqual(report["overall"]["signups"], 4)
        self.assertEqual([w["week"] for w in report["by_week"]], ["2026-10-05", "2026-10-12"])
        self.assertEqual(report["overall"]["activation"]["rate"], 0)
        low, high = report["overall"]["activation"]["interval"]
        self.assertEqual(low, 0)
        self.assertGreater(high, 0.4)  # four signups say very little
        self.assertIsNone(m.wilson(0, 0))


class EndpointTests(unittest.TestCase):
    def test_admins_only(self):
        client = TestClient(main.app)
        with patch("routers.admin.require_admin", side_effect=HTTPException(status_code=403, detail="Admins only")):
            self.assertEqual(client.get("/admin/metrics", headers={"Authorization": "Bearer x"}).status_code, 403)
        with patch("routers.admin.require_admin", return_value=("admin", object())), \
                patch("services.metrics.load_activation", return_value={"overall": {}}) as load:
            response = client.get("/admin/metrics?days=14", headers={"Authorization": "Bearer x"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(load.call_args.args[1], 14)


if __name__ == "__main__":
    unittest.main()
