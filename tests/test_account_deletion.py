"""Self-serve account deletion: confirmation, plan cancel first, data and login removed."""
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from routers import auth, billing  # noqa: E402


class DeleteAccountTests(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.buckets = {name: MagicMock() for name in ("lecture-audio", "visuals", "card-images")}
        self.db.storage.from_.side_effect = lambda name: self.buckets[name]
        self.buckets["lecture-audio"].list.side_effect = lambda path: [{"name": "rec-1", "id": None}] if path == "u1" else [{"name": "00000.webm", "id": "x"}]
        photos = [[{"name": "a.jpg", "id": "1"}, {"name": "b.png", "id": "2"}], []]
        self.buckets["card-images"].list.side_effect = lambda path, options=None: photos.pop(0) if photos else []

    def run_delete(self, confirm="DELETE"):
        with patch.object(auth, "get_user_id", return_value="u1"), patch.object(auth, "get_supabase", return_value=self.db), \
                patch.object(billing, "cancel_subscription_for_deletion") as cancel:
            result = auth.delete_account(auth.DeleteAccountRequest(confirm=confirm), "Bearer t")
        return result, cancel

    def test_requires_typed_confirmation(self):
        with self.assertRaises(HTTPException) as caught:
            self.run_delete("yes")
        self.assertEqual(caught.exception.status_code, 400)
        self.db.auth.admin.delete_user.assert_not_called()

    def test_cancels_plan_removes_data_audio_and_login(self):
        result, cancel = self.run_delete()
        self.assertEqual(result, {"deleted": True})
        cancel.assert_called_once_with("u1")
        tables = [call.args[0] for call in self.db.table.call_args_list]
        for table in ("study_guides", "smart_notes", "folders", "quiz_attempts", "study_sessions", "user_streaks", "user_profiles"):
            self.assertIn(table, tables)
        self.buckets["lecture-audio"].remove.assert_called_once_with(["u1/rec-1/00000.webm"])
        self.buckets["card-images"].remove.assert_called_once_with(["u1/a.jpg", "u1/b.png"])
        self.db.auth.admin.delete_user.assert_called_once_with("u1")

    def test_failed_plan_cancel_stops_the_deletion(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"stripe_subscription_id": "sub_1", "status": "active"}]
        fake_stripe = MagicMock()
        fake_stripe.Subscription.cancel.side_effect = billing.stripe.error.APIConnectionError("down")
        with patch.object(billing, "get_supabase", return_value=db), patch.object(billing, "_stripe", return_value=fake_stripe):
            with self.assertRaises(HTTPException) as caught:
                billing.cancel_subscription_for_deletion("u1")
        self.assertEqual(caught.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
