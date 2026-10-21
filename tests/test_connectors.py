"""Settings > Connectors: Composio-backed apps, deadline pushes, imports and the Apple Calendar feed."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

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
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer t"}
        self.patches = [
            patch("routers.connectors.get_user_id", return_value=USER),
            patch("routers.connectors.calendar_for", return_value={"items": ITEMS}),
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
        self.assertEqual(list(by_id), ["gcal", "apple_calendar", "gtasks", "gdrive", "gdocs", "notion"])
        self.assertTrue(by_id["apple_calendar"]["available"])
        self.assertFalse(by_id["gcal"]["available"])
        with patch("services.composio.configured", return_value=True), patch("services.composio.active_accounts", return_value={"gcal": "ca_1"}):
            body = self.client.get("/connectors", headers=self.auth).json()
        self.assertTrue(next(c for c in body["connectors"] if c["id"] == "gcal")["connected"])

    def test_calendar_gets_only_open_upcoming_deadlines_once(self):
        calls = []

        def run(account, user, slug, args):
            calls.append((slug, args))
            if slug == "GOOGLECALENDAR_EVENTS_LIST":
                return {"items": []}
            return {}
        with patch("services.composio.account_for", return_value="ca_1"), patch("services.composio.run", side_effect=run):
            body = self.client.post("/connectors/gcal/deadlines", headers=self.auth, json={"time_zone": "America/Chicago"}).json()
        self.assertEqual(body, {"added": 1, "skipped": 0})
        created = [args for slug, args in calls if slug == "GOOGLECALENDAR_CREATE_EVENT"][0]
        self.assertEqual(created["summary"], "Due: Lab report")
        self.assertEqual(created["timezone"], "America/Chicago")
        self.assertNotIn("+", created["start_datetime"])

        def run_again(account, user, slug, args):
            if slug == "GOOGLECALENDAR_EVENTS_LIST":
                start = created["start_datetime"][:10]
                return {"items": [{"summary": "Due: Lab report", "start": {"dateTime": start + "T10:00:00-05:00"}}]}
            raise AssertionError("nothing new should be created")
        with patch("services.composio.account_for", return_value="ca_1"), patch("services.composio.run", side_effect=run_again):
            body = self.client.post("/connectors/gcal/deadlines", headers=self.auth, json={"time_zone": "America/Chicago"}).json()
        self.assertEqual(body, {"added": 0, "skipped": 1})

    def test_tasks_skip_open_duplicates(self):
        inserted = []

        def run(account, user, slug, args):
            if slug == "GOOGLETASKS_LIST_TASKS":
                return {"tasks": []}
            inserted.append(args)
            return {}
        with patch("services.composio.account_for", return_value="ca_1"), patch("services.composio.run", side_effect=run):
            self.client.post("/connectors/gtasks/deadlines", headers=self.auth, json={})
        self.assertEqual([t["title"] for t in inserted], ["Lab report"])
        self.assertEqual(inserted[0]["status"], "needsAction")

    def test_apple_feed_is_signed_and_lists_open_deadlines(self):
        url = self.client.get("/connectors/apple_calendar/feed", headers=self.auth).json()["url"]
        path = "/" + url.split("/", 3)[3]
        ics = self.client.get(path)
        self.assertEqual(ics.status_code, 200)
        self.assertIn("text/calendar", ics.headers["content-type"])
        self.assertIn("SUMMARY:Due: Lab report", ics.text)
        self.assertNotIn("Essay", ics.text)
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
