"""Settings > Connectors: Composio-backed apps, deadline pushes, imports and the Apple Calendar feed."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

USER = "11111111-2222-4333-8444-555555555555"
SOON = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
ITEMS = [
    {"id": "canvas:1", "title": "Lab report", "due_at": SOON.isoformat(), "course": "BIO 101", "url": "https://x.instructure.com/a/1"},
    {"id": "canvas:2", "title": "Essay", "due_at": (SOON + timedelta(days=1)).isoformat(), "done": True},
    {"id": "canvas:3", "title": "Old quiz", "due_at": (SOON - timedelta(days=5)).isoformat()},
]


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        import os
        os.environ.setdefault("RETAIN_SIGNING_KEY", "test-key")
        from fastapi.testclient import TestClient
        from main import app
        from fake_supabase import FakeDB
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer t"}
        self.db = FakeDB()
        self.patches = [
            patch("routers.connectors.get_user_id", return_value=USER),
            patch("routers.connectors.calendar_for", return_value={"items": ITEMS}),
            patch("routers.connectors.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("services.google_sync.get_supabase", return_value=self.db),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_list_marks_connected_apps_and_apple_is_always_available(self):
        with patch("services.composio.configured", return_value=False), patch("services.composio.active_accounts", return_value={}):
            body = self.client.get("/connectors", headers=self.auth).json()
        by_id = {c["id"]: c for c in body["connectors"]}
        self.assertEqual(list(by_id), ["gcal", "apple_calendar", "gtasks", "gdrive", "dropbox", "gdocs", "notion", "gsheets", "github", "slack", "gmail", "outlook", "ynab"])
        self.assertTrue(by_id["apple_calendar"]["available"])
        self.assertFalse(by_id["gcal"]["available"])
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"gcal": "ca_1"}):
            body = self.client.get("/connectors", headers=self.auth).json()
        self.assertTrue(next(c for c in body["connectors"] if c["id"] == "gcal")["connected"])

    def test_list_says_where_each_app_is_used_and_switches_save(self):
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={}), \
                patch("services.connector_settings.for_user", return_value={"notion": {"tutor": False, "assistant": True}}):
            by_id = {c["id"]: c for c in self.client.get("/connectors", headers=self.auth).json()["connectors"]}
        self.assertEqual(by_id["notion"]["uses"], {"tutor": False, "assistant": True})
        self.assertEqual(by_id["slack"]["uses"], {"assistant": True})
        self.assertEqual(by_id["apple_calendar"]["uses"], {})
        with patch("services.connector_settings.save", return_value={"tutor": True, "assistant": False}) as save:
            body = self.client.patch("/connectors/notion/uses", headers=self.auth, json={"assistant": False}).json()
        save.assert_called_once_with(USER, "notion", {"assistant": False})
        self.assertEqual(body["uses"], {"tutor": True, "assistant": False})
        self.assertEqual(self.client.patch("/connectors/slack/uses", headers=self.auth, json={"tutor": True}).status_code, 400)

    def test_tutor_reads_a_named_app_only_when_it_is_on_for_the_tutor(self):
        from routers import connectors
        self.assertIsNone(connectors.tutor_material(USER, "what's on my calendar"))
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={}):
            self.assertIn("isn't connected", connectors.tutor_material(USER, "quiz me on my Notion page")["problem"])
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": False, "assistant": True}):
            self.assertIn("switched off for the Tutor", connectors.tutor_material(USER, "quiz me on my Notion page")["problem"])
        calls = []

        def run(account, user, slug, args):
            calls.append((slug, args))
            if slug == "NOTION_SEARCH_NOTION_PAGE":
                return {"results": [{"id": "p1", "object": "page", "title": [{"plain_text": "Week 3 notes"}]}]}
            return {"results": [{"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Mitosis has four phases."}]}}]}
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"notion": "ca_n"}), \
                patch("services.connector_settings.uses", return_value={"tutor": True, "assistant": True}), patch("services.composio.run", side_effect=run):
            found = connectors.tutor_material(USER, 'Quiz me on my Notion page "Week 3 notes"')
        self.assertEqual(found["title"], "Notion: Week 3 notes")
        self.assertIn("Mitosis", found["text"])
        self.assertEqual(calls[0][1]["query"], "Week 3 notes")

    def test_search_terms_drop_filler_and_app_names(self):
        from routers.connectors import _search_terms
        self.assertEqual(_search_terms("explain my google doc called Cell Biology review", "gdocs"), ["Cell Biology review"])
        self.assertEqual(_search_terms("summarize the photosynthesis lab from my google drive", "gdrive")[0], "photosynthesis lab")
        self.assertEqual(_search_terms("what's in Sam's Notion page on enzymes", "notion")[0], "Sam's enzymes")

    def test_apple_feed_is_signed_and_lists_open_deadlines(self):
        url = self.client.get("/connectors/apple_calendar/feed", headers=self.auth).json()["url"]
        path = "/" + url.split("/", 3)[3]
        ics = self.client.get(path)
        self.assertEqual(ics.status_code, 200)
        self.assertIn("text/calendar", ics.headers["content-type"])
        self.assertIn("SUMMARY:Due: Lab report", ics.text)
        self.assertNotIn("Essay", ics.text)
        self.db.rows("study_blocks").append({"id": "b1", "user_id": USER, "item_key": "canvas:1", "kind": "work", "status": "planned",
                                             "starts_at": (SOON - timedelta(days=1)).isoformat(), "ends_at": (SOON - timedelta(days=1, minutes=-45)).isoformat()})
        with patch("routers.calendar.calendar_for", return_value={"items": ITEMS}):
            ics = self.client.get(path)
        self.assertIn("UID:block-b1@cordiaai.io", ics.text)
        self.assertIn("SUMMARY:Work on Lab report", ics.text)
        forged = self.client.get(f"/calendar-feed/{USER}.{'0' * 32}.ics")
        self.assertEqual(forged.status_code, 404)

    def test_imports_return_text_for_create(self):
        with patch("services.composio.account_for", return_value="ca_1"), patch("services.composio.run", return_value={"plain_text": "Osmosis is the movement of water.", "title": "Bio notes"}):
            body = self.client.post("/connectors/gdocs/import", headers=self.auth, json={"id": "doc1"}).json()
        self.assertEqual(body["title"], "Bio notes")
        self.assertIn("Osmosis", body["text"])

    def test_downloads_only_from_composio_storage(self):
        from fastapi import HTTPException
        from services.composio import download
        with self.assertRaises(HTTPException):
            download("http://169.254.169.254/latest/meta-data")


if __name__ == "__main__":
    unittest.main()
