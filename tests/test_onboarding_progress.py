import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app

AUTH = {"Authorization": "Bearer token"}


def table_with(rows=None, error=None):
    query = MagicMock()
    for method in ("select", "eq", "limit", "upsert"):
        getattr(query, method).return_value = query
    if error:
        query.execute.side_effect = error
    else:
        query.execute.return_value = MagicMock(data=rows or [])
    client = MagicMock()
    client.table.return_value = query
    return client, query


@patch("routers.learning.get_user_id", return_value="student-1")
class OnboardingProgressTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_new_student_starts_at_the_first_step(self, _user):
        stub, _ = table_with([])
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.get("/onboarding", headers=AUTH)
        self.assertEqual(response.json(), {"step": "style", "completed": False})

    def test_saved_step_is_resumed(self, _user):
        stub, _ = table_with([{"step": "smartnotes", "completed_at": None}])
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.get("/onboarding", headers=AUTH)
        self.assertEqual(response.json(), {"step": "smartnotes", "completed": False})

    def test_unreadable_progress_never_blocks_the_app(self, _user):
        stub, _ = table_with(error=RuntimeError("relation does not exist"))
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.get("/onboarding", headers=AUTH)
        self.assertEqual(response.json(), {"step": "done", "completed": True})

    def test_finishing_records_completion_for_this_student_only(self, _user):
        stub, query = table_with([])
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.put("/onboarding", headers=AUTH, json={"step": "done"})
        self.assertEqual(response.json(), {"step": "done", "completed": True})
        record = query.upsert.call_args[0][0]
        self.assertEqual(record["user_id"], "student-1")
        self.assertIn("completed_at", record)

    def test_unknown_step_is_rejected(self, _user):
        response = self.client.put("/onboarding", headers=AUTH, json={"step": "admin"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
