"""Settings > Connectors > Notion: a page's blocks become the text a guide is made from.

The fakes below are shaped like Notion's block objects (to-do lists, plain text pages, toggles with
nested bullets), handed back the way Composio returns them. The real Notion and Composio APIs are
never called."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

USER = "11111111-2222-4333-8444-555555555555"
PAGE = "0c9e8d3a-1111-4222-8333-444455556666"


def rich(text):
    return [{"type": "text", "text": {"content": text, "link": None}, "annotations": {"bold": False}, "plain_text": text, "href": None}]


def block(kind, text="", block_id=None, children=False, **extra):
    body = {"rich_text": rich(text) if text else [], "color": "default", **extra}
    return {"object": "block", "id": block_id or f"b-{kind}-{abs(hash(text)) % 10_000}", "type": kind, "has_children": children,
            "archived": False, kind: body}


def listing(*blocks, has_more=False, cursor=None, nested=None):
    """A page of children: Notion's own shape, or wrapped the way Composio can return it."""
    page = {"object": "list", "results": list(blocks), "has_more": has_more, "next_cursor": cursor}
    return {nested: page} if nested else page


class Pages:
    """A fake Notion: children by parent block id. Each call is kept in .calls."""

    def __init__(self, tree, nested=None):
        self.tree, self.nested, self.calls = tree, nested, []

    def __call__(self, account, user, slug, arguments):
        self.calls.append((account, user, slug, dict(arguments)))
        assert slug == "NOTION_FETCH_BLOCK_CONTENTS", slug
        out = self.tree.get((arguments["block_id"], arguments.get("start_cursor")), [])
        if isinstance(out, dict):
            return out
        return listing(*out, nested=self.nested)


class NotionTextTests(unittest.TestCase):
    def setUp(self):
        import os
        os.environ.setdefault("RETAIN_SIGNING_KEY", "test-key")
        from fastapi.testclient import TestClient
        from main import app
        from rate_limit import limiter
        from services import notion_text
        notion_text.reset_gates()  # calls an earlier test gave up waiting for still count until they end
        limiter.reset()  # imports allow 10 a minute per client; each test makes several
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer t"}
        for p in [patch("routers.connectors.get_user_id", return_value=USER), patch("services.composio.account_for", return_value="ca_mine")]:
            p.start()
            self.addCleanup(p.stop)

    def read(self, tree, nested=None, page=PAGE):
        fake = Pages(tree, nested)
        with patch("services.composio.run", side_effect=fake):
            response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": page, "title": "My page"})
        return response, fake

    def test_a_to_do_list_imports_every_item(self):
        tree = {(PAGE, None): [
            block("to_do", "Read chapter 4 on cell division", checked=False),
            block("to_do", "Finish the lab report", checked=True),
            block("to_do", "Email Professor Chen about the extension", checked=False),
            block("to_do", "Flashcards for Friday's quiz", checked=False),
        ]}
        response, _ = self.read(tree)
        self.assertEqual(response.status_code, 200, response.text)
        text = response.json()["text"]
        for item in ("Read chapter 4 on cell division", "Finish the lab report", "Email Professor Chen about the extension", "Flashcards for Friday's quiz"):
            self.assertIn(item, text)
        self.assertEqual(response.json()["title"], "My page")

    def test_a_plain_text_page_keeps_headings_and_paragraphs_in_order(self):
        tree = {(PAGE, None): [
            block("heading_1", "Cell respiration"),
            block("paragraph", "Cells turn glucose into ATP."),
            block("heading_2", "Glycolysis"),
            block("paragraph", "Glycolysis splits one glucose into two pyruvate molecules."),
            block("paragraph", ""),
            block("quote", "Energy cannot be created or destroyed."),
            block("callout", "Remember: the Krebs cycle runs twice per glucose."),
            block("code", "ATP = ADP + Pi", language="plain text"),
            block("divider"),
            block("numbered_list_item", "Glycolysis"),
            block("numbered_list_item", "Krebs cycle"),
        ]}
        response, _ = self.read(tree)
        self.assertEqual(response.status_code, 200, response.text)
        lines = response.json()["text"].splitlines()
        self.assertEqual(lines[0], "# Cell respiration")
        self.assertEqual(lines[1], "Cells turn glucose into ATP.")
        self.assertEqual(lines[2], "## Glycolysis")
        text = response.json()["text"]
        for part in ("Energy cannot be created or destroyed.", "Remember: the Krebs cycle runs twice per glucose.", "ATP = ADP + Pi"):
            self.assertIn(part, text)
        self.assertIn("1. Glycolysis", text)
        self.assertIn("2. Krebs cycle", text)

    def test_toggles_and_nested_bullets_are_followed(self):
        tree = {
            (PAGE, None): [
                block("toggle", "Week 3: Genetics", block_id="tg1", children=True),
                block("bulleted_list_item", "Top level point", block_id="bl1", children=True),
            ],
            ("tg1", None): [
                block("paragraph", "Mendel crossed pea plants."),
                block("bulleted_list_item", "Dominant alleles mask recessive ones", block_id="bl2", children=True),
            ],
            ("bl2", None): [block("bulleted_list_item", "Unless dominance is incomplete")],
            ("bl1", None): [block("to_do", "Check the sub-point", checked=False)],
        }
        response, fake = self.read(tree)
        self.assertEqual(response.status_code, 200, response.text)
        text = response.json()["text"]
        for part in ("Week 3: Genetics", "Mendel crossed pea plants.", "Dominant alleles mask recessive ones", "Unless dominance is incomplete", "Check the sub-point"):
            self.assertIn(part, text)
        self.assertIn("  - Dominant alleles mask recessive ones", text)
        self.assertIn("    - Unless dominance is incomplete", text)
        # Only this student's own connection is used, for every call.
        self.assertTrue(all(call[:2] == ("ca_mine", USER) for call in fake.calls))
        self.assertEqual({call[3]["block_id"] for call in fake.calls}, {PAGE, "tg1", "bl1", "bl2"})

    def test_composio_wraps_the_block_list_in_block_child_data(self):
        tree = {(PAGE, None): [block("paragraph", "Wrapped paragraph text here."), block("to_do", "Wrapped to-do item", checked=False)]}
        response, _ = self.read(tree, nested="block_child_data")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("Wrapped paragraph text here.", response.json()["text"])
        self.assertIn("Wrapped to-do item", response.json()["text"])

    def test_text_shapes_without_plain_text_and_the_older_text_key(self):
        bare = {"object": "block", "id": "x1", "type": "paragraph", "has_children": False,
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": "Only content, no plain_text."}}]}}
        older = {"object": "block", "id": "x2", "type": "bulleted_list_item", "has_children": False,
                 "bulleted_list_item": {"text": [{"type": "text", "plain_text": "Older text array item"}]}}
        equation = {"object": "block", "id": "x3", "type": "equation", "has_children": False, "equation": {"expression": "E = mc^2"}}
        response, _ = self.read({(PAGE, None): [bare, older, equation]})
        self.assertEqual(response.status_code, 200, response.text)
        for part in ("Only content, no plain_text.", "Older text array item", "E = mc^2"):
            self.assertIn(part, response.json()["text"])

    def test_tables_and_columns_and_captions(self):
        row = {"object": "block", "id": "r1", "type": "table_row", "has_children": False,
               "table_row": {"cells": [rich("Term"), rich("Meaning")]}}
        tree = {
            (PAGE, None): [
                {"object": "block", "id": "t1", "type": "table", "has_children": True, "table": {"table_width": 2, "has_column_header": True}},
                {"object": "block", "id": "cl1", "type": "column_list", "has_children": True, "column_list": {}},
                block("image", "", external={"url": "https://example.com/a.png"}, caption=rich("Figure 2: the cell cycle")),
            ],
            ("t1", None): [row],
            ("cl1", None): [{"object": "block", "id": "c1", "type": "column", "has_children": True, "column": {}}],
            ("c1", None): [block("paragraph", "Text inside a column.")],
        }
        response, _ = self.read(tree)
        self.assertEqual(response.status_code, 200, response.text)
        text = response.json()["text"]
        self.assertIn("Term | Meaning", text)
        self.assertIn("Text inside a column.", text)
        self.assertIn("Figure 2: the cell cycle", text)

    def test_a_long_page_is_read_to_the_end(self):
        first = [block("paragraph", f"First screen paragraph number {n}.") for n in range(3)]
        tree = {
            (PAGE, None): listing(*first, has_more=True, cursor="cur-2"),
            (PAGE, "cur-2"): listing(block("paragraph", "Paragraph from the second page of results."), has_more=False),
        }
        response, fake = self.read(tree)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("Paragraph from the second page of results.", response.json()["text"])
        self.assertEqual([call[3].get("start_cursor") for call in fake.calls], [None, "cur-2"])

    def test_a_later_failure_keeps_the_text_already_read(self):
        from fastapi import HTTPException
        calls = []

        def run(account, user, slug, arguments):
            calls.append(arguments["block_id"])
            if arguments["block_id"] == "tg1":
                raise HTTPException(status_code=502, detail="The app didn't respond. Try again in a minute.")
            return listing(block("paragraph", "The part that did load fine."), block("toggle", "Closed toggle", block_id="tg1", children=True))
        with patch("services.composio.run", side_effect=run):
            response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("The part that did load fine.", response.json()["text"])

    def test_deep_and_huge_pages_stop_at_the_caps(self):
        from services import notion_text
        depth_seen = []

        def run(account, user, slug, arguments):
            level = int(arguments["block_id"].split("-")[1]) if arguments["block_id"].startswith("lvl-") else 0
            depth_seen.append(level)
            return listing(block("bulleted_list_item", f"Level {level + 1} point", block_id=f"lvl-{level + 1}", children=True))
        with patch("services.composio.run", side_effect=run):
            response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertLessEqual(max(depth_seen), notion_text.MAX_DEPTH)
        self.assertLessEqual(len(depth_seen), notion_text.MAX_CALLS)
        # The deepest level's own children were left out, and the import says so.
        self.assertTrue(response.json()["partial"])

        wide_calls = []

        def wide(account, user, slug, arguments):
            wide_calls.append(arguments["block_id"])
            return listing(*[block("paragraph", f"Paragraph {n} of a very long page.", block_id=f"w{len(wide_calls)}-{n}") for n in range(100)],
                           has_more=True, cursor=f"c{len(wide_calls)}")
        with patch("services.composio.run", side_effect=wide):
            response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertLessEqual(len(wide_calls), notion_text.MAX_CALLS)
        # The blocks, then a blank line and the line that says the rest wasn't imported.
        self.assertLessEqual(len(response.json()["text"].splitlines()), notion_text.MAX_BLOCKS + 2)
        self.assertTrue(response.json()["partial"])

    def test_no_readable_text_only_after_the_attempt_finds_none(self):
        empty = {(PAGE, None): [block("paragraph", ""), block("divider"), block("image", "", external={"url": "https://example.com/a.png"}), block("to_do", "")]}
        response, _ = self.read(empty)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "That page has no readable text.")
        # A real page, even a very short to-do, does not say it.
        short, _ = self.read({(PAGE, None): [block("to_do", "Gym", checked=False)]})
        self.assertEqual(short.status_code, 200, short.text)
        self.assertIn("Gym", short.json()["text"])

    def test_odd_payloads_are_a_client_error_never_a_500(self):
        for payload in ({}, {"results": "nope"}, {"results": [None, 3, "x", {"type": 5}]}, {"block_child_data": None}, {"items": [{"id": 1}]}):
            with patch("services.composio.run", return_value=payload):
                response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})
            self.assertEqual(response.status_code, 422, (payload, response.text))

    def test_the_tutor_reads_a_to_do_page_the_same_way(self):
        from routers import connectors
        fake = Pages({(PAGE, None): [block("to_do", "Practice problems 1 to 10", checked=False), block("to_do", "Review lecture 7", checked=True)]})

        def run(account, user, slug, arguments):
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                return {"results": [{"id": PAGE, "object": "page", "properties": {"title": {"type": "title", "title": [{"plain_text": "Study list"}]}}}]}
            return fake(account, user, slug, arguments)
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True, "assistant": True}), patch("services.composio.run", side_effect=run):
            found = connectors.tutor_material(USER, 'Quiz me on my Notion page "Study list"')
        self.assertIn("Practice problems 1 to 10", found["text"])
        self.assertIn("Review lecture 7", found["text"])

    def test_library_import_takes_a_to_do_page(self):
        from fake_supabase import FakeDB
        db = FakeDB()
        db.rows("folders").append({"id": "f0f0f0f0-1111-4222-8333-444455556666", "user_id": USER, "name": "Biology"})
        fake = Pages({(PAGE, None): [block("heading_2", "This week"), block("to_do", "Read chapter 4 on cell division", checked=False),
                                     block("to_do", "Finish the lab report", checked=False)]})
        with patch("services.composio.run", side_effect=fake), patch("routers.drive.get_supabase", return_value=db), \
                patch("services.library_import.get_supabase", return_value=db), patch("services.library_import.guide_title", return_value="Study list"):
            response = self.client.post("/connectors/notion/library", headers=self.auth,
                                        json={"id": PAGE, "title": "Study list", "folder_id": "f0f0f0f0-1111-4222-8333-444455556666"})
        self.assertEqual(response.status_code, 200, response.text)
        notes = db.rows("study_guides")[0]["notes"]
        self.assertIn("Read chapter 4 on cell division", notes)


def child_page(title, block_id):
    return {"object": "block", "id": block_id, "type": "child_page", "has_children": True, "child_page": {"title": title}}


class ThreadSafePages:
    """A fake Notion that can be slow (each call sleeps `delay` seconds) and keeps how many calls ran at once."""

    def __init__(self, tree, delay=0.0, hang=()):
        import threading
        self.tree, self.delay, self.hang, self.lock = tree, delay, set(hang), threading.Lock()
        self.calls, self.running, self.peak = [], 0, 0

    def __call__(self, account, user, slug, arguments):
        import time
        with self.lock:
            self.calls.append(arguments["block_id"])
            self.running += 1
            self.peak = max(self.peak, self.running)
        try:
            time.sleep(3.0 if arguments["block_id"] in self.hang else self.delay)
        finally:
            with self.lock:
                self.running -= 1
        return listing(*self.tree.get((arguments["block_id"], arguments.get("start_cursor")), []))


def toggles(count, answer=lambda i: f"Answer {i}"):
    tree = {(PAGE, None): [block("toggle", f"Question {i}", block_id=f"t{i}", children=True) for i in range(count)]}
    for i in range(count):
        tree[(f"t{i}", None)] = [block("paragraph", answer(i))]
    return tree


class NotionBudgetTests(unittest.TestCase):
    """Review fixes: a nested page imports inside the client's wait, a cut-off page says so, and a
    page of sub-pages names them."""

    def setUp(self):
        import os
        os.environ.setdefault("RETAIN_SIGNING_KEY", "test-key")
        from fastapi.testclient import TestClient
        from main import app
        from rate_limit import limiter
        from services import notion_text
        notion_text.reset_gates()
        limiter.reset()
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer t"}
        for p in [patch("routers.connectors.get_user_id", return_value=USER), patch("services.composio.account_for", return_value="ca_mine")]:
            p.start()
            self.addCleanup(p.stop)

    def post(self, fake):
        with patch("services.composio.run", side_effect=fake):
            return self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})

    def test_forty_nested_calls_are_read_a_few_at_a_time_not_one_after_another(self):
        import time
        delay = 0.1
        fake = ThreadSafePages(toggles(40), delay=delay)
        started = time.monotonic()
        response = self.post(fake)
        took = time.monotonic() - started
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["partial"])
        self.assertEqual(len(fake.calls), 41)
        self.assertTrue(all(f"Answer {i}\n" in response.json()["text"] + "\n" for i in range(40)))
        # 41 calls one by one would take 4.1 s; four at a time takes about a quarter of that.
        self.assertLess(took, 41 * delay * 0.5, took)
        from services import notion_text
        self.assertGreater(fake.peak, 1)
        self.assertLessEqual(fake.peak, notion_text.PARALLEL)

    def test_the_time_budget_holds_when_notion_is_slow_or_hangs(self):
        import time
        from services import notion_text
        # Every call takes 0.3 s and a budget of 0.8 s only gets through a few of them; one call never returns.
        fake = ThreadSafePages(toggles(40), delay=0.3, hang={"t5"})
        started = time.monotonic()
        with patch.object(notion_text, "TIME_BUDGET", 0.8):
            response = self.post(fake)
        took = time.monotonic() - started
        self.assertEqual(response.status_code, 200, response.text)
        self.assertLess(took, 1.5, took)
        self.assertTrue(response.json()["partial"])
        text = response.json()["text"]
        self.assertIn("Question 0", text)
        # The note is for the student, not part of the text.
        self.assertEqual(response.json()["note"], "The rest of this Notion page wasn't imported because Notion was slow to answer.")
        self.assertNotIn("wasn't imported", text)
        self.assertLess(len(fake.calls), 41)

    def test_a_first_call_that_never_answers_is_a_502_inside_the_budget(self):
        import time
        from services import notion_text
        fake = ThreadSafePages({}, hang={PAGE})
        started = time.monotonic()
        with patch.object(notion_text, "TIME_BUDGET", 0.5):
            response = self.post(fake)
        self.assertEqual(response.status_code, 502, response.text)
        self.assertLess(time.monotonic() - started, 1.2)

    def test_what_kept_39_answers_before_now_keeps_all_60(self):
        fake = ThreadSafePages(toggles(60))
        response = self.post(fake)
        text = response.json()["text"]
        self.assertEqual(sum(f"Answer {i}\n" in text + "\n" for i in range(60)), 60)
        self.assertFalse(response.json()["partial"])

    def test_a_deep_outline_and_a_2000_paragraph_page_are_read_whole(self):
        tree = {(PAGE, None): []}
        for h in range(12):
            tree[(PAGE, None)].append(block("heading_2", f"H{h}"))
            for b in range(4):
                bid = f"b{h}-{b}"
                tree[(PAGE, None)].append(block("bulleted_list_item", f"B{h}-{b}", block_id=bid, children=True))
                tree[(bid, None)] = [block("bulleted_list_item", f"S{h}-{b}-{s}") for s in range(2)]
        response = self.post(ThreadSafePages(tree))
        self.assertEqual(response.json()["text"].count("  - S"), 96)
        self.assertFalse(response.json()["partial"])
        pages = {(PAGE, None): listing(*[block("paragraph", f"P{i}") for i in range(100)], has_more=True, cursor="c1")}
        for n in range(1, 20):
            pages[(PAGE, f"c{n}")] = listing(*[block("paragraph", f"P{n * 100 + i}") for i in range(100)], has_more=n < 19, cursor=f"c{n + 1}")

        def run(account, user, slug, arguments):
            return pages[(arguments["block_id"], arguments.get("start_cursor"))]
        response = self.post(run)
        self.assertEqual(len(response.json()["text"].splitlines()), 2000)
        self.assertFalse(response.json()["partial"])

    def test_a_page_stopped_by_a_cap_says_so_in_the_text_and_the_response(self):
        from services import notion_text
        for cap, value in (("MAX_CALLS", 10), ("MAX_BLOCKS", 25), ("MAX_DEPTH", 0)):
            with self.subTest(cap=cap), patch.object(notion_text, cap, value), self.assertLogs("services.notion_text", "WARNING") as logged:
                response = self.post(ThreadSafePages(toggles(60)))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["partial"], cap)
            self.assertEqual(response.json()["note"], "The rest of this Notion page wasn't imported because the page is longer than Cordia reads at once.")
            self.assertNotIn("wasn't imported", response.json()["text"])
            self.assertIn("Question 0", response.json()["text"])
            self.assertIn("cut short (size)", logged.output[0])

    def test_a_failed_call_is_said_too(self):
        from fastapi import HTTPException

        def run(account, user, slug, arguments):
            if arguments["block_id"] == "t3":
                raise HTTPException(status_code=502, detail="The app didn't respond.")
            return ThreadSafePages(toggles(6))(account, user, slug, arguments)
        response = self.post(run)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["partial"])
        self.assertIn("Answer 4", response.json()["text"])
        self.assertEqual(response.json()["note"], "Part of this Notion page couldn't be read, so it isn't all here.")
        self.assertNotIn("couldn't be read", response.json()["text"])

    def test_the_character_limit_cuts_at_a_line_and_says_so(self):
        from services import file_extraction
        long_line = "x" * 900
        tree = {(PAGE, None): [block("paragraph", f"{long_line}{i}") for i in range(80)]}
        with patch.object(file_extraction, "MAX_TEXT_CHARS", 10_000):
            response = self.post(ThreadSafePages(tree))
        body = response.json()
        self.assertTrue(body["partial"])
        self.assertLessEqual(len(body["text"]), 10_000)
        self.assertIn("longer than Cordia reads at once", body["note"])
        self.assertTrue(body["text"].splitlines()[-1].startswith("x" * 900))

    def test_a_hub_page_of_sub_pages_names_them(self):
        tree = {(PAGE, None): [child_page(f"Lecture {i}", f"cp{i}") for i in range(1, 9)]}
        fake = ThreadSafePages(tree)
        response = self.post(fake)
        self.assertEqual(response.status_code, 422, response.text)
        detail = response.json()["detail"]
        self.assertEqual(detail, "This page's notes are in its sub-pages: Lecture 1, Lecture 2, Lecture 3, Lecture 4, Lecture 5, Lecture 6 and 2 more. Import one of those.")
        # Sub-pages are not read into this page: one call, for the hub itself.
        self.assertEqual(fake.calls, [PAGE])

    def test_sub_page_titles_are_listed_beside_the_text_not_in_it(self):
        tree = {(PAGE, None): [block("heading_1", "Week 3"), block("paragraph", "Overview of the week."), child_page("Lecture 3", "cp3"),
                               {"object": "block", "id": "db", "type": "child_database", "has_children": False, "child_database": {"title": "Flashcards"}}]}
        response = self.post(ThreadSafePages(tree))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["text"].splitlines(), ["# Week 3", "Overview of the week."])
        self.assertEqual(response.json()["sub_pages"], ["Lecture 3", "Flashcards"])

    def test_one_tutor_message_makes_at_most_the_stated_number_of_notion_calls(self):
        from routers import connectors
        from services import notion_text
        counts = {"search": 0, "blocks": 0}

        def run(account, user, slug, arguments):
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                counts["search"] += 1
                return {"results": [{"id": "P-" + arguments["query"], "object": "page", "properties": {}}]}
            counts["blocks"] += 1
            if arguments["block_id"].startswith("P-"):
                return listing(*[block("toggle", "", block_id=f"T{i}-{arguments['block_id']}", children=True) for i in range(60)])
            return listing(block("divider"))
        question = "quiz me on my notion page about cellular respiration glycolysis"
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True}), patch("services.composio.run", side_effect=run):
            self.assertEqual(len(connectors._search_terms(question, "notion")), 3)
            found = connectors.tutor_material(USER, question)
        total = counts["search"] + counts["blocks"]
        self.assertEqual(counts["search"], 1)  # the first page found is the one read
        self.assertLessEqual(total, notion_text.TUTOR_MAX_CALLS)
        # The call cap stopped the read before any text: it says the page is too large, not that it is empty.
        self.assertIn("too large to read here", found["problem"])

        # Three searches that find nothing, then one that does: still inside the same number.
        counts.update(search=0, blocks=0)

        def late(account, user, slug, arguments):
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                counts["search"] += 1
                return {"results": [{"id": "P", "object": "page"}] if counts["search"] == 3 else []}
            counts["blocks"] += 1
            return listing(block("paragraph", "Glycolysis makes two ATP."))
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True}), patch("services.composio.run", side_effect=late):
            found = connectors.tutor_material(USER, question)
        self.assertIn("Glycolysis makes two ATP.", found["text"])
        self.assertLessEqual(counts["search"] + counts["blocks"], notion_text.TUTOR_MAX_CALLS)

    def test_the_tutor_names_the_sub_pages_of_a_hub(self):
        from routers import connectors

        def run(account, user, slug, arguments):
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                return {"results": [{"id": "HUB", "object": "page", "properties": {"title": {"type": "title", "title": [{"plain_text": "Biology hub"}]}}}]}
            return listing(child_page("Lecture 1", "a"), child_page("Lecture 2", "b"))
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True}), patch("services.composio.run", side_effect=run):
            found = connectors.tutor_material(USER, 'Quiz me on my Notion page "Biology hub"')
        self.assertIn("Lecture 1, Lecture 2", found["problem"])


if __name__ == "__main__":
    unittest.main()
