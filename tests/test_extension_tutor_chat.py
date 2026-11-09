import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app
from routers import chat
from services.llm import answer_question

AUTH = {"Authorization": "Bearer test"}
BASE = {"question": "Now find the inverse of 5 mod 26", "content": "Modular inverses use the extended Euclidean algorithm.", "context_title": "Lecture"}


@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.chat.get_user_id", return_value="student-1")
class ExtensionTutorChatTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("routers.chat.answer_question", return_value="**Answer.**")
    def test_side_panel_history_and_format_reach_the_model(self, answer, *_):
        history = [{"role": "user", "text": "Inverse of 7 mod 26?"}, {"role": "assistant", "text": "It is 15."}]
        response = self.client.post("/chat", headers=AUTH, json={**BASE, "history": history, "rich_text": True})
        self.assertEqual(response.status_code, 200)
        kwargs = answer.call_args.kwargs
        self.assertEqual(kwargs["conversation"], history)
        self.assertTrue(kwargs["full_history"])
        self.assertTrue(kwargs["rich_text"])

    @patch("routers.chat.answer_question")
    def test_conversation_past_the_model_memory_is_refused_with_a_clear_code(self, answer, *_):
        long_turn = {"role": "assistant", "text": "x" * 20_000}
        with patch.object(chat, "TUTOR_CONTEXT_TOKENS", 20_000):
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

    def test_a_general_question_with_no_material_reaches_the_model(self):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="ok"))]
        with patch("services.llm.get_openai_client", return_value=client):
            answer_question("What is osmosis?", "", allow_clarification=True)
        kwargs = client.chat.completions.create.call_args.kwargs
        self.assertIn("No course material is selected", kwargs["messages"][0]["content"])
        self.assertEqual(kwargs["messages"][-1]["content"], "Question: What is osmosis?")


@patch("services.student_memory.learn_from_tutor")
@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.chat.get_user_id", return_value="student-1")
class GeneralQuestionRouteTests(unittest.TestCase):
    """POST /chat with no material selected, the way the web Tutor sends it (skill "explain"): the real
    answer_question and model lookup run, only the AI client is mocked. Before tutor_general was in
    models.FEATURES this answered 500 (KeyError in model_for)."""

    def setUp(self):
        self.client = TestClient(app)

    def test_a_general_question_gets_an_answer_marked_as_not_from_the_students_material(self, *_):
        ai = MagicMock()
        ai.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="Osmosis is water moving across a membrane."))]
        with patch("services.llm.get_openai_client", return_value=ai), patch("routers.chat.connectors.tutor_material", return_value=None):
            response = self.client.post("/chat", headers=AUTH, json={"question": "What is osmosis?", "content": "", "skill": "explain"})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["answer"], "Osmosis is water moving across a membrane.")
        self.assertEqual(body["source"], chat.GENERAL_SOURCE)
        self.assertEqual(body["source"]["type"], "general")
        self.assertIn("No course material is selected", ai.chat.completions.create.call_args.kwargs["messages"][0]["content"])

    def test_answers_from_material_keep_their_own_source(self, *_):
        ai = MagicMock()
        ai.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="Use the extended Euclidean algorithm."))]
        with patch("services.llm.get_openai_client", return_value=ai):
            response = self.client.post("/chat", headers=AUTH, json={**BASE, "skill": "explain"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual((response.json().get("source") or {}).get("type"), "general")
