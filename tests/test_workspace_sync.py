"""Phase 4: Google Docs (export, linked drafts, stall nudges) and Notion (course database, toggle export)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
NOW = datetime.now(timezone.utc).replace(microsecond=0)
DUE = (NOW + timedelta(days=3)).isoformat()
ITEMS = [{"id": "canvas-1", "title": "Essay 2", "due_at": DUE, "course": "ENG 102", "done": False, "url": "https://canvas/a/1"}]


class Base(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.calls = []
        self.patches = [patch(f"{m}.get_supabase", return_value=self.db) for m in
                        ("services.docs_sync", "services.notion_sync", "services.sync_state", "services.google_sync", "services.drive_sync")]
        self.patches += [patch("services.composio.account_for", return_value="ca"),
                         patch("services.composio.active_accounts", return_value={"gdocs": "ca", "gdrive": "cd", "notion": "cn"}),
                         patch("services.composio.run", side_effect=self.run_tool),
                         patch("routers.calendar.calendar_for", side_effect=lambda _u: {"items": [dict(i) for i in self.items]})]
        self.items = ITEMS
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def run_tool(self, account, user, slug, args):
        self.calls.append((slug, args))
        return self.answer(slug, args)

    def answer(self, slug, args):
        return {}


class Docs(Base):
    def answer(self, slug, args):
        if slug == "GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN":
            return {"documentId": f"doc{len(self.calls)}"}
        if slug == "GOOGLEDRIVE_FIND_FILE":
            return {"files": [{"id": "cordia-folder"}]}
        if slug == "GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT":
            return {"plain_text": "word " * self.words}
        return {}

    def test_export_makes_a_formatted_doc_in_the_cordia_folder_and_replaces_the_last(self):
        from services import docs_sync
        first = docs_sync.export_guide(USER, "g1", "Cells", "# Cells\n- ATP")
        second = docs_sync.export_guide(USER, "g1", "Cells", "# Cells\n- ATP\n- More")
        self.assertIn("docs.google.com/document/d/", second["url"])
        moves = [a for s, a in self.calls if s == "GOOGLEDRIVE_MOVE_FILE"]
        self.assertEqual({a["add_parents"] for a in moves}, {"cordia-folder"})
        self.assertEqual([a["file_id"] for s, a in self.calls if s == "GOOGLEDRIVE_TRASH_FILE"], [first["doc_id"]])

    def test_a_stalled_draft_near_its_deadline_gets_one_nudge(self):
        from services import docs_sync
        self.words = 400
        docs_sync.link_draft(USER, "canvas-1", "draftdoc", "Essay 2 draft")
        row = next(r for r in self.db.rows("connector_settings") if r["connector"] == "gdocs")
        row["stats"]["drafts"]["canvas-1"] = [[(NOW - timedelta(days=3)).isoformat(), 400], [(NOW - timedelta(days=1)).isoformat(), 400]]
        self.assertEqual(docs_sync.check_drafts(USER), 1)
        self.assertEqual(docs_sync.check_drafts(USER), 0)  # Once a day, not every run.
        alerts = next(r for r in self.db.rows("connector_settings") if r["connector"] == "gdocs")["stats"]["alerts"]
        self.assertEqual([(a["kind"], a["item_key"]) for a in alerts], [("draft_stalled", "canvas-1")])

    def test_growing_drafts_are_not_stalled(self):
        from services.docs_sync import stalled
        points = [[(NOW - timedelta(days=3)).isoformat(), 300], [(NOW - timedelta(hours=1)).isoformat(), 900]]
        self.assertFalse(stalled(points, NOW))
        self.assertFalse(stalled(points[:1], NOW))


class Notion(Base):
    def setUp(self):
        super().setUp()
        self.rows = {}

    def answer(self, slug, args):
        if slug == "NOTION_CREATE_DATABASE":
            return {"id": "db1"}
        if slug == "NOTION_QUERY_DATABASE":
            return {"results": list(self.rows.values()), "has_more": False}
        if slug == "NOTION_INSERT_ROW_DATABASE":
            row_id = f"row{len(self.rows) + 1}"
            self.rows[row_id] = {"id": row_id, "properties": {"Status": {"select": {"name": "Not started"}}}}
            return {"id": row_id}
        if slug == "NOTION_CREATE_NOTION_PAGE":
            return {"id": f"page{len(self.calls)}", "url": "https://www.notion.so/x"}
        return {}

    def test_database_rows_two_way_and_deleted_rows_stay_deleted(self):
        from services import notion_sync
        notion_sync.setup(USER, "home1", "School")
        create = next(a for s, a in self.calls if s == "NOTION_CREATE_DATABASE")
        self.assertEqual(create["parent_id"], "home1")
        inserted = next(a for s, a in self.calls if s == "NOTION_INSERT_ROW_DATABASE")
        self.assertEqual({p["name"]: p["value"] for p in inserted["properties"]}["Status"], "Not started")
        self.rows["row1"]["properties"]["Status"] = {"select": {"name": "Done"}}
        self.assertEqual(notion_sync.sync_db(USER)["done_in_notion"], 1)
        self.assertTrue(self.db.rows("deadline_marks")[0]["done"])
        del self.rows["row1"]
        notion_sync.sync_db(USER)
        self.assertEqual(len([s for s, _ in self.calls if s == "NOTION_INSERT_ROW_DATABASE"]), 1)

    def test_a_moved_due_date_updates_the_row(self):
        from services import notion_sync
        notion_sync.setup(USER, "home1", "School")
        self.items = [{**ITEMS[0], "due_at": (NOW + timedelta(days=5)).isoformat()}]
        notion_sync.sync_db(USER)
        update = next(a for s, a in self.calls if s == "NOTION_UPDATE_ROW_DATABASE")
        self.assertEqual({p["name"]: p["value"] for p in update["properties"]}["Due"], self.items[0]["due_at"])

    def test_guide_export_puts_each_question_in_a_toggle_and_replaces_the_last(self):
        from services import notion_sync
        notion_sync.setup(USER, "home1", "School")
        pairs = [{"question": "What makes ATP?", "answer": "Mitochondria <via respiration>"}]
        first = notion_sync.export_guide(USER, "g1", "Cells", "## Energy\n- ATP", pairs)
        notion_sync.export_guide(USER, "g1", "Cells", "## Energy\n- ATP", pairs)
        page = next(a for s, a in self.calls if s == "NOTION_CREATE_NOTION_PAGE")
        self.assertEqual(page["parent_id"], "home1")
        self.assertIn("<details>\n<summary>What makes ATP?</summary>", page["markdown"])
        self.assertNotIn("<via", page["markdown"])
        self.assertEqual([a for s, a in self.calls if s == "NOTION_UPDATE_PAGE"], [{"page_id": first["page_id"], "archived": True}])

    def test_export_needs_a_home_page(self):
        from fastapi import HTTPException
        from services import notion_sync
        with self.assertRaises(HTTPException):
            notion_sync.export_guide(USER, "g1", "Cells", "", [])


if __name__ == "__main__":
    unittest.main()
