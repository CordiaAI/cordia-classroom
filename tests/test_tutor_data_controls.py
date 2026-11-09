"""Tutor data controls: delete one saved chat, see and clear Tutor memory, all owner-only through the
access layer (access.own()). Two students share one fake database; each can only touch their own."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB, route_patches  # noqa: E402
import main  # noqa: E402
import rate_limit  # noqa: E402

ANA = "11111111-1111-4111-8111-111111111111"
BEN = "22222222-2222-4222-8222-222222222222"
IDS = {"ana": ANA, "ben": BEN}
ANA_CHAT = "aaaaaaaa-0000-4000-8000-000000000001"
BEN_CHAT = "bbbbbbbb-0000-4000-8000-000000000001"
ANA_FACT = "aaaaaaaa-0000-4000-8000-0000000000f1"
BEN_FACT = "bbbbbbbb-0000-4000-8000-0000000000f1"


def who(header):
    name = (header or "").split(" ", 1)[-1]
    if name not in IDS:
        raise HTTPException(status_code=401, detail="Sign in")
    return IDS[name]


class TutorDataControlsTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("tutor_chats").extend([
            {"id": ANA_CHAT, "user_id": ANA, "guide_id": None, "title": "Cell biology", "messages": [{"role": "user", "text": "What is osmosis?"}], "updated_at": "2026-11-08T10:00:00+00:00"},
            {"id": BEN_CHAT, "user_id": BEN, "guide_id": None, "title": "Torts", "messages": [{"role": "user", "text": "What is negligence?"}], "updated_at": "2026-11-08T11:00:00+00:00"},
        ])
        self.db.rows("student_memory").extend([
            {"id": ANA_FACT, "user_id": ANA, "source": "tutor", "category": "goal", "key": "nclex", "value": "Preparing for the NCLEX", "updated_at": "2026-11-08T10:00:00+00:00"},
            {"id": "aaaaaaaa-0000-4000-8000-0000000000f2", "user_id": ANA, "source": "assistant", "category": "interest", "key": "guitar", "value": "Plays guitar", "updated_at": "2026-11-08T09:00:00+00:00"},
            {"id": BEN_FACT, "user_id": BEN, "source": "tutor", "category": "course", "key": "law", "value": "Takes Torts", "updated_at": "2026-11-08T11:00:00+00:00"},
        ])
        self.db.rows("tutor_sessions").extend([
            {"id": "s-ana", "user_id": ANA, "messages": [{"role": "user", "text": "Explain diffusion"}], "active_guide_id": None, "updated_at": "2026-11-09T01:00:00+00:00", "browser_content": "internal"},
            {"id": "s-ben", "user_id": BEN, "messages": [{"role": "user", "text": "Explain duty of care"}], "active_guide_id": None, "updated_at": "2026-11-09T01:00:00+00:00"},
        ])
        self.db.rows("study_guides").extend([
            {"id": "g-ana", "user_id": ANA, "title": "Osmosis", "notes": "Water moves", "search_doc": "internal", "review_status": "ok"},
            {"id": "g-ben", "user_id": BEN, "title": "Negligence", "notes": "Duty, breach"},
        ])
        rate_limit._hits.clear()
        self.patches = route_patches(["tutor", "learning", "auth"], who, self.db)
        self.patches.append(patch("services.tutor_sessions.get_supabase", return_value=self.db))
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def as_(self, name):
        return {"Authorization": f"Bearer {name}"}

    def ids(self, table, user):
        return [row["id"] for row in self.db.rows(table) if row["user_id"] == user]

    # One saved chat ------------------------------------------------------------------------------
    def test_a_student_deletes_one_of_their_saved_chats(self):
        response = self.client.delete(f"/tutor/chats/{ANA_CHAT}", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"chats": []})
        self.assertEqual(self.ids("tutor_chats", ANA), [])
        self.assertEqual(self.ids("tutor_chats", BEN), [BEN_CHAT])

    def test_a_student_cannot_delete_another_students_chat(self):
        response = self.client.delete(f"/tutor/chats/{BEN_CHAT}", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.ids("tutor_chats", BEN), [BEN_CHAT])
        self.assertEqual(self.ids("tutor_chats", ANA), [ANA_CHAT])

    def test_deleting_needs_a_signed_in_student_and_a_real_id(self):
        self.assertEqual(self.client.delete(f"/tutor/chats/{ANA_CHAT}").status_code, 401)
        self.assertEqual(self.client.delete("/tutor/chats/not-an-id", headers=self.as_("ana")).status_code, 400)
        self.assertEqual(self.ids("tutor_chats", ANA), [ANA_CHAT])

    # Memory --------------------------------------------------------------------------------------
    def test_a_student_sees_only_their_own_memories(self):
        memories = self.client.get("/memories", headers=self.as_("ana")).json()["memories"]
        self.assertEqual(sorted(m["id"] for m in memories), sorted(self.ids("student_memory", ANA)))
        self.assertEqual(self.client.get("/memories").status_code, 401)

    def test_forgetting_one_memory_is_owner_only(self):
        self.assertEqual(self.client.delete(f"/memories/{BEN_FACT}", headers=self.as_("ana")).status_code, 404)
        self.assertEqual(self.ids("student_memory", BEN), [BEN_FACT])
        response = self.client.delete(f"/memories/{ANA_FACT}", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn(ANA_FACT, self.ids("student_memory", ANA))

    def test_clear_all_removes_only_the_students_own_memories(self):
        response = self.client.delete("/memories", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"memories": []})
        self.assertEqual(self.ids("student_memory", ANA), [])
        self.assertEqual(self.ids("student_memory", BEN), [BEN_FACT])
        self.assertEqual(self.client.delete("/memories").status_code, 401)

    # Download my data ----------------------------------------------------------------------------
    def test_the_export_includes_the_students_tutor_chats_and_memory_and_nobody_elses(self):
        response = self.client.get("/auth/account/export", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("attachment", response.headers["content-disposition"])
        data = response.json()
        self.assertEqual(data["format"], "cordia-classroom-export/1")
        self.assertEqual(data["unavailable"], [])
        self.assertEqual([chat["id"] for chat in data["tutor_chats"]], [ANA_CHAT])
        self.assertEqual(data["tutor_chats"][0]["messages"], [{"role": "user", "text": "What is osmosis?"}])
        self.assertEqual(data["tutor_current_chat"]["messages"], [{"role": "user", "text": "Explain diffusion"}])
        self.assertEqual(sorted(m["value"] for m in data["tutor_memory"]), ["Plays guitar", "Preparing for the NCLEX"])
        self.assertEqual([guide["id"] for guide in data["study_guides"]], ["g-ana"])
        text = response.text
        for other in (BEN_CHAT, BEN_FACT, "g-ben", "duty of care", "Torts"):
            self.assertNotIn(other, text)
        # Same shape as every other section: named columns only, no internal fields.
        self.assertNotIn("search_doc", data["study_guides"][0])
        self.assertNotIn("browser_content", data["tutor_current_chat"])
        self.assertNotIn("user_id", data["tutor_chats"][0])

    def test_the_export_needs_a_signed_in_student(self):
        self.assertEqual(self.client.get("/auth/account/export").status_code, 401)

    def test_a_section_that_cant_be_read_is_listed_not_fatal(self):
        from services import account_export
        real = self.db.table

        def table(name):
            if name == "student_memory":
                raise RuntimeError("relation does not exist")
            return real(name)
        with patch.object(self.db, "table", side_effect=table):
            data = account_export.build(self.db, ANA)
        self.assertEqual(data["unavailable"], ["tutor_memory"])
        self.assertEqual(data["tutor_memory"], [])
        self.assertEqual([chat["id"] for chat in data["tutor_chats"]], [ANA_CHAT])


if __name__ == "__main__":
    unittest.main()
