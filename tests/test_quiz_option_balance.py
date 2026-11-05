import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz


class OptionBalanceTests(unittest.TestCase):
    def test_correct_answer_is_not_the_only_long_option(self):
        answer = "The number of direct reports a manager supervises"
        chosen = ["Span", "Command", "Hierarchy"]
        pool = chosen + ["The number of departments reporting to one executive", "Short"]
        out = quiz._not_longest(answer, chosen, pool)
        self.assertTrue(any(len(value) >= 0.9 * len(answer) for value in out))
        self.assertEqual(len(out), 3)
        self.assertNotIn(answer, out)

    def test_unchanged_when_balanced_or_no_longer_option(self):
        answer = "Photosynthesis"
        balanced = ["Respiration", "Fermentation", "Transpiration"]
        self.assertEqual(quiz._not_longest(answer, balanced, balanced), balanced)
        self.assertEqual(quiz._not_longest("A long correct answer here", ["a", "b"], ["a", "b", "c"]), ["a", "b"])

    def test_balanced_distractors_applies_rule(self):
        answer = "Cells convert light energy into chemical energy stored in glucose"
        out = quiz._balanced_distractors(answer, ["Light", "Heat", "Water"], ["Plants turn heat energy into stored mechanical energy in starch"])
        self.assertTrue(any(len(value) >= 0.9 * len(answer) for value in out))



class ChoiceEndingTests(unittest.TestCase):
    """The correct answer is the guide's sentence ("... the mitochondria."), wrong choices are written
    without a period: shown choices must end the same way so the period doesn't give it away."""

    CASES = [
        ("ATP is made in the mitochondria.", "ATP is made in the mitochondria"),
        ("Mitochondria", "Mitochondria"),
        ("It rose 5.5", "It rose 5.5"),
        ("Cells, tissues, organs, etc.", "Cells, tissues, organs, etc."),
        ("Founded in the U.S.", "Founded in the U.S."),
        ("It trails off...", "It trails off..."),
        ("Brown v. Board", "Brown v. Board"),
        ("Why?", "Why?"),
        ("  Spaced.  ", "Spaced"),
    ]

    def test_choice_text(self):
        for raw, shown in self.CASES:
            self.assertEqual(quiz.choice_text(raw), shown, raw)
            self.assertEqual(quiz.choice_text(shown), shown, "running it twice changes nothing")

    def test_new_quizzes_end_every_choice_alike_and_keep_the_right_index(self):
        for _ in range(20):
            options, index = quiz._choices("ATP is made in the mitochondria.",
                                           ["ATP is made in the nucleus", "ATP is made in the ribosome", "ATP is made in the mitochondria"])
            self.assertEqual(options[index], "ATP is made in the mitochondria")
            self.assertFalse(any(option.endswith(".") for option in options))
            self.assertEqual(len(options), 3, "a distractor equal to the answer without its period is dropped")

    def test_saved_quizzes_are_evened_when_read(self):
        saved = {"question": "Where is ATP made?", "options": ["In the nucleus", "In the mitochondria.", "In the ribosome"], "correct_index": 1}
        self.assertEqual(quiz.even_choices(saved)["options"], ["In the nucleus", "In the mitochondria", "In the ribosome"])
        self.assertEqual(quiz.even_choices(saved)["correct_index"], 1)


if __name__ == "__main__":
    unittest.main()
