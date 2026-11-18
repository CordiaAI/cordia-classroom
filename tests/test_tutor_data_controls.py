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

    # Deleted chats in the export -----------------------------------------------------------------
    def _delete_chat_row(self, chat_id="aaaaaaaa-0000-4000-8000-000000000002", deleted_at="2026-11-10T08:30:00+00:00"):
        self.db.rows("tutor_chats").append(
            {"id": chat_id, "user_id": ANA, "guide_id": None, "title": "Krebs cycle review",
             "messages": [{"role": "user", "text": "Where does the Krebs cycle happen?"}],
             "created_at": "2026-11-01T09:00:00+00:00", "updated_at": "2026-11-09T09:00:00+00:00", "deleted_at": deleted_at})
        return chat_id

    def test_a_deleted_chat_is_exported_marked_deleted_with_its_purge_date(self):
        from services import account_export
        deleted = self._delete_chat_row()
        data = self.client.get("/auth/account/export", headers=self.as_("ana")).json()
        chats = {chat["id"]: chat for chat in data["tutor_chats"]}
        self.assertEqual(sorted(chats), [ANA_CHAT, deleted])
        gone = chats[deleted]
        self.assertIs(gone["deleted"], True)
        self.assertEqual(gone["deleted_at"], "2026-11-10T08:30:00+00:00")
        self.assertEqual(gone["purge_on"], "2026-12-10T08:30:00+00:00")  # 30 days later
        self.assertEqual(gone["messages"], [{"role": "user", "text": "Where does the Krebs cycle happen?"}])
        note = data["deleted_chats_note"]
        self.assertIn("30 days", note)
        self.assertIn("permanently deleted", note)  # the daily clean-up removes it on its purge date ...
        self.assertIn("within a day of that date", note)  # ... or at the next run, which is at most a day later
        self.assertNotIn("on or after", note)
        self.assertEqual(account_export.DELETED_KEEP_DAYS, 30)

    def test_the_purge_date_follows_the_purge_period_the_purge_uses(self):
        from services import account_export, saved_chats
        self.assertIs(account_export.DELETED_KEEP_DAYS, saved_chats.DELETED_KEEP_DAYS)
        deleted = self._delete_chat_row(deleted_at="2026-11-10T08:30:00Z")
        with patch.object(account_export, "DELETED_KEEP_DAYS", 7):
            data = account_export.build(self.db, ANA)
        gone = next(chat for chat in data["tutor_chats"] if chat["id"] == deleted)
        self.assertEqual(gone["purge_on"], "2026-11-17T08:30:00+00:00")

    def test_a_chat_that_is_not_deleted_is_exported_exactly_as_before(self):
        data = self.client.get("/auth/account/export", headers=self.as_("ana")).json()
        self.assertEqual(data["tutor_chats"], [{
            "id": ANA_CHAT, "guide_id": None, "title": "Cell biology", "messages": [{"role": "user", "text": "What is osmosis?"}],
            "created_at": None, "updated_at": "2026-11-08T10:00:00+00:00"}])
        self.assertNotIn("deleted_chats_note", data)
        # A restored chat (deleted_at cleared) is a live one again.
        self._delete_chat_row("aaaaaaaa-0000-4000-8000-000000000003", deleted_at=None)
        data = self.client.get("/auth/account/export", headers=self.as_("ana")).json()
        for chat in data["tutor_chats"]:
            for field in ("deleted", "deleted_at", "purge_on"):
                self.assertNotIn(field, chat)

    def test_the_export_works_before_the_saved_chats_migration(self):
        real = self.db.table

        def table(name):
            query = real(name)
            if name != "tutor_chats":
                return query
            select = query.select

            def checked(columns="*", **kwargs):
                if "deleted_at" in columns:
                    raise Exception('{"code": "42703", "message": "column tutor_chats.deleted_at does not exist"}')
                return select(columns, **kwargs)
            query.select = checked
            return query
        with patch.object(self.db, "table", side_effect=table):
            response = self.client.get("/auth/account/export", headers=self.as_("ana"))
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["unavailable"], [])
        self.assertEqual([chat["id"] for chat in data["tutor_chats"]], [ANA_CHAT])
        self.assertEqual(data["tutor_chats"][0]["title"], "Cell biology")
        self.assertNotIn("deleted_at", data["tutor_chats"][0])
        self.assertNotIn("deleted_chats_note", data)

    def test_a_real_error_reading_chats_is_still_reported_not_swallowed(self):
        from services import account_export
        real = self.db.table

        def table(name):
            if name == "tutor_chats":
                raise RuntimeError("connection reset")
            return real(name)
        with patch.object(self.db, "table", side_effect=table):
            data = account_export.build(self.db, ANA)
        self.assertEqual(data["unavailable"], ["tutor_chats"])


if __name__ == "__main__":
    unittest.main()
