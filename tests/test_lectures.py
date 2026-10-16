import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from routers import lectures  # noqa: E402
from services.text_processing import clean_spoken_text, merge_overlap, transcript_text  # noqa: E402

AUTH = {"Authorization": "Bearer test"}


class FakeClient:
    """Stands in for the OpenAI client: one canned transcription and one canned chat reply."""

    def __init__(self, transcript="", chat_content="{}"):
        self.calls = []
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self._transcribe))
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._chat))
        self.transcript = transcript
        self.chat_content = chat_content

    def _transcribe(self, **kwargs):
        self.calls.append(("transcribe", kwargs))
        return SimpleNamespace(text=self.transcript)

    def _chat(self, **kwargs):
        self.calls.append(("chat", kwargs))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.chat_content))], usage=None)


class TranscriptTextTests(unittest.TestCase):
    def test_overlap_words_are_removed_once(self):
        self.assertEqual(merge_overlap("the powerhouse of the cell", "of the cell. Next we look at ribosomes"), "Next we look at ribosomes")
        self.assertEqual(merge_overlap("hello world", "a new sentence"), "a new sentence")
        self.assertEqual(merge_overlap("", "first chunk"), "first chunk")

    def test_fillers_and_doubled_words_go_but_content_stays(self):
        self.assertEqual(clean_spoken_text("So um the the enzyme, uh, binds. Umbrella stays."), "So the enzyme binds. Umbrella stays.")

    def test_segments_join_in_time_order(self):
        self.assertEqual(transcript_text([{"start_ms": 20000, "text": "second"}, {"start_ms": 0, "text": "first"}]), "first second")


class LectureRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        patches = [
            mock.patch.object(lectures, "get_user_id", return_value="user-1"),
            mock.patch.object(lectures.entitlements, "require", return_value=None),
            mock.patch.object(lectures.entitlements, "record", return_value=None),
        ]
        self.mocks = [p.start() for p in patches]
        self.addCleanup(mock.patch.stopall)

    def post_chunk(self, fake, **form):
        data = {"recording_id": "rec_12345678", "seq": "1", "start_ms": "18000", "duration_ms": "20000", "previous_tail": "the powerhouse of the cell", "terms": "mitochondria, ATP"}
        data.update(form)
        with mock.patch.object(lectures, "get_openai_client", return_value=fake):
            return self.client.post("/lectures/chunk", headers=AUTH, data=data, files={"audio": ("chunk.webm", b"\x1a\x45\xdf\xa3audio", "audio/webm;codecs=opus")})

    def test_chunk_returns_new_words_and_sends_context_prompt(self):
        fake = FakeClient(transcript="of the cell. Um, next is ATP synthase.")
        response = self.post_chunk(fake)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "next is ATP synthase.")
        kind, kwargs = fake.calls[0]
        self.assertEqual(kwargs["model"], "gpt-4o-mini-transcribe")
        self.assertIn("mitochondria, ATP", kwargs["prompt"])
        self.assertIn("the powerhouse of the cell", kwargs["prompt"])

    def test_minutes_are_charged_once_per_minute_per_recording(self):
        self.post_chunk(FakeClient(transcript="words"), start_ms="50000")
        keys = [call.kwargs["request_key"] for call in self.mocks[2].call_args_list]
        self.assertEqual(keys, ["rec_12345678:0", "rec_12345678:1"])  # 50 s to 70 s touches minutes 0 and 1

    def test_unknown_audio_type_is_refused(self):
        with mock.patch.object(lectures, "get_openai_client", return_value=FakeClient()):
            response = self.client.post("/lectures/chunk", headers=AUTH, data={"recording_id": "rec_12345678", "seq": "0", "start_ms": "0", "duration_ms": "20000"}, files={"audio": ("x.txt", b"abc", "text/plain")})
        self.assertEqual(response.status_code, 415)

    def test_bad_recording_id_is_refused(self):
        response = self.post_chunk(FakeClient(), recording_id="../../etc")
        self.assertEqual(response.status_code, 400)

    def test_transcription_errors_are_short_and_never_raw(self):
        fake = FakeClient()
        fake.audio.transcriptions.create = mock.Mock(side_effect=RuntimeError("upstream secret detail"))
        response = self.post_chunk(fake)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("secret", response.text)

    def test_limit_reached_stops_before_any_ai_call(self):
        self.mocks[1].side_effect = lectures.entitlements.LimitReached("lecture_minute", 120, 120, "free")
        fake = FakeClient(transcript="x")
        response = self.post_chunk(fake)
        self.assertEqual(response.status_code, 402)
        self.assertEqual(fake.calls, [])

    def test_notes_snap_to_real_segments_and_validate_class(self):
        content = '{"notes": [{"kind": "exam", "text": "Glycolysis steps are on the midterm", "at_ms": 50000}, {"kind": "joke", "text": "x", "at_ms": 0}], "class_id": "c1"}'
        with mock.patch.object(lectures, "get_openai_client", return_value=FakeClient(chat_content=content)):
            response = self.client.post("/lectures/notes", headers=AUTH, json={
                "segments": [{"start_ms": 0, "text": "Intro"}, {"start_ms": 36000, "text": "Glycolysis steps will be on the midterm."}],
                "classes": [{"id": "c1", "name": "Biology 101"}],
            })
        body = response.json()
        self.assertEqual(body["notes"], [{"kind": "exam", "text": "Glycolysis steps are on the midterm", "at_ms": 36000}])
        self.assertEqual(body["class_id"], "c1")

    def test_finish_cleans_titles_and_never_shrinks_the_lecture(self):
        segments = [{"start_ms": i * 18000, "text": f"Sentence number {i} about the topic of the lecture."} for i in range(6)]
        with mock.patch.object(lectures, "get_openai_client", return_value=FakeClient(chat_content="Short.")):
            response = self.client.post("/lectures/finish", headers=AUTH, json={"segments": segments})
        body = response.json()
        self.assertIn("Sentence number 5", body["transcript"])  # the too-short "cleanup" was rejected
        self.assertEqual(body["title"], "Short")

    def test_finish_refuses_a_too_short_recording(self):
        response = self.client.post("/lectures/finish", headers=AUTH, json={"segments": [{"start_ms": 0, "text": "hi"}]})
        self.assertEqual(response.status_code, 422)

    def test_upload_recording_rejects_files_over_25_mb(self):
        with mock.patch.object(lectures, "MAX_FILE_BYTES", 10), mock.patch.object(lectures.entitlements, "remaining", return_value=100), \
                mock.patch.object(lectures.entitlements, "plan_for", return_value="free"), mock.patch.object(lectures.entitlements, "subscription_row", return_value=None):
            response = self.client.post("/lectures/transcribe-file", headers=AUTH, data={"recording_id": "rec_12345678", "duration_ms": "60000"}, files={"audio": ("talk.mp3", b"x" * 20, "audio/mpeg")})
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
