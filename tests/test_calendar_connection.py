import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import calendar


class CalendarConnectionTests(unittest.TestCase):
    def test_connect_validates_then_saves_only_for_authenticated_user(self):
        query = MagicMock()
        database = MagicMock()
        database.table.return_value = query
        payload = {"connected": True, "items": [], "due_today": [], "updated_at": "now"}

        with (
            patch.object(calendar, "get_user_id", return_value="user-1"),
            patch.object(calendar, "_calendar_payload", return_value=payload),
            patch.object(calendar, "get_supabase", return_value=database),
        ):
            result = calendar.connect_calendar(
                calendar.CalendarPreviewRequest(url="https://canvas.example.edu/feeds/calendars/user_Tok3n.ics"),
                "Bearer token",
            )

        self.assertEqual(result, payload)
        saved = query.upsert.call_args.args[0]
        self.assertEqual(saved["user_id"], "user-1")
        self.assertEqual(saved["feed_url"], "https://canvas.example.edu/feeds/calendars/user_Tok3n.ics")
        self.assertNotIn("feed_url", result)

    def test_study_blocks_are_the_students_own_with_titles(self):
        rows = [{"id": "b1", "item_key": "canvas:1", "kind": "work", "step_id": "s1", "starts_at": "2026-10-27T16:00:00+00:00", "ends_at": "2026-10-27T16:45:00+00:00"},
                {"id": "b2", "item_key": "canvas:2", "kind": None, "step_id": None, "starts_at": "2026-10-28T16:00:00+00:00", "ends_at": "2026-10-28T17:00:00+00:00"}]
        query = MagicMock()
        for name in ("select", "eq", "neq", "gte", "lte", "order", "limit"):
            getattr(query, name).return_value = query
        query.execute.return_value = SimpleNamespace(data=rows)
        database = MagicMock()
        database.table.return_value = query
        with (
            patch.object(calendar, "get_user_id", return_value="user-9"),
            patch.object(calendar, "get_supabase", return_value=database),
            patch("services.google_sync._block_titles", return_value={"b1": "Essay: Outline"}),
        ):
            result = calendar.study_blocks("Bearer token")
        database.table.assert_called_with("study_blocks")
        query.eq.assert_any_call("user_id", "user-9")
        query.neq.assert_any_call("status", "removed")
        self.assertEqual([block["title"] for block in result["blocks"]], ["Essay: Outline", "Study"])
        self.assertEqual(result["blocks"][1]["kind"], "work")

    def test_get_connection_returns_calendar_without_revealing_feed_url(self):
        payload = {"connected": True, "items": [], "due_today": [], "updated_at": "now"}
        with (
            patch.object(calendar, "get_user_id", return_value="user-2"),
            patch.object(calendar, "_token_payload", return_value=None),
            patch.object(calendar, "_stored_feed", return_value="https://canvas.example.edu/feeds/calendars/private.ics"),
            patch.object(calendar, "_calendar_payload", return_value=payload),
        ):
            result = calendar.get_calendar_connection("Bearer token")
        self.assertEqual(result, payload)
        self.assertNotIn("feed_url", result)

    def test_canvas_token_wins_over_a_calendar_link(self):
        token = {"connected": True, "source": "canvas", "items": [], "due_today": []}
        with (
            patch.object(calendar, "get_user_id", return_value="user-2"),
            patch.object(calendar, "_token_payload", return_value=token),
            patch.object(calendar, "_stored_feed", side_effect=AssertionError("the link isn't read")),
        ):
            self.assertEqual(calendar.get_calendar_connection("Bearer token"), token)

    def test_get_connection_is_empty_when_account_has_no_feed(self):
        with (
            patch.object(calendar, "get_user_id", return_value="user-3"),
            patch.object(calendar, "_stored_feed", return_value=""),
            patch.object(calendar, "_token_payload", return_value=None),
        ):
            result = calendar.get_calendar_connection("Bearer token")
        self.assertEqual(result, {"connected": False, "items": [], "due_today": []})

    def test_disconnect_deletes_only_authenticated_users_row(self):
        query = MagicMock()
        database = MagicMock()
        database.table.return_value = query
        with (
            patch.object(calendar, "get_user_id", return_value="user-4"),
            patch.object(calendar, "get_supabase", return_value=database),
        ):
            result = calendar.disconnect_calendar("Bearer token")
        self.assertEqual(result, {"connected": False})
        query.delete.return_value.eq.assert_called_once_with("user_id", "user-4")


if __name__ == "__main__":
    unittest.main()


class TokenCalendarTests(unittest.TestCase):
    """With no calendar link, a Canvas access-token connection fills the calendar."""

    def test_token_deadlines_fill_the_calendar(self):
        sys.path.insert(0, os.path.dirname(__file__))
        from datetime import datetime, timedelta, timezone
        from fake_supabase import FakeDB

        db = FakeDB()
        soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        long_ago = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        db.rows("canvas_connections").append({"user_id": "u1", "canvas_domain": "school.instructure.com", "status": "connected"})
        db.rows("canvas_courses").append({"user_id": "u1", "canvas_course_id": 7, "name": "Management", "course_code": "MGT 300"})
        db.rows("canvas_assignments").extend([
            {"user_id": "u1", "canvas_assignment_id": 70, "canvas_course_id": 7, "title": "Quiz 2", "due_at": soon},
            {"user_id": "u1", "canvas_assignment_id": 71, "canvas_course_id": 7, "title": "Old essay", "due_at": long_ago},
            {"user_id": "u2", "canvas_assignment_id": 72, "canvas_course_id": 7, "title": "Not mine", "due_at": soon},
        ])
        with (
            patch.object(calendar, "get_user_id", return_value="u1"),
            patch.object(calendar, "_stored_feed", return_value=""),
            patch.object(calendar, "get_supabase", return_value=db),
        ):
            result = calendar.get_calendar_connection("Bearer token")
        self.assertEqual((result["connected"], result["source"]), (True, "canvas"))
        self.assertEqual([item["title"] for item in result["items"]], ["Quiz 2"])
        self.assertEqual(result["items"][0]["type"], "quiz")
        self.assertEqual(result["items"][0]["course"], "MGT 300")
        self.assertEqual(result["items"][0]["url"], "https://school.instructure.com/courses/7/assignments/70")

    def test_no_link_and_no_token_is_not_connected(self):
        sys.path.insert(0, os.path.dirname(__file__))
        from fake_supabase import FakeDB

        with (
            patch.object(calendar, "get_user_id", return_value="u1"),
            patch.object(calendar, "_stored_feed", return_value=""),
            patch.object(calendar, "get_supabase", return_value=FakeDB()),
        ):
            self.assertEqual(calendar.get_calendar_connection("Bearer token")["connected"], False)
