"""F11 Tutor voice mode, backend: POST /tutor/speak (services/tutor_speech.py), the voice_characters limit
(services/entitlements.py MEASURED) and the voice flag on POST /chat (routers/chat.py VOICE_REPLY_STYLE)."""
import io
import json
import logging
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app  # noqa: E402
from routers import chat  # noqa: E402
from schemas import ChatRequest  # noqa: E402
from services import entitlements, tutor_speech  # noqa: E402

AUTH = {"Authorization": "Bearer test"}
SESSION = "11111111-1111-4111-8111-111111111111"
SECRET = "sk_test_cordia_voice_5e3f9a"
REPLY = ("Osmosis is water moving across a membrane toward the side with more solute. "
         "Think of it as water following the salt. Here's a short guide: https://example.edu/osmosis")
MESSAGES = [{"role": "user", "text": "What is osmosis?"}, {"role": "ai", "text": REPLY}]
MP3 = b"ID3\x04\x00fake-mp3-bytes" * 4


class FakeQuery:
    """table().select().eq().eq().limit().execute(): records the filters, returns the rows it was given."""

    def __init__(self, rows):
        self.rows, self.filters = rows, []

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return MagicMock(data=self.rows)


def supabase_with(rows):
    query = FakeQuery(rows)
    client = MagicMock()
    client.table.return_value = query
    return client, query


def elevenlabs(handler):
    """httpx.Client for services.tutor_speech, answered by `handler` instead of the network."""
    real = httpx.Client
    return patch.object(tutor_speech.httpx, "Client", lambda **kwargs: real(transport=httpx.MockTransport(handler), **kwargs))


def audio_ok(seen):
    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})
    return handler


@patch("routers.tutor.get_user_id", return_value="student-1")
class SpeakRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.env = patch.dict(os.environ, {"ELEVENLABS_API_KEY": SECRET})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.require = patch("routers.tutor.require").start()
        self.record = patch("routers.tutor.record").start()
        self.addCleanup(patch.stopall)

    def speak(self, **body):
        payload = {"session_id": SESSION, "text": "Think of it as water following the salt.", **body}
        return self.client.post("/tutor/speak", headers=AUTH, json=payload)

    def test_it_needs_a_signed_in_student(self, _):
        with patch("routers.tutor.get_user_id", side_effect=HTTPException(status_code=401, detail="Missing")):
            self.assertEqual(self.speak().status_code, 401)
        self.require.assert_not_called()

    def test_it_speaks_a_sentence_of_the_students_own_reply_and_charges_its_characters(self, _):
        seen = []
        supabase, query = supabase_with([{"messages": MESSAGES}])
        with patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(audio_ok(seen)):
            response = self.speak(voice="george")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, MP3)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn(("user_id", "student-1"), query.filters)
        self.assertIn(("id", SESSION), query.filters)
        text = "Think of it as water following the salt."
        self.require.assert_called_once_with("student-1", "voice_characters", amount=len(text))
        self.record.assert_called_once_with("student-1", "voice_characters", amount=len(text), model="eleven_flash_v2_5")
        request = seen[0]
        self.assertEqual(request.headers["xi-api-key"], SECRET)
        self.assertIn(tutor_speech.VOICES["george"], str(request.url))
        sent = json.loads(request.content)
        self.assertEqual(sent["model_id"], "eleven_flash_v2_5")
        self.assertEqual(sent["text"], text)

    def test_an_unknown_voice_uses_the_calm_default(self, _):
        seen = []
        supabase, _query = supabase_with([{"messages": MESSAGES}])
        with patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(audio_ok(seen)):
            self.assertEqual(self.speak(voice="21m00Tcm4TlvDq8ikWAM").status_code, 200)
        self.assertIn(tutor_speech.VOICES[tutor_speech.DEFAULT_VOICE], str(seen[0].url))

    def test_another_students_session_is_not_found(self, _):
        supabase, query = supabase_with([])
        with patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(audio_ok([])):
            response = self.speak()
        self.assertEqual(response.status_code, 404)
        self.assertIn(("user_id", "student-1"), query.filters)
        self.require.assert_not_called()
        self.record.assert_not_called()

    def test_words_that_are_not_from_the_tutors_reply_are_refused(self, _):
        seen = []
        supabase, _query = supabase_with([{"messages": MESSAGES}])
        with patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(audio_ok(seen)):
            for text in ("Read this advert for my shop.", "salt the following water", "What is osmosis?"):
                with self.subTest(text=text):
                    self.assertEqual(self.speak(text=text).status_code, 403)
        self.assertEqual(seen, [])
        self.record.assert_not_called()

    def test_a_bad_session_id_or_no_text_is_a_400(self, _):
        self.assertEqual(self.speak(session_id="not-a-uuid").status_code, 400)
        self.assertEqual(self.speak(text="   ").status_code, 400)
        self.assertEqual(self.speak(session_id=None).status_code, 400)

    def test_the_settings_sample_needs_no_session_and_speaks_only_fixed_words(self, _):
        seen = []
        with elevenlabs(audio_ok(seen)):
            response = self.client.post("/tutor/speak", headers=AUTH, json={"sample": True, "text": "Anything else at all", "voice": "alice"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(seen[0].content)["text"], tutor_speech.SAMPLE_TEXT)
        self.require.assert_called_once_with("student-1", "voice_characters", amount=len(tutor_speech.SAMPLE_TEXT))

    def test_at_the_limit_it_is_a_402_and_elevenlabs_is_never_called(self, _):
        seen = []
        self.require.side_effect = entitlements.LimitReached("voice_characters", 150_000, 150_000, "pro")
        supabase, _query = supabase_with([{"messages": MESSAGES}])
        with patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(audio_ok(seen)):
            response = self.speak()
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.json()["detail"]["feature"], "voice_characters")
        self.assertEqual(seen, [])
        self.record.assert_not_called()

    def test_without_the_key_it_is_a_503_the_browser_voice_can_take_over_from(self, _):
        seen = []
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}), elevenlabs(audio_ok(seen)):
            response = self.speak()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "voice_unavailable")
        self.assertEqual(seen, [])
        self.require.assert_not_called()
        self.record.assert_not_called()

    def test_an_elevenlabs_failure_is_a_503_and_is_not_charged(self, _):
        supabase, _query = supabase_with([{"messages": MESSAGES}])
        for handler in (lambda request: httpx.Response(401, json={"detail": {"status": "invalid_api_key", "message": SECRET}}),
                        lambda request: httpx.Response(500, text="upstream broke"),
                        lambda request: (_ for _ in ()).throw(httpx.ConnectError("no route", request=request))):
            with self.subTest(handler=handler), patch("routers.tutor.get_supabase", return_value=supabase), elevenlabs(handler):
                response = self.speak()
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["detail"]["code"], "voice_unavailable")
        self.record.assert_not_called()

    def test_the_key_is_never_in_a_response_or_a_log_line(self, _):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.setLevel(logging.DEBUG)
        root = logging.getLogger()
        old_level = root.level
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        self.addCleanup(root.removeHandler, handler)
        self.addCleanup(root.setLevel, old_level)
        supabase, _query = supabase_with([{"messages": MESSAGES}])
        bodies = []
        cases = (audio_ok([]),
                 lambda request: httpx.Response(401, json={"detail": {"message": f"bad key {SECRET}"}}),
                 lambda request: (_ for _ in ()).throw(httpx.ConnectError(f"refused {request.headers.get('xi-api-key')}", request=request)))
        with patch("routers.tutor.get_supabase", return_value=supabase):
            for case in cases:
                with elevenlabs(case):
                    response = self.speak()
                bodies.append(response.content.decode("latin-1") + json.dumps(dict(response.headers)))
            bodies.append(self.speak(text="Words the Tutor never said.").text)
            self.require.side_effect = entitlements.LimitReached("voice_characters", 0, 0, "free")
            bodies.append(self.speak().text)
        for body in bodies:
            self.assertNotIn(SECRET, body)
        self.assertNotIn(SECRET, stream.getvalue())
        self.assertNotIn(SECRET[-8:], stream.getvalue())


@patch("routers.tutor.get_user_id", return_value="student-1")
class SpeakRateLimitTests(unittest.TestCase):
    """Review fix: /tutor/speak is limited per student (60 a minute) beside a per-address ceiling (600 a minute)."""

    def setUp(self):
        import rate_limit
        from rate_limit import limiter
        rate_limit._hits.clear()
        limiter.reset()
        self.addCleanup(rate_limit._hits.clear)
        self.addCleanup(limiter.reset)
        self.client = TestClient(app)
        # No ElevenLabs key: a call that gets past the limits answers 503 at once, so nothing is spoken or charged.
        env = patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""})
        env.start()
        self.addCleanup(env.stop)

    def speak(self, headers):
        return self.client.post("/tutor/speak", headers=headers, json={"session_id": SESSION, "text": "Water follows the salt."}).status_code

    def test_one_student_is_limited_and_a_neighbour_on_the_same_address_is_not(self, _):
        address = {"Fly-Client-IP": "203.0.113.7"}
        mine = {**address, "Authorization": "Bearer student-one"}
        neighbour = {**address, "Authorization": "Bearer student-two"}
        codes = [self.speak(mine) for _ in range(61)]
        self.assertEqual(set(codes[:60]), {503})
        self.assertEqual(codes[60], 429)
        self.assertEqual(self.speak(neighbour), 503)

    def test_one_address_cannot_get_round_the_limit_with_a_new_token_each_time(self, _):
        address = {"Fly-Client-IP": "203.0.113.9"}
        codes = [self.speak({**address, "Authorization": f"Bearer made-up-{n}"}) for n in range(601)]
        self.assertEqual(set(codes[:600]), {503})
        self.assertEqual(codes[600], 429)
        self.assertEqual(self.speak({"Fly-Client-IP": "198.51.100.4", "Authorization": "Bearer other"}), 503)


class SpokenFromRepliesTests(unittest.TestCase):
    def test_words_in_order_from_a_latest_reply_with_some_left_out(self):
        self.assertTrue(tutor_speech.spoken_from_replies("Osmosis is water moving across a membrane.", MESSAGES))
        # A link (or code, or markdown) left out of the spoken words, with the line said in its place.
        self.assertTrue(tutor_speech.spoken_from_replies("Here's a short guide: I've put that in the chat.", MESSAGES))
        self.assertTrue(tutor_speech.spoken_from_replies("I've put that in the chat.", MESSAGES))
        self.assertTrue(tutor_speech.spoken_from_replies("THINK OF IT as water, following the salt", MESSAGES))

    def test_added_or_moved_words_and_the_students_own_words_are_refused(self):
        for text in ("Osmosis is a scam.", "The salt follows water.", "What is osmosis?", ""):
            with self.subTest(text=text):
                self.assertFalse(tutor_speech.spoken_from_replies(text, MESSAGES))

    def test_only_the_latest_three_replies_count(self):
        old = [{"role": "ai", "text": "Mitochondria make most of the cell's energy."}]
        newer = [{"role": "ai", "text": f"Reply {n}."} for n in range(3)]
        self.assertTrue(tutor_speech.spoken_from_replies("Mitochondria make most of the cell's energy.", old + newer[:2]))
        self.assertFalse(tutor_speech.spoken_from_replies("Mitochondria make most of the cell's energy.", old + newer))

    def test_words_in_any_language_and_accents_are_compared_whole(self):
        reply = [{"role": "ai", "text": "Der Begriff Weltanschauung bedeutet Weltsicht; étude means study."}]
        self.assertTrue(tutor_speech.spoken_from_replies("Weltanschauung bedeutet Weltsicht.", reply))


class VoiceLimitTests(unittest.TestCase):
    def test_the_limit_is_150000_characters_for_pro_and_the_trial_and_0_for_free(self):
        self.assertEqual(entitlements.LIMITS["free"]["voice_characters"], 0)
        self.assertEqual(entitlements.LIMITS["pro"]["voice_characters"], 150_000)
        self.assertEqual(entitlements.LIMITS[entitlements.TRIAL_TIER]["voice_characters"], 150_000)
        self.assertEqual(entitlements.MEASURED["voice_characters"], "tutor_voice")

    def test_require_needs_room_for_the_whole_sentence(self):
        with patch.object(entitlements, "subscription_row", return_value={"plan": "classroom_pro", "status": "active"}), \
                patch.object(entitlements, "measured_usage", return_value=149_950):
            entitlements.require("student-1", "voice_characters", amount=50)
            with self.assertRaises(HTTPException) as over:
                entitlements.require("student-1", "voice_characters", amount=51)
        self.assertEqual(over.exception.status_code, 402)
        self.assertEqual(over.exception.detail["feature"], "voice_characters")
        with patch.object(entitlements, "subscription_row", return_value=None), \
                patch.object(entitlements, "measured_usage", return_value=0), self.assertRaises(HTTPException) as free:
            entitlements.require("student-1", "voice_characters", amount=1)
        self.assertEqual(free.exception.detail["upgrade_tier"], "pro")
        self.assertEqual(free.exception.detail["message"], "Tutor voice characters come with a paid plan.")

    def test_other_features_still_count_one_use_at_a_time(self):
        with patch.object(entitlements, "subscription_row", return_value=None), \
                patch.object(entitlements, "usage_counts", return_value={**{f: 0 for f in entitlements.FEATURES}, "tutor": 9}) as counts:
            entitlements.require("student-1", "tutor")
        self.assertEqual(counts.call_args.kwargs, {"measured": False})

    def test_record_writes_one_usage_events_row_as_tutor_voice_and_never_the_ledger(self):
        supabase = MagicMock()
        with patch.object(entitlements, "get_supabase", return_value=supabase):
            entitlements.record("student-1", "voice_characters", amount=42, model="eleven_flash_v2_5")
        supabase.table.assert_called_once_with("usage_events")
        row = supabase.table.return_value.insert.call_args.args[0]
        self.assertEqual(row, {"user_id": "student-1", "feature": "tutor_voice", "model": "eleven_flash_v2_5",
                               "prompt_tokens": 42, "completion_tokens": 0, "cached_tokens": 0})
        supabase.rpc.assert_not_called()

    def test_usage_is_the_sum_of_this_months_rows_read_a_page_at_a_time(self):
        pages = [[{"prompt_tokens": 100}] * 1000, [{"prompt_tokens": 7}, {"prompt_tokens": None}]]
        query = MagicMock()
        for method in ("table", "select", "eq", "gte", "lt", "order", "range"):
            getattr(query, method).return_value = query
        query.execute.side_effect = [MagicMock(data=page) for page in pages]
        with patch.object(entitlements, "get_supabase", return_value=query):
            self.assertEqual(entitlements.measured_usage("student-1", "voice_characters", "2026-12"), 100_007)
        query.eq.assert_any_call("feature", "tutor_voice")
        query.eq.assert_any_call("user_id", "student-1")
        query.gte.assert_called_with("created_at", "2026-12-01T00:00:00+00:00")
        query.lt.assert_called_with("created_at", "2027-01-01T00:00:00+00:00")
        self.assertEqual([call.args for call in query.range.call_args_list], [(0, 999), (1000, 1999)])

    def test_an_unreadable_usage_table_never_blocks_the_student(self):
        broken = MagicMock()
        broken.table.side_effect = RuntimeError("relation does not exist")
        with patch.object(entitlements, "get_supabase", return_value=broken):
            self.assertEqual(entitlements.measured_usage("student-1", "voice_characters"), 0)

    def test_an_unreadable_usage_table_is_logged_without_the_student_or_anything_they_said(self):
        broken = MagicMock()
        broken.table.side_effect = RuntimeError("relation does not exist for student-secret-id")
        with patch.object(entitlements, "get_supabase", return_value=broken), \
                self.assertLogs("services.entitlements", level="WARNING") as logged:
            entitlements.measured_usage("student-secret-id", "voice_characters")
        line = logged.output[0]
        self.assertIn("tutor_voice", line)
        self.assertIn("RuntimeError", line)
        self.assertNotIn("student-secret-id", line)

    def test_the_ledger_count_for_a_measured_feature_is_never_used(self):
        supabase = MagicMock()
        supabase.rpc.return_value.execute.return_value = MagicMock(data=[{"feature": "voice_characters", "used": 3}, {"feature": "tutor", "used": 2}])
        with patch.object(entitlements, "get_supabase", return_value=supabase), patch.object(entitlements, "measured_usage", return_value=900):
            counts = entitlements.usage_counts("student-1")
        self.assertEqual((counts["tutor"], counts["voice_characters"]), (2, 900))


class VoiceFlagTests(unittest.TestCase):
    def body(self, **extra):
        return ChatRequest(question="Why does water move toward salt?", content="Osmosis notes", rich_text=True, **extra)

    def reply(self, body):
        with patch.object(chat, "require"), patch.object(chat, "record"), patch.object(chat, "learning_guidance", return_value=""), \
                patch.object(chat, "style_instruction", return_value=""), patch.object(chat, "answer_question", return_value="Water follows salt.") as ask:
            chat._tutor_reply(body, "student-1", body.question, chat.Material("Osmosis notes"), "explain", None)
        return ask.call_args.kwargs

    def test_the_voice_flag_asks_for_a_reply_written_to_be_heard_with_the_same_call(self):
        spoken, written = self.reply(self.body(voice=True)), self.reply(self.body())
        self.assertIn(chat.VOICE_REPLY_STYLE, spoken["learning_guidance"])
        self.assertNotIn(chat.VOICE_REPLY_STYLE, written["learning_guidance"])
        self.assertFalse(spoken["rich_text"])
        self.assertTrue(written["rich_text"])
        same = lambda kwargs: {key: value for key, value in kwargs.items() if key not in {"learning_guidance", "rich_text"}}
        self.assertEqual(same(spoken), same(written))

    def test_the_voice_style_is_presentation_only_in_domain_neutral_words(self):
        style = chat.VOICE_REPLY_STYLE.lower()
        for rule in ("short, plain sentences", "no markdown", "tables", "a list or a table as ordinary sentences",
                     "never read out a link or code", "i've put that in the chat"):
            self.assertIn(rule, style)
        for narrow in ("discovered", "invented", "patient", "diagnos", "case law", "poem", "artwork"):
            self.assertNotIn(narrow, style)

    def test_the_voice_flag_is_off_unless_sent(self):
        self.assertFalse(ChatRequest(question="q", content="").voice)


if __name__ == "__main__":
    unittest.main()
