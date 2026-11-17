"""Saved Tutor chats (redesign T5): /chats list, open, rename, move, delete and undo, owner-only, and the
fallback while migration 20261130120000_saved_chats.sql has not been applied. Two students share one
fake database; each can only touch their own chats."""
from pathlib import Path
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB, Query, route_patches  # noqa: E402
import main  # noqa: E402
import rate_limit  # noqa: E402

ANA = "11111111-1111-4111-8111-111111111111"
BEN = "22222222-2222-4222-8222-222222222222"
IDS = {"ana": ANA, "ben": BEN}
CALC = "c0000000-0000-4000-8000-000000000001"      # Ana's class: MATH 2210 Calculus II
ANATOMY = "c0000000-0000-4000-8000-000000000002"   # Ana's class: BIOL 2400 Anatomy
BEN_CLASS = "c0000000-0000-4000-8000-0000000000b1"
GUIDE = "90000000-0000-4000-8000-000000000001"     # Ana's guide in CALC
SESSION = "50000000-0000-4000-8000-000000000001"
BEN_SESSION = "50000000-0000-4000-8000-0000000000b1"
RATES, TITRATION, RENAMED, TRASHED, BEN_CHAT, LIVE, MISSING = (
    f"a0000000-0000-4000-8000-00000000000{n}" for n in (1, 2, 3, 4, 5, 6, 9))
NEW_COLUMNS = ("class_id", "renamed", "live", "deleted_at")


def who(header):
    name = (header or "").split(" ", 1)[-1]
    if name not in IDS:
        raise HTTPException(status_code=401, detail="Sign in")
    return IDS[name]


def ask(text):
    return {"role": "user", "text": text}


def reply(text):
    return {"role": "ai", "text": text}


def chat_row(id, user, title, updated, **extra):
    return {"id": id, "user_id": user, "guide_id": None, "class_id": None, "title": title, "renamed": False, "live": False,
            "deleted_at": None, "messages": [ask(title), reply("Here is how it works.")], "created_at": "2026-11-01T09:00:00+00:00",
            "updated_at": updated, **extra}


class LegacyQuery(Query):
    """tutor_chats as it is before the migration: any use of a new column is the database's own error."""

    def _check(self, *keys):
        if self.name == "tutor_chats":
            for key in keys:
                if key in NEW_COLUMNS:
                    raise Exception('{"code": "42703", "message": "column tutor_chats.%s does not exist"}' % key)

    def select(self, columns="*", **kwargs):
        self._check(*[c.strip() for c in columns.split(",")])
        return super().select(columns, **kwargs)

    def eq(self, key, value):
        self._check(key)
        return super().eq(key, value)

    def neq(self, key, value):
        self._check(key)
        return super().neq(key, value)

    def is_(self, key, value):
        self._check(key)
        return super().is_(key, value)

    def lt(self, key, value):
        self._check(key)
        return super().lt(key, value)

    def insert(self, payload, **kwargs):
        self._check(*payload)
        return super().insert(payload, **kwargs)

    def update(self, payload):
        self._check(*payload)
        return super().update(payload)


class LegacyDB(FakeDB):
    def table(self, name):
        return LegacyQuery(self, name)


class SavedChatsBase(unittest.TestCase):
    db_class = FakeDB

    def setUp(self):
        self.db = self.db_class()
        self.db.rows("folders").extend([
            {"id": CALC, "user_id": ANA, "name": "MATH 2210"}, {"id": ANATOMY, "user_id": ANA, "name": "BIOL 2400"},
            {"id": BEN_CLASS, "user_id": BEN, "name": "LAW 3100"},
        ])
        self.db.rows("study_guides").append({"id": GUIDE, "user_id": ANA, "title": "Related rates", "folder_id": CALC})
        self.db.rows("tutor_sessions").extend([
            {"id": SESSION, "user_id": ANA, "status": "idle", "conversation_version": 4, "active_guide_id": None,
             "messages": [], "created_at": "2026-10-01T09:00:00+00:00", "updated_at": "2026-11-14T10:00:00+00:00"},
            {"id": BEN_SESSION, "user_id": BEN, "status": "idle", "conversation_version": 0, "active_guide_id": None,
             "messages": [], "created_at": "2026-10-01T09:00:00+00:00", "updated_at": "2026-11-14T10:00:00+00:00"},
        ])
        rate_limit._hits.clear()
        self.patches = route_patches(["tutor"], who, self.db)
        for module in ("services.saved_chats", "services.tutor_sessions"):
            self.patches.append(patch(f"{module}.get_supabase", return_value=self.db))
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def as_(self, name):
        return {"Authorization": f"Bearer {name}"}

    def call(self, method, path, who="ana", **kwargs):
        return self.client.request(method, path, headers=self.as_(who), **kwargs)

    def rows(self, table, user=ANA):
        return [r for r in self.db.rows(table) if r.get("user_id") == user]

    def session(self, user=ANA):
        return self.rows("tutor_sessions", user)[0]

    def titles(self, response):
        return [chat["title"] for chat in response.json()["chats"]]


class AfterMigrationTests(SavedChatsBase):
    def setUp(self):
        super().setUp()
        self.db.rows("tutor_chats").extend([
            chat_row(RATES, ANA, "Exam 3 review: related rates", "2026-11-10T10:00:00+00:00", class_id=CALC, guide_id=GUIDE),
            chat_row(TITRATION, ANA, "Titration practice", "2026-11-12T10:00:00+00:00"),
            chat_row(RENAMED, ANA, "Why does heparin need monitoring?", "2026-11-11T10:00:00+00:00", renamed=True),
            chat_row(TRASHED, ANA, "Old study plan", "2026-11-13T10:00:00+00:00", deleted_at="2026-11-13T12:00:00+00:00"),
            chat_row(BEN_CHAT, BEN, "Negligence vs strict liability", "2026-11-12T11:00:00+00:00", class_id=BEN_CLASS),
        ])

    def start_live(self, class_id=None):
        """Ana is mid-conversation in a live chat."""
        self.session().update({
            "messages": [ask("  Walk me through implicit   differentiation "), reply("Differentiate both sides, then solve for dy/dx.")],
            "updated_at": "2026-11-14T10:00:00+00:00",
        })
        self.db.rows("tutor_chats").append(chat_row(LIVE, ANA, "", "2026-11-09T09:00:00+00:00", live=True, messages=[], class_id=class_id))

    # Listing --------------------------------------------------------------------------------------
    def test_the_list_is_newest_first_and_only_the_callers_not_deleted_chats(self):
        response = self.call("GET", "/chats")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.titles(response), ["Titration practice", "Why does heparin need monitoring?", "Exam 3 review: related rates"])
        self.assertTrue(response.json()["editable"])
        self.assertEqual(self.titles(self.call("GET", "/chats", who="ben")), ["Negligence vs strict liability"])

    def test_the_list_takes_a_limit(self):
        self.assertEqual(self.titles(self.call("GET", "/chats?limit=2")), ["Titration practice", "Why does heparin need monitoring?"])
        self.assertEqual(self.call("GET", "/chats?limit=0").status_code, 422)
        self.assertEqual(self.call("GET", "/chats?limit=101").status_code, 422)

    def test_the_list_takes_a_class_filter(self):
        response = self.call("GET", f"/chats?class_id={CALC}")
        self.assertEqual(self.titles(response), ["Exam 3 review: related rates"])
        self.assertEqual(self.titles(self.call("GET", f"/chats?class_id={ANATOMY}")), [])
        self.assertEqual(self.call("GET", "/chats?class_id=not-an-id").status_code, 400)
        self.assertEqual(self.titles(self.call("GET", f"/chats?class_id={CALC}", who="ben")), [])  # not Ben's class

    def test_the_live_chat_is_listed_once_with_the_first_message_as_its_title_and_the_sessions_activity(self):
        self.start_live(class_id=CALC)
        chats = self.call("GET", "/chats").json()["chats"]
        self.assertEqual(chats[0]["id"], LIVE)
        self.assertEqual(chats[0]["title"], "Walk me through implicit differentiation")
        self.assertTrue(chats[0]["live"])
        self.assertEqual(chats[0]["updated_at"], "2026-11-14T10:00:00+00:00")
        self.assertEqual(len(chats), 4)
        self.assertEqual([c["id"] for c in self.call("GET", f"/chats?class_id={CALC}").json()["chats"]], [LIVE, RATES])

    def test_an_empty_live_chat_is_not_listed_but_can_be_opened_by_id(self):
        self.db.rows("tutor_chats").append(chat_row(LIVE, ANA, "", "2026-11-14T09:00:00+00:00", live=True, messages=[]))
        self.assertNotIn(LIVE, [c["id"] for c in self.call("GET", "/chats").json()["chats"]])
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["messages"], [])

    def test_a_conversation_from_before_saved_chats_gets_one_stable_chat_and_is_listed_once(self):
        self.session().update({"messages": [ask("Explain the Krebs cycle"), reply("It oxidises acetyl-CoA.")], "active_guide_id": GUIDE})
        first = self.call("GET", "/chats").json()["chats"]
        self.call("GET", "/chats")
        live = [row for row in self.rows("tutor_chats") if row["live"]]
        self.assertEqual(len(live), 1)
        self.assertEqual(live[0]["messages"], [])  # the messages stay in the session: not copied twice
        self.assertEqual(live[0]["class_id"], CALC)  # a guide's chat sits in the guide's class
        self.assertEqual([c["id"] for c in first if c["live"]], [live[0]["id"]])
        self.assertEqual(first[0]["title"], "Explain the Krebs cycle")
        found = self.call("GET", f"/chats/{SESSION}").json()["chat"]  # the Tutor session's id finds it too
        self.assertEqual(found["id"], live[0]["id"])

    # One chat -------------------------------------------------------------------------------------
    def test_a_chat_comes_with_its_messages(self):
        chat = self.call("GET", f"/chats/{RATES}").json()["chat"]
        self.assertEqual(chat["title"], "Exam 3 review: related rates")
        self.assertEqual([m["role"] for m in chat["messages"]], ["user", "ai"])
        self.assertEqual((chat["class_id"], chat["guide_id"], chat["live"]), (CALC, GUIDE, False))

    def test_the_live_chat_reads_its_messages_from_the_session_and_says_how_to_continue(self):
        self.start_live()
        chat = self.call("GET", f"/chats/{LIVE}").json()["chat"]
        self.assertEqual(chat["messages"], self.session()["messages"])
        self.assertEqual((chat["session_id"], chat["conversation_version"]), (SESSION, 4))

    def test_another_students_chat_and_a_deleted_chat_read_as_gone(self):
        for chat_id in (BEN_CHAT, TRASHED, MISSING):
            self.assertEqual(self.call("GET", f"/chats/{chat_id}").status_code, 404, chat_id)
        self.assertEqual(self.call("GET", "/chats/not-an-id").status_code, 400)
        self.assertEqual(self.client.get(f"/chats/{RATES}").status_code, 401)

    # Rename ---------------------------------------------------------------------------------------
    def test_renaming_sets_the_title_and_keeps_the_order(self):
        response = self.call("PATCH", f"/chats/{RATES}", json={"title": "  Related   rates: exam 3  "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chat"]["title"], "Related rates: exam 3")
        row = next(r for r in self.db.rows("tutor_chats") if r["id"] == RATES)
        self.assertTrue(row["renamed"])
        self.assertEqual(row["updated_at"], "2026-11-10T10:00:00+00:00")  # a rename is not activity

    def test_a_renamed_live_chat_keeps_its_title_after_the_conversation_moves_on(self):
        self.start_live()
        self.call("PATCH", f"/chats/{LIVE}", json={"title": "Implicit differentiation"})
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "Implicit differentiation")
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "Implicit differentiation")

    def test_an_unrenamed_live_chat_is_titled_from_its_first_message_when_it_is_saved(self):
        self.start_live()
        self.call("POST", "/chats", json={})
        row = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
        self.assertEqual(row["title"], "Walk me through implicit differentiation")
        self.assertFalse(row["renamed"])

    def test_a_blank_title_and_an_empty_change_are_refused(self):
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={"title": "   "}).status_code, 422)
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={"title": "x" * 121}).status_code, 422)
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={}).status_code, 400)

    def test_a_student_cannot_rename_move_or_delete_another_students_chat(self):
        before = [dict(r) for r in self.db.rows("tutor_chats")]
        for response in (
            self.call("PATCH", f"/chats/{BEN_CHAT}", json={"title": "Mine now"}),
            self.call("PATCH", f"/chats/{BEN_CHAT}", json={"class_id": CALC}),
            self.call("DELETE", f"/chats/{BEN_CHAT}"),
            self.call("POST", f"/chats/{BEN_CHAT}/restore"),
            self.call("POST", f"/chats/{BEN_CHAT}/open"),
        ):
            self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.db.rows("tutor_chats"), before)

    # Move -----------------------------------------------------------------------------------------
    def test_a_chat_moves_into_a_class_shows_there_and_moves_out(self):
        response = self.call("PATCH", f"/chats/{TITRATION}", json={"class_id": ANATOMY})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chat"]["class_id"], ANATOMY)
        self.assertEqual(self.titles(self.call("GET", f"/chats?class_id={ANATOMY}")), ["Titration practice"])
        self.call("PATCH", f"/chats/{TITRATION}", json={"class_id": None})
        self.assertEqual(self.titles(self.call("GET", f"/chats?class_id={ANATOMY}")), [])
        self.assertIn("Titration practice", self.titles(self.call("GET", "/chats")))

    def test_a_chat_cannot_move_into_a_class_that_is_not_the_students(self):
        self.assertEqual(self.call("PATCH", f"/chats/{TITRATION}", json={"class_id": BEN_CLASS}).status_code, 404)
        self.assertEqual(self.call("PATCH", f"/chats/{TITRATION}", json={"class_id": MISSING}).status_code, 404)
        self.assertEqual(self.call("PATCH", f"/chats/{TITRATION}", json={"class_id": "nope"}).status_code, 400)
        self.assertIsNone(next(r for r in self.db.rows("tutor_chats") if r["id"] == TITRATION)["class_id"])

    # Delete and undo ------------------------------------------------------------------------------
    def test_a_deleted_chat_leaves_the_list_and_undo_brings_it_back_in_place(self):
        response = self.call("DELETE", f"/chats/{TITRATION}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["chat"]["deleted_at"])
        self.assertNotIn("Titration practice", self.titles(self.call("GET", "/chats")))
        self.assertEqual(self.call("GET", f"/chats/{TITRATION}").status_code, 404)
        self.assertEqual(self.call("DELETE", f"/chats/{TITRATION}").status_code, 404)
        restored = self.call("POST", f"/chats/{TITRATION}/restore")
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(self.titles(self.call("GET", "/chats"))[0], "Titration practice")

    def test_restoring_a_chat_that_was_not_deleted_changes_nothing(self):
        self.assertEqual(self.call("POST", f"/chats/{TITRATION}/restore").status_code, 200)
        self.assertEqual(self.call("POST", f"/chats/{MISSING}/restore").status_code, 404)

    def test_deleting_the_live_chat_clears_the_tutor_and_undo_brings_it_back_as_a_saved_chat(self):
        self.start_live(class_id=CALC)
        messages = list(self.session()["messages"])
        self.assertEqual(self.call("DELETE", f"/chats/{LIVE}").status_code, 200)
        self.assertEqual(self.session()["messages"], [])
        self.assertEqual(self.session()["conversation_version"], 5)
        row = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
        self.assertEqual((row["live"], row["messages"]), (False, messages))
        restored = self.call("POST", f"/chats/{LIVE}/restore").json()["chat"]
        self.assertEqual((restored["title"], restored["live"], restored["class_id"]),
                         ("Walk me through implicit differentiation", False, CALC))
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["messages"], messages)

    def test_a_busy_tutor_blocks_deleting_the_live_chat(self):
        self.start_live()
        self.session().update({"status": "running", "run_started_at": datetime.now(timezone.utc).isoformat()})
        self.assertEqual(self.call("DELETE", f"/chats/{LIVE}").status_code, 409)
        self.assertIsNone(next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)["deleted_at"])

    def test_deleted_chats_are_removed_for_good_after_thirty_days(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        self.db.rows("tutor_chats").extend([
            chat_row("a0000000-0000-4000-8000-0000000000a1", ANA, "Old", "2026-09-01T10:00:00+00:00", deleted_at=old),
            chat_row("a0000000-0000-4000-8000-0000000000a2", ANA, "Recent", "2026-11-01T10:00:00+00:00", deleted_at=recent),
        ])
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        left = [r["title"] for r in self.rows("tutor_chats") if r.get("deleted_at")]
        self.assertEqual(sorted(left), ["Old study plan", "Recent"])

    # Starting and opening -------------------------------------------------------------------------
    def test_a_new_chat_saves_the_current_one_under_its_own_id_and_starts_empty(self):
        self.start_live(class_id=CALC)
        response = self.call("POST", "/chats", json={})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertNotEqual(body["chat"]["id"], LIVE)
        self.assertTrue(body["chat"]["live"])
        self.assertEqual(body["session"]["messages"], [])
        self.assertEqual(body["session"]["conversation_version"], 5)
        saved = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
        self.assertFalse(saved["live"])
        self.assertEqual(len(saved["messages"]), 2)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["messages"] and r["title"].startswith("Walk me")]), 1)

    def test_a_new_chat_can_start_in_a_class_or_about_a_guide(self):
        in_class = self.call("POST", "/chats", json={"class_id": ANATOMY}).json()["chat"]
        self.assertEqual(in_class["class_id"], ANATOMY)
        about_guide = self.call("POST", "/chats", json={"guide_id": GUIDE}).json()
        self.assertEqual((about_guide["chat"]["guide_id"], about_guide["chat"]["class_id"]), (GUIDE, CALC))
        self.assertEqual(about_guide["session"]["active_guide_id"], GUIDE)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)  # the empty one was reused

    def test_a_new_chat_refuses_what_is_not_the_students(self):
        self.assertEqual(self.call("POST", "/chats", json={"class_id": BEN_CLASS}).status_code, 404)
        self.assertEqual(self.call("POST", "/chats", json={"guide_id": MISSING}).status_code, 404)
        self.assertEqual(self.call("POST", "/chats", json={"session_id": BEN_SESSION}).status_code, 404)
        busy = self.session()
        busy.update({"status": "running", "run_started_at": datetime.now(timezone.utc).isoformat()})
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 409)

    def test_opening_a_saved_chat_keeps_its_id_and_saves_the_current_one(self):
        self.start_live()
        response = self.call("POST", f"/chats/{RATES}/open")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["chat"]["id"], body["chat"]["live"]), (RATES, True))
        self.assertEqual([m["text"] for m in body["session"]["messages"]][0], "Exam 3 review: related rates")
        self.assertEqual(self.session()["active_guide_id"], GUIDE)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertTrue(next(r for r in self.db.rows("tutor_chats") if r["id"] == RATES)["live"])
        self.assertFalse(next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)["live"])
        self.assertEqual(self.call("POST", f"/chats/{RATES}/open").status_code, 200)  # already open: no change
        self.assertEqual(self.session()["conversation_version"], 5)

    def test_a_deleted_chat_cannot_be_opened(self):
        self.assertEqual(self.call("POST", f"/chats/{TRASHED}/open").status_code, 404)

    def test_the_tutor_panels_past_chat_list_leaves_out_the_live_and_deleted_chats(self):
        self.start_live()
        listed = self.call("GET", "/tutor/chats").json()["chats"]
        self.assertEqual(sorted(c["id"] for c in listed), sorted([RATES, TITRATION, RENAMED]))

    def test_the_tutor_panels_new_chat_route_keeps_the_live_chats_row(self):
        self.start_live()
        response = self.call("POST", "/tutor/session/new", json={"session_id": SESSION})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["messages"], [])
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["messages"] and r["title"].startswith("Walk me")]), 1)

    def test_a_deleted_chat_is_not_material_for_the_memory_trick(self):
        from services import memory_context
        said = [ask("Who started ATO?"), reply("Otis Allan Glazebrook founded ATO in Richmond.")]
        self.db.rows("tutor_chats").extend([
            chat_row("a0000000-0000-4000-8000-0000000000b1", ANA, "Greek life", "2026-11-14T10:00:00+00:00", messages=said),
            chat_row("a0000000-0000-4000-8000-0000000000b2", ANA, "Greek life, deleted", "2026-11-14T11:00:00+00:00", messages=said,
                     deleted_at="2026-11-14T12:00:00+00:00"),
        ])
        with self.assertLogs("services.memory_context", "WARNING"):  # the fake database has no full-text search
            found = memory_context.related_material(self.db, ANA, GUIDE, "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual([item["title"] for item in found if item["kind"] == "tutor"], ["Greek life"])


class BeforeMigrationTests(SavedChatsBase):
    """The live database today: tutor_chats has no class_id, renamed, live or deleted_at."""
    db_class = LegacyDB

    def setUp(self):
        super().setUp()
        legacy = lambda id, user, title, updated, **extra: {k: v for k, v in chat_row(id, user, title, updated, **extra).items() if k not in NEW_COLUMNS}  # noqa: E731
        self.db.rows("tutor_chats").extend([
            legacy(RATES, ANA, "Exam 3 review: related rates", "2026-11-10T10:00:00+00:00", guide_id=GUIDE),
            legacy(TITRATION, ANA, "", "2026-11-12T10:00:00+00:00", messages=[ask("  How do I read   a titration curve? "), reply("Find the equivalence point.")]),
            legacy(BEN_CHAT, BEN, "Negligence vs strict liability", "2026-11-12T11:00:00+00:00"),
        ])

    def live_conversation(self):
        self.session().update({"messages": [ask("Quiz me on chapter 4"), reply("Question 1: what is osmosis?")], "updated_at": "2026-11-14T10:00:00+00:00"})

    def assert_not_available(self, response):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["code"], "chats_not_available")
        self.assertTrue(response.json()["detail"])

    def test_the_list_falls_back_to_the_existing_chats_and_the_live_conversation(self):
        self.live_conversation()
        response = self.call("GET", "/chats")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.titles(response), ["Quiz me on chapter 4", "How do I read a titration curve?", "Exam 3 review: related rates"])
        self.assertFalse(response.json()["editable"])
        self.assertEqual(response.json()["chats"][0]["id"], SESSION)
        self.assertEqual(self.titles(self.call("GET", "/chats", who="ben")), ["Negligence vs strict liability"])

    def test_the_list_fallback_keeps_limit_and_class_filter(self):
        self.live_conversation()
        self.assertEqual(len(self.call("GET", "/chats?limit=2").json()["chats"]), 2)
        self.assertEqual(self.titles(self.call("GET", f"/chats?class_id={CALC}")), ["Exam 3 review: related rates"])  # via the guide's class

    def test_an_empty_database_lists_nothing_without_an_error(self):
        response = self.call("GET", "/chats", who="ben")
        self.assertEqual(self.titles(response), ["Negligence vs strict liability"])
        self.db.tables["tutor_chats"] = []
        self.assertEqual(self.call("GET", "/chats").json(), {"chats": [], "editable": False})

    def test_one_chat_still_opens_with_its_messages(self):
        self.live_conversation()
        chat = self.call("GET", f"/chats/{TITRATION}").json()
        self.assertEqual(chat["chat"]["title"], "How do I read a titration curve?")
        self.assertEqual(len(chat["chat"]["messages"]), 2)
        self.assertFalse(chat["editable"])
        live = self.call("GET", f"/chats/{SESSION}").json()["chat"]
        self.assertEqual((live["live"], live["title"], live["session_id"]), (True, "Quiz me on chapter 4", SESSION))
        self.assertEqual(self.call("GET", f"/chats/{BEN_CHAT}").status_code, 404)

    def test_rename_move_delete_and_undo_say_not_available_yet(self):
        self.live_conversation()
        for chat_id in (RATES, SESSION):
            self.assert_not_available(self.call("PATCH", f"/chats/{chat_id}", json={"title": "Related rates"}))
            self.assert_not_available(self.call("PATCH", f"/chats/{chat_id}", json={"class_id": CALC}))
            self.assert_not_available(self.call("DELETE", f"/chats/{chat_id}"))
            self.assert_not_available(self.call("POST", f"/chats/{chat_id}/restore"))
        self.assertEqual(len(self.db.rows("tutor_chats")), 3)
        self.assertEqual(self.session()["messages"][0]["text"], "Quiz me on chapter 4")

    def test_the_fallback_still_checks_who_owns_the_chat(self):
        for response in (self.call("PATCH", f"/chats/{BEN_CHAT}", json={"title": "Mine"}), self.call("DELETE", f"/chats/{BEN_CHAT}"),
                         self.call("POST", f"/chats/{BEN_CHAT}/restore"), self.call("POST", f"/chats/{BEN_CHAT}/open")):
            self.assertEqual(response.status_code, 404, response.text)

    def test_a_new_chat_and_opening_one_still_work_through_the_sessions_own_save(self):
        self.live_conversation()
        started = self.call("POST", "/chats", json={})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["session"]["messages"], [])
        self.assertEqual(started.json()["chat"]["id"], SESSION)  # before the migration the live chat's id is the session's
        saved = [r for r in self.rows("tutor_chats") if r["title"] == "Quiz me on chapter 4"]
        self.assertEqual(len(saved), 1)
        opened = self.call("POST", f"/chats/{TITRATION}/open")
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()["session"]["messages"][0]["text"], "  How do I read   a titration curve? ")

    def test_the_tutor_panels_own_routes_are_unchanged(self):
        self.live_conversation()
        self.assertEqual(len(self.call("GET", "/tutor/chats").json()["chats"]), 2)
        self.assertEqual(self.call("POST", "/tutor/session/new", json={"session_id": SESSION}).status_code, 200)
        self.assertEqual(self.call("DELETE", f"/tutor/chats/{RATES}").status_code, 200)

    def test_the_extensions_chat_endpoint_is_not_touched(self):
        import routers.chat as chat_router
        self.assertEqual(chat_router.router.prefix, "")
        paths = {route.path for route in chat_router.router.routes}
        self.assertEqual(paths, {"/chat"})


class MigrationFileTests(unittest.TestCase):
    SQL = (ROOT / "supabase/migrations/20261130120000_saved_chats.sql").read_text()

    def test_it_is_marked_not_applied_on_its_first_line(self):
        self.assertTrue(self.SQL.splitlines()[0].startswith("-- NOT APPLIED: waiting for owner's OK"))

    def test_it_adds_to_the_existing_table_instead_of_a_second_store(self):
        self.assertNotIn("create table", self.SQL.lower())
        for column in ("class_id uuid references public.folders(id) on delete set null", "renamed boolean not null default false",
                       "live boolean not null default false", "deleted_at timestamptz"):
            self.assertIn(column, self.SQL)
        self.assertIn("on public.tutor_chats (user_id) where live", self.SQL)
        self.assertIn("(user_id, class_id, updated_at desc) where deleted_at is null", self.SQL)

    def test_it_stays_service_role_only_like_the_other_tutor_tables(self):
        self.assertIn("enable row level security", self.SQL)
        self.assertIn("revoke all on table public.tutor_chats from public, anon, authenticated", self.SQL)
        self.assertNotIn("create policy", self.SQL.lower())

    def test_it_can_run_twice(self):
        self.assertEqual(self.SQL.count("add column if not exists"), 4)
        self.assertIn("create unique index if not exists", self.SQL)
        self.assertIn("and c.class_id is null", self.SQL)


if __name__ == "__main__":
    unittest.main()
