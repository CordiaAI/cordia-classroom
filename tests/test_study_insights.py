import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app
from routers.stats import _graded_items
from services.learning_styles import explanation_instruction
from services.study_insights import build_insights, practice_results, question_kind

AUTH = {"Authorization": "Bearer token"}


class QuestionKindTests(unittest.TestCase):
    def test_kinds_read_from_wording_in_any_subject(self):
        self.assertEqual(question_kind("What is osmosis?"), "terms")
        self.assertEqual(question_kind("Why did the Roman Republic collapse?"), "why")
        self.assertEqual(question_kind("How does a bill become law?"), "process")
        self.assertEqual(question_kind("What is the difference between a lease and a license?"), "compare")
        self.assertEqual(question_kind("Calculate the dose for a 70 kg patient."), "calculate")
        self.assertEqual(question_kind("Suppose a company raises prices. What happens to demand?"), "apply")
        self.assertEqual(question_kind("Monet painted Impression, Sunrise in 1872."), "facts")


class InsightsTests(unittest.TestCase):
    def test_strengths_weak_spots_and_matching_tip(self):
        results = [("terms", True)] * 4 + [("why", False)] * 3 + [("why", True)]
        insights = build_insights(results, [])
        self.assertEqual(insights["strengths"][0]["kind"], "terms")
        self.assertEqual(insights["needs_work"][0]["kind"], "why")
        self.assertIn("Elaborative interrogation", insights["tips"][0]["source"])

    def test_one_question_never_becomes_a_strength_or_weakness(self):
        insights = build_insights([("why", False), ("terms", True)], [])
        self.assertEqual((insights["strengths"], insights["needs_work"]), ([], []))
        self.assertEqual(insights["answered"], 2)

    def test_cramming_and_rereading_habits_get_research_tips(self):
        now = datetime(2026, 9, 30, tzinfo=timezone.utc)
        sessions = [{"session_type": "read", "started_at": (now - timedelta(hours=h)).isoformat()} for h in (1, 2, 3, 4)]
        sources = [tip["source"] for tip in build_insights([], sessions, now)["tips"]]
        self.assertTrue(any("Spacing" in source for source in sources))
        self.assertTrue(any("Testing effect" in source for source in sources))

    def test_practice_counts_only_graded_problems(self):
        state = {
            "problems": [{"practice_type": "calculation", "prompt": "x"}, {"practice_type": "scenario", "prompt": "y"}],
            "progress": {"evaluations": {"0": {"status": "correct"}, "1": {"status": "retry"}}, "revealed": {"0": True}},
        }
        self.assertEqual(practice_results(state), [("calculate", True)])

    def test_quiz_retain_and_practice_all_feed_results_and_scores(self):
        data = {
            "attempts": [{"guide_id": "g1", "score": 50, "answers": [{"question_index": 0, "is_correct": False}]}],
            "questions": {"g1": [{"question": "Why does ice float?"}]},
            "practice": [{"problems": [{"practice_type": "calculation"}], "progress": {"evaluations": {"0": {"status": "correct"}}, "revealed": {"0": True}}}],
            "sessions": [],
        }
        results, scores = _graded_items(data)
        self.assertEqual(results, [("why", False), ("calculate", True)])
        self.assertEqual(scores, [50, 100])


class ExplanationPreferenceTests(unittest.TestCase):
    def test_instruction_is_bounded_to_presentation(self):
        text = explanation_instruction("Use sports analogies and short steps.")
        self.assertIn("Use sports analogies and short steps.", text)
        self.assertIn("never changes facts", text)
        self.assertEqual(explanation_instruction("   "), "")

    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_saving_trims_and_stores_for_this_student(self, _user):
        with patch("routers.learning.get_supabase") as supabase:
            response = TestClient(app).put("/explanation-preference", headers=AUTH, json={"text": "  Simple   words please "})
        self.assertEqual(response.json(), {"text": "Simple words please"})
        record = supabase.return_value.table.return_value.upsert.call_args[0][0]
        self.assertEqual((record["user_id"], record["explain_preference"]), ("student-1", "Simple words please"))

    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_overlong_preference_is_rejected(self, _user):
        response = TestClient(app).put("/explanation-preference", headers=AUTH, json={"text": "x" * 501})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
