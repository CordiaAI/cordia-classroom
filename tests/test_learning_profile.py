import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers.stats import _build_learning_profile
from services.llm import answer_question


class LearningProfileTests(unittest.TestCase):
    def test_profile_is_balanced_without_results(self):
        profile = _build_learning_profile([])
        self.assertEqual(profile["evidence_count"], 0)
        self.assertIn("balanced", profile["generation_guidance"])

    def test_one_result_is_enough_to_adapt(self):
        self.assertIn("foundational", _build_learning_profile([55])["generation_guidance"])
        self.assertIn("application", _build_learning_profile([92])["generation_guidance"])

    def test_tutor_prompt_uses_observed_learning_guidance(self):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [
            MagicMock(message=MagicMock(content="Cell division creates new cells."))
        ]
        with patch("services.llm.get_openai_client", return_value=client):
            answer_question(
                "What is cell division?",
                "Cell division creates new cells.",
                learning_guidance="Start with foundational recall.",
            )
        messages = client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("Start with foundational recall.", messages[0]["content"])


if __name__ == "__main__":
    unittest.main()
