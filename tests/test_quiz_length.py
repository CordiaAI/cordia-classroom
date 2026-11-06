"""Quiz length: the student picks how many questions; the server picks which at random and shuffles
the order (services/retain.py pick_questions / shuffled_cards, routers/quiz.py start_session)."""
import os
import random
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from pydantic import ValidationError  # noqa: E402

from routers import quiz  # noqa: E402
from services import retain  # noqa: E402

GUIDE = "00000000-0000-0000-0000-000000000001"


def mc(question, answer):
    return {"question": question, "options": [answer, "Wrong one", "Wrong two", "Wrong three"], "correct_index": 0}


QUESTIONS = [mc(f"Question {n}?", f"A full sentence answer number {n} for this idea") for n in range(20)]


class PickTests(unittest.TestCase):
    def test_all_questions_without_a_count(self):
        self.assertEqual(retain.pick_questions(QUESTIONS), list(range(20)))
        self.assertEqual(retain.pick_questions(QUESTIONS, 50), list(range(20)), "a count over the guide's size asks them all")

    def test_count_picks_that_many_at_random(self):
        picks = {tuple(retain.pick_questions(QUESTIONS, 5, random.Random(seed))) for seed in range(10)}
        self.assertTrue(all(len(pick) == 5 and len(set(pick)) == 5 for pick in picks))
        self.assertGreater(len(picks), 1, "different quizzes pick different questions")

    def test_questions_without_an_answer_are_never_picked(self):
        broken = QUESTIONS[:3] + [{"question": "No answer?", "options": [], "correct_index": 0}]
        self.assertEqual(retain.pick_questions(broken), [0, 1, 2])

    def test_order_is_shuffled_and_nothing_is_lost(self):
        cards = retain.plan_session(QUESTIONS, ["mc"])
        orders = {tuple(card["concepts"][0] for card in retain.shuffled_cards(cards, random.Random(seed))) for seed in range(10)}
        self.assertGreater(len(orders), 1)
        self.assertTrue(all(sorted(order) == list(range(20)) for order in orders))

    def test_plan_only_the_picked_questions(self):
        cards = retain.plan_session(QUESTIONS, ["mc"], [2, 7, 11])
        self.assertEqual(sorted(card["concepts"][0] for card in cards), [2, 7, 11])


class SessionTests(unittest.TestCase):
    def start(self, **body):
        require, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(),
                            _load_quiz=MagicMock(return_value=(QUESTIONS, True)), require=require, record=record,
                            plan_for=MagicMock(return_value="free"), subscription_row=MagicMock(return_value=None)):
            return quiz.start_session(GUIDE, quiz.SessionRequest(**body), "Bearer t")

    def test_session_asks_the_chosen_number(self):
        session = self.start(types=["mc"], count=8)
        concepts = [index for card in session["cards"] for index in card["concepts"]]
        self.assertEqual(len(concepts), 8)
        self.assertEqual(len(session["questions"]), 20, "questions keep their indexes for checking answers")

    def test_no_count_asks_everything(self):
        session = self.start(types=["mc"])
        self.assertEqual(len(session["cards"]), 20)

    def test_limit(self):
        with self.assertRaises(ValidationError):
            quiz.SessionRequest(types=["mc"], count=0)
        with self.assertRaises(ValidationError):
            quiz.SessionRequest(types=["mc"], count=retain.MAX_QUIZ_QUESTIONS + 1)


if __name__ == "__main__":
    unittest.main()
