import os
import sys
import unittest
from unittest.mock import patch

import httpx
import openai
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

import main  # noqa: E402
from routers import smart_notes  # noqa: E402

REQUEST = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


class OpenAiErrorTests(unittest.TestCase):
    """A failed AI call reaches the student as a clear error, never as an empty or fake result."""

    def post_diagram(self, error):
        with patch.object(smart_notes, "get_user_id", return_value="user-1"), \
             patch.object(smart_notes, "require"), \
             patch.object(smart_notes, "get_openai_client"), \
             patch.object(smart_notes, "chat", side_effect=error):
            return TestClient(main.app).post(
                "/smart_notes/diagram", json={"content": "Mitosis has four phases."},
                headers={"Authorization": "Bearer test"},
            )

    def test_rate_limit_is_a_retryable_503(self):
        error = openai.RateLimitError("busy", response=httpx.Response(429, request=REQUEST), body=None)
        response = self.post_diagram(error)
        self.assertEqual(response.status_code, 503)
        self.assertIn("busy", response.json()["detail"])
        self.assertRegex(response.headers["X-Request-ID"], r"^[0-9a-f]{12}$")

    def test_other_failures_are_a_502(self):
        response = self.post_diagram(openai.APIConnectionError(request=REQUEST))
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Cordia's AI service had a problem. Please try again.")


if __name__ == "__main__":
    unittest.main()
