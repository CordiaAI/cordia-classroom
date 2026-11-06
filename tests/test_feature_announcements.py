"""What's new seen state (GET/PUT /onboarding/features): stored in onboarding_progress.features once
migration 20261120120000 runs, lists only grow and hold registry-shaped ids, and the account facts
behind each feature's audience. Before the migration the server says stored: false."""
from pathlib import Path
from types import SimpleNamespace
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import feature_announcements as announcements  # noqa: E402

USER = "aaaaaaaa-0000-4000-8000-000000000001"


class BeforeMigration(FakeDB):
    """onboarding_progress without the features column."""
    def table(self, name):
        query = super().table(name)
        if name == "onboarding_progress":
            select = query.select

            def strict(columns="*", **kw):
                if "features" in columns:
                    raise RuntimeError('column onboarding_progress.features does not exist')
                return select(columns, **kw)
            query.select = strict
        return query


class FeatureAnnouncementTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.db.auth = SimpleNamespace(admin=SimpleNamespace(get_user_by_id=lambda uid: SimpleNamespace(user=SimpleNamespace(created_at="2026-09-01T10:00:00+00:00"))))
        self.patches = [patch("routers.learning.get_user_id", return_value=USER), patch("routers.learning.get_supabase", side_effect=lambda: self.db)]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def put(self, **body):
        response = self.client.put("/onboarding/features", json=body, headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_lists_grow_merge_and_hold_only_registry_ids(self):
        self.db.rows("onboarding_progress").append({"user_id": USER, "step": "done", "features": {"announced": ["learn"]}})
        out = self.put(announced=["learn", "how-sure"], dismissed=["timed-test", "Bad Id", "x" * 60, "-starts-with-dash"])
        self.assertTrue(out["stored"])
        self.assertEqual(out["features"], {"announced": ["learn", "how-sure"], "opened": [], "dismissed": ["timed-test"]})
        self.put(opened=["learn"])
        row = self.db.rows("onboarding_progress")[0]
        self.assertEqual(row["features"]["opened"], ["learn"])
        self.assertEqual(row["features"]["announced"], ["learn", "how-sure"], "nothing is ever removed")
        self.assertEqual(row["step"], "done", "the wizard step is untouched")

    def test_a_student_without_a_wizard_row_keeps_step_style(self):
        self.put(dismissed=["learn"])
        row = self.db.rows("onboarding_progress")[0]
        self.assertEqual((row["step"], row["features"]["dismissed"]), ("style", ["learn"]))
        onboarding = self.client.get("/onboarding", headers={"Authorization": "Bearer t"}).json()
        self.assertEqual(onboarding["step"], "style")

    def test_get_returns_the_lists_and_who_the_student_is(self):
        self.db.rows("onboarding_progress").append({"user_id": USER, "step": "done", "features": {"opened": ["learn"]}})
        self.db.rows("canvas_connections").append({"user_id": USER, "status": "connected"})
        self.db.rows("study_guides").append({"id": "g1", "user_id": USER, "nclex_questions": [{"q": 1}]})
        with patch("services.entitlements.subscription_row", return_value={"status": "active"}), patch("services.entitlements.plan_for", return_value="pro"):
            out = self.client.get("/onboarding/features", headers={"Authorization": "Bearer t"}).json()
        self.assertTrue(out["stored"])
        self.assertEqual(out["features"]["opened"], ["learn"])
        self.assertEqual(out["account"], {"created_at": "2026-09-01T10:00:00+00:00", "plan": "pro", "canvas": True, "nursing": True})

    def test_before_the_migration_nothing_is_stored_and_the_wizard_still_works(self):
        self.db = BeforeMigration()
        self.db.rows("onboarding_progress").append({"user_id": USER, "step": "create"})
        out = self.client.get("/onboarding/features", headers={"Authorization": "Bearer t"}).json()
        self.assertFalse(out["stored"])
        self.assertEqual(out["account"]["plan"], "free")
        self.assertFalse(self.put(dismissed=["learn"])["stored"])
        self.assertNotIn("features", self.db.rows("onboarding_progress")[0])
        onboarding = self.client.get("/onboarding", headers={"Authorization": "Bearer t"}).json()
        self.assertEqual(onboarding["step"], "create")

    def test_payload_limits(self):
        response = self.client.put("/onboarding/features", json={"announced": [f"f{i}" for i in range(51)]}, headers={"Authorization": "Bearer t"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(len(announcements.merge({"opened": [f"f{i}" for i in range(300)]}, {})["opened"]), announcements.CAP)


if __name__ == "__main__":
    unittest.main()
