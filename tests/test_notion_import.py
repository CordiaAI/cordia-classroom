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

        wide_calls = []

        def wide(account, user, slug, arguments):
            wide_calls.append(arguments["block_id"])
            return listing(*[block("paragraph", f"Paragraph {n} of a very long page.", block_id=f"w{len(wide_calls)}-{n}") for n in range(100)],
                           has_more=True, cursor=f"c{len(wide_calls)}")
        with patch("services.composio.run", side_effect=wide):
            response = self.client.post("/connectors/notion/import", headers=self.auth, json={"id": PAGE, "title": "p"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertLessEqual(len(wide_calls), notion_text.MAX_CALLS)
        self.assertLessEqual(len(response.json()["text"].splitlines()), notion_text.MAX_BLOCKS)

    def test_no_readable_text_only_after_the_attempt_finds_none(self):
        empty = {(PAGE, None): [block("paragraph", ""), block("divider"), block("image", "", external={"url": "https://example.com/a.png"}), block("to_do", "")]}
        response, _ = self.read(empty)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "That file has no readable text.")
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


if __name__ == "__main__":
    unittest.main()
