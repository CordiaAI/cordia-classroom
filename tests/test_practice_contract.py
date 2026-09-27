import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.llm import validate_practice_set


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
        problem = self.problem(calculation={"expression": "3*4", "expected_value": 14, "tolerance": 0.001})
        result = validate_practice_set({"problems": [problem]})
        self.assertEqual(result["problems"][0]["verification"]["status"], "reference")
        self.assertIsNone(result["problems"][0]["expected_value"])

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


if __name__ == "__main__":
    unittest.main()
