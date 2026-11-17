"""Saved Tutor chats (redesign T5): /chats list, open, rename, move, delete and undo, owner-only, and the
fallback while migration 20261130120000_saved_chats.sql has not been applied. Two students share one
fake database; each can only touch their own chats."""
import copy
from pathlib import Path
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB, Query, route_patches  # noqa: E402
import main  # noqa: E402
import rate_limit  # noqa: E402
from services import saved_chats, sync_worker, tutor_sessions  # noqa: E402

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


def db_error(code, message):
    return APIError({"code": code, "message": message, "details": None, "hint": None})


class ConstraintQuery(Query):
    """tutor_chats with what the migration adds: one live chat per student (a partial unique index) and the
    check that a chat is never live and deleted. A write that would break either is refused whole, with the
    database's own error. db.before() runs another request in the middle of this one (two tabs)."""

    def execute(self):
        for hook in list(self.db.hooks):
            table, op, when, run = hook
            if table == self.name and op == self.op and when(self):
                self.db.hooks.remove(hook)
                run()
                break
        if self.name == "tutor_chats" and self.op in ("insert", "update"):
            before = copy.deepcopy(self.db.rows("tutor_chats"))
            out = super().execute()
            rows = self.db.rows("tutor_chats")
            live = [r["user_id"] for r in rows if r.get("live")]
            error = None
            if any(r.get("live") and r.get("deleted_at") for r in rows):
                error = db_error("23514", 'new row for relation "tutor_chats" violates check constraint "tutor_chats_live_not_deleted"')
            elif len(live) != len(set(live)):
                error = db_error("23505", 'duplicate key value violates unique constraint "tutor_chats_one_live_per_user"')
            if error:
                self.db.tables["tutor_chats"] = before
                raise error
            return out
        return super().execute()


class ConstraintDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.hooks = []

    def table(self, name):
        return ConstraintQuery(self, name)

    def before(self, table, op, run, when=None):
        """Run `run()` once, just before the next matching write or read of `table`."""
        self.hooks.append((table, op, when or (lambda query: True), run))


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
    db_class = ConstraintDB

    def setUp(self):
        super().setUp()
        self.client.raise_server_exceptions = False  # a bug shows as the 500 the student would get
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


    # Races: two tabs, step by step ---------------------------------------------------------------------
    # db.before(...) runs the other tab's whole request at the named point of this tab's request.
    def assert_never_live_and_deleted(self):
        for row in self.db.rows("tutor_chats"):
            self.assertFalse(row.get("live") and row.get("deleted_at"), f"{row['id']} is live and deleted")
        for user in (ANA, BEN):
            self.assertLessEqual(len([r for r in self.rows("tutor_chats", user) if r["live"]]), 1)

    def holding(self, word):
        """Ana's chat rows (deleted or not) whose saved messages hold `word`."""
        return [r for r in self.rows("tutor_chats") if any(word in (m.get("text") or "") for m in r.get("messages") or [])]

    def reachable(self, word):
        """Ids of the chats Ana can open now (the list) whose messages hold `word`."""
        found = []
        for chat in self.call("GET", "/chats").json()["chats"]:
            messages = self.call("GET", f"/chats/{chat['id']}").json()["chat"]["messages"]
            if any(word in (m.get("text") or "") for m in messages):
                found.append(chat["id"])
        return found

    def keep_talking(self, text):
        """What POST /chat does to the session: the student's message and the answer are added."""
        session = self.session()
        session.update({"messages": (session.get("messages") or []) + [ask(text), reply("p^2 + 2pq + q^2 = 1")],
                        "conversation_version": session["conversation_version"] + 1,
                        "updated_at": datetime.now(timezone.utc).isoformat()})

    def assert_what_was_typed_after_is_kept(self, word="Hardy-Weinberg"):
        """The student keeps talking, then starts another chat: the messages end up in one chat they can list
        (here and in the Tutor panel), and no chat is live and deleted at any point."""
        self.keep_talking(f"Next topic: {word}")
        self.assert_never_live_and_deleted()
        self.assertEqual(len(self.reachable(word)), 1)
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assert_never_live_and_deleted()
        holders = self.holding(word)
        self.assertEqual(len(holders), 1)
        self.assertIsNone(holders[0].get("deleted_at"))
        self.assertIn(holders[0]["id"], [c["id"] for c in self.call("GET", "/chats").json()["chats"]])
        self.assertIn(holders[0]["id"], [c["id"] for c in self.call("GET", "/tutor/chats").json()["chats"]])

    def test_scenario_a_a_delete_in_another_tab_wins_before_a_new_chat_resets_the_tutor(self):
        """Tab A read the session; tab B deletes the live chat; then A's reset fails its version check.
        Before: A put the deleted chat back as live, and what the student typed next was filed under it."""
        for start in ("/chats", "/tutor/session/new"):  # the new Chat button, and the old panel's automatic call
            with self.subTest(start=start):
                self.tearDown()
                self.setUp()
                self.start_live()
                other = []
                self.db.before("tutor_sessions", "update", lambda: other.append(self.call("DELETE", f"/chats/{LIVE}")))
                body = {"session_id": SESSION} if start != "/chats" else {}
                a = self.call("POST", start, json=body)
                self.assertEqual((other[0].status_code, a.status_code), (200, 409), a.text)
                lost = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
                self.assertTrue(lost["deleted_at"] and not lost["live"])
                self.assertEqual(self.session()["messages"], [])
                self.assert_never_live_and_deleted()
                self.assert_what_was_typed_after_is_kept()

    def test_scenario_a_the_delete_lands_after_the_new_chat_took_the_conversation(self):
        """B deletes the live chat after A reset the Tutor but before A saved the conversation: the conversation
        is still saved (as a chat of its own), nothing is live and deleted, and A is not told it failed."""
        self.start_live()
        other = []
        self.db.before("tutor_chats", "update", lambda: other.append(self.call("DELETE", f"/chats/{LIVE}")),
                       when=lambda query: query.payload.get("live") is False)
        a = self.call("POST", "/chats", json={})
        self.assertEqual((other[0].status_code, a.status_code), (200, 200), a.text)
        self.assert_never_live_and_deleted()
        self.assertEqual(len(self.reachable("implicit")), 1)
        self.assertEqual(len(self.holding("implicit")), 1)
        self.assertIsNone(self.holding("implicit")[0].get("deleted_at"))
        self.assert_what_was_typed_after_is_kept()

    def test_scenario_b_opening_a_chat_while_another_tab_deletes_it(self):
        """Before: the chat ended up live and deleted at once. Now the open is refused, the conversation the
        student was in comes back as the live chat, and the deleted chat stays deleted."""
        for point, op, when in (("flip", "tutor_chats", lambda query: query.payload == {"live": True}),
                                ("reset", "tutor_sessions", None)):
            with self.subTest(point=point):
                self.tearDown()
                self.setUp()
                self.start_live()
                before = list(self.session()["messages"])
                other = []
                self.db.before(op, "update", lambda: other.append(self.call("DELETE", f"/chats/{RATES}")), when=when)
                a = self.call("POST", f"/chats/{RATES}/open")
                self.assertEqual((other[0].status_code, a.status_code), (200, 404), a.text)
                rates = next(r for r in self.db.rows("tutor_chats") if r["id"] == RATES)
                self.assertTrue(rates["deleted_at"] and not rates["live"])
                live = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
                self.assertTrue(live["live"] and not live["deleted_at"])
                self.assertEqual(self.session()["messages"], before)
                self.assert_never_live_and_deleted()
                self.assert_what_was_typed_after_is_kept()

    def test_deleting_a_saved_chat_that_became_live_meanwhile_is_refused(self):
        def opened_elsewhere():
            next(r for r in self.db.rows("tutor_chats") if r["id"] == TITRATION)["live"] = True
        self.db.before("tutor_chats", "update", opened_elsewhere)
        response = self.call("DELETE", f"/chats/{TITRATION}")
        self.assertEqual(response.status_code, 409, response.text)
        row = next(r for r in self.db.rows("tutor_chats") if r["id"] == TITRATION)
        self.assertEqual((row["live"], row["deleted_at"]), (True, None))
        self.assert_never_live_and_deleted()

    def test_the_database_check_is_what_the_code_falls_back_on_and_it_answers_409_not_500(self):
        """If a write ever did reach the check or the unique index, the answer is a conflict and the student's
        conversation is back where it was."""
        for code, message in (("23514", 'violates check constraint "tutor_chats_live_not_deleted"'),
                              ("23505", 'duplicate key value violates unique constraint "tutor_chats_one_live_per_user"')):
            with self.subTest(code=code):
                self.tearDown()
                self.setUp()
                self.start_live()
                before = list(self.session()["messages"])
                def refuse():
                    raise db_error(code, message)
                self.db.before("tutor_chats", "update", refuse, when=lambda query: query.payload == {"live": True})
                response = self.call("POST", f"/chats/{RATES}/open")
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(self.session()["messages"], before)
                self.assertTrue(next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)["live"])
                self.assertFalse(next(r for r in self.db.rows("tutor_chats") if r["id"] == RATES)["live"])
                self.assert_never_live_and_deleted()

    def test_deleting_the_live_chat_when_its_row_cannot_be_written_puts_the_conversation_back(self):
        self.start_live()
        before = list(self.session()["messages"])
        def refuse():
            raise db_error("23514", 'violates check constraint "tutor_chats_live_not_deleted"')
        self.db.before("tutor_chats", "update", refuse)
        response = self.call("DELETE", f"/chats/{LIVE}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.session()["messages"], before)
        row = next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)
        self.assertEqual((row["live"], row["deleted_at"]), (True, None))

    def test_if_the_conversation_cannot_be_put_back_it_is_saved_as_a_chat_of_its_own(self):
        """The delete cleared the Tutor, its row could not be written, and the session moved on again meanwhile:
        the only copy of the conversation is in memory, so it is kept as a saved chat."""
        self.start_live()
        def moved_on_then_refuse():
            self.session()["conversation_version"] += 1
            raise db_error("23514", 'violates check constraint "tutor_chats_live_not_deleted"')
        self.db.before("tutor_chats", "update", moved_on_then_refuse)
        self.assertEqual(self.call("DELETE", f"/chats/{LIVE}").status_code, 409)
        copies = self.holding("implicit")
        self.assertEqual(len(copies), 1)
        self.assertEqual((copies[0]["live"], copies[0].get("deleted_at")), (False, None))
        self.assertIn(copies[0]["id"], [c["id"] for c in self.call("GET", "/chats").json()["chats"]])
        self.assert_never_live_and_deleted()

    def test_the_fake_database_really_refuses_the_state_the_check_forbids(self):
        with self.assertRaises(APIError) as caught:
            self.db.table("tutor_chats").update({"live": True}).eq("id", TRASHED).execute()  # deleted and live
        self.assertEqual(caught.exception.code, "23514")
        self.start_live()
        with self.assertRaises(APIError) as caught:
            self.db.table("tutor_chats").update({"live": True}).eq("id", RATES).execute()  # a second live chat
        self.assertEqual(caught.exception.code, "23505")

    def test_p1_two_tabs_start_a_new_chat_at_once(self):
        """Before: one of the two got a 500. Now one wins and the other is told to refresh; one saved copy."""
        self.start_live()
        other = []
        self.db.before("tutor_sessions", "update",
                       lambda: other.append(self.call("POST", "/tutor/session/new", json={"session_id": SESSION})))
        a = self.call("POST", "/tutor/session/new", json={"session_id": SESSION})
        self.assertEqual(sorted([a.status_code, other[0].status_code]), [200, 409], (a.text, other[0].text))
        self.assertEqual(len(self.holding("implicit")), 1)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assert_never_live_and_deleted()

    def test_p1b_the_second_tab_reads_after_the_first_saved_the_conversation_but_before_it_made_the_new_chat(self):
        """Before: a 500, and the same conversation saved as two chats."""
        self.start_live()
        other = []
        self.db.before("tutor_chats", "insert",
                       lambda: other.append(self.call("POST", "/tutor/session/new", json={"session_id": SESSION})))
        a = self.call("POST", "/chats", json={})
        self.assertEqual((a.status_code, other[0].status_code), (200, 200), (a.text, other[0].text))
        self.assertEqual(len(self.holding("implicit")), 1)  # saved once
        live = [r for r in self.rows("tutor_chats") if r["live"]]
        self.assertEqual(len(live), 1)
        self.assertEqual(a.json()["chat"]["id"], live[0]["id"])  # both tabs end up on the one live chat
        self.assertEqual(a.json()["session"]["conversation_version"], self.session()["conversation_version"])
        self.assert_never_live_and_deleted()

    def test_a_live_chat_that_vanishes_before_it_is_reused_is_replaced_not_a_500(self):
        """Before: .data[0] on an empty answer raised IndexError."""
        self.db.rows("tutor_chats").append(chat_row(LIVE, ANA, "", "2026-11-09T09:00:00+00:00", live=True, messages=[]))
        def gone():
            self.db.tables["tutor_chats"] = [r for r in self.db.rows("tutor_chats") if r["id"] != LIVE]
        self.db.before("tutor_chats", "update", gone)
        response = self.call("POST", "/chats", json={"class_id": ANATOMY})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chat"]["class_id"], ANATOMY)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)

    def test_opening_a_chat_when_a_stray_live_chat_appears_is_a_409_and_keeps_the_conversation(self):
        self.start_live()
        def stray():
            self.db.rows("tutor_chats").append(chat_row("a0000000-0000-4000-8000-0000000000d1", ANA, "", "2026-11-14T10:00:00+00:00",
                                                        live=True, messages=[]))
            next(r for r in self.db.rows("tutor_chats") if r["id"] == LIVE)["live"] = False  # the first one went elsewhere
        self.db.before("tutor_chats", "update", stray, when=lambda query: query.payload == {"live": True})
        response = self.call("POST", f"/chats/{RATES}/open")
        self.assertEqual(response.status_code, 409, response.text)
        self.assert_never_live_and_deleted()
        self.assertTrue(self.reachable("implicit"))

    # A guide's class must be the student's ------------------------------------------------------------
    def test_a_guide_whose_folder_belongs_to_another_student_gives_the_chat_no_class(self):
        other_guide = "90000000-0000-4000-8000-000000000002"
        self.db.rows("study_guides").extend([
            {"id": other_guide, "user_id": ANA, "title": "Negligence", "folder_id": BEN_CLASS},
            {"id": "90000000-0000-4000-8000-0000000000b1", "user_id": BEN, "title": "Contracts", "folder_id": BEN_CLASS},
        ])
        started = self.call("POST", "/chats", json={"guide_id": other_guide}).json()["chat"]
        self.assertEqual((started["guide_id"], started["class_id"]), (other_guide, None))
        self.assertEqual(saved_chats._guide_classes(ANA, [GUIDE, other_guide]), {GUIDE: CALC})
        self.assertEqual(saved_chats._guide_classes(ANA, ["90000000-0000-4000-8000-0000000000b1"]), {})  # not Ana's guide
        self.session().update({"messages": [ask("Explain negligence"), reply("Duty, breach, causation, damage.")], "active_guide_id": other_guide})
        self.db.tables["tutor_chats"] = [r for r in self.db.rows("tutor_chats") if not r["live"]]
        self.call("GET", "/chats")
        live = [r for r in self.rows("tutor_chats") if r["live"]]
        self.assertEqual((len(live), live[0]["class_id"]), (1, None))  # a conversation from before saved chats

    # Opening with another student's session, and the purge with another student's rows -----------------
    def test_a_second_student_resumes_through_the_tutor_panels_route(self):
        ben_chat = next(r for r in self.db.rows("tutor_chats") if r["id"] == BEN_CHAT)
        ben_chat["messages"] = [ask("Negligence or strict liability?"), reply("Strict liability needs no fault.")]
        response = self.call("POST", "/tutor/session/new", who="ben", json={"session_id": BEN_SESSION, "resume_id": BEN_CHAT})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["messages"][0]["text"], "Negligence or strict liability?")
        self.assertTrue(ben_chat["live"])
        self.assertEqual(self.call("POST", "/tutor/session/new", json={"session_id": SESSION, "resume_id": BEN_CHAT}).status_code, 404)
        self.assertEqual(self.call("POST", "/tutor/session/new", who="ben", json={"session_id": SESSION}).status_code, 404)
        self.assertEqual(self.call("POST", "/tutor/session/new", who="ben", json={"session_id": BEN_SESSION, "resume_id": RATES}).status_code, 404)
        self.assertFalse(next(r for r in self.db.rows("tutor_chats") if r["id"] == RATES)["live"])
        self.assert_never_live_and_deleted()

    def test_the_students_own_purge_leaves_another_students_deleted_chats_alone(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        self.db.rows("tutor_chats").append(chat_row("a0000000-0000-4000-8000-0000000000c1", BEN, "Ben's old chat", "2026-09-01T10:00:00+00:00", deleted_at=old))
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assertIn("a0000000-0000-4000-8000-0000000000c1", [r["id"] for r in self.db.rows("tutor_chats")])
        self.assertEqual(self.call("POST", "/chats", who="ben", json={}).status_code, 200)
        self.assertNotIn("a0000000-0000-4000-8000-0000000000c1", [r["id"] for r in self.db.rows("tutor_chats")])


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

    def test_opening_the_live_conversation_by_the_id_the_list_gave_it_returns_it(self):
        """Before: 404, because the live conversation's id is the Tutor session's and it is not in tutor_chats."""
        self.live_conversation()
        live_id = next(c["id"] for c in self.call("GET", "/chats").json()["chats"] if c["live"])
        self.assertEqual(live_id, SESSION)
        opened = self.call("POST", f"/chats/{live_id}/open")
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual((opened.json()["chat"]["id"], opened.json()["chat"]["live"]), (SESSION, True))
        self.assertEqual(opened.json()["session"]["messages"][0]["text"], "Quiz me on chapter 4")
        self.assertEqual(self.session()["conversation_version"], 4)  # nothing was reset
        again = self.call("POST", "/tutor/session/new", json={"session_id": SESSION, "resume_id": SESSION})
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["messages"][0]["text"], "Quiz me on chapter 4")
        self.assertEqual(self.call("POST", f"/chats/{BEN_SESSION}/open").status_code, 404)  # not Ana's session
        self.assertEqual(len(self.db.rows("tutor_chats")), 3)

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
        self.assertEqual(self.SQL.count("add column if not exists"), 3)  # class_id is added inside the guarded block below
        self.assertIn("create unique index if not exists", self.SQL)
        self.assertIn("drop constraint if exists tutor_chats_live_not_deleted", self.SQL)
        self.assertEqual(self.SQL.count("create index if not exists"), 3)

    def test_it_applies_whole_or_not_at_all(self):
        lines = [line.strip() for line in self.SQL.splitlines()]
        self.assertEqual(lines.count("begin;"), 1)
        self.assertEqual(lines.count("commit;"), 1)
        self.assertLess(lines.index("begin;"), lines.index("commit;"))
        self.assertNotIn("alter table", "\n".join(lines[:lines.index("begin;")]))  # nothing runs before the transaction opens

    def test_a_chat_can_never_be_live_and_deleted(self):
        self.assertIn("add constraint tutor_chats_live_not_deleted check (not (live and deleted_at is not null))", self.SQL)

    def test_the_backfill_runs_only_the_first_time_and_only_with_the_owners_guide_and_class(self):
        guard, backfill, end = (self.SQL.index("if not exists ("), self.SQL.index("update public.tutor_chats c"), self.SQL.index("end if;"))
        self.assertLess(guard, backfill)
        self.assertLess(backfill, end)
        self.assertIn("table_name = 'tutor_chats' and column_name = 'class_id'", self.SQL[guard:backfill])
        self.assertIn("add column class_id uuid references public.folders(id) on delete set null", self.SQL[guard:backfill])
        for condition in ("and g.user_id = c.user_id",
                          "exists (select 1 from public.folders f where f.id = g.folder_id and f.user_id = c.user_id)"):
            self.assertIn(condition, self.SQL[backfill:end])
        self.assertNotIn("safe to run again", self.SQL)

    def test_deleting_a_class_and_the_daily_purge_have_indexes_that_start_with_their_column(self):
        self.assertIn("on public.tutor_chats (class_id) where class_id is not null", self.SQL)
        self.assertIn("on public.tutor_chats (deleted_at) where deleted_at is not null", self.SQL)

    def test_it_warns_never_to_roll_the_backend_back(self):
        self.assertIn("never roll the backend back", self.SQL.lower())


class MissingSchemaMatcherTests(unittest.TestCase):
    def test_a_missing_saved_chats_column_is_recognised_by_its_whole_name(self):
        for message in ("column tutor_chats.live does not exist", "column tutor_chats.deleted_at does not exist",
                        "Could not find the 'live' column of 'tutor_chats' in the schema cache",
                        'column "renamed" does not exist', 'column "class_id" does not exist'):
            code = "PGRST204" if message.startswith("Could not") else "42703"
            self.assertTrue(tutor_sessions.is_missing_saved_chats_schema(APIError({"code": code, "message": message})), message)

    def test_other_errors_that_only_contain_the_letters_are_not(self):
        for code, message in (("42P01", 'relation "public.delivery" does not exist'),
                              ("42703", 'column "delivery" does not exist'),
                              ("42703", 'column "outlived" does not exist'),
                              ("57014", "canceling statement due to statement timeout"),
                              ("23505", 'duplicate key value violates unique constraint "tutor_chats_one_live_per_user"')):
            self.assertFalse(tutor_sessions.is_missing_saved_chats_schema(APIError({"code": code, "message": message})), message)

    def test_a_missing_table_still_counts(self):
        self.assertTrue(tutor_sessions.is_missing_saved_chats_schema(
            APIError({"code": "PGRST205", "message": "Could not find the table 'public.tutor_chats' in the schema cache"})))


def ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class PurgeJobTests(SavedChatsBase):
    """The daily purge in the sync worker: every student's deleted chats past DELETED_KEEP_DAYS go for good."""
    db_class = ConstraintDB

    def setUp(self):
        super().setUp()
        saved_chats._last_purge_day, saved_chats._purge_retry_at = None, None
        self.id = lambda n: f"a0000000-0000-4000-8000-0000000001{n:02d}"
        self.db.rows("tutor_chats").extend([
            chat_row(self.id(1), ANA, "Cell respiration, deleted 31 days ago", "2026-09-01T10:00:00+00:00", deleted_at=ago(31)),
            chat_row(self.id(2), ANA, "Organic chemistry, deleted 29 days ago", "2026-09-01T10:00:00+00:00", deleted_at=ago(29)),
            chat_row(self.id(3), ANA, "Never deleted, last used years ago", "2020-01-01T10:00:00+00:00"),
            chat_row(self.id(4), BEN, "Torts, deleted 31 days ago", "2026-09-01T10:00:00+00:00", deleted_at=ago(31)),
            chat_row(self.id(5), BEN, "Contracts, deleted 29 days ago", "2026-09-01T10:00:00+00:00", deleted_at=ago(29)),
            chat_row(self.id(6), BEN, "Evidence, never deleted", "2020-01-01T10:00:00+00:00"),
        ])
        # A live chat that somehow has an old deleted_at (the database check now refuses it; this row got in anyway).
        self.db.rows("tutor_chats").append(chat_row(self.id(7), ANA, "Live", "2026-11-14T10:00:00+00:00", live=True, messages=[], deleted_at=ago(45)))

    def ids(self):
        return sorted(r["id"] for r in self.db.rows("tutor_chats"))

    def test_a_chat_deleted_31_days_ago_is_removed_and_29_days_ago_is_kept_for_every_student(self):
        self.assertEqual(saved_chats.purge_expired_chats(), 2)
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 5, 6, 7)])

    def test_a_chat_that_is_not_deleted_and_a_live_chat_are_never_removed_however_old(self):
        saved_chats.purge_expired_chats()
        self.assertIn(self.id(3), self.ids())  # deleted_at null
        self.assertIn(self.id(6), self.ids())
        self.assertIn(self.id(7), self.ids())  # live, even with an old deleted_at

    def test_the_students_own_purge_only_touches_their_rows(self):
        saved_chats._purge_deleted(ANA)
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 4, 5, 6, 7)])  # Ben's old chat is still there
        saved_chats._purge_deleted(BEN)
        self.assertNotIn(self.id(4), self.ids())

    def test_running_it_twice_removes_nothing_the_second_time(self):
        self.assertEqual(saved_chats.purge_expired_chats(), 2)
        self.assertEqual(saved_chats.purge_expired_chats(), 0)

    def test_two_workers_at_once_do_not_clash(self):
        """The other machine's whole run happens between this run's pick and its delete."""
        other = []
        self.db.before("tutor_chats", "delete", lambda: other.append(saved_chats.purge_expired_chats()))
        self.assertEqual(saved_chats.purge_expired_chats(), 0)  # its rows were already gone
        self.assertEqual(other, [2])
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 5, 6, 7)])

    def test_it_deletes_in_bounded_batches(self):
        for n in range(10, 15):
            self.db.rows("tutor_chats").append(chat_row(self.id(n), ANA, f"Old {n}", "2026-09-01T10:00:00+00:00", deleted_at=ago(40)))
        with patch.object(saved_chats, "PURGE_BATCH", 3):
            self.assertEqual(list(saved_chats._purge_batches(saved_chats._cutoff())), [3, 3, 1])
        with patch.object(saved_chats, "PURGE_BATCH", 2), patch.object(saved_chats, "PURGE_MAX_BATCHES", 2):
            self.assertEqual(saved_chats.purge_expired_chats(), 0)  # nothing left: the first run took them all
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 5, 6, 7)])

    def test_one_run_is_capped_and_the_rest_goes_next_time(self):
        for n in range(10, 15):
            self.db.rows("tutor_chats").append(chat_row(self.id(n), ANA, f"Old {n}", "2026-09-01T10:00:00+00:00", deleted_at=ago(40)))
        with patch.object(saved_chats, "PURGE_BATCH", 2), patch.object(saved_chats, "PURGE_MAX_BATCHES", 2):
            self.assertEqual(saved_chats.purge_expired_chats(), 4)  # two batches of two
            self.assertEqual(saved_chats.purge_expired_chats(), 3)  # the other three
            self.assertEqual(saved_chats.purge_expired_chats(), 0)
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 5, 6, 7)])

    def test_the_job_and_the_students_purge_use_the_same_filter_and_the_same_cutoff(self):
        with patch.object(saved_chats, "_expired", wraps=saved_chats._expired) as spy:
            saved_chats._purge_deleted(ANA)
            saved_chats.purge_expired_chats()
        cutoffs = [call.args[1] for call in spy.call_args_list]
        self.assertGreaterEqual(len(cutoffs), 4)  # a pick and a delete, in each of the two runs
        self.assertEqual((cutoffs[0], cutoffs[2]), (cutoffs[1], cutoffs[3]))  # one cutoff per run, for the pick and the delete
        for cutoff in cutoffs:
            expected = datetime.now(timezone.utc) - timedelta(days=saved_chats.DELETED_KEEP_DAYS)
            self.assertLess(abs((cutoff - expected).total_seconds()), 5)

    def test_the_cutoff_is_utc_and_comes_from_the_one_constant(self):
        now = datetime(2026, 12, 20, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(saved_chats._cutoff(now), datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(saved_chats._cutoff().utcoffset(), timedelta(0))
        with patch.object(saved_chats, "DELETED_KEEP_DAYS", 7):
            self.assertEqual(saved_chats._cutoff(now), datetime(2026, 12, 13, 9, 0, tzinfo=timezone.utc))
            self.assertEqual(saved_chats.purge_expired_chats(), 4)  # deleted 29 and 31 days ago are both past 7 days
        self.assertEqual(self.ids(), [self.id(n) for n in (3, 6, 7)])  # never deleted, and live: kept whatever the period

    def test_the_log_says_how_many_and_nothing_about_the_chats(self):
        with self.assertLogs("services.saved_chats", "INFO") as logs:
            saved_chats.purge_expired_chats()
        text = " ".join(logs.output)
        self.assertIn("removed 2 deleted chats", text)
        for word in ("respiration", "Torts", "Cell", self.id(1), ANA, BEN):
            self.assertNotIn(word, text)

    def test_a_database_error_is_logged_and_does_not_raise(self):
        with patch.object(saved_chats, "_chats", side_effect=RuntimeError("connection reset by peer")), \
                self.assertLogs("services.saved_chats", "WARNING") as logs:
            self.assertEqual(saved_chats.purge_expired_chats(), 0)
        self.assertIn("purge failed", logs.output[0])

    def test_after_an_error_it_tries_again_in_an_hour_not_every_minute(self):
        calls = []
        morning = datetime(2026, 11, 20, 9, 5, tzinfo=timezone.utc)
        results = iter([(0, False), (3, True), (0, True)])
        with patch.object(saved_chats, "_purge_all", side_effect=lambda now: calls.append(now) or next(results)):
            saved_chats.run_purge_if_due(morning)
            saved_chats.run_purge_if_due(morning + timedelta(minutes=1))   # too soon
            saved_chats.run_purge_if_due(morning + timedelta(minutes=59))  # too soon
            self.assertEqual(saved_chats.run_purge_if_due(morning + timedelta(hours=1)), 3)
            saved_chats.run_purge_if_due(morning + timedelta(hours=2))     # done for today
        self.assertEqual(len(calls), 2)

    def test_it_runs_once_a_day_on_the_first_pass_after_its_hour(self):
        calls = []
        with patch.object(saved_chats, "_purge_all", side_effect=lambda now: calls.append(now) or (0, True)):
            for when in (datetime(2026, 11, 20, 3, 0), datetime(2026, 11, 20, 8, 59), datetime(2026, 11, 20, 9, 0),
                         datetime(2026, 11, 20, 9, 1), datetime(2026, 11, 20, 23, 59), datetime(2026, 11, 21, 8, 0),
                         datetime(2026, 11, 21, 9, 30)):
                saved_chats.run_purge_if_due(when.replace(tzinfo=timezone.utc))
        self.assertEqual([c.strftime("%d %H:%M") for c in calls], ["20 09:00", "21 09:30"])


class PurgeBeforeTheMigrationTests(SavedChatsBase):
    db_class = LegacyDB

    def test_nothing_happens_and_it_says_so_once_without_an_error(self):
        saved_chats._last_purge_day, saved_chats._purge_retry_at = None, None
        self.db.rows("tutor_chats").append({"id": RATES, "user_id": ANA, "title": "Related rates", "messages": [], "updated_at": "2020-01-01T00:00:00+00:00"})
        before = copy.deepcopy(self.db.rows("tutor_chats"))
        with self.assertLogs("services.saved_chats", "INFO") as logs:
            self.assertEqual(saved_chats.purge_expired_chats(), 0)
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].levelname, "INFO")
        self.assertEqual(self.db.rows("tutor_chats"), before)
        with self.assertLogs("services.saved_chats", "INFO") as logs:  # through the daily entry point: once, then not again that day
            saved_chats.run_purge_if_due(datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc))
            saved_chats.run_purge_if_due(datetime(2026, 11, 20, 9, 1, tzinfo=timezone.utc))
        self.assertEqual(len(logs.records), 1)


class WorkerLoopTests(unittest.TestCase):
    """The purge is one more job in the existing sync worker's loop; a failure in it does not stop the others."""

    class Stop(Exception):
        pass

    def test_the_worker_runs_the_purge_every_pass_and_survives_it_failing(self):
        sleeps = []
        def sleep(seconds):
            sleeps.append(seconds)
            if len(sleeps) == 2:
                raise self.Stop
        with patch.object(sync_worker, "tick"), patch.object(sync_worker, "send_reminders") as reminders, \
             patch("services.decision_outcomes.run_if_due") as outcomes, \
             patch.object(saved_chats, "run_purge_if_due", side_effect=[RuntimeError("database is down"), 0]) as purge, \
             patch.object(sync_worker.time, "sleep", side_effect=sleep), self.assertLogs("services.sync_worker", "ERROR"):
            with self.assertRaises(self.Stop):
                sync_worker._loop()
        self.assertEqual((purge.call_count, outcomes.call_count, reminders.call_count), (2, 2, 2))
        self.assertEqual(sleeps, [sync_worker.REMINDER_SECONDS] * 2)

    def test_the_worker_docstring_names_the_job(self):
        self.assertIn("saved_chats.run_purge_if_due", sync_worker.__doc__)


if __name__ == "__main__":
    unittest.main()
