"""Onboarding experiment assignment and onboarding answers (personalization plan steps 1.1, 1.2)."""
from pathlib import Path
from types import SimpleNamespace
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import experiments as ex  # noqa: E402
from services.onboarding_questions import QUESTIONS, InvalidAnswer, check  # noqa: E402

AUTH = {"Authorization": "Bearer token"}
ON = {"ONBOARDING_EXPERIMENT": "on"}


def ids(n):
    return [f"{i:08x}-0000-4000-8000-000000000000" for i in range(n)]


class AssignmentTests(unittest.TestCase):
    def test_the_arm_is_fixed_and_about_80_20(self):
        users = ids(4000)
        arms = [ex.arm_for(u, ex.ONBOARDING) for u in users]
        self.assertEqual(arms, [ex.arm_for(u, ex.ONBOARDING) for u in users])  # same every time
        share = arms.count("v2") / len(arms)
        self.assertTrue(0.77 < share < 0.83, share)
        self.assertEqual(ex.arm_for(users[0].upper(), ex.ONBOARDING), arms[0])

    def test_new_student_is_assigned_once_with_stratum_only_while_on(self):
        db = FakeDB()
        db.auth = SimpleNamespace(admin=SimpleNamespace(get_user_by_id=lambda _u: SimpleNamespace(
            user=SimpleNamespace(app_metadata={"provider": "google"}))))
        db.tables["canvas_connections"] = [{"user_id": "u1"}]
        self.assertIsNone(ex.onboarding_arm(db, "u1", new_student=True))  # switched off
        self.assertEqual(db.rows("experiment_assignments"), [])
        with patch.dict(os.environ, ON):
            arm = ex.onboarding_arm(db, "u1", new_student=True)
            self.assertIn(arm, ("v2", "old"))
            self.assertEqual(ex.onboarding_arm(db, "u1", new_student=False), arm)  # saved arm returned
            [row] = db.rows("experiment_assignments")
            self.assertEqual(row["stratum"], {"sign_in": "google", "canvas": True})
            # A student who had already started onboarding never joins.
            self.assertIsNone(ex.onboarding_arm(db, "u2", new_student=False))

    def test_failures_mean_the_old_flow_not_an_error(self):
        class Broken:
            def table(self, _name):
                raise RuntimeError("PGRST205 Could not find the table")
        with patch.dict(os.environ, ON):
            self.assertIsNone(ex.onboarding_arm(Broken(), "u1", new_student=True))
        self.assertEqual(ex.arms_by_user(Broken()), {})


class QuestionTests(unittest.TestCase):
    def test_choices_versions_and_skips(self):
        self.assertEqual(check("night_before", 1, {"value": "quiz_flashcards"}), {"value": "quiz_flashcards"})
        self.assertEqual(check("chronotype", 1, {"skipped": True}), {"skipped": True})
        with self.assertRaises(InvalidAnswer):
            check("night_before", 1, {"value": "cram"})
        with self.assertRaises(InvalidAnswer):
            check("night_before", 2, {"value": "reread"})  # wrong version
        with self.assertRaises(InvalidAnswer):
            check("exam_nerves", 1, {"value": "calm"})  # anxiety items are out of v1

    def test_structured_answers(self):
        self.assertEqual(check("exam_date", 1, {"value": "2026-12-10", "course": "BIO 201"}), {"value": "2026-12-10", "course": "BIO 201"})
        self.assertEqual(check("exam_date", 1, {"value": "none_yet"}), {"value": "none_yet"})
        self.assertEqual(check("study_trigger", 1, {"cue": "after BIO 201", "place": "the library"}), {"cue": "after BIO 201", "place": "the library"})
        self.assertEqual(check("conscientiousness", 1, {"items": [4, 2, 5, 3]}), {"items": [4, 2, 5, 3]})
        self.assertEqual(check("major", 1, {"value": "nursing", "second": "psychology"}), {"value": "nursing", "second": "psychology"})
        for bad in (("exam_date", {"value": "next week"}), ("conscientiousness", {"items": [1, 2]}), ("major", {"value": ""})):
            with self.assertRaises(InvalidAnswer):
                check(bad[0], 1, bad[1])

    def test_memory_questions(self):
        self.assertEqual(check("memory_style", 1, {"value": "funny"}), {"value": "funny"})
        self.assertEqual(check("interests", 1, {"value": ["music", "food"]}), {"value": ["music", "food"]})
        self.assertEqual(check("interests", 1, {"skipped": True}), {"skipped": True})
        for bad in ([], ["music", "food", "tech", "books"], ["music", "music"], ["knitting"], "music"):
            with self.assertRaises(InvalidAnswer):
                check("interests", 1, {"value": bad})

    def test_no_act_option_and_no_anxiety_question(self):
        self.assertNotIn("act", QUESTIONS["licensure_exam"][2])
        self.assertFalse([q for q in QUESTIONS if "anx" in q or "nerve" in q])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.client = TestClient(main.app)
        self.patches = [patch("routers.learning.get_user_id", return_value="u1"),
                        patch("routers.learning.get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_answers_are_saved_with_their_version(self):
        response = self.client.post("/onboarding/answers", headers=AUTH, json={"answers": [
            {"question_id": "night_before", "version": 1, "answer": {"value": "reread"}},
            {"question_id": "exam_date", "version": 1, "answer": {"value": "2026-12-10"}},
        ]})
        self.assertEqual(response.json(), {"saved": 2})
        rows = self.db.rows("onboarding_answers")
        self.assertEqual([(r["user_id"], r["question_id"], r["question_version"], r["source"]) for r in rows],
                         [("u1", "night_before", 1, "onboarding"), ("u1", "exam_date", 1, "onboarding")])

    def test_a_bad_answer_saves_nothing(self):
        response = self.client.post("/onboarding/answers", headers=AUTH, json={"answers": [
            {"question_id": "night_before", "version": 1, "answer": {"value": "reread"}},
            {"question_id": "year", "version": 1, "answer": {"value": "ninth"}},
        ]})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.rows("onboarding_answers"), [])

    def test_onboarding_read_reports_the_arm(self):
        with patch.dict(os.environ, ON):
            body = self.client.get("/onboarding", headers=AUTH).json()
        self.assertIn(body["arm"], ("v2", "old"))
        self.assertEqual(body["step"], "style")


if __name__ == "__main__":
    unittest.main()
