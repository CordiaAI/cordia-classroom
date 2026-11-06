"""Learn format ladder, backend side (LEARN_LADDER_V2): saved Fill in the blank spans, Learn's
Fill in the blank charge without a mid-round upgrade dialog, the test format, and the owner-only
study fields on each logged answer."""
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json
import os
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from routers import guides, learning, quiz  # noqa: E402
from services import blanks  # noqa: E402
from services import learning_events as le  # noqa: E402

GUIDE = "22222222-2222-4222-8222-222222222222"
USER = "11111111-1111-4111-8111-111111111111"
LONG_ANSWER = "Cells use ATP to power reactions that need energy, such as building proteins"


def mcq(question, answer, **extra):
    return {"question": question, "options": ["Wrong one", answer, "Wrong two"], "correct_index": 1, **extra}


def fake_chat(spans):
    calls = []

    def chat(_client, feature, messages, **_kwargs):
        calls.append((feature, messages))
        content = json.dumps({"items": [{"span": span} for span in spans]})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])
    chat.calls = calls
    return chat


class BlankTests(unittest.TestCase):
    def test_validation(self):
        self.assertTrue(blanks.valid_span(LONG_ANSWER, "power reactions"))
        self.assertFalse(blanks.valid_span(LONG_ANSWER, "Power reactions"), "must appear exactly")
        self.assertFalse(blanks.valid_span(LONG_ANSWER, "not there"))
        self.assertFalse(blanks.valid_span(LONG_ANSWER, "use ATP to power reactions that need"), "over six words")
        self.assertFalse(blanks.valid_span("Short answer here", "Short answer here"), "never the whole answer")
        self.assertFalse(blanks.valid_span(LONG_ANSWER, "to"), "never a stopword")
        self.assertFalse(blanks.valid_span(LONG_ANSWER, None))

    def test_short_answers_are_whole_and_need_no_ai(self):
        chat = fake_chat([])
        out = blanks.choose_blanks([mcq("What makes ATP?", "Mitochondria")], chat=chat, client=object())
        self.assertEqual(out[0]["blank"], {"whole": True})
        self.assertEqual(chat.calls, [])

    def test_long_answers_get_a_checked_span_or_written(self):
        questions = [mcq("Why do cells need ATP?", LONG_ANSWER), mcq("How does diffusion work?", "Particles spread from high to low concentration over time"),
                     mcq("What makes ATP?", "Mitochondria"), mcq("Already done?", LONG_ANSWER, blank={"span": "kept"})]
        chat = fake_chat(["power reactions", "this is not in the answer"])
        out = blanks.choose_blanks(questions, chat=chat, client=object())
        self.assertEqual(out[0]["blank"], {"span": "power reactions"})
        self.assertEqual(out[1]["blank"], {"written": True}, "a span that fails validation falls back to Written")
        self.assertEqual(out[2]["blank"], {"whole": True})
        self.assertEqual(out[3]["blank"], {"span": "kept"}, "questions that have one are left alone")
        self.assertEqual(len(chat.calls), 1, "one call per batch")
        self.assertEqual(chat.calls[0][0], "learn_blanks")

    def test_prompt_is_domain_neutral(self):
        prompt = blanks._prompt([{"question": "Q?", "answer": "A long answer"}]).lower()
        for word in ("key term", "definition", "role", "relationship"):
            self.assertIn(word, prompt)
        for subject in ("cell", "nurs", "patient", "court", "poem", "algorithm"):
            self.assertNotIn(subject, prompt)

    def test_a_failed_call_means_written_never_an_error(self):
        def broken(*_args, **_kwargs):
            raise RuntimeError("down")
        out = blanks.choose_blanks([mcq("Why?", LONG_ANSWER)], chat=broken, client=object())
        self.assertEqual(out[0]["blank"], {"written": True})

    def test_ensure_blanks_saves_into_the_cached_quiz(self):
        db = FakeDB()
        db.rows("study_guides").append({"id": GUIDE, "user_id": USER, "quiz_questions": [mcq("Why do cells need ATP?", LONG_ANSWER), mcq("What makes ATP?", "Mitochondria")]})
        picked = lambda qs: [{**q, "blank": {"span": "power reactions"} if q["question"].startswith("Why") else {"whole": True}} for q in qs]  # noqa: E731
        with patch.object(blanks, "choose_blanks", side_effect=picked):
            blanks.ensure_blanks(db, GUIDE, USER)
        saved = db.rows("study_guides")[0]["quiz_questions"]
        self.assertEqual([q["blank"] for q in saved], [{"span": "power reactions"}, {"whole": True}])
        self.assertEqual(saved[0]["options"][saved[0]["correct_index"]], LONG_ANSWER, "the rest of the question is untouched")

    def test_flag_off_builds_nothing(self):
        with patch.dict(os.environ, {"LEARN_LADDER_V2": "false"}):
            self.assertFalse(blanks.start_blanks(FakeDB(), GUIDE, USER, [mcq("Why?", LONG_ANSWER)]))
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(blanks.learn_ladder_v2())


class LearnSessionTests(unittest.TestCase):
    QUESTIONS = [mcq("What makes ATP?", "Mitochondria"), mcq("Why do cells need ATP?", LONG_ANSWER)]

    def start(self, remaining, types=("mc", "written", "fill"), flag="true"):
        require, record = MagicMock(), MagicMock()
        with patch.dict(os.environ, {"LEARN_LADDER_V2": flag}), \
             patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=FakeDB()),
                            _load_quiz=MagicMock(return_value=(self.QUESTIONS, True)), remaining=MagicMock(return_value=remaining),
                            require=require, record=record, plan_for=MagicMock(return_value="free"), subscription_row=MagicMock(return_value=None)), \
             patch.object(blanks, "start_blanks", return_value=True) as started:
            session = quiz.start_session(GUIDE, quiz.SessionRequest(types=list(types), learn=True), "Bearer t")
        return session, require, record, started

    def test_fill_is_charged_once_when_available(self):
        session, require, record, started = self.start(remaining=1)
        self.assertTrue(session["fill_available"])
        require.assert_called_once_with("u1", "retain_types")
        record.assert_called_once_with("u1", "retain_types")
        started.assert_called_once()
        self.assertEqual(session["questions"], self.QUESTIONS)

    def test_out_of_fill_tries_falls_back_without_a_402(self):
        session, require, record, started = self.start(remaining=0)
        self.assertFalse(session["fill_available"])
        require.assert_not_called()
        record.assert_not_called()
        started.assert_not_called()

    def test_no_fill_asked_no_charge(self):
        session, _, record, _ = self.start(remaining=5, types=("mc", "written"))
        self.assertFalse(session["fill_available"])
        record.assert_not_called()

    def test_flag_off_keeps_the_old_session(self):
        session, require, record, _ = self.start(remaining=0, types=("mc", "written"), flag="false")
        self.assertNotIn("fill_available", session)
        self.assertIn("cards", session)
        require.assert_not_called()


class TestFormatTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("study_guides").append({"id": GUIDE, "user_id": USER, "flashcard_progress": {"learn": {"levels": {}, "test_date": "2026-12-01"}}})
        self.client = TestClient(main.app)
        self.patches = [patch.object(guides, "get_user_id", return_value=USER), patch.object(guides, "get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def learn(self):
        return self.db.rows("study_guides")[0]["flashcard_progress"]["learn"]

    def test_format_saved_next_to_the_date_and_kept(self):
        self.assertEqual(self.client.patch(f"/guides/{GUIDE}/test-format", json={"test_format": "essay"}).json(), {"test_format": "essay"})
        self.assertEqual(self.learn(), {"levels": {}, "test_date": "2026-12-01", "test_format": "essay"})
        # A Learn save without the format keeps it; with one, changes it.
        self.client.patch(f"/guides/{GUIDE}/learn-progress", json={"levels": {}, "test_date": "2026-12-02"})
        self.assertEqual(self.learn()["test_format"], "essay")
        self.client.patch(f"/guides/{GUIDE}/learn-progress", json={"levels": {}, "test_date": "2026-12-02", "test_format": "mc"})
        self.assertEqual(self.learn()["test_format"], "mc")

    def test_invalid_format_refused(self):
        self.assertEqual(self.client.patch(f"/guides/{GUIDE}/test-format", json={"test_format": "oral"}).status_code, 422)


class LadderLoggingTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"LEARNING_EVENTS_ENABLED": "true"})
        self.env.start()
        self.db = FakeDB()

    def tearDown(self):
        self.env.stop()

    def event(self, **extra):
        return {"guide_id": GUIDE, "fingerprint": "what makes atp", "mode": "learn", "format": "typed", "outcome": "right", **extra}

    def detail(self):
        return learning.LadderDetail(first_try=False, gap=5, level_before=1, level_after=2, test_format="mc", days_to_test=2, fallback=True).model_dump()

    def test_detail_is_saved_and_left_out_when_absent(self):
        le.write_batch(self.db, USER, [], [self.event(detail=self.detail()), self.event()])
        rows = self.db.rows("learning_events")
        self.assertEqual(rows[0]["detail"]["gap"], 5)
        self.assertIsNone(rows[1]["detail"])
        plain = le.event_rows(USER, [self.event()], [], 0, datetime.now(timezone.utc))
        self.assertNotIn("detail", plain[0], "flag-off answers don't name the column")

    def test_logging_keeps_working_before_the_detail_migration(self):
        db, real = self.db, self.db.table

        class NoColumnYet:
            def table(self, name):
                query = real(name)
                if name == "learning_events":
                    insert = query.insert

                    def guarded(payload, **kwargs):
                        if any("detail" in row for row in payload):
                            raise RuntimeError("{'code': 'PGRST204', 'message': \"Could not find the 'detail' column of 'learning_events'\"}")
                        return insert(payload, **kwargs)
                    query.insert = guarded
                return query
        result = le.write_batch(NoColumnYet(), USER, [], [self.event(detail=self.detail())])
        self.assertEqual(result["events"], 1)
        self.assertNotIn("detail", db.rows("learning_events")[0])

    def test_detail_values_are_checked(self):
        with self.assertRaises(Exception):
            learning.LadderDetail(first_try=True, level_before=7)
        with self.assertRaises(Exception):
            learning.LadderDetail(first_try=True, test_format="oral")


if __name__ == "__main__":
    unittest.main()
