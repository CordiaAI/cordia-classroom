"""Moving a guide to another class and deleting a guide or a class: the row really changes, and
when nothing changed (not yours, already gone, the database failed) the answer says so instead of
reporting success (feedback F3: "moving or deleting often doesn't take")."""
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB, route_patches  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"
BEN = "bbbbbbbb-0000-4000-8000-000000000002"
MGT = "f0000000-0000-4000-8000-000000000001"      # Ana's class, linked to a shared class
FILM = "f0000000-0000-4000-8000-000000000002"     # Ana's other class, not shared
BEN_FOLDER = "f0000000-0000-4000-8000-000000000009"
MGT_CLASS = "c0000000-0000-4000-8000-000000000001"
GUIDE = "10000000-0000-4000-8000-000000000001"
BEN_GUIDE = "10000000-0000-4000-8000-000000000002"
IDS = {"ana": ANA, "ben": BEN}


def who(header):
    name = (header or "").split(" ", 1)[-1]
    if name not in IDS:
        raise HTTPException(status_code=401, detail="Sign in")
    return IDS[name]


class GuideMoveDeleteTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.db.rows("folders").extend([
            {"id": MGT, "user_id": ANA, "name": "MGT 300", "class_id": MGT_CLASS},
            {"id": FILM, "user_id": ANA, "name": "FILM 201", "class_id": None},
            {"id": BEN_FOLDER, "user_id": BEN, "name": "BEN 100", "class_id": None},
        ])
        self.db.rows("study_guides").extend([
            {"id": GUIDE, "user_id": ANA, "title": "Supply chains", "folder_id": MGT, "visibility": "private"},
            {"id": BEN_GUIDE, "user_id": BEN, "title": "Ben's guide", "folder_id": BEN_FOLDER, "visibility": "private"},
        ])
        self.patches = route_patches(("guides", "folders"), who, self.db)
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def guide(self, guide_id=GUIDE):
        return next((g for g in self.db.rows("study_guides") if g["id"] == guide_id), None)

    def call(self, method, who_, path, **kw):
        return getattr(self.client, method)(path, headers={"Authorization": f"Bearer {who_}"}, **kw)

    # Move ------------------------------------------------------------------------------------------
    def test_move_changes_the_row_and_says_where_it_went(self):
        response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": FILM})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"updated": True, "folder_id": FILM})
        self.assertEqual(self.guide()["folder_id"], FILM)

    def test_move_out_of_every_class_clears_the_folder(self):
        response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": None})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.guide()["folder_id"])

    def test_move_into_someone_elses_class_is_refused_and_changes_nothing(self):
        response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": BEN_FOLDER})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.guide()["folder_id"], MGT)

    def test_move_of_someone_elses_guide_is_refused_and_changes_nothing(self):
        response = self.call("patch", "ana", f"/guides/{BEN_GUIDE}/move", json={"folder_id": FILM})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.guide(BEN_GUIDE)["folder_id"], BEN_FOLDER)

    def test_move_that_changed_no_row_is_not_reported_as_done(self):
        # The guide is deleted (another tab) after the ownership check and before the update.
        from routers import guides
        real = guides.require_own_folder

        def gone_meanwhile(supabase, user_id, folder_id):
            real(supabase, user_id, folder_id)
            self.db.tables["study_guides"] = []
        with patch.object(guides, "require_own_folder", side_effect=gone_meanwhile):
            response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": FILM})
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("updated", response.json())

    def test_a_database_failure_on_move_is_an_error_not_a_success(self):
        real = self.db.table

        def failing(name):
            query = real(name)
            if name == "study_guides":
                original = query.execute
                query.execute = lambda: (_ for _ in ()).throw(RuntimeError("connection lost")) if query.op == "update" else original()
            return query
        with patch.object(self.db, "table", side_effect=failing):
            response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": FILM})
        self.assertGreaterEqual(response.status_code, 500)
        self.assertEqual(self.guide()["folder_id"], MGT)

    def test_moving_a_class_shared_guide_to_another_class_stops_sharing_it_with_the_old_one(self):
        self.guide()["visibility"] = "classroom"
        self.db.rows("shared_sets").append({"id": "s1", "guide_id": GUIDE, "owner_id": ANA, "class_id": MGT_CLASS, "visibility": "class"})
        response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": FILM})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.rows("shared_sets")[0]["visibility"], "private")
        self.assertEqual(self.guide()["visibility"], "private")

    def test_moving_a_shared_guide_within_the_same_class_keeps_it_shared(self):
        self.guide()["visibility"] = "classroom"
        self.db.rows("shared_sets").append({"id": "s1", "guide_id": GUIDE, "owner_id": ANA, "class_id": MGT_CLASS, "visibility": "class"})
        other = {"id": "f0000000-0000-4000-8000-000000000003", "user_id": ANA, "name": "MGT 300 again", "class_id": MGT_CLASS}
        self.db.rows("folders").append(other)
        response = self.call("patch", "ana", f"/guides/{GUIDE}/move", json={"folder_id": other["id"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.db.rows("shared_sets")[0]["visibility"], "class")

    # Delete a guide --------------------------------------------------------------------------------
    def test_delete_removes_the_row(self):
        response = self.call("delete", "ana", f"/guides/{GUIDE}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True})
        self.assertIsNone(self.guide())

    def test_delete_of_someone_elses_guide_is_not_reported_as_done(self):
        response = self.call("delete", "ana", f"/guides/{BEN_GUIDE}")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("deleted", response.json())
        self.assertIsNotNone(self.guide(BEN_GUIDE))

    def test_delete_of_a_guide_that_is_already_gone_says_so(self):
        self.call("delete", "ana", f"/guides/{GUIDE}")
        again = self.call("delete", "ana", f"/guides/{GUIDE}")
        self.assertEqual(again.status_code, 404)
        self.assertEqual(again.json()["detail"], "Guide not found")

    def test_a_database_failure_on_delete_is_an_error_not_a_success(self):
        real = self.db.table

        def failing(name):
            query = real(name)
            if name == "study_guides":
                original = query.execute
                query.execute = lambda: (_ for _ in ()).throw(RuntimeError("connection lost")) if query.op == "delete" else original()
            return query
        with patch.object(self.db, "table", side_effect=failing):
            response = self.call("delete", "ana", f"/guides/{GUIDE}")
        self.assertGreaterEqual(response.status_code, 500)
        self.assertNotIn("deleted", response.json())
        self.assertIsNotNone(self.guide())

    # Delete a class --------------------------------------------------------------------------------
    def test_deleting_a_class_removes_the_row(self):
        response = self.call("delete", "ana", f"/folders/{FILM}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True})
        self.assertNotIn(FILM, [f["id"] for f in self.db.rows("folders")])

    def test_deleting_someone_elses_class_is_not_reported_as_done(self):
        response = self.call("delete", "ana", f"/folders/{BEN_FOLDER}")
        self.assertEqual(response.status_code, 404)
        self.assertIn(BEN_FOLDER, [f["id"] for f in self.db.rows("folders")])


if __name__ == "__main__":
    unittest.main()
