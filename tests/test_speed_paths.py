"""Faster guide and heavy-page paths: parallel guide batches, fewer reads and writes, same results."""
import os
import sys
import threading
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "tests"))

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from fake_supabase import FakeDB  # noqa: E402
from routers import guides, quiz  # noqa: E402
from services import docs_sync, llm, sync_worker  # noqa: E402

GUIDE_ID = "00000000-0000-0000-0000-000000000001"
GUIDE = "Q1: First?\nA1: Alpha\nQ2: Second?\nA2: Beta\nQ3: Third?\nA3: Gamma\nQ4: Fourth?\nA4: Delta"


class CountingDB(FakeDB):
    """FakeDB that remembers each table() call and the columns each select asked for."""

    def __init__(self):
        super().__init__()
        self.selects = []

    def table(self, name):
        query = super().table(name)
        select = query.select

        def recording(columns="*", **kwargs):
            self.selects.append((name, columns))
            return select(columns, **kwargs)

        query.select = recording
        return query


class GuideBatchTests(unittest.TestCase):
    def test_batches_run_together_and_keep_source_order(self):
        # Three ~8k batches; the first is the slowest, so finishing order differs from source order.
        chunks = [f"BATCH{i} " + "x" * 7990 for i in range(3)]
        running, peak, lock = [0], [0], threading.Lock()

        def fake_chat(_client, _feature, **kwargs):
            prompt = kwargs["messages"][1]["content"]
            index = next(i for i in range(3) if f"BATCH{i}" in prompt)
            with lock:
                running[0] += 1
                peak[0] = max(peak[0], running[0])
            time.sleep(0.15 if index == 0 else 0.02)
            with lock:
                running[0] -= 1
            text = f"Q1: Batch {index} first?\nA1: One.\nQ2: Batch {index} second?\nA2: Two."
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

        with patch.object(llm, "chat", side_effect=fake_chat), patch.object(llm, "get_openai_client"):
            guide = llm.generate_study_guide(chunks)

        self.assertGreater(peak[0], 1, "batches were written one after another")
        questions = [line for line in guide.splitlines() if line.startswith("Q")]
        self.assertEqual([q.split(":")[0] for q in questions], [f"Q{i}" for i in range(1, 7)])
        self.assertEqual([q.split("Batch ")[1][0] for q in questions], ["0", "0", "1", "1", "2", "2"])

    def test_a_failed_batch_still_fails_the_guide(self):
        chunks = [f"BATCH{i} " + "x" * 7990 for i in range(2)]

        def fake_chat(_client, _feature, **kwargs):
            if "BATCH1" in kwargs["messages"][1]["content"]:
                raise RuntimeError("provider down")
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Q1: A?\nA1: B."))])

        with patch.object(llm, "chat", side_effect=fake_chat), patch.object(llm, "get_openai_client"):
            with self.assertRaises(RuntimeError):
                llm.generate_study_guide(chunks)


class IngestScreenshotTests(unittest.TestCase):
    client = None

    @classmethod
    def setUpClass(cls):
        from main import app
        cls.client = TestClient(app)

    def _ingest(self, content):
        with patch("routers.materials.get_user_id", return_value="student-1"), \
             patch("routers.materials.analyze_images_for_slides") as vision:
            response = self.client.post("/ingest", headers={"Authorization": "Bearer t"}, json={
                "content": content, "images": [{"data": "data:image/png;base64,AAAA", "context": "Visible study material"}]})
        return response.json(), vision

    def test_full_page_text_skips_the_screenshot(self):
        body, vision = self._ingest("Mitosis separates replicated chromosomes into two nuclei. " * 20)
        self.assertFalse(body["use_images"])
        vision.assert_not_called()

    def test_thin_page_text_keeps_the_screenshot(self):
        body, _ = self._ingest("Slide 4: Mitosis diagram")
        self.assertTrue(body["use_images"])


class CanvasFileTextTests(unittest.TestCase):
    def test_make_guide_reads_the_canvas_file_on_the_server(self):
        from main import app
        with patch("routers.canvas.get_user_id", return_value="student-1"), patch("routers.canvas.get_supabase"), \
             patch("routers.canvas._download", return_value=("Week 3 notes.txt", b"Mitosis separates chromosomes into two nuclei.")) as download:
            response = TestClient(app).post("/canvas/courses/101/files/77/text", headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"name": "Week 3 notes.txt", "text": "Mitosis separates chromosomes into two nuclei."})
        self.assertEqual(download.call_args.args[1:], ("student-1", 101, 77))

    def test_web_make_guide_uses_the_server_read(self):
        with open(os.path.join(ROOT, "web", "components", "CanvasClasses.js"), encoding="utf-8") as source:
            text = source.read()
        self.assertIn("/files/${file.id}/text", text)
        self.assertIn("openNewSheet('upload', { files: [await readFile(course.id, file)] })", text)


class QuizReadTests(unittest.TestCase):
    def setUp(self):
        self.db = CountingDB()
        self.patches = [patch.object(quiz, "get_user_id", return_value="student-1"),
                        patch.object(quiz, "get_supabase", return_value=self.db)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def guide(self, **row):
        self.db.rows("study_guides").append({"id": GUIDE_ID, "user_id": "student-1", "study_guide": GUIDE, **row})

    def test_saved_quiz_is_read_without_the_guide_text(self):
        cached = [{"question": "Saved?", "options": ["Yes", "No"], "correct_index": 0}]
        self.guide(quiz_questions=cached)
        self.assertEqual(quiz._quiz_for_guide(GUIDE_ID, "Bearer t")["questions"], cached)
        self.assertEqual(self.db.selects, [("study_guides", "quiz_questions")])

    def test_session_on_a_saved_quiz_reads_once_and_writes_nothing(self):
        cached = [{"question": "Saved?", "options": ["Yes", "No"], "correct_index": 0}]
        self.guide(quiz_questions=cached)
        with patch.object(quiz, "plan_for", return_value="free"), patch.object(quiz, "subscription_row"), \
             patch.object(quiz, "_save_quiz") as save:
            result = quiz.start_session(GUIDE_ID, quiz.SessionRequest(), "Bearer t")
        self.assertEqual(result["questions"], cached)
        self.assertEqual(self.db.selects, [("study_guides", "quiz_questions")])
        save.assert_not_called()

    def test_guide_text_is_read_only_to_build_a_quiz(self):
        self.guide(quiz_questions=None)
        with patch.object(quiz, "remaining", return_value=0):
            result = quiz._quiz_for_guide(GUIDE_ID, "Bearer t")
        self.assertEqual(len(result["questions"]), 4)
        self.assertEqual(self.db.selects, [("study_guides", "quiz_questions"), ("study_guides", "study_guide")])

    def test_unsaved_fallback_is_saved_when_a_session_starts(self):
        self.guide(quiz_questions=None)
        reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="not json"))])
        with patch.object(quiz, "remaining", return_value=5), patch.object(quiz, "require"), patch.object(quiz, "record"), \
             patch.object(quiz, "chat", return_value=reply), patch.object(quiz, "get_openai_client"), \
             patch.object(quiz, "plan_for", return_value="pro"), patch.object(quiz, "subscription_row"):
            result = quiz.start_session(GUIDE_ID, quiz.SessionRequest(), "Bearer t")
        self.assertEqual(self.db.rows("study_guides")[0]["quiz_questions"], result["questions"])

    def test_warm_up_skips_free_accounts_and_builds_for_pro(self):
        self.guide(quiz_questions=None)
        with patch.object(quiz, "remaining", return_value=1), patch.object(quiz, "_load_quiz") as load:
            quiz.prewarm_quiz(GUIDE_ID, "student-1")  # the free preview is kept for the student's choice
        load.assert_not_called()
        with patch.object(quiz, "remaining", return_value=0):
            quiz.prewarm_quiz(GUIDE_ID, "student-1")
        self.assertIsNone(self.db.rows("study_guides")[0]["quiz_questions"])
        with patch.object(quiz, "remaining", return_value=150), patch.object(quiz, "_load_quiz") as load:
            quiz.prewarm_quiz(GUIDE_ID, "student-1")
        load.assert_called_once_with(self.db, GUIDE_ID, "student-1")

    def test_warm_up_starts_only_for_guides_with_questions(self):
        with patch.object(quiz.threading, "Thread") as thread:
            quiz.start_quiz_warmup({"id": GUIDE_ID, "study_guide": "Just notes"}, "student-1")
            thread.assert_not_called()
            quiz.start_quiz_warmup({"id": GUIDE_ID, "study_guide": GUIDE}, "student-1")
        thread.assert_called_once()
        self.assertEqual(thread.call_args.kwargs["args"], (GUIDE_ID, "student-1"))


class GuideFieldsTests(unittest.TestCase):
    def _get(self, **kwargs):
        db = CountingDB()
        db.rows("study_guides").append({"id": GUIDE_ID, "user_id": "student-1", "title": "Cells", "study_guide": GUIDE,
                                        "notes": "n", "flashcards": [{"front": "a", "back": "b"}], "flashcard_progress": {},
                                        "is_bookmarked": True, "folder_id": None, "source_type": "file", "created_at": "2026-10-01"})
        with patch.object(guides, "get_user_id", return_value="student-1"), patch.object(guides, "get_supabase", return_value=db):
            return guides.get_guide(GUIDE_ID, authorization="Bearer t", **kwargs)["guide"], db

    def test_default_returns_every_column(self):
        guide, db = self._get()
        self.assertEqual(db.selects, [("study_guides", "*")])
        self.assertIn("study_guide", guide)

    def test_cards_and_meta_leave_out_the_guide_text(self):
        cards, _ = self._get(fields="cards")
        self.assertEqual(set(cards), {"id", "title", "flashcards", "flashcard_progress", "is_bookmarked"})
        meta, _ = self._get(fields="meta")
        self.assertEqual(set(meta), {"id", "title", "folder_id", "flashcard_progress", "source_type", "created_at"})

    def test_unknown_fields_are_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._get(fields="study_guide")
        self.assertEqual(caught.exception.status_code, 400)

    def test_flashcard_study_page_asks_for_cards_only(self):
        with open(os.path.join(ROOT, "web", "pages", "flashcards", "study.js"), encoding="utf-8") as page:
            self.assertIn("'?fields=cards'", page.read())


class RecordingQuery:
    """Records the PostgREST calls of one query; returns the rows it was given."""

    def __init__(self, log, name, rows):
        self.log, self.name, self.rows, self.calls = log, name, rows, []
        log.append(self)

    def __getattr__(self, method):
        def call(*args, **kwargs):
            self.calls.append((method, args, kwargs))
            return self
        return call

    def execute(self):
        return SimpleNamespace(data=self.rows)


class SyncWorkerTests(unittest.TestCase):
    def test_one_connector_settings_query_finds_every_app_due(self):
        rows = [
            {"user_id": "u1", "connector": "gcal", "last_synced_at": None},
            {"user_id": "u2", "connector": "gdrive", "last_synced_at": "2026-10-01T00:00:00+00:00"},
            {"user_id": "u3", "connector": "slack", "last_synced_at": None},
            {"user_id": "u4", "connector": "gdocs", "last_synced_at": None},
            {"user_id": "u5", "connector": "gdocs", "last_synced_at": None},
        ]
        log = []
        db = MagicMock()
        db.table.side_effect = lambda name: RecordingQuery(log, name, rows if name == "connector_settings" else [{"user_id": "u4"}])
        with patch.object(sync_worker, "get_supabase", return_value=db), patch.object(docs_sync, "get_supabase", return_value=db):
            due = sync_worker.due_connectors(datetime(2026, 10, 29, 12, tzinfo=timezone.utc))
        self.assertEqual([q.name for q in log], ["connector_settings", "connector_links"])
        self.assertEqual([r["user_id"] for r in due["gcal"]], ["u1"])
        self.assertEqual([r["user_id"] for r in due["gdrive"]], ["u2"])
        self.assertEqual([r["user_id"] for r in due["slack"]], ["u3"])
        self.assertEqual([r["user_id"] for r in due["gdocs"]], ["u4"], "only students with a linked draft")
        self.assertEqual(due["gtasks"], [])
        # Each app keeps its own eligibility and interval, in the one query.
        filters = next(args[0] for method, args, _ in log[0].calls if method == "or_")
        self.assertIn("and(connector.eq.gdrive,stats->>linked.eq.true,or(last_synced_at.is.null,last_synced_at.lt.2026-10-29T11:30:00+00:00))", filters)
        self.assertIn("and(connector.eq.gcal,container_id.not.is.null,or(last_synced_at.is.null,last_synced_at.lt.2026-10-29T11:45:00+00:00))", filters)
        self.assertIn("connector.eq.gsheets,stats->>auto.eq.true,or(last_synced_at.is.null,last_synced_at.lt.2026-10-28T12:00:00+00:00)", filters)

    def test_tick_runs_each_due_app_once_claimed(self):
        due = {connector: [] for connector in sync_worker._rules()}
        due["gdrive"] = [{"user_id": "u2", "connector": "gdrive", "last_synced_at": None}]
        due["gmail"] = [{"user_id": "u6", "connector": "gmail", "last_synced_at": None}]
        with patch.object(sync_worker, "_due_canvas", return_value=[]), \
             patch.object(sync_worker, "due_connectors", return_value=due), \
             patch.object(sync_worker.sync_state, "claim", return_value=True), \
             patch("services.drive_sync.sync_folders") as drive, patch("services.mail_watch.watch") as mail:
            sync_worker.tick()
        drive.assert_called_once_with("u2")
        mail.assert_called_once_with("u6", "gmail")

    def test_ticks_every_five_minutes_under_the_shortest_interval(self):
        self.assertEqual(sync_worker.TICK_SECONDS, 300)
        shortest = min(every for _, every in sync_worker._rules().values())
        self.assertLessEqual(sync_worker.TICK_SECONDS, shortest.total_seconds() / 3)

    def test_draft_lookup_is_one_query(self):
        log = []
        db = MagicMock()
        db.table.side_effect = lambda name: RecordingQuery(log, name, [{"user_id": "a"}, {"user_id": "a"}])
        with patch.object(docs_sync, "get_supabase", return_value=db):
            self.assertEqual(docs_sync.users_with_drafts(["a", "b", "c"]), {"a"})
            self.assertEqual(docs_sync.users_with_drafts([]), set())
        self.assertEqual(len(log), 1)


if __name__ == "__main__":
    unittest.main()
