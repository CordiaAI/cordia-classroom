"""Backend pieces for connected apps: the /mcp/* token check, get_progress's summary (built from the
app's own Progress functions), and folders made from Canvas or the calendar feed being marked."""
import os
import sys
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import auth_utils  # noqa: E402
from services import class_db  # noqa: E402
from services.mcp_progress import progress_summary  # noqa: E402

URL = "https://project.supabase.co"
MCP = "https://classroom.cordiacode.com/mcp"


class McpTokenTests(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        jwks = MagicMock()
        jwks.get_signing_key_from_jwt.return_value = MagicMock(key=self.key.public_key())
        self.patches = [patch.dict(os.environ, {"SUPABASE_URL": URL}), patch.object(auth_utils, "_get_jwks_client", return_value=jwks)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def token(self, key=None, **claims):
        payload = {"sub": "student-1", "aud": MCP, "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 600,
                   "role": "mcp_client", "client_id": "c0ffee00-0000-4000-8000-000000000000"}
        payload.update(claims)
        payload = {k: v for k, v in payload.items() if v is not None}
        return jwt.encode(payload, key or self.key, algorithm="ES256")

    def test_connected_app_token_names_the_student(self):
        token = self.token()
        self.assertEqual(auth_utils.verify_mcp_token("Bearer " + token), ("student-1", token))

    def test_everything_else_is_refused(self):
        cases = {
            "app sign-in": self.token(aud="authenticated", role="authenticated", client_id=None),
            "client_id with the app role (hook off)": self.token(aud="authenticated", role="authenticated"),
            "MCP audience without client_id": self.token(client_id=None),
            "MCP audience, app role": self.token(role="authenticated"),
            "expired": self.token(exp=int(time.time()) - 10),
            "another project": self.token(iss="https://other.supabase.co/auth/v1"),
            "forged": self.token(key=ec.generate_private_key(ec.SECP256R1())),
        }
        for name, token in cases.items():
            with self.subTest(name), self.assertRaises(HTTPException) as ctx:
                auth_utils.verify_mcp_token("Bearer " + token)
            self.assertEqual(ctx.exception.status_code, 401)
        with self.assertRaises(HTTPException):
            auth_utils.verify_mcp_token("")

    def test_app_routes_still_refuse_connected_app_tokens(self):
        with self.assertRaises(HTTPException) as ctx:
            auth_utils.get_user_id("Bearer " + self.token())
        self.assertEqual(ctx.exception.status_code, 401)


class ProgressSummaryTests(unittest.TestCase):
    guides = {"g1": {"id": "g1", "title": "Cells", "folder_id": "bio"}, "g2": {"id": "g2", "title": "WW1", "folder_id": "hist"}}
    sessions = [
        {"guide_id": "g1", "session_type": "quiz", "duration_seconds": 1800, "started_at": "2026-10-30T14:00:00+00:00", "ended_at": "2026-10-30T14:30:00+00:00", "metadata": {}},
        {"guide_id": "g2", "session_type": "read", "duration_seconds": 600, "started_at": "2026-10-29T20:00:00+00:00", "ended_at": "2026-10-29T20:10:00+00:00", "metadata": {}},
        {"guide_id": "g2", "session_type": "read", "duration_seconds": 600, "started_at": "2026-09-01T20:00:00+00:00", "ended_at": "2026-09-01T20:10:00+00:00", "metadata": {}},
    ]
    attempts = [
        {"guide_id": "g1", "score": 50, "completed_at": "2026-10-30T14:30:00+00:00"},
        {"guide_id": "g1", "score": 70, "completed_at": "2026-10-28T14:30:00+00:00"},
        {"guide_id": "g2", "score": 95, "completed_at": "2026-10-29T20:10:00+00:00"},
        {"guide_id": "g2", "score": 10, "completed_at": "2026-08-01T20:10:00+00:00"},
    ]

    def summary(self, **extra):
        return progress_summary(sessions=self.sessions, attempts=self.attempts, guides=self.guides,
                                streak={"current_streak": 3, "longest_streak": 9, "studied_today": True},
                                insights={"needs_work": [{"label": "Why questions", "accuracy": 40, "total": 6}]},
                                today=date(2026, 10, 30), tz_offset=0, since=date(2026, 10, 1), **extra)

    def test_counts_only_the_range_and_finds_weak_sets(self):
        out = self.summary()
        self.assertEqual(out["active_study_minutes"], 40)
        self.assertEqual(out["streak_days"], 3)
        self.assertEqual([row["accuracy"] for row in out["quiz_accuracy_trend"]], [70, 95, 50])
        self.assertEqual(out["weak_topics"], [{"topic": "Cells", "accuracy": 60, "last_seen": "2026-10-30", "study_set_id": "g1", "attempts": 2}])
        self.assertEqual(out["best_study_hours"][0], {"hour": 14, "minutes": 30})
        self.assertEqual(out["question_types_needing_work"], [{"type": "Why questions", "accuracy": 40, "answered": 6}])

    def test_course_filter_narrows_minutes_and_scores(self):
        out = self.summary(course_id="hist")
        self.assertEqual(out["active_study_minutes"], 10)
        self.assertEqual([row["study_set_id"] for row in out["quiz_accuracy_trend"]], ["g2"])
        self.assertEqual(out["weak_topics"], [])
        self.assertEqual(out["streak_days"], 3, "the streak is the student's, whatever the course")


class FolderLabelTests(unittest.TestCase):
    def db(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        return db

    def test_canvas_and_calendar_classes_make_marked_folders(self):
        for source, marked in (("canvas", True), ("calendar", True), ("manual", False)):
            db = self.db()
            with patch.object(class_db, "ensure_term", return_value={"id": "term"}):
                class_db.add_membership(db, "u", {"id": "c", "course_code_normalized": "BIO 101", "display_name": "Biology"}, "Fall", source)
            inserted = [call.args[0] for call in db.table.return_value.insert.call_args_list]
            self.assertEqual(inserted[-1].get("lms_named", False), marked, source)
            self.assertEqual(inserted[-1]["name"], "BIO 101 Biology")

    def test_before_the_migration_the_folder_is_still_made(self):
        db = self.db()
        insert = db.table.return_value.insert
        insert.return_value.execute.side_effect = [Exception('column "lms_named" does not exist'), MagicMock(data=[{"id": "f"}])]
        folder = class_db.ensure_folder(db, "u", {"id": "c", "course_code_normalized": "BIO 101"}, lms_named=True)
        self.assertEqual(folder, {"id": "f"})
        self.assertNotIn("lms_named", insert.call_args_list[-1].args[0])


if __name__ == "__main__":
    unittest.main()
