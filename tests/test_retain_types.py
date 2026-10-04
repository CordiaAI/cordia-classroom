import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi import HTTPException
from routers import quiz
from services import retain

GUIDE_ID = "00000000-0000-0000-0000-000000000001"


def mc(question, answer, others=("Wrong one", "Wrong two", "Wrong three")):
    return {"question": question, "options": [answer, *others], "correct_index": 0}


TERMS = [mc(f"Term {n}?", word) for n, word in enumerate(["Mitosis", "Tort", "Iambic pentameter", "Equity", "Recursion"])]
SENTENCE = mc("What does a contract need?", "A contract needs an offer, acceptance and consideration to be valid.")
LONG = mc(
    "Why does inflation reduce purchasing power?",
    "Inflation raises the general price level. Each unit of money therefore buys fewer goods and services than before.",
)


class Query:
    def __init__(self, row):
        self.row, self.inserted, self.updated = row, None, None

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def update(self, payload):
        self.updated = payload
        return self

    def insert(self, payload):
        self.inserted = payload
        return self

    def execute(self):
        return SimpleNamespace(data=[self.row])


def database(questions):
    tables = {"study_guides": Query({"quiz_questions": questions}), "quiz_attempts": Query({}), "study_sessions": Query({})}
    db = MagicMock()
    db.table.side_effect = lambda name: tables[name]
    return db, tables


class AnswerShapeTests(unittest.TestCase):
    def test_terms_sentences_and_long_answers_across_subjects(self):
        self.assertEqual(retain.answer_shape("Define tort.", "A civil wrong"), "term")
        self.assertEqual(retain.answer_shape(SENTENCE["question"], retain.concept_answer(SENTENCE)), "sentence")
        self.assertEqual(retain.answer_shape(LONG["question"], retain.concept_answer(LONG)), "long")

    def test_one_sentence_is_never_written(self):
        one = "The poem uses iambic pentameter to imitate natural speech rhythm in English."
        self.assertEqual(retain.answer_shape("Explain the meter.", one), "long")  # "explain" + 12+ words
        self.assertEqual(retain.answer_shape("What meter is used?", one), "sentence")
        cards = retain.plan_session([mc("What meter is used?", one)], ["written"])
        self.assertEqual(cards, [{"type": "mc", "concepts": [0]}])


class SessionPlanTests(unittest.TestCase):
    def test_each_idea_gets_the_best_fitting_selected_type(self):
        cards = retain.plan_session([*TERMS, SENTENCE, LONG], ["mc", "written", "fill", "matching"])
        self.assertEqual(cards[0], {"type": "matching", "concepts": [0, 1, 2, 3, 4]})
        self.assertIn({"type": "mc", "concepts": [5]}, cards)
        self.assertIn({"type": "written", "concepts": [6]}, cards)
        asked = sorted(index for card in cards for index in card["concepts"])
        self.assertEqual(asked, list(range(7)))  # every idea asked exactly once

    def test_too_few_terms_for_matching_fall_back_to_fill_or_mc(self):
        self.assertEqual({c["type"] for c in retain.plan_session(TERMS[:3], ["matching", "fill"])}, {"fill"})
        self.assertEqual({c["type"] for c in retain.plan_session(TERMS[:3], ["matching"])}, {"mc"})

    def test_matching_sets_hold_four_to_six_with_distinct_answers(self):
        terms = [mc("Dup?", "answer 0")] + [mc(f"Q{n}?", f"Answer {n}") for n in range(9)]
        cards = retain.plan_session(terms, ["matching", "fill"])
        sets = [c for c in cards if c["type"] == "matching"]
        self.assertEqual([len(c["concepts"]) for c in sets], [6])
        self.assertIn({"type": "fill", "concepts": [1]}, cards)  # "Answer 0" repeats "answer 0" in the same set
        for group in sets:
            answers = [retain.normalize(retain.concept_answer(terms[i])) for i in group["concepts"]]
            self.assertEqual(len(answers), len(set(answers)))

    def test_no_selection_means_multiple_choice(self):
        self.assertEqual({c["type"] for c in retain.plan_session([*TERMS, LONG], [])}, {"mc"})


class FillInTheBlankTests(unittest.TestCase):
    def test_tolerates_case_articles_plurals_typos_and_listed_alternatives(self):
        self.assertTrue(retain.fill_matches("the MITOSIS", "Mitosis"))
        self.assertTrue(retain.fill_matches("mitochondrias", "Mitochondria"))
        self.assertTrue(retain.fill_matches("iambic pentametr", "Iambic pentameter"))
        self.assertTrue(retain.fill_matches("DNA", "Deoxyribonucleic acid (DNA)"))
        self.assertTrue(retain.fill_matches("tort", "Tort or civil wrong"))

    def test_rejects_different_terms_and_wrong_numbers(self):
        self.assertFalse(retain.fill_matches("meiosis", "Mitosis"))
        self.assertFalse(retain.fill_matches("1865", "1863"))
        self.assertFalse(retain.fill_matches("", "Equity"))


class SignedGradeTests(unittest.TestCase):
    def test_only_an_unaltered_grade_counts(self):
        with patch.dict(os.environ, {"RETAIN_SIGNING_KEY": "k"}):
            token = retain.sign_grade("u1", GUIDE_ID, 2, 0.5)
            self.assertEqual(retain.verified_credit("u1", GUIDE_ID, 2, 0.5, token), 0.5)
            self.assertEqual(retain.verified_credit("u1", GUIDE_ID, 2, 1.0, token), 0.0)
            self.assertEqual(retain.verified_credit("u2", GUIDE_ID, 2, 0.5, token), 0.0)
            self.assertEqual(retain.verified_credit("u1", GUIDE_ID, 3, 0.5, token), 0.0)


class RetainRouteTests(unittest.TestCase):
    def test_submit_rechecks_first_tries_and_scores_partial_credit(self):
        questions = [TERMS[0], TERMS[1], SENTENCE, LONG]
        db, tables = database(questions)
        with patch.dict(os.environ, {"RETAIN_SIGNING_KEY": "k"}), \
             patch.object(quiz, "get_user_id", return_value="u1"), \
             patch.object(quiz, "get_supabase", return_value=db), \
             patch("routers.stats._update_streak"):
            token = retain.sign_grade("u1", GUIDE_ID, 3, 0.5)
            result = quiz.submit_quiz(GUIDE_ID, quiz.QuizSubmission(attempts=[
                {"concept": 0, "type": "fill", "response": "mitosis"},
                {"concept": 1, "type": "matching", "response": "Mitosis"},  # wrong match
                {"concept": 2, "type": "mc", "response": "Wrong one", "credit": 1, "token": "forged"},
                {"concept": 3, "type": "written", "response": "Prices rise", "credit": 0.5, "token": token},
                {"concept": 0, "type": "mc", "response": "Wrong one"},  # a later retry never changes the first try
            ]), "Bearer t")
        self.assertEqual(result, {"score": 38, "total": 4, "correct": 1, "earned": 1.5})
        stored = tables["quiz_attempts"].inserted["answers"]
        self.assertEqual([a["credit"] for a in stored], [1.0, 0.0, 0.0, 0.5])
        self.assertEqual([a["is_correct"] for a in stored], [True, False, False, False])

    def test_forged_written_credit_is_worth_nothing(self):
        db, tables = database([LONG])
        with patch.object(quiz, "get_user_id", return_value="u1"), \
             patch.object(quiz, "get_supabase", return_value=db), \
             patch("routers.stats._update_streak"):
            result = quiz.submit_quiz(GUIDE_ID, quiz.QuizSubmission(attempts=[
                {"concept": 0, "type": "written", "response": "x", "credit": 1, "token": "0" * 64},
            ]), "Bearer t")
        self.assertEqual(result["score"], 0)

    def test_pro_types_are_charged_once_per_session_and_only_when_used(self):
        db, _ = database(TERMS)
        common = dict(get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                      _quiz_for_guide=MagicMock(return_value={"questions": TERMS}),
                      plan_for=MagicMock(return_value="free"), subscription_row=MagicMock(return_value=None))
        require, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, **common, require=require, record=record):
            session = quiz.start_session(GUIDE_ID, quiz.SessionRequest(types=["mc", "matching"]), "Bearer t")
        require.assert_called_once_with("u1", "retain_types")
        record.assert_called_once_with("u1", "retain_types")
        self.assertEqual(session["types"], ["matching"])
        self.assertEqual(session["pro"], False)

        require, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, **common, require=require, record=record):
            quiz.start_session(GUIDE_ID, quiz.SessionRequest(types=["mc", "written"]), "Bearer t")
        require.assert_not_called()
        record.assert_not_called()

    def test_out_of_pro_sessions_opens_the_upgrade(self):
        db, _ = database(TERMS)
        limit = HTTPException(status_code=402, detail={"code": "limit_reached"})
        record = MagicMock()
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                            _quiz_for_guide=MagicMock(return_value={"questions": TERMS}),
                            require=MagicMock(side_effect=limit), record=record):
            with self.assertRaises(HTTPException) as raised:
                quiz.start_session(GUIDE_ID, quiz.SessionRequest(types=["fill"]), "Bearer t")
        record.assert_not_called()
        self.assertEqual(raised.exception.status_code, 402)

    def test_written_grade_is_signed_and_counts_one_reading_action(self):
        db, _ = database([LONG])
        require, record = MagicMock(), MagicMock()
        with patch.dict(os.environ, {"RETAIN_SIGNING_KEY": "k"}), \
             patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                            require=require, record=record,
                            grade_written_answer=MagicMock(return_value={"credit": 0.5, "explanation": "Close."})):
            result = quiz.grade_written(GUIDE_ID, quiz.WrittenAnswer(concept=0, answer="Prices go up"), "Bearer t")
            require.assert_called_once_with("u1", "light")
            record.assert_called_once_with("u1", "light")
            self.assertEqual(retain.verified_credit("u1", GUIDE_ID, 0, 0.5, result["token"]), 0.5)
        self.assertEqual(result["answer"], retain.concept_answer(LONG))

    def test_failed_marking_is_not_charged(self):
        db, _ = database([LONG])
        record = MagicMock()
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                            require=MagicMock(), record=record,
                            grade_written_answer=MagicMock(return_value={})):
            with self.assertRaises(HTTPException):
                quiz.grade_written(GUIDE_ID, quiz.WrittenAnswer(concept=0, answer="x"), "Bearer t")
        record.assert_not_called()


if __name__ == "__main__":
    unittest.main()
