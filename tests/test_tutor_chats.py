"""Saved Tutor chats: a new chat saves the live one, and a saved chat can be resumed."""
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def chain(*results):
    table = MagicMock()
    for name in ("select", "update", "insert", "delete", "eq", "in_", "limit", "order", "range"):
        getattr(table, name).return_value = table
    table.execute.side_effect = [MagicMock(data=data) for data in results]
    return table


SESSION = {
    "id": "session-1", "user_id": "student-1", "status": "idle", "conversation_version": 7,
    "active_guide_id": "guide-1", "updated_at": "2026-10-20T10:00:00+00:00",
    "messages": [{"role": "user", "text": "What is   a tort?"}, {"role": "ai", "text": "A civil wrong."}],
}


class TutorChatTests(unittest.TestCase):
    def run_start(self, sessions, chats, guides=None, **kwargs):
        from services.tutor_sessions import start_tutor_chat
        db = MagicMock()
        db.table.side_effect = {"tutor_sessions": sessions, "tutor_chats": chats, "study_guides": guides or chain()}.__getitem__
        with patch("services.tutor_sessions.get_supabase", return_value=db):
            return start_tutor_chat("student-1", "session-1", **kwargs)

    def test_new_chat_saves_the_current_one_and_starts_empty_for_the_guide(self):
        sessions = chain([SESSION], [{**SESSION, "messages": []}])
        chats = chain([{"id": "chat-1"}], [])
        guides = chain([{"id": "guide-2"}])
        self.run_start(sessions, chats, guides, guide_id="guide-2")
        saved = chats.insert.call_args.args[0]
        self.assertEqual(saved["title"], "What is a tort?")
        self.assertEqual(saved["guide_id"], "guide-1")
        self.assertEqual(saved["messages"], SESSION["messages"])
        update = sessions.update.call_args.args[0]
        self.assertEqual(update["messages"], [])
        self.assertEqual(update["active_guide_id"], "guide-2")
        self.assertEqual(update["conversation_version"], 8)

    def test_general_chat_has_no_guide(self):
        sessions = chain([{**SESSION, "messages": []}], [SESSION])
        chats = chain()
        self.run_start(sessions, chats)
        chats.insert.assert_not_called()
        self.assertIsNone(sessions.update.call_args.args[0]["active_guide_id"])

    def test_resuming_moves_the_saved_chat_back_into_the_session(self):
        saved = {"id": "chat-9", "guide_id": None, "messages": [{"role": "user", "text": "Hi"}]}
        sessions = chain([SESSION], [SESSION])
        chats = chain([saved], [{"id": "chat-10"}], [], [])
        self.run_start(sessions, chats, resume_id="chat-9")
        update = sessions.update.call_args.args[0]
        self.assertEqual(update["messages"], saved["messages"])
        self.assertIsNone(update["active_guide_id"])
        chats.delete.assert_called()

    def test_a_busy_tutor_cannot_switch_chats(self):
        from fastapi import HTTPException
        busy = {**SESSION, "status": "running", "run_started_at": "2999-01-01T00:00:00+00:00"}
        with self.assertRaises(HTTPException) as raised:
            self.run_start(chain([busy]), chain())
        self.assertEqual(raised.exception.status_code, 409)

    def test_migration_is_service_role_only(self):
        sql = (ROOT / "supabase/migrations/20261021130000_tutor_chats.sql").read_text()
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all on table public.tutor_chats from public, anon, authenticated", sql)
        self.assertNotIn("assistant.", sql)


if __name__ == "__main__":
    unittest.main()
