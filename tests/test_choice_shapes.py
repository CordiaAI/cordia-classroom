"""Multiple-choice options look like the answer: dates get dates in the same style, amounts get
amounts with the same unit, short phrases around a value keep their words (services/choice_shapes.py,
routers/quiz.py)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz  # noqa: E402
from services.choice_shapes import coerce, conform, is_value, repair, same_shape, shape, synthesize  # noqa: E402


class ShapeTests(unittest.TestCase):
    def test_kinds(self):
        cases = {
            "1863": "year", "c. 1450": "year", "1960s": "year", "44 BCE": "year",
            "July 4, 1776": "date", "4 July 1776": "date", "Jul. 1776": "date", "March 3rd": "date",
            "2024-05-01": "date", "07/04/1776": "date",
            "45%": "number", "$3.2 million": "number", "0.5 mg/kg": "number", "1,200 people": "number",
            "In 1863": "templated", "Signed in July 1776": "templated",
            "Mitochondria": "short", "The number of direct reports a manager supervises": "sentence",
        }
        for text, kind in cases.items():
            self.assertEqual(shape(text).kind, kind, text)

    def test_same_shape_compares_the_written_style(self):
        self.assertTrue(same_shape("July 4, 1776", "June 21, 1788"))
        self.assertFalse(same_shape("July 4, 1776", "1776"))
        self.assertFalse(same_shape("July 4, 1776", "4 July 1776"))
        self.assertTrue(same_shape("$3.2 million", "$12.5 million"))
        self.assertFalse(same_shape("45%", "45 mg"))
        self.assertFalse(same_shape("3.14", "3"), "the same number of decimal places")
        self.assertTrue(same_shape("c. 1450", "c. 1500"))
        self.assertFalse(same_shape("1863", "c. 1863"))

    def test_made_up_values_keep_the_exact_format(self):
        for answer in ["1863", "c. 1450", "1960s", "44 BCE", "July 4, 1776", "4 July 1776", "Jul. 1776", "March 3rd",
                       "2024-05-01", "07/04/1776", "45%", "$3.2 million", "0.5 mg/kg", "1,200 people", "3.14",
                       "In 1863", "About 45%", "Signed in July 1776"]:
            made = synthesize(answer, 3, seed="When?")
            self.assertEqual(len(made), 3, answer)
            self.assertEqual(len({m.casefold() for m in made}), 3, answer)
            for value in made:
                self.assertTrue(same_shape(answer, value), f"{answer} -> {value}")
                self.assertNotEqual(value.casefold(), answer.casefold())

    def test_made_up_values_are_stable_and_sensible(self):
        self.assertEqual(synthesize("1863", 3, "q"), synthesize("1863", 3, "q"))
        for value in synthesize("45%", 3, "q"):
            self.assertLessEqual(float(value[:-1]), 100)
        for value in synthesize("1990", 5, "q"):
            self.assertLessEqual(int(value), 2100)
        self.assertEqual(synthesize("Mitochondria", 3, "q"), [], "plain text is never made up")

    def test_coerce_rewrites_near_misses(self):
        self.assertEqual(coerce("1863", "In 1861"), "1861")
        self.assertEqual(coerce("In 1863", "1861"), "In 1861")
        self.assertEqual(coerce("July 4, 1776", "On July 2, 1776"), "July 2, 1776")
        self.assertIsNone(coerce("July 4, 1776", "1776"))
        self.assertIsNone(coerce("1863", "ATP"))


class QuizOptionTests(unittest.TestCase):
    PAIRS = [
        {"question": "When was the society founded?", "answer": "1863"},
        {"question": "What makes ATP?", "answer": "The mitochondria in each cell"},
        {"question": "What carries oxygen?", "answer": "Hemoglobin"},
        {"question": "Who wrote the charter?", "answer": "Henry Dunant"},
        {"question": "What share of members voted?", "answer": "45%"},
        {"question": "When was the treaty signed?", "answer": "August 22, 1864"},
    ]

    def test_free_quiz_gives_dates_dates_and_amounts_amounts(self):
        for _ in range(10):
            questions = {q["question"]: q for q in quiz._standard_questions(self.PAIRS)}
            for question, answer in [("When was the society founded?", "1863"), ("What share of members voted?", "45%"),
                                     ("When was the treaty signed?", "August 22, 1864")]:
                q = questions[question]
                self.assertEqual(q["options"][q["correct_index"]], answer)
                self.assertEqual(len(q["options"]), 4)
                for option in q["options"]:
                    self.assertTrue(same_shape(answer, option), f"{question}: {option}")

    def test_free_quiz_prefers_text_of_the_same_kind(self):
        for _ in range(10):
            q = next(q for q in quiz._standard_questions(self.PAIRS) if q["question"] == "What carries oxygen?")
            wrong = [o for i, o in enumerate(q["options"]) if i != q["correct_index"]]
            self.assertGreaterEqual(len(wrong), 1)
            self.assertFalse(any(is_value(option) for option in wrong), "a term never gets a date or amount as a choice")
            # Another question's full answer is a true statement, never a wrong choice (distractor_check).
            self.assertNotIn("The mitochondria in each cell", wrong)

    def test_ai_choices_off_format_are_rewritten_or_replaced(self):
        out = quiz._balanced_distractors("1863", ["In 1861", "the late 1800s", "1870"], ["Hemoglobin", "45%"], seed="When?")
        self.assertEqual(len(out), 3)
        self.assertIn("1861", out)
        self.assertIn("1870", out)
        self.assertTrue(all(same_shape("1863", value) for value in out), out)

    def test_ai_text_answers_still_get_three_choices(self):
        out = quiz._balanced_distractors("Hemoglobin", ["Myoglobin"], ["The mitochondria in each cell", "Insulin", "1863", "Glucagon"], seed="q")
        self.assertEqual(out[:1], ["Myoglobin"])
        self.assertNotIn("1863", out)
        self.assertEqual(len(out), 3)

    def test_saved_quizzes_are_repaired_without_moving_the_answer(self):
        saved = {"question": "When was the society founded?", "options": ["ATP", "1863", "A protein that carries oxygen", "1870"], "correct_index": 1}
        fixed = quiz.even_choices(saved)
        self.assertEqual(fixed["correct_index"], 1)
        self.assertEqual(fixed["options"][1], "1863")
        self.assertEqual(fixed["options"][3], "1870", "matching choices stay")
        self.assertTrue(all(same_shape("1863", option) for option in fixed["options"]), fixed["options"])
        self.assertEqual(quiz.even_choices(saved), fixed, "the same repair every time")

    def test_repair_leaves_text_questions_alone(self):
        options = ["Hemoglobin", "Insulin", "Myoglobin"]
        self.assertEqual(repair("What carries oxygen?", options, 0), options)
        self.assertEqual(repair("x", options, 9), options)

    def test_conform_never_returns_the_answer(self):
        self.assertNotIn("1863", conform("1863", ["1863", "1863."], ["1863"], seed="q"))


if __name__ == "__main__":
    unittest.main()
