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

    def test_get_connection_returns_calendar_without_revealing_feed_url(self):
        payload = {"connected": True, "items": [], "due_today": [], "updated_at": "now"}
        with (
            patch.object(calendar, "get_user_id", return_value="user-2"),
            patch.object(calendar, "_stored_feed", return_value="https://canvas.example.edu/feeds/calendars/private.ics"),
            patch.object(calendar, "_calendar_payload", return_value=payload),
        ):
            result = calendar.get_calendar_connection("Bearer token")
        self.assertEqual(result, payload)
        self.assertNotIn("feed_url", result)

    def test_get_connection_is_empty_when_account_has_no_feed(self):
        with (
            patch.object(calendar, "get_user_id", return_value="user-3"),
            patch.object(calendar, "_stored_feed", return_value=""),
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
