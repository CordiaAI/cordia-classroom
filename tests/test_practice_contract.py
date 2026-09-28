import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from unittest.mock import MagicMock, patch

import services.llm as llm
from services.llm import _loads_model_json, validate_practice_set


class PracticeContractTests(unittest.TestCase):

    def problem(self, **updates):
        item = {
            "prompt": "A 3 amp current crosses a 4 ohm resistor. Find voltage.",
            "answer": "12 volts",
            "worked_solution": "Use V = I × R, so V = 3 × 4 = 12 volts.",
            "source_basis": "voltage equals current multiplied by resistance",
            "practice_type": "word_problem",
            "answer_format": "A number with units",
            "verification_method": "calculation",
            "calculation": {"expression": "3*4", "expected_value": 12, "tolerance": 0.001},
            "starter_code": None,
            "test_cases": [],
        }
        item.update(updates)
        return item

    def test_numeric_answer_is_verified_by_local_calculation(self):
        result = validate_practice_set({"subject_area": "Electrical engineering", "problems": [self.problem()]})
        problem = result["problems"][0]
        self.assertEqual(problem["verification"]["status"], "verified")
        self.assertEqual(problem["expected_value"], 12.0)

    def test_mismatched_numeric_key_is_kept_but_not_auto_graded(self):
        problem = self.problem(
            answer="14 volts",
            worked_solution="Use V = I × R, so V = 14 volts.",
            calculation={"expression": "3*4", "expected_value": 14, "tolerance": 0.001},
        )
        result = validate_practice_set({"problems": [problem]})
        self.assertEqual(result["problems"][0]["verification"]["status"], "reference")
        self.assertIsNone(result["problems"][0]["expected_value"])

    def test_mistyped_answer_is_corrected_to_the_recomputed_value(self):
        # Reported case: key said 54 while the expression and worked solution gave 45.
        problem = self.problem(
            prompt="Speed is 4t^2 + 2t m/s. Find the distance traveled from t = 0 to t = 3.",
            answer="54",
            worked_solution="Integrate: [4/3 t^3 + t^2] from 0 to 3 = 36 + 9 = 45.",
            calculation={"expression": "4/3*27 + 9", "expected_value": 54, "tolerance": 0.001},
        )
        result = validate_practice_set({"problems": [problem]})["problems"][0]
        self.assertEqual(result["answer"], "45")
        self.assertEqual(result["expected_value"], 45.0)
        self.assertEqual(result["verification"]["status"], "verified")

    def test_answer_units_are_kept_when_the_number_is_corrected(self):
        problem = self.problem(answer="21 volts")
        self.assertEqual(validate_practice_set({"problems": [problem]})["problems"][0]["answer"], "12 volts")

    def test_source_basis_is_not_required_to_match_material_verbatim(self):
        result = validate_practice_set({"problems": [self.problem(source_basis="Ohm's law applied to a resistor")]})
        self.assertEqual(len(result["problems"]), 1)

    def test_incomplete_problem_is_dropped(self):
        result = validate_practice_set({"problems": [self.problem(worked_solution="")]})
        self.assertEqual(result["problems"], [])

    def test_code_is_test_guided_not_falsely_marked_verified(self):
        problem = self.problem(
            prompt="Implement a stack pop operation.",
            answer="Return and remove the last item.",
            worked_solution="The last appended item is removed first.",
            source_basis="A stack uses last-in, first-out order",
            practice_type="code",
            verification_method="code_review",
            calculation=None,
            starter_code="def pop(items):\n    pass",
            test_cases=["pop([1, 2]) == 2"],
        )
        result = validate_practice_set({"problems": [problem]})
        self.assertEqual(result["problems"][0]["verification"]["status"], "review_required")


class ModelJsonTests(unittest.TestCase):
    def test_unescaped_latex_backslashes_parse(self):
        raw = r'[{"stem": "Given \( a \) and \\( b \\)\n", "q": "\"x\""}]'
        self.assertEqual(_loads_model_json(raw)[0]["stem"], "Given \\( a \\) and \\( b \\)\n")
        self.assertEqual(_loads_model_json(raw)[0]["q"], '"x"')

class PracticeGradingTests(unittest.TestCase):
    def grade(self, reply):
        client = MagicMock()
        client.chat.completions.create.return_value.choices[0].message.content = reply
        with patch.object(llm, "get_openai_client", return_value=client):
            return llm.grade_practice_answer("Declare an int array nums of size 5.", "int nums[5];", "", "int nums[4];")

    def test_wrong_answer_returns_explanation(self):
        result = self.grade('{"correct": false, "explanation": "The size must be 5, not 4."}')
        self.assertEqual(result, {"correct": False, "explanation": "The size must be 5, not 4."})

    def test_unusable_grade_returns_empty(self):
        self.assertEqual(self.grade('{"correct": "maybe"}'), {})

if __name__ == "__main__":
    unittest.main()
