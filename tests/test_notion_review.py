"""F1 follow-up (review of #280): long pages come in part-way, nothing from the import leaks into a
guide, and Notion is read gently. Each test is one of the reviewer's probes (probe2.py,
probe_tutor.py, probe_outline.py) or a finding from the Vercel threads.

The fakes are shaped like Notion's block objects. Slow Notion is scaled: a call that takes 1 s
against a 25 s budget takes 0.1 s against a 2.5 s budget here. The real Notion and Composio APIs are
never called."""
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fastapi import HTTPException  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
OTHER = "99999999-2222-4333-8444-555555555555"
PAGE = "0c9e8d3a-1111-4222-8333-444455556666"
FOLDER = "f0f0f0f0-1111-4222-8333-444455556666"


def rich(text):
    return [{"type": "text", "text": {"content": text}, "plain_text": text}]


def block(kind, text="", block_id=None, children=False, **extra):
    return {"object": "block", "id": block_id or f"b-{kind}-{text}", "type": kind, "has_children": children,
            kind: {"rich_text": rich(text) if text else [], **extra}}


def child_page(title, block_id):
    return {"object": "block", "id": block_id, "type": "child_page", "has_children": True, "child_page": {"title": title}}


class SlowNotion:
    """A fake Notion with `tree` {block id: [children]}, a per-call delay, and a count of calls at once.
    Lists come 100 at a time with a cursor, like Notion's. `delays` can slow single calls: {(id, start): s}."""

    def __init__(self, tree, delay=0.0, delays=None, fail=(), busy=None):
        self.tree, self.delay, self.delays, self.fail = tree, delay, delays or {}, set(fail)
        self.busy = busy or {}        # block id -> how many 429s to answer before it answers
        self.lock = threading.Lock()
        self.calls, self.running, self.peak, self.log = 0, 0, 0, []

    def __call__(self, account, user, slug, arguments):
        block_id, start = arguments["block_id"], int(arguments.get("start_cursor") or 0)
        with self.lock:
            self.calls += 1
            self.running += 1
            self.peak = max(self.peak, self.running)
            self.log.append((block_id, start))
            busy = self.busy.get(block_id, 0)
            if busy:
                self.busy[block_id] = busy - 1
        try:
            time.sleep(self.delays.get((block_id, start), self.delay))
            if busy:
                raise HTTPException(status_code=429, detail="busy")
            if block_id in self.fail:
                raise HTTPException(status_code=502, detail="The app didn't respond.")
            kids = self.tree.get(block_id, [])
            page = kids[start:start + 100]
            more = start + 100 < len(kids)
            return {"results": page, "has_more": more, "next_cursor": str(start + 100) if more else None}
        finally:
            with self.lock:
                self.running -= 1


def paragraphs(count, prefix="P"):
    return [block("paragraph", f"{prefix}{i}", block_id=f"{prefix}{i}") for i in range(count)]


def read(fake, budget=2.5, **kwargs):
    from services import notion_text
    with patch("services.composio.run", side_effect=fake), patch.object(notion_text, "TIME_BUDGET", budget):
        return notion_text.read_page("ca_mine", USER, PAGE, **kwargs)


class Base(unittest.TestCase):
    def setUp(self):
        import os
        os.environ.setdefault("RETAIN_SIGNING_KEY", "test-key")
        from fastapi.testclient import TestClient
        from main import app
        from rate_limit import limiter
        limiter.reset()  # also forgets the per-student limits and Notion call budgets
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer t"}
        self.user = USER
        for p in [patch("routers.connectors.get_user_id", side_effect=lambda authorization: self.user),
                  patch("services.composio.account_for", return_value="ca_mine")]:
            p.start()
            self.addCleanup(p.stop)

    def post(self, fake, path="import", budget=None, **extra):
        from services import notion_text
        body = {"id": PAGE, "title": "p", **extra}
        with patch("services.composio.run", side_effect=fake), patch.object(notion_text, "TIME_BUDGET", budget or notion_text.TIME_BUDGET):
            return self.client.post(f"/connectors/notion/{path}", headers=self.auth, json=body)


class LongFlatPages(Base):
    """R-H1 and V2: a page that spans many listings comes in part-way, never as a 502."""

    def test_3000_paragraphs_at_one_second_a_call_come_in_partial_with_the_note(self):
        fake = SlowNotion({PAGE: paragraphs(3000)}, delay=0.1)
        started = time.monotonic()
        response = self.post(fake, budget=2.5)
        took = time.monotonic() - started
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["partial"])
        self.assertIn("Notion was slow to answer", body["note"])
        lines = body["text"].splitlines()
        # Every listing that came back before the clock ran out is kept: about 25 of 30, in order.
        self.assertGreaterEqual(len(lines), 2000, len(lines))
        self.assertEqual(lines, [f"P{i}" for i in range(len(lines))])
        self.assertLess(took, 3.5, took)

    def test_1500_paragraphs_at_two_seconds_a_call_come_in_partial_with_the_note(self):
        fake = SlowNotion({PAGE: paragraphs(1500)}, delay=0.2)
        response = self.post(fake, budget=2.5)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["partial"])
        self.assertIn("Notion was slow to answer", body["note"])
        self.assertGreaterEqual(len(body["text"].splitlines()), 1000)

    def test_nothing_already_read_is_dropped_when_a_later_listing_is_too_slow(self):
        # V2, root: the second listing answers after the deadline; the first 100 blocks stay.
        fake = SlowNotion({PAGE: paragraphs(300)}, delays={(PAGE, 100): 1.5})
        page = read(fake, budget=0.4)
        self.assertEqual(len(page.body.splitlines()), 100)
        self.assertTrue(page.partial)
        self.assertEqual(page.reason, "time")
        self.assertEqual(page.note, "The rest of this Notion page wasn't imported because Notion was slow to answer.")

    def test_a_nested_listing_keeps_the_blocks_fetched_before_the_deadline(self):
        # V2, nested: a toggle's second listing is too slow; its first 100 children stay.
        tree = {PAGE: [block("paragraph", "Before the toggle"), block("toggle", "Big toggle", block_id="tg", children=True)], "tg": paragraphs(250, "K")}
        fake = SlowNotion(tree, delays={("tg", 100): 1.5})
        page = read(fake, budget=0.4)
        text = page.body
        self.assertIn("Before the toggle", text)
        self.assertIn("K0", text)
        self.assertIn("K99", text)
        self.assertNotIn("K100", text)
        self.assertTrue(page.partial)
        self.assertEqual(page.reason, "time")

    def test_a_listing_that_never_answers_is_a_502_only_when_nothing_came_back(self):
        fake = SlowNotion({PAGE: paragraphs(10)}, delays={(PAGE, 0): 1.5})
        response = self.post(fake, budget=0.3)
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(response.json()["detail"], "Notion was slow to answer. Try again in a minute.")

    def test_a_retry_after_a_partial_import_is_not_a_502(self):
        fake = SlowNotion({PAGE: paragraphs(3000)}, delay=0.1)
        for _ in range(2):
            self.assertEqual(self.post(fake, budget=1.0).status_code, 200)

    def test_the_library_path_takes_a_partial_page_and_says_so(self):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        fake = SlowNotion({PAGE: [block("paragraph", f"Point {i}") for i in range(3000)]}, delay=0.1)
        with patch("routers.drive.get_supabase", return_value=db), patch("services.library_import.get_supabase", return_value=db), \
                patch("services.library_import.guide_title", return_value="Slow page"):
            response = self.post(fake, "library", budget=1.0, folder_id=FOLDER)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["partial"])
        self.assertIn("slow to answer", response.json()["note"])
        self.assertTrue(db.rows("study_guides"))


class TutorNeverFails(Base):
    """The Tutor answers even when Notion can't: a Notion read is never a 502 on the chat message."""

    def material(self, run, question='Quiz me on my Notion page "Week 3 notes"', budget=None):
        from routers import connectors
        from services import notion_text
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True}), patch("services.composio.run", side_effect=run), \
                patch.object(notion_text, "TUTOR_TIME_BUDGET", budget or notion_text.TUTOR_TIME_BUDGET):
            return connectors.tutor_material(USER, question)

    @staticmethod
    def search(fake):
        def run(account, user, slug, arguments):
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                return {"results": [{"id": PAGE, "object": "page", "properties": {"title": {"type": "title", "title": [{"plain_text": "Week 3 notes"}]}}}]}
            return fake(account, user, slug, arguments)
        return run

    def test_a_long_flat_page_gives_what_was_read_and_a_note(self):
        found = self.material(self.search(SlowNotion({PAGE: paragraphs(3000)}, delay=0.1)), budget=1.5)
        self.assertNotIn("problem", found)
        self.assertGreater(len(found["text"].splitlines()), 500)
        self.assertNotIn("wasn't imported", found["text"])
        self.assertIn("slow to answer", found["note"])

    def test_a_failing_read_is_a_plain_problem_not_an_error(self):
        found = self.material(self.search(SlowNotion({PAGE: paragraphs(10)}, fail={PAGE})))
        self.assertIn("slow to answer", found["problem"])

    def test_a_failing_search_is_a_plain_problem_not_an_error(self):
        def run(account, user, slug, arguments):
            raise HTTPException(status_code=502, detail="The app didn't respond.")
        found = self.material(run)
        self.assertIn("slow to answer", found["problem"])

    def test_a_page_that_never_answers_stays_inside_the_budget(self):
        started = time.monotonic()
        found = self.material(self.search(SlowNotion({PAGE: paragraphs(10)}, delay=1.5)), budget=0.4)
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertIn("slow to answer", found["problem"])

    def test_the_note_goes_on_the_answer_not_into_the_material(self):
        from routers import chat
        from schemas import ChatResponse
        fake = SlowNotion({PAGE: paragraphs(3000)}, delay=0.1)
        material = self.material(self.search(fake), budget=1.0)
        with patch.object(chat.connectors, "tutor_material", return_value=material), \
                patch.object(chat, "_tutor_reply", return_value=ChatResponse(answer="Here is a quiz.")) as reply:
            body = chat.ChatRequest(question="quiz me on my notion page", content="")
            answer = chat._reply(body, USER, "quiz me on my notion page", chat.Material(content=""), None, None, None, "Bearer t")
        self.assertNotIn("wasn't imported", reply.call_args[0][3].content)
        self.assertTrue(answer.answer.startswith("Here is a quiz."))
        self.assertIn("slow to answer", answer.answer)


class NothingLeaksIntoGuides(Base):
    """R-M2: the partial note and sub-page titles are never study content (probe_outline.py)."""

    def test_the_probe_case_makes_no_note_bullet_and_no_sub_page_section(self):
        from services import notion_text as nt
        from services.text_processing import text_to_outline
        page = nt.PageRead(body="# Week 3\n- Glycolysis\n  - 2 ATP net\nSub-page: Lecture 4", partial=True, reason="time")
        outline = text_to_outline(page.text)
        self.assertNotIn("Sub-page", outline)
        self.assertNotIn("wasn't imported", outline)
        self.assertIn("2 ATP net", outline)
        # Even when the note is put on by hand, the outline drops it.
        for reason in nt._NOTES:
            hand = f"# Week 3\n- Glycolysis\n  - 2 ATP net\n\n{nt._NOTES[reason]}"
            self.assertNotIn("Notion page", text_to_outline(hand), reason)

    def test_a_page_with_sub_pages_keeps_titles_out_of_the_text_and_in_the_response(self):
        tree = {PAGE: [block("heading_1", "Week 3"), block("paragraph", "Overview of the week."), child_page("Lecture 3", "cp3"),
                       {"object": "block", "id": "db", "type": "child_database", "has_children": False, "child_database": {"title": "Flashcards"}}]}
        response = self.post(SlowNotion(tree))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"].splitlines(), ["# Week 3", "Overview of the week."])
        self.assertEqual(response.json()["sub_pages"], ["Lecture 3", "Flashcards"])

    def test_a_partial_library_import_files_no_note_and_no_sub_page_line(self):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        tree = {PAGE: [block("heading_1", "Week 3"), block("bulleted_list_item", "Glycolysis makes ATP"), child_page("Lecture 4", "cp4"),
                       block("toggle", "Closed toggle", block_id="tg", children=True)], "tg": [block("paragraph", "Hidden")]}
        fake = SlowNotion(tree, fail={"tg"})
        with patch("routers.drive.get_supabase", return_value=db), patch("services.library_import.get_supabase", return_value=db), \
                patch("services.library_import.guide_title", return_value="Week 3"):
            response = self.post(fake, "library", folder_id=FOLDER)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["partial"])
        notes = db.rows("study_guides")[0]["notes"]
        self.assertIn("Glycolysis makes ATP", notes)
        for stray in ("Sub-page", "Lecture 4", "wasn't imported", "couldn't be read"):
            self.assertNotIn(stray, notes)

    def test_the_text_processing_pattern_matches_every_note_the_reader_writes(self):
        from services import notion_text as nt
        from services.text_processing import clean_text
        for note in nt._NOTES.values():
            self.assertEqual(clean_text(f"Cells make ATP from glucose.\n{note}\nMitochondria are the site."),
                             "Cells make ATP from glucose.\nMitochondria are the site.")

    def test_a_course_line_that_starts_with_database_is_still_study_content(self):
        from services.text_processing import clean_text
        self.assertIn("Database: normalization removes redundancy", clean_text("Database: normalization removes redundancy\nIt splits tables."))


class HubPage(Base):
    def test_sub_page_names_come_back_for_the_sheet(self):
        fake = SlowNotion({PAGE: [child_page(f"Lecture {i}", f"cp{i}") for i in range(1, 9)]})
        response = self.post(fake)
        self.assertEqual(response.status_code, 422)
        self.assertIn("This page's notes are in its sub-pages: Lecture 1", response.json()["detail"])
        self.assertEqual(response.json()["sub_pages"], [f"Lecture {i}" for i in range(1, 9)])

    def test_the_library_path_names_them_too(self):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        fake = SlowNotion({PAGE: [child_page("Lecture 1", "cp1"), child_page("Lecture 2", "cp2")]})
        with patch("routers.drive.get_supabase", return_value=db), patch("services.library_import.get_supabase", return_value=db):
            response = self.post(fake, "library", folder_id=FOLDER)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["sub_pages"], ["Lecture 1", "Lecture 2"])

    def test_a_cap_hit_before_any_text_says_the_page_is_too_large(self):
        from services import notion_text
        tree = {PAGE: [block("toggle", "", block_id=f"t{i}", children=True) for i in range(5)], **{f"t{i}": [block("divider")] for i in range(5)}}
        with patch.object(notion_text, "MAX_CALLS", 1):
            response = self.post(SlowNotion(tree))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "That page is too large to read here.")


class GentleOnNotion(Base):
    """R-M4: three calls at a time, a 429 retried once, limits and a call budget per student."""

    def test_never_more_than_three_calls_at_once(self):
        tree = {PAGE: [block("toggle", f"Q{i}", block_id=f"t{i}", children=True) for i in range(60)], **{f"t{i}": [block("paragraph", f"A{i}")] for i in range(60)}}
        fake = SlowNotion(tree, delay=0.05)
        response = self.post(fake)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["partial"])
        self.assertEqual(fake.calls, 61)
        self.assertGreater(fake.peak, 1)
        self.assertLessEqual(fake.peak, 3)

    def test_a_429_is_retried_once_after_a_jittered_pause(self):
        from services import notion_text
        tree = {PAGE: [block("toggle", "Q", block_id="t0", children=True)], "t0": [block("paragraph", "The answer")]}
        fake = SlowNotion(tree, busy={"t0": 1})
        pauses = []
        with patch.object(notion_text, "_sleep", side_effect=pauses.append):
            page = read(fake, budget=5)
        self.assertIn("The answer", page.body)
        self.assertFalse(page.partial)
        self.assertEqual(len(pauses), 1)
        self.assertGreater(pauses[0], 0)
        self.assertLessEqual(pauses[0], 2.0)
        # A jitter: not the same number every time.
        seen = set()
        for _ in range(12):
            seen.add(notion_text._pause())
        self.assertGreater(len(seen), 1)

    def test_a_429_that_keeps_coming_is_retried_only_once_and_counts_as_a_missed_read(self):
        from services import notion_text
        tree = {PAGE: [block("paragraph", "Kept"), block("toggle", "Q", block_id="t0", children=True)], "t0": [block("paragraph", "The answer")]}
        fake = SlowNotion(tree, busy={"t0": 5})
        pauses = []
        with patch.object(notion_text, "_sleep", side_effect=pauses.append):
            page = read(fake, budget=5)
        self.assertEqual(sum(1 for call in fake.log if call[0] == "t0"), 2)
        self.assertEqual(len(pauses), 1)
        self.assertTrue(page.partial)
        self.assertEqual(page.reason, "missed")
        self.assertIn("Kept", page.body)

    def test_the_import_limit_is_per_student_not_per_address(self):
        from rate_limit import limiter
        limiter.reset()
        fake = SlowNotion({PAGE: [block("paragraph", "Some notes here")]})
        statuses = [self.post(fake).status_code for _ in range(10)]
        self.assertEqual(statuses, [200] * 10)
        # Same address, another student: their own allowance.
        self.user = OTHER
        self.assertEqual(self.post(fake).status_code, 200)
        # The first student, from the same address, is at their limit.
        self.user = USER
        over = self.post(fake)
        self.assertEqual(over.status_code, 429, over.text)
        self.assertIn("Too many requests", over.json()["detail"])

    def test_the_library_limit_is_per_student_too(self):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        db.rows("folders").append({"id": FOLDER[:-1] + "7", "user_id": OTHER, "name": "Biology"})
        fake = SlowNotion({PAGE: [block("paragraph", "Some notes here")]})
        with patch("routers.drive.get_supabase", return_value=db), patch("services.library_import.get_supabase", return_value=db), \
                patch("services.library_import.guide_title", return_value="Notes"):
            self.assertEqual([self.post(fake, "library", folder_id=FOLDER).status_code for _ in range(10)], [200] * 10)
            self.user = OTHER
            self.assertEqual(self.post(fake, "library", folder_id=FOLDER[:-1] + "7").status_code, 200)
            self.user = USER
            self.assertEqual(self.post(fake, "library", folder_id=FOLDER).status_code, 429)

    def test_a_student_has_a_notion_call_budget_with_a_plain_message(self):
        from services import notion_text
        tree = {PAGE: [block("toggle", f"Q{i}", block_id=f"t{i}", children=True) for i in range(30)], **{f"t{i}": [block("paragraph", f"A{i}")] for i in range(30)}}
        with patch.object(notion_text, "CALL_BUDGET", 12):
            response = self.post(SlowNotion(tree))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["partial"])
            self.assertIn("limit of Notion reads", response.json()["note"])
            self.assertNotIn("limit of Notion reads", response.json()["text"])
            # Out of budget: nothing is read, and the message says why and what to do.
            again = self.post(SlowNotion(tree))
        self.assertEqual(again.status_code, 429, again.text)
        self.assertEqual(again.json()["detail"], "You've used a lot of Notion reads in the last hour. Try again in a little while.")

    def test_another_student_has_their_own_budget(self):
        from services import notion_text
        fake = SlowNotion({PAGE: [block("paragraph", "Some notes here")]})
        with patch.object(notion_text, "CALL_BUDGET", 1):
            self.assertEqual(self.post(fake).status_code, 200)
            self.assertEqual(self.post(fake).status_code, 429)
            self.user = OTHER
            self.assertEqual(self.post(fake).status_code, 200)

    def test_the_search_spends_the_budget_too(self):
        from services import notion_text
        with patch.object(notion_text, "CALL_BUDGET", 1), patch("services.composio.run", return_value={"results": []}):
            first = self.client.get("/connectors/notion/files?q=bio", headers=self.auth)
            second = self.client.get("/connectors/notion/files?q=bio", headers=self.auth)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 429, second.text)

    def test_composio_names_a_rate_limit_so_the_read_can_retry(self):
        from services import composio

        class Response:
            status_code, ok, content = 429, False, b"{}"

            @staticmethod
            def json():
                return {"successful": False, "error": "Too many requests"}
        with patch("services.composio._request", return_value=Response()):
            with self.assertRaises(HTTPException) as caught:
                composio.run("ca", USER, "NOTION_FETCH_BLOCK_CONTENTS", {})
        self.assertEqual(caught.exception.status_code, 429)


class LibraryPath(Base):
    """V1 and R-M3: a cut on the Library path says so; a slow re-import never replaces a longer copy."""

    def setUp(self):
        super().setUp()
        from fake_supabase import FakeDB
        self.db = FakeDB()
        self.db.rows("folders").append({"id": FOLDER, "user_id": USER, "name": "Biology"})
        for p in [patch("routers.drive.get_supabase", return_value=self.db), patch("services.library_import.get_supabase", return_value=self.db),
                  patch("services.library_import.guide_title", return_value="Notes")]:
            p.start()
            self.addCleanup(p.stop)

    def test_more_than_400_points_sets_partial_and_says_so(self):
        # V1: 500 bullets read in full, then cut by the outline's 400-point limit.
        tree = {PAGE: [block("bulleted_list_item", f"Point number {i}") for i in range(500)]}
        response = self.post(SlowNotion(tree), "library", folder_id=FOLDER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["partial"])
        self.assertIn("first 400 points", body["note"])
        self.assertEqual(self.db.rows("study_guides")[0]["notes"].count("\n- ") + 1, 400)

    def test_a_page_under_the_limit_is_not_partial(self):
        response = self.post(SlowNotion({PAGE: [block("bulleted_list_item", f"Point number {i}") for i in range(40)]}), "library", folder_id=FOLDER)
        self.assertFalse(response.json()["partial"])
        self.assertEqual(response.json()["note"], "")

    def test_the_outline_reports_a_cut(self):
        from services.text_processing import outline_from_text, text_to_outline
        text = "\n".join(f"- Point number {i}" for i in range(450))
        outline, cut = outline_from_text(text)
        self.assertTrue(cut)
        self.assertEqual(outline, text_to_outline(text))
        self.assertFalse(outline_from_text("- One point here\n- Another point here")[1])

    def full_copy(self):
        tree = {PAGE: [block("bulleted_list_item", f"Point number {i}") for i in range(60)]}
        self.assertEqual(self.post(SlowNotion(tree), "library", folder_id=FOLDER).status_code, 200)
        return self.db.rows("study_guides")[0]["notes"]

    def test_a_shorter_partial_import_does_not_replace_the_copy(self):
        before = self.full_copy()
        short = {PAGE: [block("bulleted_list_item", f"Point number {i}") for i in range(5)], "x": []}
        tree = {PAGE: short[PAGE] + [block("toggle", "Closed", block_id="tg", children=True)]}
        response = self.post(SlowNotion(tree, fail={"tg"}), "library", folder_id=FOLDER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["kept"])
        self.assertTrue(body["partial"])
        self.assertEqual(self.db.rows("study_guides")[0]["notes"], before)
        self.assertEqual(len(self.db.rows("study_guides")), 1)

    def test_the_slow_copy_note_names_the_slowness(self):
        self.full_copy()
        tree = {PAGE: [block("bulleted_list_item", "Point number 0")]}
        slow = SlowNotion({**tree, PAGE: tree[PAGE] + paragraphs(300)}, delays={(PAGE, 100): 1.5})
        response = self.post(slow, "library", budget=0.4, folder_id=FOLDER)
        self.assertTrue(response.json()["kept"])
        self.assertEqual(response.json()["note"], "Notion was slow; your earlier copy was kept.")

    def test_a_full_reimport_still_refreshes_untouched_notes(self):
        self.full_copy()
        tree = {PAGE: [block("bulleted_list_item", f"Point number {i}") for i in range(60)] + [block("bulleted_list_item", "A new point")]}
        response = self.post(SlowNotion(tree), "library", folder_id=FOLDER)
        self.assertFalse(response.json()["kept"])
        self.assertIn("A new point", self.db.rows("study_guides")[0]["notes"])


if __name__ == "__main__":
    unittest.main()
