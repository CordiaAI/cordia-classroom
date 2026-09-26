import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.llm import validate_practice_set


class PracticeContractTests(unittest.TestCase):
    source = "Ohm's law states that voltage equals current multiplied by resistance. A stack uses last-in, first-out order."

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
        result = validate_practice_set({"subject_area": "Electrical engineering", "problems": [self.problem()]}, self.source)
        problem = result["problems"][0]
        self.assertEqual(problem["verification"]["status"], "verified")
        self.assertEqual(problem["expected_value"], 12.0)

    def test_incorrect_numeric_key_is_rejected(self):
        problem = self.problem(calculation={"expression": "3*4", "expected_value": 14, "tolerance": 0.001})
        result = validate_practice_set({"problems": [problem]}, self.source)
        self.assertEqual(result["problems"], [])

    def test_unsupported_source_basis_is_rejected(self):
        result = validate_practice_set({"problems": [self.problem(source_basis="Kirchhoff's current law")]}, self.source)
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
        result = validate_practice_set({"problems": [problem]}, self.source)
        self.assertEqual(result["problems"][0]["verification"]["status"], "review_required")


if __name__ == "__main__":
    unittest.main()
