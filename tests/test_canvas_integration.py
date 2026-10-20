"""Connect -> import 3 courses -> sync -> 401 auto-disconnect -> disconnect, against a mocked Canvas."""
import base64
import io
import json
import logging
import os
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qsl, urlparse

from fastapi import BackgroundTasks, HTTPException

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))
os.environ["CANVAS_TOKEN_KEY"] = base64.b64encode(b"z" * 32).decode()

from fake_supabase import FakeDB  # noqa: E402
from routers import canvas, classes  # noqa: E402
from services import canvas_client, log_scrub  # noqa: E402

TOKEN = "1234~" + "Zq9" * 21 + "w"
HOST = "testu.instructure.com"
COURSES = [
    {"id": 101, "name": "Principles of Management", "course_code": "MGT-300-102", "term": {"name": "Fall 2026"}},
    {"id": 102, "name": "Film History", "course_code": "FILM 201.01", "term": {"name": "Fall 2026"}},
    {"id": 103, "name": "Organic Chemistry", "course_code": "CHEM 2410", "term": {"name": "Fall 2026"}},
]


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self._body, self.headers = status, body, headers or {"X-Rate-Limit-Remaining": "700"}
        self.ok = 200 <= status < 300
        self.is_redirect = False
        self.text = json.dumps(body) if body is not None else ""
        self.links = {}

    def json(self):
        return self._body


class FakeCanvas:
    """Answers only the read-only endpoints; records every request."""

    def __init__(self):
        self.calls = []
        self.unauthorized = False

    def mount(self, prefix, adapter):  # the client pins its session to the checked address
        self.mounted = (prefix, adapter)

    def request(self, method, url, headers=None, **_kwargs):
        parsed = urlparse(url)
        assert parsed.hostname == HOST
        assert headers["Authorization"] == f"Bearer {TOKEN}"
        self.calls.append((method, parsed.path, parse_qsl(parsed.query)))
        if self.unauthorized:
            return FakeResponse(401, {"errors": [{"message": "Invalid access token."}]})
        path = parsed.path
        if path == "/api/v1/users/self":
            return FakeResponse(200, {"id": 9, "name": "Sam Student"})
        if path == "/api/v1/courses":
            return FakeResponse(200, COURSES)
        for course in COURSES:
            base = f"/api/v1/courses/{course['id']}"
            if path == base:
                return FakeResponse(200, {**course, "syllabus_body": "<p>Leadership, motivation and organizational design. Grading: 40% exams.</p>"})
            if path == base + "/modules":
                return FakeResponse(200, [{"name": "Week 1: Planning", "items": [{"title": "Strategy basics"}]}])
            if path == base + "/assignments":
                return FakeResponse(200, [
                    {"id": course["id"] * 10, "name": "Case study", "due_at": "2026-11-01T05:00:00Z", "points_possible": 10,
                     "submission": {"score": 9}},
                ])
        return FakeResponse(404, {"errors": []})


class CanvasIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("canvas_school_policy").append({"domain": "canvas.missouri.edu", "school_name": "University of Missouri", "tokens_allowed": False})
        self.canvas = FakeCanvas()
        self.log_stream = io.StringIO()
        self.handler = logging.StreamHandler(self.log_stream)
        self.handler.addFilter(log_scrub.ScrubFilter())
        logging.getLogger().addHandler(self.handler)
        logging.getLogger().setLevel(logging.DEBUG)
        self.patches = [
            patch.object(canvas, "get_user_id", return_value="user-1"),
            patch.object(classes, "get_user_id", return_value="user-1"),
            patch.object(canvas, "get_supabase", return_value=self.db),
            patch.object(classes, "get_supabase", return_value=self.db),
            patch.object(canvas_client.requests, "Session", return_value=self.canvas),
            patch.object(canvas_client, "_public_addresses", return_value=["203.0.113.10"]),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        logging.getLogger().removeHandler(self.handler)

    def connect(self):
        return canvas.connect(canvas.ConnectRequest(canvas_url=f"https://{HOST}", token=TOKEN, expires_at="2026-12-15", acknowledged=True), "Bearer x")

    def test_full_lifecycle(self):
        status = self.connect()
        self.assertTrue(status["connected"])
        self.assertEqual(len(status["courses"]), 3)
        self.assertEqual(status["last4"], TOKEN[-4:])
        self.assertNotIn(TOKEN, json.dumps(status))
        stored = self.db.rows("canvas_tokens")[0]
        self.assertNotIn(TOKEN, json.dumps(stored))
        self.assertEqual(set(stored), {"user_id", "ciphertext", "iv", "last4", "expires_at", "created_at"})

        # Import all three courses.
        for course in COURSES:
            status = canvas.set_import(course["id"], canvas.ImportRequest(imported=True), "Bearer x")
        self.assertTrue(all(c["imported"] for c in status["courses"]))
        codes = sorted(r["course_code_normalized"] for r in self.db.rows("classes"))
        self.assertEqual(codes, ["CHEM 2410", "FILM 201", "MGT 300"])
        self.assertEqual(len(self.db.rows("class_memberships")), 3)
        self.assertEqual({m["source"] for m in self.db.rows("class_memberships")}, {"canvas"})
        self.assertEqual(len(self.db.rows("folders")), 3)
        # Data minimization: only titles and due dates; summary is short; no raw syllabus, grades or submissions.
        self.assertEqual(set(self.db.rows("canvas_assignments")[0]), {"user_id", "canvas_assignment_id", "canvas_course_id", "title", "due_at", "created_at"})
        for row in self.db.rows("canvas_courses"):
            self.assertLessEqual(len(row["topic_summary"]), 600)
            self.assertNotIn("<p>", row["topic_summary"])
        self.assertNotIn("score", json.dumps(self.db.tables))
        listed = classes.list_classes("Bearer x")["classes"]
        self.assertEqual([c["code"] for c in listed], ["CHEM 2410", "FILM 201", "MGT 300"])

        # Sync: blocked inside 60s, runs after.
        calls = len(self.canvas.calls)
        canvas.sync_now("Bearer x")
        self.assertEqual(len(self.canvas.calls), calls)
        self.db.rows("canvas_connections")[0]["last_synced_at"] = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        canvas.sync_now("Bearer x")
        self.assertGreater(len(self.canvas.calls), calls)
        self.assertTrue(all(method == "GET" for method, _, _ in self.canvas.calls))
        activity = canvas.activity("Bearer x")["activity"]
        self.assertTrue(activity and {"endpoint", "status", "created_at"} == set(activity[0]))
        self.assertIn("courses.list", {a["endpoint"] for a in activity})

        # Background sync is scheduled only when 6 hours have passed.
        tasks = BackgroundTasks()
        canvas.canvas_status(tasks, "Bearer x")
        self.assertEqual(len(tasks.tasks), 0)

        # 401: auto-disconnect and ask to reconnect.
        self.canvas.unauthorized = True
        self.db.rows("canvas_connections")[0]["last_synced_at"] = (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()
        with self.assertRaises(HTTPException) as caught:
            canvas.sync_now("Bearer x")
        self.assertEqual(caught.exception.detail, "Reconnect Canvas")
        self.assertEqual(self.db.rows("canvas_tokens"), [])
        self.assertEqual(self.db.rows("canvas_courses"), [])
        self.assertEqual(self.db.rows("canvas_assignments"), [])
        self.assertEqual(self.db.rows("canvas_connections")[0]["status"], "needs_reconnect")
        self.assertEqual(canvas.canvas_status(BackgroundTasks(), "Bearer x")["status"], "needs_reconnect")

        # Reconnect, then disconnect deletes everything.
        self.canvas.unauthorized = False
        self.connect()
        result = canvas.disconnect("Bearer x")
        self.assertEqual(result["settings_url"], f"https://{HOST}/profile/settings")
        for table in ("canvas_tokens", "canvas_courses", "canvas_assignments", "canvas_connections"):
            self.assertEqual(self.db.rows(table), [], table)

        self.assertNotIn(TOKEN, self.log_stream.getvalue())

    def test_school_that_disallows_tokens_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            canvas.connect(canvas.ConnectRequest(canvas_url="canvas.missouri.edu", token=TOKEN, acknowledged=True), "Bearer x")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail, "Your school doesn't allow tokens")
        self.assertEqual(self.canvas.calls, [])
        self.assertFalse(canvas.school_policy(school="University of Missouri")["tokens_allowed"])

    def test_acknowledgement_is_required(self):
        with self.assertRaises(HTTPException):
            canvas.connect(canvas.ConnectRequest(canvas_url=HOST, token=TOKEN, acknowledged=False), "Bearer x")
        self.assertEqual(self.db.rows("canvas_tokens"), [])

    def test_token_rejected_on_connect_stores_nothing(self):
        self.canvas.unauthorized = True
        with self.assertRaises(HTTPException):
            self.connect()
        self.assertEqual(self.db.rows("canvas_tokens"), [])

    def test_connect_request_repr_hides_token(self):
        body = canvas.ConnectRequest(canvas_url=HOST, token=TOKEN, acknowledged=True)
        self.assertNotIn(TOKEN, repr(body))
        self.assertNotIn(TOKEN, str(body))


if __name__ == "__main__":
    unittest.main()
