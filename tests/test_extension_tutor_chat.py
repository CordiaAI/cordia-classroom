import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import main
from main import app
from services.llm import answer_question

AUTH = {"Authorization": "Bearer test"}
BASE = {"question": "Now find the inverse of 5 mod 26", "content": "Modular inverses use the extended Euclidean algorithm.", "context_title": "Lecture"}


@patch("main._style_instruction", return_value="")
@patch("main._learning_guidance", return_value="")
@patch("main.record")
@patch("main.require", return_value={"used": 0})
@patch("main.get_user_id", return_value="student-1")
class ExtensionTutorChatTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("main.answer_question", return_value="**Answer.**")
    def test_side_panel_history_and_format_reach_the_model(self, answer, *_):
        history = [{"role": "user", "text": "Inverse of 7 mod 26?"}, {"role": "assistant", "text": "It is 15."}]
        response = self.client.post("/chat", headers=AUTH, json={**BASE, "history": history, "rich_text": True})
        self.assertEqual(response.status_code, 200)
        kwargs = answer.call_args.kwargs
        self.assertEqual(kwargs["conversation"], history)
        self.assertTrue(kwargs["full_history"])
        self.assertTrue(kwargs["rich_text"])

    @patch("main.answer_question")
    def test_conversation_past_the_model_memory_is_refused_with_a_clear_code(self, answer, *_):
        long_turn = {"role": "assistant", "text": "x" * 20_000}
        with patch.object(main, "TUTOR_CONTEXT_TOKENS", 20_000):
            response = self.client.post("/chat", headers=AUTH, json={**BASE, "history": [long_turn] * 4})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"], "context_window_full")
        answer.assert_not_called()


class RichAnswerPromptTests(unittest.TestCase):
    def test_rich_answers_ask_for_steps_symbols_and_bold_and_keep_full_history(self):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="ok"))]
        history = [{"role": "user", "text": f"turn {n}"} for n in range(10)]
        with patch("services.llm.get_openai_client", return_value=client):
            answer_question("q", "ctx", conversation=history, allow_clarification=True, rich_text=True, full_history=True)
        kwargs = client.chat.completions.create.call_args.kwargs
        system = kwargs["messages"][0]["content"]
        self.assertIn('"1. **Step title', system)
        self.assertIn("never use LaTeX", system)
        self.assertEqual(len(kwargs["messages"]), 12)  # system + all 10 turns + question


if __name__ == "__main__":
    unittest.main()


class WebTutorAnswerTests(unittest.TestCase):
    def test_tutor_asked_again_must_teach_differently_in_short_sentences(self):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="ok"))]
        with patch("services.llm.get_openai_client", return_value=client):
            answer_question("explain that again", "ctx", allow_clarification=True, rich_text=True)
        system = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("never repeat or lightly reword your earlier answer", system)
        self.assertIn("Keep every sentence short", system)
