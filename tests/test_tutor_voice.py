"""The Tutor's voice guards: no slang openers, and no specific fact stated as settled without material."""
import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app
from rate_limit import limiter
from routers import chat
from services.llm import answer_question
from services.tutor_voice import UNCHECKED_NOTE, ground_general_answer, plain_opening, states_specifics

AUTH = {"Authorization": "Bearer test"}

# Each discipline: (question, an answer that states specifics, an answer that only explains).
DISCIPLINES = {
    "nursing": ("What is the normal adult heart rate?", "A normal adult resting heart rate is 60 to 100 beats per minute.",
                "Heart rate is how often the heart beats; a resting rate is taken when the person is calm."),
    # A question that asks who, how many or what year is answered with a specific, so the general answers
    # here go with questions that don't (the second review's question-side rule flags those).
    "art history": ("Tell me about the Night Watch", "Rembrandt painted it in 1642 for a civic guard company.",
                    "A group portrait shows several sitters together, often arranged to show their roles."),
    "business law": ("What case set the rule on consideration?", "The rule comes from Currie v Misa, decided in 1875.",
                     "Consideration is something of value that each side gives up to make a promise binding."),
    "literature": ("When was Beloved published?", "Toni Morrison published it on September 16 of that year.",
                   "A frame narrative is a story told inside another story, which shapes how we read it."),
    "computer science": ("Tell me about the first compiler", "It was built by a team of three engineers at the lab.",
                         "A compiler translates source code into instructions a machine can run, before it runs."),
}


class SpecificsTests(unittest.TestCase):
    def test_every_discipline_gets_the_same_rule(self):
        for name, (question, specific, general) in DISCIPLINES.items():
            with self.subTest(discipline=name):
                self.assertTrue(states_specifics(specific, question), specific)
                self.assertFalse(states_specifics(general, question), general)
                self.assertTrue(ground_general_answer(specific, question).endswith(UNCHECKED_NOTE))
                self.assertEqual(ground_general_answer(general, question), general)

    def test_the_reported_answer_is_marked_unchecked(self):
        answer = "It was founded in Pulaski, Tennessee by six Confederate veterans."
        self.assertIn(UNCHECKED_NOTE, ground_general_answer(answer, "Who founded it?"))

    def test_numbers_the_student_gave_and_counts_about_the_answer_are_not_facts(self):
        self.assertFalse(states_specifics("The answer is 4.", "What is 2 + 2?"))
        self.assertFalse(states_specifics("There are two ways to think about it.", "Explain recursion"))
        self.assertFalse(states_specifics("In Python, a list keeps its order.", "what is a list in python"))
        self.assertFalse(states_specifics("1. **Identify The Variables**\nWrite down what you know.", "how do I start"))

    def test_a_full_name_or_an_amount_is_flagged_in_every_discipline(self):
        # Second review: a name at the very start of a sentence, a currency amount and a percent are specifics too.
        for answer in ["Florence Nightingale founded modern nursing.", "Jan van Eyck painted it.", "Chief Justice Marshall wrote the opinion.",
                       "Toni Morrison wrote it.", "Ada Lovelace wrote the first program.", "Sales of goods for $500 or more need a writing.",
                       "About 60 percent of an adult's weight is water.", "About sixty percent of cases settle."]:
            with self.subTest(answer=answer):
                self.assertTrue(ground_general_answer(answer, "Tell me about it").endswith(UNCHECKED_NOTE))
        self.assertTrue(states_specifics("Morrison wrote it.", "who wrote it?"))

    def test_a_capital_word_that_starts_a_plain_sentence_is_not_a_name(self):
        for answer in ["Sterile technique keeps the field clean.", "Italian painters used linear perspective.", "The Greek word means measure.",
                       "Contract law protects promises.", "Free verse has no set meter.", "Big O describes growth."]:
            with self.subTest(answer=answer):
                self.assertEqual(ground_general_answer(answer, "Explain it"), answer)

    def test_an_answer_that_already_offers_to_check_the_material_is_left_alone(self):
        answer = "It may have been 1642, but pick your guide and I can confirm it."
        self.assertEqual(ground_general_answer(answer, "When?"), answer)


class OpeningTests(unittest.TestCase):
    def test_slang_and_filler_openers_are_dropped(self):
        self.assertEqual(plain_opening("Yo, osmosis is water moving."), "Osmosis is water moving.")
        self.assertEqual(plain_opening("Yo! Let's go through it."), "Let's go through it.")
        self.assertEqual(plain_opening("Hey there! A tort is a civil wrong."), "A tort is a civil wrong.")
        self.assertEqual(plain_opening("Great question! Irony is a gap between words and meaning."), "Irony is a gap between words and meaning.")

    def test_ordinary_openings_are_kept(self):
        for text in ("You can solve this in two steps.", "Yoga aside, rest helps recovery.", "Superposition means both at once.", "Yo"):
            self.assertEqual(plain_opening(text), text)


class PromptTests(unittest.TestCase):
    def system_prompt(self, **kwargs):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content="ok"))]
        with patch("services.llm.get_openai_client", return_value=client):
            answer_question(**kwargs)
        return client.chat.completions.create.call_args.kwargs["messages"][0]["content"]

    def test_the_no_material_prompt_never_states_specifics_as_fact(self):
        system = self.system_prompt(question="Who founded it?", context="", allow_clarification=True)
        self.assertIn("never present a specific name, number, count or date as settled fact", system)
        self.assertEqual(system.count("unsure"), 1)  # the rule replaced the old "say when unsure" line

    def test_the_rich_format_asks_for_a_plain_voice(self):
        system = self.system_prompt(question="q", context="ctx", allow_clarification=True, rich_text=True)
        self.assertIn("warm, plain voice; no slang or filler openers", system)


@patch("services.student_memory.learn_from_tutor")
@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.chat.get_user_id", return_value="student-1")
class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        limiter.reset()  # /chat allows 30 a minute per client; other modules' tests use it too

    def ask(self, reply, body):
        ai = MagicMock()
        ai.chat.completions.create.return_value.choices = [MagicMock(message=MagicMock(content=reply))]
        with patch("services.llm.get_openai_client", return_value=ai), patch("routers.chat.connectors.tutor_material", return_value=None):
            response = self.client.post("/chat", headers=AUTH, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_a_general_answer_with_specifics_says_they_are_unchecked(self, *_):
        body = self.ask("Yo, it was founded by six Confederate veterans.", {"question": "Who founded it?", "content": "", "skill": "explain"})
        self.assertTrue(body["answer"].startswith("It was founded by six Confederate veterans."))
        self.assertTrue(body["answer"].endswith(UNCHECKED_NOTE))
        self.assertEqual(body["source"], chat.GENERAL_SOURCE)

    def test_an_answer_from_material_is_not_marked(self, *_):
        body = self.ask("It was founded by three people in 1865.", {
            "question": "Who founded it?", "content": "Three people founded it in 1865.", "context_title": "Notes", "skill": "explain"})
        self.assertNotIn(UNCHECKED_NOTE, body["answer"])


if __name__ == "__main__":
    unittest.main()
