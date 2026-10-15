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


if __name__ == "__main__":
    unittest.main()
