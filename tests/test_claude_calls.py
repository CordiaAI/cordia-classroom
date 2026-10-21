"""The backend's one chat wrapper speaks to Claude when ANTHROPIC_API_KEY is set."""
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


class ClaudeCallTests(unittest.TestCase):
    def test_openai_messages_become_a_messages_api_request(self):
        from services.llm_calls import claude_request
        system, turns = claude_request([
            {"role": "system", "content": "Be exact."},
            {"role": "assistant", "content": "Earlier answer."},
            {"role": "user", "content": [
                {"type": "text", "text": "Read this page."},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD", "detail": "high"}},
            ]},
        ], json_mode=True)
        self.assertTrue(system.startswith("Be exact."))
        self.assertIn("only the JSON object", system)
        self.assertEqual(turns[0]["role"], "user", "a conversation can't open with the assistant")
        self.assertEqual(turns[1], {"role": "assistant", "content": [{"type": "text", "text": "Earlier answer."}]})
        self.assertEqual(turns[2]["content"][1], {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"}})

    def test_chat_returns_the_openai_shape_and_drops_sampling(self):
        from services import llm_calls, models
        final = SimpleNamespace(
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text='```json\n{"a": 1}\n```')],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=40, output_tokens=7, cache_read_input_tokens=10),
        )
        stream = MagicMock()
        stream.__enter__.return_value.get_final_message.return_value = final
        client = MagicMock()
        client.beta.messages.stream.return_value = stream
        with patch.object(models, "ANTHROPIC", True), patch.object(llm_calls, "log_usage"):
            response = llm_calls.chat(client, "study_guide", model="claude-opus-5-5",
                                      messages=[{"role": "user", "content": "Make a guide."}],
                                      temperature=0.2, response_format={"type": "json_object"})
        sent = client.beta.messages.stream.call_args.kwargs
        self.assertNotIn("temperature", sent)
        self.assertEqual(sent["output_config"], {"effort": "high"}, "guides get high effort")
        self.assertEqual(sent["fallbacks"], "default")
        self.assertGreater(sent["max_tokens"], models.FEATURES["study_guide"].max_tokens)
        self.assertEqual(response.choices[0].message.content, '{"a": 1}')
        self.assertEqual(response.choices[0].finish_reason, "stop")
        self.assertEqual(response.usage.prompt_tokens, 50)

    def test_a_refusal_comes_back_empty(self):
        from services import llm_calls, models
        final = SimpleNamespace(content=[], stop_reason="refusal", usage=SimpleNamespace(input_tokens=1, output_tokens=0, cache_read_input_tokens=0))
        stream = MagicMock()
        stream.__enter__.return_value.get_final_message.return_value = final
        client = MagicMock()
        client.beta.messages.stream.return_value = stream
        with patch.object(models, "ANTHROPIC", True), patch.object(llm_calls, "log_usage"):
            response = llm_calls.chat(client, "tutor_short", model="claude-opus-5-5", messages=[{"role": "user", "content": "x"}])
        self.assertEqual(response.choices[0].message.content, "")
        self.assertEqual(response.choices[0].finish_reason, "content_filter")


if __name__ == "__main__":
    unittest.main()
