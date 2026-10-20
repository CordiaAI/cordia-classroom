"""The backend's AI provider: Groq when GROQ_API_KEY is set, OpenAI otherwise."""
import importlib
import os
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from services import llm, llm_calls, models  # noqa: E402

MODEL_VARS = ("GROQ_API_KEY", "CLASSROOM_BUILD_MODEL", "CLASSROOM_LIGHT_MODEL", "CLASSROOM_VISION_MODEL")


def load(**env):
    clean = {k: v for k, v in os.environ.items() if k not in MODEL_VARS}
    with patch.dict(os.environ, {**clean, **env}, clear=True):
        importlib.reload(models)
        importlib.reload(llm)
    return models


class ProviderTests(unittest.TestCase):
    def tearDown(self):
        load()

    def test_openai_by_default(self):
        m = load(OPENAI_API_KEY="sk")
        self.assertFalse(m.GROQ)
        self.assertEqual((m.BUILD_MODEL, m.LIGHT_MODEL, m.VISION_MODEL), ("gpt-4o", "gpt-4o-mini", "gpt-4o"))

    def test_groq_models_and_overrides(self):
        m = load(GROQ_API_KEY="gk")
        self.assertTrue(m.GROQ)
        self.assertEqual((m.BUILD_MODEL, m.LIGHT_MODEL, m.VISION_MODEL), ("openai/gpt-oss-120b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"))
        self.assertEqual(load(GROQ_API_KEY="gk", CLASSROOM_LIGHT_MODEL="openai/gpt-oss-20b").LIGHT_MODEL, "openai/gpt-oss-20b")

    def test_groq_client_uses_groq_endpoint(self):
        load(GROQ_API_KEY="gk")
        with patch.dict(os.environ, {"GROQ_API_KEY": "gk"}), patch.object(llm, "OpenAI") as client:
            llm.get_openai_client()
        client.assert_called_once_with(api_key="gk", base_url="https://api.groq.com/openai/v1")

    def test_reasoning_is_short_hidden_and_has_headroom(self):
        load(GROQ_API_KEY="gk")
        client = MagicMock()
        llm_calls.chat(client, "tutor_short", messages=[])
        sent = client.chat.completions.create.call_args.kwargs
        self.assertEqual(sent["model"], "openai/gpt-oss-120b")
        self.assertEqual(sent["extra_body"], {"reasoning_effort": "low"})
        self.assertEqual(sent["max_tokens"], models.FEATURES["tutor_short"].max_tokens + llm_calls.REASONING_HEADROOM)
        llm_calls.chat(client, "handwriting", messages=[])
        self.assertEqual(client.chat.completions.create.call_args.kwargs["extra_body"], {"reasoning_format": "hidden"})

    def test_openai_calls_are_unchanged(self):
        load(OPENAI_API_KEY="sk")
        client = MagicMock()
        llm_calls.chat(client, "tutor_short", messages=[])
        sent = client.chat.completions.create.call_args.kwargs
        self.assertNotIn("extra_body", sent)
        self.assertEqual(sent["max_tokens"], models.FEATURES["tutor_short"].max_tokens)


if __name__ == "__main__":
    unittest.main()
