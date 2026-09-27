import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz


GUIDE_ID = "00000000-0000-0000-0000-000000000001"
GUIDE = "Q1: First?\nA1: Alpha\nQ2: Second?\nA2: Beta\nQ3: Third?\nA3: Gamma\nQ4: Fourth?\nA4: Delta"


class FakeQuery:
    def __init__(self, row):
        self.row = row
        self.updated = None

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def update(self, payload):
        self.updated = payload
        return self

    def execute(self):
        return SimpleNamespace(data=[self.row])


class QuizPlanContractTests(unittest.TestCase):
    def _database(self, row):
        query = FakeQuery(row)
        database = MagicMock()
        database.table.return_value = query
        return database, query

    def test_free_quiz_uses_other_guide_answers_without_ai_or_cache_write(self):
        database, query = self._database({"study_guide": GUIDE, "quiz_questions": [{"old": True}]})
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_user_plan", return_value={"plan": "free"}), \
             patch.object(quiz, "get_openai_client") as openai:
            result = quiz.generate_quiz(GUIDE_ID, "Bearer token")

        self.assertEqual(len(result["questions"]), 4)
        first = result["questions"][0]
        self.assertEqual(set(first["options"]), {"Alpha", "Beta", "Gamma", "Delta"})
        self.assertEqual(first["options"][first["correct_index"]], "Alpha")
        self.assertIsNone(query.updated)
        openai.assert_not_called()

    def test_length_outliers_are_replaced_with_balanced_guide_answers(self):
        distractors = quiz._balanced_distractors(
            "Alpha concept",
            ["A", "This answer is far too long to look like a peer option", "Beta concept"],
            ["Gamma concept", "Delta concept"],
        )

        self.assertEqual(distractors, ["Beta concept", "Gamma concept", "Delta concept"])

    def test_paid_quiz_reuses_the_saved_ai_quiz(self):
        cached = [{"question": "Saved?", "options": ["Yes", "No"], "correct_index": 0}]
        database, query = self._database({"study_guide": GUIDE, "quiz_questions": cached})
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_user_plan", return_value={"plan": "classroom_plus"}), \
             patch.object(quiz, "get_openai_client") as openai:
            result = quiz.generate_quiz(GUIDE_ID, "Bearer token")

        self.assertEqual(result["questions"], cached)
        self.assertIsNone(query.updated)
        openai.assert_not_called()

    def test_paid_quiz_generates_and_saves_only_when_missing(self):
        database, query = self._database({"study_guide": GUIDE, "quiz_questions": None})
        response = MagicMock()
        response.choices[0].message.content = (
            '{"items":[{"distractors":["A1","A2","A3"]},'
            '{"distractors":["B1","B2","B3"]},'
            '{"distractors":["C1","C2","C3"]},'
            '{"distractors":["D1","D2","D3"]}]}'
        )
        client = MagicMock()
        client.chat.completions.create.return_value = response
        usage = {"builds_used": 0, "lightweight_actions_used": 0}
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_user_plan", return_value={"plan": "classroom_plus"}), \
             patch.object(quiz, "check_usage", return_value=usage), \
             patch.object(quiz, "record_usage") as record_usage, \
             patch.object(quiz, "get_openai_client", return_value=client):
            result = quiz.generate_quiz(GUIDE_ID, "Bearer token")

        self.assertEqual(len(result["questions"]), 4)
        self.assertEqual(query.updated, {"quiz_questions": result["questions"]})
        record_usage.assert_called_once_with("student-1", "lightweight", usage)
        prompt = client.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("incorrect terminology", prompt)
        self.assertIn("missing or altering one essential factor", prompt)

    def test_unusable_ai_reply_falls_back_without_caching(self):
        database, query = self._database({"study_guide": GUIDE, "quiz_questions": None})
        response = MagicMock()
        response.choices[0].message.content = '{"items": "\\( a \\)'
        client = MagicMock()
        client.chat.completions.create.return_value = response
        usage = {"builds_used": 0, "lightweight_actions_used": 0}
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_user_plan", return_value={"plan": "classroom_plus"}), \
             patch.object(quiz, "check_usage", return_value=usage), \
             patch.object(quiz, "record_usage"), \
             patch.object(quiz, "get_openai_client", return_value=client):
            result = quiz.generate_quiz(GUIDE_ID, "Bearer token")

        self.assertEqual(len(result["questions"]), 4)
        self.assertIsNone(query.updated)

    def test_paid_regeneration_replaces_cached_distractors(self):
        cached = [{"question": "Saved?", "options": ["Yes", "No"], "correct_index": 0}]
        database, query = self._database({"study_guide": GUIDE, "quiz_questions": cached})
        response = MagicMock()
        response.choices[0].message.content = (
            '{"items":[{"distractors":["Omega","Sigma","Theta"]},'
            '{"distractors":["Theta","Delta","Alpha"]},'
            '{"distractors":["Sigma","Alpha","Delta"]},'
            '{"distractors":["Theta","Gamma","Alpha"]}]}'
        )
        client = MagicMock()
        client.chat.completions.create.return_value = response
        usage = {"builds_used": 0, "lightweight_actions_used": 0}
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_user_plan", return_value={"plan": "classroom_plus"}), \
             patch.object(quiz, "check_usage", return_value=usage), \
             patch.object(quiz, "record_usage"), \
             patch.object(quiz, "get_openai_client", return_value=client):
            result = quiz.regenerate_quiz(GUIDE_ID, "Bearer token")

        self.assertNotEqual(result["questions"], cached)
        self.assertEqual(query.updated, {"quiz_questions": result["questions"]})
        client.chat.completions.create.assert_called_once()


if __name__ == "__main__":
    unittest.main()
