"""Saved Tutor chats (redesign T5): /chats list, open, rename, move, delete and undo, owner-only, and the
fallback while migration 20261130120000_saved_chats.sql has not been applied. Two students share one
fake database; each can only touch their own chats.

The live chat is the one tutor_sessions.live_chat_id names. The tests below check the order every change
of the live chat follows (save the conversation first, then replace it and the pointer in one
compare-and-set): two tabs interleaved at every database call, crashes at every call, and the reviewer's
probes ported as tests."""
import copy
import itertools
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
# What the migration adds, per table. `live` is not a column at all (the session's pointer is the one record).
NEW_COLUMNS = {"tutor_chats": ("class_id", "renamed", "deleted_at", "live"), "tutor_sessions": ("live_chat_id",)}
CHAT_COLUMNS = NEW_COLUMNS["tutor_chats"]


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
    return {"id": id, "user_id": user, "guide_id": None, "class_id": None, "title": title, "renamed": False,
            "deleted_at": None, "messages": [ask(title), reply("Here is how it works.")], "created_at": "2026-11-01T09:00:00+00:00",
            "updated_at": updated, **extra}


def db_error(code, message):
    return APIError({"code": code, "message": message, "details": None, "hint": None})


class LegacyQuery(Query):
    """The tables as they are before the migration: any use of a new column is the database's own error."""

    def _check(self, *keys):
        for key in keys:
            if key in NEW_COLUMNS.get(self.name, ()):
                raise Exception('{"code": "42703", "message": "column %s.%s does not exist"}' % (self.name, key))

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

    def in_(self, key, values):
        self._check(key)
        return super().in_(key, values)

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


class ConstraintQuery(Query):
    """The tables after the migration, with what the database enforces: tutor_chats has no `live` column (any
    use of one is refused), and tutor_sessions.live_chat_id is a foreign key to tutor_chats(id) on delete set
    null (pointing at a chat that does not exist is refused; removing the chat clears the pointer).
    For the tests' eyes only, every tutor_chats row in db.rows() also carries "live": whether a session points
    at it. Rows the code reads never include it.
    db.before() runs another request just before the next matching call; db.step / db.after run a callback
    before / after every call (the interleaving matrix and the crash tests)."""

    def _check(self, *keys):
        if self.name == "tutor_chats" and "live" in keys:
            raise db_error("42703", "column tutor_chats.live does not exist")

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

    def insert(self, payload, **kwargs):
        self._check(*payload)
        return super().insert(payload, **kwargs)

    def update(self, payload):
        self._check(*payload)
        return super().update(payload)

    def execute(self):
        db = self.db
        if db.step:
            db.step(self)
        for hook in list(db.hooks):
            table, op, when, run = hook
            if table == self.name and op == self.op and when(self):
                db.hooks.remove(hook)
                run()
                break
        db.settle()
        if self.name == "tutor_sessions" and self.op in ("insert", "update", "upsert") and isinstance(self.payload, dict):
            target = self.payload.get("live_chat_id")
            hits = self.op != "update" or any(self._match(r) for r in db.rows("tutor_sessions"))
            if target and hits and target not in {r["id"] for r in db.rows("tutor_chats")}:
                raise db_error("23503", 'insert or update on table "tutor_sessions" violates foreign key constraint '
                                        '"tutor_sessions_live_chat_id_fkey"')
        out = super().execute()
        db.settle()
        if self.name == "tutor_chats":
            for row in out.data or []:
                row.pop("live", None)
        if db.after:
            db.after(self)
        return out


class ConstraintDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.hooks, self.step, self.after = [], None, None

    def table(self, name):
        return ConstraintQuery(self, name)

    def before(self, table, op, run, when=None):
        """Run `run()` once, just before the next matching write or read of `table`."""
        self.hooks.append((table, op, when or (lambda query: True), run))

    def settle(self):
        """The foreign key's on delete set null, and the tests' view of which chat is live."""
        ids = {r["id"] for r in self.rows("tutor_chats")}
        pointed = set()
        for session in self.rows("tutor_sessions"):
            if session.get("live_chat_id") not in ids:
                session["live_chat_id"] = None
            if session.get("live_chat_id"):
                pointed.add(session["live_chat_id"])
        for row in self.rows("tutor_chats"):
            row["live"] = row["id"] in pointed


class SavedChatsBase(unittest.TestCase):
    db_class = FakeDB

    def setUp(self):
        self.db = self.db_class()
        self.fill(self.db)
        rate_limit._hits.clear()
        self.patches = route_patches(["tutor"], who, self.db)
        for module in ("services.saved_chats", "services.tutor_sessions"):
            self.patches.append(patch(f"{module}.get_supabase", side_effect=lambda: self.db))
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def fill(self, db):
        db.rows("folders").extend([
            {"id": CALC, "user_id": ANA, "name": "MATH 2210"}, {"id": ANATOMY, "user_id": ANA, "name": "BIOL 2400"},
            {"id": BEN_CLASS, "user_id": BEN, "name": "LAW 3100"},
        ])
        db.rows("study_guides").append({"id": GUIDE, "user_id": ANA, "title": "Related rates", "folder_id": CALC})
        db.rows("tutor_sessions").extend([
            {"id": SESSION, "user_id": ANA, "status": "idle", "conversation_version": 4, "active_guide_id": None, "live_chat_id": None,
             "messages": [], "created_at": "2026-10-01T09:00:00+00:00", "updated_at": "2026-11-14T10:00:00+00:00"},
            {"id": BEN_SESSION, "user_id": BEN, "status": "idle", "conversation_version": 0, "active_guide_id": None, "live_chat_id": None,
             "messages": [], "created_at": "2026-10-01T09:00:00+00:00", "updated_at": "2026-11-14T10:00:00+00:00"},
        ])

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def as_(self, name):
        return {"Authorization": f"Bearer {name}"}

    def call(self, method, path, who="ana", **kwargs):
        return self.client.request(method, path, headers=self.as_(who), **kwargs)

    def rows(self, table, user=ANA):
        return [r for r in self.db.rows(table) if r.get("user_id") == user]

    def row(self, chat_id):
        return next((r for r in self.db.rows("tutor_chats") if r["id"] == chat_id), None)

    def session(self, user=ANA):
        return self.rows("tutor_sessions", user)[0]

    def titles(self, response):
        return [chat["title"] for chat in response.json()["chats"]]


def seed_chats(db):
    db.rows("tutor_chats").extend([
        chat_row(RATES, ANA, "Exam 3 review: related rates", "2026-11-10T10:00:00+00:00", class_id=CALC, guide_id=GUIDE),
        chat_row(TITRATION, ANA, "Titration practice", "2026-11-12T10:00:00+00:00"),
        chat_row(RENAMED, ANA, "Why does heparin need monitoring?", "2026-11-11T10:00:00+00:00", renamed=True),
        chat_row(TRASHED, ANA, "Old study plan", "2026-11-13T10:00:00+00:00", deleted_at="2026-11-13T12:00:00+00:00"),
        chat_row(BEN_CHAT, BEN, "Negligence vs strict liability", "2026-11-12T11:00:00+00:00", class_id=BEN_CLASS),
    ])


def start_live(db, state="normal", class_id=None):
    """Ana's starting point. normal: mid-conversation in the live chat LIVE (its row keeps no copy yet).
    norow: the same conversation from before saved chats (no chat row, no pointer). empty: an empty live
    chat she just started."""
    session = next(r for r in db.rows("tutor_sessions") if r["user_id"] == ANA)
    if state != "empty":
        session.update({
            "messages": [ask("  Walk me through implicit   differentiation "), reply("Differentiate both sides, then solve for dy/dx.")],
            "updated_at": "2026-11-14T10:00:00+00:00",
        })
    if state != "norow":
        db.rows("tutor_chats").append(chat_row(LIVE, ANA, "", "2026-11-09T09:00:00+00:00", messages=[], class_id=class_id))
        session["live_chat_id"] = LIVE


def send(text, answer="p^2 + 2pq + q^2 = 1"):
    """A message turn through the same functions POST /chat uses: claim, then complete."""
    turn = tutor_sessions.claim_tutor_turn(ANA, SESSION, None, text, None)
    tutor_sessions.complete_tutor_turn(ANA, turn, {"answer": answer})


class AfterMigrationTests(SavedChatsBase):
    db_class = ConstraintDB

    def setUp(self):
        super().setUp()
        self.client.raise_server_exceptions = False  # a bug shows as the 500 the student would get
        seed_chats(self.db)

    def start_live(self, class_id=None):
        """Ana is mid-conversation in a live chat."""
        start_live(self.db, "normal", class_id)

    def live_id(self, user=ANA):
        return self.session(user).get("live_chat_id")

    def reachable(self, word):
        """Ids of the chats Ana can open now (the list) whose messages hold `word`."""
        found = []
        for chat in self.call("GET", "/chats?limit=100").json()["chats"]:
            messages = self.call("GET", f"/chats/{chat['id']}").json()["chat"]["messages"]
            if any(word in (m.get("text") or "") for m in messages):
                found.append(chat["id"])
        return found

    def holding(self, word, deleted=None):
        """Ana's chat rows (deleted, not deleted, or either) whose saved messages hold `word`."""
        return [r["id"] for r in self.rows("tutor_chats") if any(word in (m.get("text") or "") for m in r.get("messages") or [])
                and (deleted is None or bool(r.get("deleted_at")) == deleted)]

    def keep_talking(self, text):
        """The student sends a message in the Tutor: a full turn through the functions POST /chat uses."""
        send(text)

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
        start_live(self.db, "empty")
        self.assertNotIn(LIVE, [c["id"] for c in self.call("GET", "/chats").json()["chats"]])
        chat = self.call("GET", f"/chats/{LIVE}").json()["chat"]
        self.assertEqual((chat["messages"], chat["live"]), ([], True))

    def test_a_conversation_from_before_saved_chats_gets_one_stable_chat_and_is_listed_once(self):
        self.session().update({"messages": [ask("Explain the Krebs cycle"), reply("It oxidises acetyl-CoA.")], "active_guide_id": GUIDE})
        first = self.call("GET", "/chats").json()["chats"]
        self.call("GET", "/chats")
        live = [row for row in self.rows("tutor_chats") if row["live"]]
        self.assertEqual(len(live), 1)
        self.assertEqual(self.live_id(), live[0]["id"])  # the session points at it
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

    def test_a_pointer_at_a_deleted_chat_counts_as_no_live_chat(self):
        """Only a race (or a crash) can leave the session pointing at a deleted chat. Every reader treats it as
        no live chat, and the next read gives the conversation a chat of its own: nothing is live and deleted,
        nothing is dropped."""
        self.start_live()
        self.row(LIVE)["deleted_at"] = "2026-11-14T11:00:00+00:00"
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").status_code, 404)
        listed = self.call("GET", "/chats").json()["chats"]
        live = [c for c in listed if c["live"]]
        self.assertEqual(len(live), 1)
        self.assertNotEqual(live[0]["id"], LIVE)
        self.assertEqual(self.live_id(), live[0]["id"])
        self.assertEqual(self.call("GET", f"/chats/{live[0]['id']}").json()["chat"]["messages"], self.session()["messages"])

    # Rename ---------------------------------------------------------------------------------------
    def test_renaming_sets_the_title_and_keeps_the_order(self):
        response = self.call("PATCH", f"/chats/{RATES}", json={"title": "  Related   rates: exam 3  "})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chat"]["title"], "Related rates: exam 3")
        row = self.row(RATES)
        self.assertTrue(row["renamed"])
        self.assertEqual(row["updated_at"], "2026-11-10T10:00:00+00:00")  # a rename is not activity

    def test_a_renamed_live_chat_keeps_its_title_after_the_conversation_moves_on(self):
        self.start_live()
        self.call("PATCH", f"/chats/{LIVE}", json={"title": "Implicit differentiation"})
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "Implicit differentiation")
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "Implicit differentiation")

    def test_an_unrenamed_chat_is_titled_from_its_first_message_and_the_save_never_writes_a_title(self):
        self.start_live()
        self.call("POST", "/chats", json={})
        row = self.row(LIVE)
        self.assertEqual((row["title"], row["renamed"]), ("", False))  # the save writes messages and time only
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "Walk me through implicit differentiation")
        self.assertIn("Walk me through implicit differentiation", self.titles(self.call("GET", "/chats")))
        panel = {c["id"]: c["title"] for c in self.call("GET", "/tutor/chats").json()["chats"]}
        self.assertEqual(panel[LIVE], "Walk me through implicit differentiation")  # the old panel's list too

    def test_a_blank_title_and_an_empty_change_are_refused(self):
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={"title": "   "}).status_code, 422)
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={"title": "x" * 121}).status_code, 422)
        self.assertEqual(self.call("PATCH", f"/chats/{RATES}", json={}).status_code, 400)

    def test_a_student_cannot_rename_move_or_delete_another_students_chat(self):
        self.db.settle()
        before = copy.deepcopy(self.db.rows("tutor_chats"))
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
        self.assertIsNone(self.row(TITRATION)["class_id"])

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
        self.assertIsNone(self.live_id())
        self.assertEqual(self.session()["conversation_version"], 5)
        row = self.row(LIVE)
        self.assertEqual((row["live"], row["messages"], bool(row["deleted_at"])), (False, messages, True))
        restored = self.call("POST", f"/chats/{LIVE}/restore").json()["chat"]
        self.assertEqual((restored["title"], restored["live"], restored["class_id"]),
                         ("Walk me through implicit differentiation", False, CALC))
        self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["messages"], messages)

    def test_a_busy_tutor_blocks_deleting_the_live_chat(self):
        self.start_live()
        self.session().update({"status": "running", "run_id": "70000000-0000-4000-8000-000000000001",
                               "run_started_at": datetime.now(timezone.utc).isoformat()})
        self.assertEqual(self.call("DELETE", f"/chats/{LIVE}").status_code, 409)
        self.assertIsNone(self.row(LIVE)["deleted_at"])
        self.assertEqual(self.live_id(), LIVE)

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
        self.assertEqual(self.live_id(), body["chat"]["id"])
        self.assertEqual(body["session"]["messages"], [])
        self.assertEqual(body["session"]["conversation_version"], 5)
        self.assertNotIn("live_chat_id", body["session"])  # the session's shape is unchanged
        saved = self.row(LIVE)
        self.assertFalse(saved["live"])
        self.assertEqual(len(saved["messages"]), 2)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if any("implicit" in m["text"] for m in r["messages"])]), 1)

    def test_a_new_chat_can_start_in_a_class_or_about_a_guide(self):
        in_class = self.call("POST", "/chats", json={"class_id": ANATOMY}).json()["chat"]
        self.assertEqual(in_class["class_id"], ANATOMY)
        about_guide = self.call("POST", "/chats", json={"guide_id": GUIDE}).json()
        self.assertEqual((about_guide["chat"]["guide_id"], about_guide["chat"]["class_id"]), (GUIDE, CALC))
        self.assertEqual(about_guide["session"]["active_guide_id"], GUIDE)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertIsNone(self.row(in_class["id"]))  # the empty chat nobody used is not kept

    def test_an_empty_chat_the_student_renamed_is_kept_when_they_start_another(self):
        start_live(self.db, "empty")
        self.call("PATCH", f"/chats/{LIVE}", json={"title": "Exam 3 prep"})
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assertEqual((self.row(LIVE)["title"], self.row(LIVE)["live"]), ("Exam 3 prep", False))

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
        self.assertEqual(self.live_id(), RATES)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertFalse(self.row(LIVE)["live"])
        self.assertEqual(self.row(LIVE)["messages"][0]["text"], "  Walk me through implicit   differentiation ")
        self.assertEqual(self.call("POST", f"/chats/{RATES}/open").status_code, 200)  # already open: no change
        self.assertEqual(self.session()["conversation_version"], 5)

    def test_a_deleted_chat_cannot_be_opened(self):
        self.assertEqual(self.call("POST", f"/chats/{TRASHED}/open").status_code, 404)

    def test_the_tutor_panels_past_chat_list_leaves_out_the_live_and_deleted_chats(self):
        self.start_live()
        listed = self.call("GET", "/tutor/chats").json()["chats"]
        self.assertEqual(sorted(c["id"] for c in listed), sorted([RATES, TITRATION, RENAMED]))
        self.assertEqual(set(listed[0]), {"id", "guide_id", "title", "updated_at"})  # the same shape as before

    def test_the_tutor_panels_new_chat_route_keeps_the_live_chats_row(self):
        self.start_live()
        response = self.call("POST", "/tutor/session/new", json={"session_id": SESSION})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["messages"], [])
        self.assertNotIn("live_chat_id", response.json())
        self.assertEqual(len(self.row(LIVE)["messages"]), 2)

    def test_a_deleted_chat_is_not_material_for_the_memory_trick(self):
        from services import memory_context
        said = [ask("Who started ATO?"), reply("Otis Allan Glazebrook founded ATO in Richmond.")]
        self.db.rows("tutor_chats").extend([
            chat_row("a0000000-0000-4000-8000-0000000000b1", ANA, "Greek life", "2026-11-14T10:00:00+00:00", messages=said),
            chat_row("a0000000-0000-4000-8000-0000000000b2", ANA, "Greek life, deleted", "2026-11-14T11:00:00+00:00", messages=said,
                     deleted_at="2026-11-14T12:00:00+00:00"),
            chat_row("a0000000-0000-4000-8000-0000000000b3", ANA, "", "2026-11-14T09:00:00+00:00", messages=said),
        ])
        with self.assertLogs("services.memory_context", "WARNING"):  # the fake database has no full-text search
            found = memory_context.related_material(self.db, ANA, GUIDE, "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual(sorted(item["title"] for item in found if item["kind"] == "tutor"), ["Greek life", "Who started ATO?"])

    def test_twenty_newer_deleted_chats_do_not_crowd_out_a_live_one_for_the_memory_trick(self):
        from services import memory_context
        said = [ask("Who started ATO?"), reply("Otis Allan Glazebrook founded ATO in Richmond.")]
        self.db.rows("tutor_chats").append(
            chat_row("a0000000-0000-4000-8000-0000000000c0", ANA, "Greek life", "2026-11-01T10:00:00+00:00", messages=said))
        for n in range(20):  # all newer than the live one, so the 20 newest rows are all deleted
            self.db.rows("tutor_chats").append(
                chat_row(f"a0000000-0000-4000-8000-0000000001{n:02d}", ANA, f"Deleted {n}", f"2026-11-14T10:{n:02d}:00+00:00",
                         messages=said, deleted_at="2026-11-14T12:00:00+00:00"))
        with self.assertLogs("services.memory_context", "WARNING"):  # the fake database has no full-text search
            found = memory_context.related_material(self.db, ANA, GUIDE, "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual([item["title"] for item in found if item["kind"] == "tutor"], ["Greek life"])

    def test_the_memory_trick_falls_back_only_when_the_column_is_missing(self):
        from services import memory_context
        said = [ask("Who started ATO?"), reply("Otis Allan Glazebrook founded ATO in Richmond.")]
        self.db.rows("tutor_chats").append(chat_row("a0000000-0000-4000-8000-0000000000b1", ANA, "Greek life", "2026-11-14T10:00:00+00:00", messages=said))
        real = ConstraintQuery.execute
        seen = []

        def timeout(query):
            if query.name == "tutor_chats":
                seen.append(query.columns)
                raise db_error("57014", "canceling statement due to statement timeout")
            return real(query)
        with patch.object(ConstraintQuery, "execute", timeout), self.assertLogs("services.memory_context", "WARNING") as logs:
            found = memory_context.related_material(self.db, ANA, GUIDE, "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual([item for item in found if item["kind"] == "tutor"], [])  # skipped this time, not read without the filter
        self.assertEqual(len(seen), 1)
        self.assertTrue(any("Tutor chats unavailable" in line for line in logs.output))

    def test_a_second_student_resumes_through_the_tutor_panels_route(self):
        ben_chat = self.row(BEN_CHAT)
        ben_chat["messages"] = [ask("Negligence or strict liability?"), reply("Strict liability needs no fault.")]
        response = self.call("POST", "/tutor/session/new", who="ben", json={"session_id": BEN_SESSION, "resume_id": BEN_CHAT})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["messages"][0]["text"], "Negligence or strict liability?")
        self.assertEqual(self.live_id(BEN), BEN_CHAT)
        self.assertEqual(self.call("POST", "/tutor/session/new", json={"session_id": SESSION, "resume_id": BEN_CHAT}).status_code, 404)
        self.assertEqual(self.call("POST", "/tutor/session/new", who="ben", json={"session_id": SESSION}).status_code, 404)
        self.assertEqual(self.call("POST", "/tutor/session/new", who="ben", json={"session_id": BEN_SESSION, "resume_id": RATES}).status_code, 404)
        self.assertIsNone(self.live_id())

    def test_the_students_own_purge_leaves_another_students_deleted_chats_alone(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        self.db.rows("tutor_chats").append(chat_row("a0000000-0000-4000-8000-0000000000c1", BEN, "Ben's old chat", "2026-09-01T10:00:00+00:00", deleted_at=old))
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assertIn("a0000000-0000-4000-8000-0000000000c1", [r["id"] for r in self.db.rows("tutor_chats")])
        self.assertEqual(self.call("POST", "/chats", who="ben", json={}).status_code, 200)
        self.assertNotIn("a0000000-0000-4000-8000-0000000000c1", [r["id"] for r in self.db.rows("tutor_chats")])

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
        self.session().update({"messages": [ask("Explain negligence"), reply("Duty, breach, causation, damage.")],
                               "active_guide_id": other_guide, "live_chat_id": None})
        self.call("GET", "/chats")
        live = [r for r in self.rows("tutor_chats") if r["live"]]
        self.assertEqual((len(live), live[0]["class_id"]), (1, None))  # a conversation from before saved chats

    def test_the_fake_database_enforces_the_pointer(self):
        with self.assertRaises(APIError) as caught:
            self.db.table("tutor_chats").select("id,live").execute()  # there is no live column
        self.assertEqual(caught.exception.code, "42703")
        with self.assertRaises(APIError) as caught:
            self.db.table("tutor_sessions").update({"live_chat_id": MISSING}).eq("id", SESSION).execute()
        self.assertEqual(caught.exception.code, "23503")
        self.start_live()
        self.db.table("tutor_chats").delete().eq("id", LIVE).execute()
        self.assertIsNone(self.live_id())  # on delete set null: the conversation stays in the session
        self.assertEqual(len(self.session()["messages"]), 2)


class TwoTabTests(AfterMigrationTests):
    """Two tabs, step by step. at(n, other) runs the other tab's whole request just before the n-th database
    call of this one; each test tries every n."""

    def every_step(self, state, a, b, check):
        """Run request a with request b at each of a's database calls in turn, from a fresh `state`, and call
        check(a's status, b's status) after each."""
        n = 1
        while True:
            self.tearDown()
            self.setUp()
            start_live(self.db, state)
            seen = {"n": 0, "b": None, "inside": False}

            def step(query):
                if seen["inside"]:
                    return
                seen["n"] += 1
                if seen["n"] == n:
                    seen["inside"] = True
                    try:
                        seen["b"] = b()
                    finally:
                        seen["inside"] = False
            self.db.step = step
            got = a()
            self.db.step = None
            if seen["b"] is None:
                return n - 1
            with self.subTest(state=state, at=n):
                check(got, seen["b"])
            n += 1

    def code(self, method, path, body=None):
        return lambda: (self.call(method, path, json=body) if body is not None else self.call(method, path)).status_code

    def assert_consistent(self):
        """No chat is live and deleted; the list, a single chat and the panel agree on which chat is live."""
        for session in self.db.rows("tutor_sessions"):
            pointer = session.get("live_chat_id")
            if pointer:
                row = self.row(pointer)
                self.assertTrue(row and not row.get("deleted_at") and row["user_id"] == session["user_id"], f"{pointer} is live and deleted")
        listed = self.call("GET", "/chats?limit=100").json()["chats"]
        live = [c["id"] for c in listed if c["live"]]
        self.assertLessEqual(len(live), 1)
        if self.session()["messages"]:
            self.assertEqual(live, [self.live_id()])
        for chat in listed:
            self.assertEqual(self.call("GET", f"/chats/{chat['id']}").json()["chat"]["live"], chat["id"] in live)
        self.assertFalse(set(live) & {c["id"] for c in self.call("GET", "/tutor/chats").json()["chats"]})

    def assert_what_was_typed_after_is_kept(self, word="Hardy-Weinberg"):
        """The student keeps talking, then starts another chat: the messages end up in exactly one chat they
        can list (here and in the Tutor panel)."""
        send(f"Next topic: {word}")
        self.assert_consistent()
        self.assertEqual(len(self.reachable(word)), 1)
        self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
        self.assert_consistent()
        self.assertEqual(len(self.holding(word, deleted=False)), 1)
        self.assertEqual(self.holding(word, deleted=True), [])
        self.assertEqual(len(self.reachable(word)), 1)
        self.assertIn(self.holding(word)[0], [c["id"] for c in self.call("GET", "/tutor/chats").json()["chats"]])

    def later(self, days=31):
        real = saved_chats.datetime

        class Later(real):
            @classmethod
            def now(cls, tz=None):
                return real.now(tz) + timedelta(days=days)
        return patch.object(saved_chats, "datetime", Later)

    # H-A: open plus delete of the live chat (probe_wrong_row) ------------------------------------------
    def test_h_a_opening_a_chat_while_another_tab_deletes_the_live_chat_loses_nothing(self):
        for state in ("normal", "empty", "norow"):
            def check(a, b, state=state):
                self.assertEqual(a, 200)
                self.assertIn(b, (404,) if state == "norow" else (200, 404) if state == "empty" else (200,))  # empty: gone once unused
                self.assertEqual(self.live_id(), RATES)
                self.assertTrue(any("Exam 3 review" in m["text"] for m in self.session()["messages"]))
                self.assertEqual(self.reachable("Exam 3 review"), [RATES])
                if state == "normal":  # the deleted live chat holds its own conversation, and nothing else
                    self.assertEqual(self.holding("implicit"), [LIVE])
                    self.assertEqual(self.reachable("implicit"), [])
                    self.assertEqual(self.holding("Exam 3 review", deleted=True), [])
                if state == "norow":
                    self.assertEqual(len(self.reachable("implicit")), 1)
                self.assert_consistent()
                send("Next topic: Hardy-Weinberg")
                self.assertEqual(self.call("POST", "/chats", json={}).status_code, 200)
                with self.later():
                    saved_chats.purge_expired_chats()
                self.assertEqual(self.reachable("Exam 3 review"), [RATES])  # R's original messages survive the purge
                self.assertEqual(self.reachable("Hardy-Weinberg"), [RATES])
            self.assertGreater(self.every_step(state, self.code("POST", f"/chats/{RATES}/open"),
                                               self.code("DELETE", f"/chats/{LIVE}"), check), 5)

    def test_h_a_the_other_way_round_deleting_the_live_chat_while_another_tab_opens_one(self):
        for state in ("normal", "empty"):
            def check(a, b):
                self.assertIn(a, (200, 404))
                self.assertEqual(b, 200)
                self.assertEqual(self.reachable("Exam 3 review"), [RATES])
                if a == 200:
                    self.assertEqual(self.reachable("implicit"), [])
                    self.assertTrue(self.row(LIVE)["deleted_at"])
                else:
                    self.assertLessEqual(len(self.reachable("implicit")), 1)
                self.assertEqual(self.holding("Exam 3 review", deleted=True), [])
                self.assert_consistent()
                self.assert_what_was_typed_after_is_kept()
            self.every_step(state, self.code("DELETE", f"/chats/{LIVE}"), self.code("POST", f"/chats/{RATES}/open"), check)

    # H-B: crashes are in CrashTests; the old put-back and turns (probe_after_reset [5], [6]) ---------
    def test_a_turn_started_in_another_tab_is_never_overwritten(self):
        """probe_after_reset [5]: tab A opens R; in the middle, tab C starts a turn and tab B deletes R; C's turn
        then completes. There is no put-back any more, so C's message stays wherever it was sent."""
        held = {}

        def tab_c_then_b():
            held["turn"] = None
            try:
                held["turn"] = tutor_sessions.claim_tutor_turn(ANA, SESSION, None, "Tab C: quick question on L'Hopital", None)
            except HTTPException:
                pass
            return self.call("DELETE", f"/chats/{RATES}").status_code

        def check(a, b):
            self.assertIn(a, (200, 404, 409))
            self.assertIn(b, (200, 404, 409))
            if held["turn"]:
                tutor_sessions.complete_tutor_turn(ANA, held["turn"], {"answer": "Here you go."})
                self.assertEqual(len(self.reachable("L'Hopital")) + len(self.holding("L'Hopital", deleted=True)) > 0, True)
                self.assertLessEqual(len(self.reachable("L'Hopital")), 1)
            self.assertEqual(len(self.reachable("implicit")), 1)
            self.assert_consistent()
        self.every_step("normal", self.code("POST", f"/chats/{RATES}/open"), tab_c_then_b, check)

    def test_a_failed_delete_never_overwrites_a_turn(self):
        """probe_after_reset [6]: tab A deletes live L; tab C starts a turn and A's next write fails; C completes."""
        self.start_live()
        turn = {}

        def others():
            turn["t"] = tutor_sessions.claim_tutor_turn(ANA, SESSION, None, "Tab C question about related rates", None)
            raise db_error("08006", "connection failure")
        self.db.before("tutor_chats", "update", others)
        a = self.call("DELETE", f"/chats/{LIVE}")
        self.assertEqual(a.status_code, 500)  # a database failure before anything was replaced
        tutor_sessions.complete_tutor_turn(ANA, turn["t"], {"answer": "Answer."})
        self.assertEqual(self.reachable("implicit"), [LIVE])
        self.assertEqual(self.reachable("Tab C question"), [LIVE])
        self.assertIsNone(self.row(LIVE)["deleted_at"])

    def test_a_message_sent_between_the_save_and_the_reset_is_never_dropped(self):
        """conversation_version does not change when a turn is claimed or fails, or when the Tutor posts a reply
        outside a turn; updated_at does, and the reset checks it."""
        for name, other in (
            ("claim then fail", lambda: tutor_sessions.fail_tutor_turn(
                ANA, tutor_sessions.claim_tutor_turn(ANA, SESSION, None, "Can you check my chain rule step?", None), "model timeout")),
            ("reply outside a turn", lambda: tutor_sessions.append_tutor_message(ANA, "Can you check my chain rule step? Yes: it is right.")),
            ("full turn", lambda: send("Can you check my chain rule step?")),
        ):
            for action in (("POST", "/chats", {}), ("POST", f"/chats/{RATES}/open", None), ("DELETE", f"/chats/{LIVE}", None)):
                with self.subTest(other=name, action=action[1]):
                    def check(a, b, action=action):
                        self.assertIn(a, (200, 409))
                        where = self.reachable("chain rule") + self.holding("chain rule", deleted=True)
                        self.assertTrue(where, "the message sent in between was dropped")
                        if action[0] != "DELETE" or a != 200:
                            self.assertEqual(len(self.reachable("chain rule")), 1)
                        self.assert_consistent()
                    self.every_step("normal", self.code(*action), lambda other=other: other() or 200, check)

    def test_a_slower_request_never_saves_an_older_copy_over_a_newer_one(self):
        """Three tabs: A starts a new chat; in the middle of it the student sends a message (tab C) and starts
        another chat (tab B), which saves the longer conversation into the live chat's row. A's own save must
        never then write its shorter, older copy over it."""
        for action in (("POST", "/chats", {}), ("POST", f"/chats/{RATES}/open", None), ("DELETE", f"/chats/{LIVE}", None)):
            def check(a, b, action=action):
                self.assertIn(a, (200, 404, 409))
                held = self.holding("Hardy-Weinberg")
                self.assertTrue(held, "an older copy was saved over the newer one")  # B moved on, so a chat row holds it
                if LIVE in held or a != 200 or action[0] != "DELETE":
                    self.assertEqual(len(self.reachable("Hardy-Weinberg")) + len(self.holding("Hardy-Weinberg", deleted=True)), 1)
                self.assert_consistent()

            def talk_then_move_on():
                send("Next topic: Hardy-Weinberg")
                return self.call("POST", "/chats", json={}).status_code
            self.every_step("normal", self.code(*action), talk_then_move_on, check)

    # The settle hijack and the lost rename (probe_settle_hijack) ---------------------------------------
    def test_a_new_chat_never_changes_a_chat_another_tab_opened(self):
        for state in ("normal", "empty", "norow"):
            def check(a, b, state=state):
                self.assertEqual((a, b), (200, 200))
                rates = self.row(RATES)
                self.assertEqual((rates["class_id"], rates["guide_id"], rates["title"], rates["renamed"]),
                                 (CALC, GUIDE, "Exam 3 review: related rates", False))
                self.assertEqual(self.reachable("Exam 3 review"), [RATES])
                self.assertEqual(len(self.reachable("implicit")), 0 if state == "empty" else 1)
                self.assert_consistent()
            self.every_step(state, self.code("POST", "/chats", {"class_id": ANATOMY}), self.code("POST", f"/chats/{RATES}/open"), check)

    def test_a_rename_in_another_tab_during_a_new_chat_is_kept(self):
        def check(a, b):
            self.assertEqual(a, 200)
            if b == 404:  # an empty chat nobody used was already removed by the new chat: a stale tab
                self.assertIsNone(self.row(LIVE))
                return
            self.assertEqual(b, 200)
            live = self.row(LIVE)
            self.assertEqual((live["title"], live["renamed"]), ("My own title", True))
            self.assertEqual(self.call("GET", f"/chats/{LIVE}").json()["chat"]["title"], "My own title")
        for state in ("normal", "empty"):
            self.every_step(state, self.code("POST", "/chats", {}), self.code("PATCH", f"/chats/{LIVE}", {"title": "My own title"}), check)
        self.every_step("normal", self.code("POST", f"/chats/{RATES}/open"),
                        self.code("PATCH", f"/chats/{LIVE}", {"title": "My own title"}), check)

    # Duplicates ----------------------------------------------------------------------------------------
    def test_overlapping_starts_and_reads_never_save_a_conversation_twice(self):
        pairs = (
            (("POST", "/chats", {}), ("POST", "/tutor/session/new", {"session_id": SESSION})),
            (("POST", f"/chats/{RATES}/open", None), ("POST", "/chats", {})),
            (("POST", f"/chats/{RATES}/open", None), ("POST", f"/chats/{TITRATION}/open", None)),
            (("POST", f"/chats/{RATES}/open", None), ("POST", f"/chats/{RATES}/open", None)),
            (("POST", f"/chats/{RATES}/open", None), ("GET", "/chats", None)),
            (("POST", "/chats", {}), ("GET", f"/chats/{SESSION}", None)),
        )
        for a, b in pairs:
            for state in ("normal", "norow", "empty"):
                def check(code_a, code_b):
                    self.assertIn(code_a, (200, 409))
                    self.assertIn(code_b, (200, 409))
                    for word in ("Exam 3 review", "Titration") + (("implicit",) if state != "empty" else ()):
                        self.assertEqual(len(self.reachable(word)), 1, word)
                    self.assert_consistent()
                    self.assert_what_was_typed_after_is_kept()
                self.every_step(state, self.code(*a), self.code(*b), check)

    def test_two_tabs_starting_a_new_chat_at_once_both_get_one_and_the_conversation_is_saved_once(self):
        self.start_live()
        other = []
        self.db.before("tutor_sessions", "update", lambda: other.append(self.call("POST", "/tutor/session/new", json={"session_id": SESSION})))
        a = self.call("POST", "/tutor/session/new", json={"session_id": SESSION})
        self.assertEqual((a.status_code, other[0].status_code), (200, 200), (a.text, other[0].text))
        self.assertEqual(self.holding("implicit"), [LIVE])
        self.assertEqual(len([r for r in self.rows("tutor_chats") if r["live"]]), 1)
        self.assertEqual(len([r for r in self.rows("tutor_chats") if not r["messages"]]), 1)  # the other tab's empty chat went
        self.assert_consistent()

    # Stale tabs ----------------------------------------------------------------------------------------
    def test_deleting_a_saved_chat_another_tab_opened_meanwhile_is_taken_back(self):
        def opened_elsewhere():
            self.session().update({"live_chat_id": TITRATION, "messages": self.row(TITRATION)["messages"],
                                   "updated_at": datetime.now(timezone.utc).isoformat()})
        self.db.before("tutor_chats", "update", opened_elsewhere)
        response = self.call("DELETE", f"/chats/{TITRATION}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual((self.row(TITRATION)["live"], self.row(TITRATION)["deleted_at"]), (True, None))
        self.assert_consistent()

    def test_opening_a_chat_the_old_panel_removed_meanwhile_is_a_404_not_a_500(self):
        self.start_live()
        self.db.before("tutor_sessions", "update",
                       lambda: self.db.tables.update(tutor_chats=[r for r in self.db.rows("tutor_chats") if r["id"] != RATES]))
        response = self.call("POST", f"/chats/{RATES}/open")
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.live_id(), LIVE)
        self.assertEqual(len(self.session()["messages"]), 2)
        self.assert_consistent()

    def test_a_new_chat_whose_new_row_the_old_panel_removed_makes_another(self):
        self.start_live()

        def remove_fresh_row():
            self.db.tables["tutor_chats"] = [r for r in self.db.rows("tutor_chats") if r["messages"] or r["id"] == LIVE or r.get("title")]
        self.db.before("tutor_sessions", "update", remove_fresh_row)
        response = self.call("POST", "/chats", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.live_id(), response.json()["chat"]["id"])
        self.assertEqual(self.holding("implicit"), [LIVE])
        self.assert_consistent()


ACTIONS = {
    "new": lambda: saved_chats.start_chat(ANA),
    "panel_new": lambda: saved_chats.start_chat(ANA, SESSION),
    "open_rates": lambda: saved_chats.start_chat(ANA, resume_id=RATES),
    "open_titration": lambda: saved_chats.start_chat(ANA, resume_id=TITRATION),
    "open_live": lambda: saved_chats.start_chat(ANA, resume_id=LIVE),
    "delete_live": lambda: saved_chats.delete_chat(ANA, LIVE),
    "delete_rates": lambda: saved_chats.delete_chat(ANA, RATES),
    "restore_trashed": lambda: saved_chats.restore_chat(ANA, TRASHED),
    "list": lambda: saved_chats.list_chats(ANA, 100),
    "get_live": lambda: saved_chats.get_chat(ANA, LIVE),
    "rename_live": lambda: saved_chats.edit_chat(ANA, LIVE, {"title": "Implicit differentiation: my notes"}),
    "move_rates": lambda: saved_chats.edit_chat(ANA, RATES, {"class_id": ANATOMY}),
    "turn": lambda: send("Quick check: Krebs cycle", answer="It oxidises acetyl-CoA."),
}
WORDS = {"implicit": LIVE, "Exam 3 review": RATES, "Titration": TITRATION, "heparin": RENAMED, "Old study plan": TRASHED}
TURN_WORD, FOLLOW_UP = "Krebs", "Hardy-Weinberg"
SEEDED = (LIVE, RATES, TITRATION, RENAMED, TRASHED)


def status(action) -> int:
    try:
        ACTIONS[action]()
        return 200
    except HTTPException as error:
        return error.status_code
    except saved_chats.NotAvailable:
        return 503


class Interleavings(SavedChatsBase):
    """Every ordered pair of actions, with tab B's whole request run just before every database call of tab
    A's, from three starting points. The actions are the service functions the routes call (and claim then
    complete for a message), so the matrix stays fast enough for the suite."""
    db_class = ConstraintDB

    def fresh(self, state):
        self.db = ConstraintDB()
        self.fill(self.db)
        seed_chats(self.db)
        start_live(self.db, state)
        self.db.settle()
        self.before = {r["id"]: {k: r.get(k) for k in ("title", "class_id", "renamed", "guide_id", "created_at")}
                       for r in self.db.rows("tutor_chats") if r["user_id"] == ANA}

    def run_pair(self, state, a, b, at):
        self.fresh(state)
        seen = {"n": 0, "b": None, "inside": False}

        def step(query):
            if seen["inside"]:
                return
            seen["n"] += 1
            if seen["n"] == at:
                seen["inside"] = True
                try:
                    seen["b"] = self.safely(b)
                finally:
                    seen["inside"] = False
        self.db.step = step
        got = self.safely(a)
        self.db.step = None
        return got, seen["b"]

    def safely(self, action):
        try:
            return status(action)
        except Exception as error:  # a 500 for the student
            self.errors.append(f"{action}: {error!r}")
            return 500

    def texts(self, messages):
        return " ".join(m.get("text") or "" for m in messages or [])

    def problems(self, state, codes):
        """Every invariant, as a list of what is wrong (empty when all hold). codes: [(action, status)] for both tabs."""
        bad = []
        if any(code >= 500 for _, code in codes):
            bad.append(f"5xx {codes}")
        ok = lambda name: any(n == name and c == 200 for n, c in codes)  # noqa: E731
        session = next(r for r in self.db.rows("tutor_sessions") if r["user_id"] == ANA)
        rows = {r["id"]: r for r in self.db.rows("tutor_chats") if r["user_id"] == ANA}
        pointer = session.get("live_chat_id")
        if pointer and (pointer not in rows or rows[pointer].get("deleted_at")):
            bad.append("the live chat is deleted")
        # Wrong-row pairing: a chat row holds only its own conversation; the session only the live chat's.
        for row in rows.values():
            words = {w for w in WORDS if w in self.texts(row.get("messages"))}
            own = {w for w, owner in WORDS.items() if owner == row["id"]}
            if (row["id"] in SEEDED and words - own) or len(words) > 1:
                bad.append(f"{row['id'][:8]} holds {sorted(words)}")
        words = {w for w in WORDS if w in self.texts(session.get("messages"))}
        if len(words) > 1 or (pointer in SEEDED and words - {w for w, o in WORDS.items() if o == pointer}):
            bad.append(f"the session holds {sorted(words)} for {str(pointer)[:8]}")
        # Titles, classes and the renamed flag change only by a rename or move of that chat.
        allowed = {LIVE: {"title", "renamed"} if ok("rename_live") else set(), RATES: {"class_id"} if ok("move_rates") else set()}
        for chat_id, was in self.before.items():
            if chat_id not in rows:
                if not (chat_id == LIVE and state == "empty" and not ok("rename_live")):  # only an empty chat nobody used goes
                    bad.append(f"{chat_id[:8]} was removed")
                continue
            for key, value in was.items():
                if rows[chat_id].get(key) != value and key not in allowed.get(chat_id, set()):
                    bad.append(f"{chat_id[:8]} {key} changed")
        # One answer to "which chat is live", everywhere.
        listing = saved_chats.list_chats(ANA, 100)["chats"]
        session = next(r for r in self.db.rows("tutor_sessions") if r["user_id"] == ANA)
        live = [c["id"] for c in listing if c["live"]]
        if len(live) > 1 or (session.get("messages") and live != [session.get("live_chat_id")]):
            bad.append(f"live in the list {live}, pointer {session.get('live_chat_id')}")
        opened = {}
        for chat in listing:
            got = saved_chats.get_chat(ANA, chat["id"])["chat"]
            opened[chat["id"]] = self.texts(got["messages"])
            if got["live"] != (chat["id"] in live):
                bad.append(f"{chat['id'][:8]} live {got['live']} on its own, {chat['id'] in live} in the list")
        if set(live) & {c["id"] for c in tutor_sessions.list_tutor_chats(ANA)}:
            bad.append("the old panel lists the live chat as a past chat")
        # Every message is reachable once (in a deleted chat only when the student deleted that chat).
        deleted_ok = ({LIVE} if ok("delete_live") else set()) | ({RATES} if ok("delete_rates") else set())
        rows = {r["id"]: r for r in self.db.rows("tutor_chats") if r["user_id"] == ANA}
        held_deleted = lambda word: [i for i, r in rows.items() if r.get("deleted_at") and word in self.texts(r.get("messages"))]  # noqa: E731
        for word, owner in WORDS.items():
            if state == "empty" and owner == LIVE:
                continue
            reach = len([i for i, text in opened.items() if word in text])
            if owner in deleted_ok:
                want = 0
                if not held_deleted(word):
                    bad.append(f"'{word}' was deleted but no deleted chat holds it (Undo impossible)")
            elif owner == TRASHED:
                want = 1 if ok("restore_trashed") else 0
            else:
                want = 1
            if reach != want:
                bad.append(f"'{word}' reachable {reach}, want {want}")
        if ok("turn"):
            reach = len([i for i, text in opened.items() if TURN_WORD in text])
            if reach != 1 and not (reach == 0 and deleted_ok and held_deleted(TURN_WORD)):
                bad.append(f"the message sent in the other tab is reachable {reach} times")
        return bad

    def follow_up(self):
        """The student keeps talking, then starts another chat: still consistent, the new words saved once."""
        bad = []
        try:
            send(f"Next topic: {FOLLOW_UP}")
            saved_chats.start_chat(ANA)
        except Exception as error:
            return [f"follow-up failed: {error!r}"]
        holders = [r for r in self.db.rows("tutor_chats") if FOLLOW_UP in self.texts(r.get("messages"))]
        if len(holders) != 1 or holders[0].get("deleted_at"):
            bad.append(f"follow-up held by {[(r['id'][:8], bool(r.get('deleted_at'))) for r in holders]}")
        session = next(r for r in self.db.rows("tutor_sessions") if r["user_id"] == ANA)
        pointer = session.get("live_chat_id")
        if pointer and self.row(pointer).get("deleted_at"):
            bad.append("after the follow-up the live chat is deleted")
        return bad

    def matrix(self, state):
        found, runs = [], 0
        for a, b in itertools.product(ACTIONS, ACTIONS):
            at = 1
            while True:
                self.errors = []
                code_a, code_b = self.run_pair(state, a, b, at)
                if code_b is None:
                    break
                runs += 1
                bad = self.problems(state, [(a, code_a), (b, code_b)]) + self.follow_up() + self.errors
                if bad:
                    found.append(f"{state}: A={a} B={b} before call {at}: {bad}")
                at += 1
        self.assertGreater(runs, 500)
        self.assertEqual(found, [], f"{len(found)} of {runs} interleavings broke an invariant:\n" + "\n".join(found[:40]))

    def test_every_pair_from_a_normal_live_chat(self):
        self.matrix("normal")

    def test_every_pair_from_a_conversation_with_no_chat_yet(self):
        self.matrix("norow")

    def test_every_pair_from_an_empty_live_chat(self):
        self.matrix("empty")

    def test_a_turn_in_flight_across_every_step_of_every_change(self):
        """POST /chat's claim lands just before each database call of a change of the live chat (or a delete,
        open or list), and its answer is written after that request has finished. The student's message and
        the answer end up in one chat they can open, never only in a deleted one they did not delete."""
        found, runs = [], 0
        for state, action in itertools.product(("normal", "norow", "empty"), (
                "new", "panel_new", "open_rates", "open_titration", "open_live", "delete_live", "delete_rates", "list")):
            at = 1
            while True:
                held = {}

                def claim():
                    try:
                        held["turn"] = tutor_sessions.claim_tutor_turn(ANA, SESSION, None, "Quick check: Krebs cycle", None)
                    except HTTPException as error:
                        return error.status_code
                    return 200
                self.errors = []
                self.fresh(state)
                seen = {"n": 0, "b": None}

                def step(query):
                    seen["n"] += 1
                    if seen["n"] == at and seen["b"] is None:
                        seen["b"] = claim()
                self.db.step = step
                code_a = self.safely(action)
                self.db.step = None
                if seen["b"] is None:
                    break
                runs += 1
                completed = False
                if held.get("turn"):
                    try:
                        tutor_sessions.complete_tutor_turn(ANA, held["turn"], {"answer": "It oxidises acetyl-CoA."})
                        completed = True
                    except HTTPException:
                        pass  # the change won: the turn's answer is refused (409), its question was saved
                codes = [(action, code_a), ("turn", 200 if completed else 409)]
                bad = self.problems(state, codes)
                if held.get("turn") and not completed:
                    opened = [self.texts(saved_chats.get_chat(ANA, c["id"])["chat"]["messages"])
                              for c in saved_chats.list_chats(ANA, 100)["chats"]]
                    if len([text for text in opened if TURN_WORD in text]) != 1:
                        bad.append("the question of a turn whose answer was refused is not in exactly one chat")
                bad += self.follow_up() + self.errors
                if bad:
                    found.append(f"{state}: {action} with a claim before call {at}: {bad}")
                at += 1
        self.assertGreater(runs, 100)
        self.assertEqual(found, [], "\n".join(found[:40]))


class Crash(BaseException):
    """The process dies here (a deploy, out of memory): no except block runs."""


class CrashTests(Interleavings):
    """A crash, a lost answer or a database blip at each database call of new chat, open and delete of the
    live chat: nothing is ever lost (a duplicate is allowed, a gap is not), and the next ordinary request
    leaves everything consistent."""

    def nothing_lost(self, state, action):
        bad = []
        session = next(r for r in self.db.rows("tutor_sessions") if r["user_id"] == ANA)
        for word, owner in WORDS.items():
            if (state == "empty" and owner == LIVE) or owner == TRASHED:
                continue
            in_session = word in self.texts(session.get("messages"))
            kept = [r for r in self.db.rows("tutor_chats") if word in self.texts(r.get("messages"))]
            alive = [r for r in kept if not r.get("deleted_at")]
            deleted_by_request = action == "delete_live" and owner == LIVE and any(r["id"] == LIVE for r in kept)
            if not in_session and not alive and not deleted_by_request:
                bad.append(f"'{word}' is gone (kept only in {[r['id'][:8] for r in kept]})")
        return bad

    def consistent_after(self, state, action):
        bad = []
        try:
            listing = saved_chats.list_chats(ANA, 100)["chats"]
        except Exception as error:
            return [f"the next list failed: {error!r}"]
        session = next(r for r in self.db.rows("tutor_sessions") if r["user_id"] == ANA)
        live = [c["id"] for c in listing if c["live"]]
        if len(live) > 1 or (session.get("messages") and live != [session.get("live_chat_id")]):
            bad.append(f"live {live} vs pointer {session.get('live_chat_id')}")
        opened = " | ".join(self.texts(saved_chats.get_chat(ANA, c["id"])["chat"]["messages"]) for c in listing)
        for word, owner in WORDS.items():
            if (state == "empty" and owner == LIVE) or owner == TRASHED:
                continue
            gone_on_purpose = action == "delete_live" and owner == LIVE and (self.row(LIVE) or {}).get("deleted_at")
            if word not in opened and not gone_on_purpose:
                bad.append(f"'{word}' cannot be reached after the crash")
        return bad + self.follow_up()

    def crash(self, state, action, mode, at):
        """mode crash: the process dies before call `at`. lost: call `at` is done but its answer never comes
        back. blip: calls `at` and `at + 1` fail with a database error. Returns False once `at` is past the
        request's last call."""
        self.fresh(state)
        seen = {"n": 0, "hit": False}

        def step(query):
            seen["n"] += 1
            if mode == "crash" and seen["n"] == at:
                seen["hit"] = True
                raise Crash()
            if mode == "blip" and seen["n"] in (at, at + 1):
                seen["hit"] = True
                raise db_error("08006", "connection failure")

        def after(query):
            if mode == "lost" and seen["n"] == at and query.op != "select":
                seen["hit"] = True
                raise db_error("57014", "canceling statement due to statement timeout")
        self.db.step, self.db.after = step, after
        try:
            status(action)
        except Crash:
            pass
        except Exception:
            pass  # a database error answered as a 500: the request ends here, like a crash
        self.db.step = self.db.after = None
        return seen["hit"] or seen["n"] >= at

    def test_a_crash_or_a_lost_answer_at_any_step_never_loses_a_message(self):
        found, runs = [], 0
        for state, action, mode in itertools.product(("normal", "norow", "empty"), ("new", "panel_new", "open_rates", "delete_live"),
                                                     ("crash", "lost", "blip")):
            at = 1
            while self.crash(state, action, mode, at):
                runs += 1
                self.errors = []
                bad = self.nothing_lost(state, action)
                bad += self.consistent_after(state, action)
                if bad:
                    found.append(f"{state} {action} {mode} at call {at}: {bad}")
                at += 1
        self.assertGreater(runs, 100)
        self.assertEqual(found, [], "\n".join(found[:40]))

    # probe_after_reset, case by case -------------------------------------------------------------------
    def test_probe_1_a_crash_right_after_the_first_chat_write_of_a_new_chat(self):
        self.fresh("normal")
        self.db.before("tutor_chats", "update", lambda: (_ for _ in ()).throw(Crash()))
        with self.assertRaises(Crash):
            saved_chats.start_chat(ANA)
        self.assertEqual(self.session()["messages"][0]["text"], "  Walk me through implicit   differentiation ")
        self.assertEqual(self.consistent_after("normal", "new"), [])

    def test_probe_2_the_old_order_still_only_duplicates(self):
        self.fresh("norow")
        self.db.before("tutor_sessions", "update", lambda: (_ for _ in ()).throw(Crash()))
        with self.assertRaises(Crash):
            tutor_sessions.start_tutor_chat(ANA, SESSION)
        self.assertTrue(any("implicit" in self.texts(r["messages"]) for r in self.rows("tutor_chats")))
        self.assertTrue("implicit" in self.texts(self.session()["messages"]))

    def test_probe_3_two_database_failures_right_after_the_reset_are_only_logged(self):
        self.fresh("normal")
        state = {"left": 2, "armed": False}

        def step(query):
            if state["armed"] and state["left"]:
                state["left"] -= 1
                raise db_error("08006", "connection failure")

        def after(query):
            if query.name == "tutor_sessions" and query.op == "update":
                state["armed"] = True
        self.db.step, self.db.after = step, after
        with self.assertLogs("services.saved_chats", "WARNING"):
            chat, _ = saved_chats.start_chat(ANA)
        self.db.step = self.db.after = None
        self.assertEqual(self.session()["live_chat_id"], chat["id"])
        self.assertEqual([r["id"] for r in self.rows("tutor_chats") if "implicit" in self.texts(r["messages"])], [LIVE])
        self.assertEqual(self.consistent_after("normal", "new"), [])

    def test_probe_4_a_save_that_was_written_but_whose_answer_was_lost(self):
        self.fresh("normal")
        state = {}

        def after(query):
            if query.name == "tutor_chats" and query.op == "update" and "messages" in (query.payload or {}) and not state:
                state["done"] = True
                raise db_error("57014", "canceling statement due to statement timeout")
        self.db.after = after
        with self.assertRaises(APIError):
            saved_chats.start_chat(ANA)
        self.db.after = None
        self.assertEqual(self.session()["live_chat_id"], LIVE)  # nothing was replaced
        self.assertEqual(self.consistent_after("normal", "new"), [])
        self.assertEqual(len([r for r in self.rows("tutor_chats") if "implicit" in self.texts(r["messages"]) and not r.get("deleted_at")]), 1)

    # The purge never removes the chat a session points at ----------------------------------------------
    def test_the_purge_never_removes_the_chat_a_session_points_at_even_with_an_old_deleted_at(self):
        self.fresh("normal")
        self.row(LIVE)["deleted_at"] = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()  # only a bug could do this
        self.row(TRASHED)["deleted_at"] = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        self.assertEqual(saved_chats.purge_expired_chats(), 1)
        saved_chats._purge_deleted(ANA)
        self.assertIsNotNone(self.row(LIVE))
        self.assertIsNone(self.row(TRASHED))
        self.assertEqual(self.session()["live_chat_id"], LIVE)


class StaleSchemaCacheTests(SavedChatsBase):
    """Right after the migration, before PostgREST reloads its schema cache: reads see the new columns,
    writes naming them are refused with PGRST204. Nothing answers 500; new and open fall back to the old path."""
    db_class = ConstraintDB

    def setUp(self):
        super().setUp()
        self.client.raise_server_exceptions = False
        seed_chats(self.db)
        start_live(self.db, "norow")
        real = ConstraintQuery.execute

        def stale(query):
            if query.op in ("insert", "update") and isinstance(query.payload, dict):
                for column in NEW_COLUMNS.get(query.name, ()):
                    if column in query.payload:
                        raise db_error("PGRST204", f"Could not find the '{column}' column of '{query.name}' in the schema cache")
            return real(query)
        self.patches.append(patch.object(ConstraintQuery, "execute", stale))
        self.patches[-1].start()

    def test_nothing_answers_500_and_starts_use_the_old_path(self):
        self.assertEqual(self.call("GET", "/chats").status_code, 200)
        self.assertEqual(self.call("GET", f"/chats/{SESSION}").status_code, 200)
        for method, path, body in (("PATCH", f"/chats/{RATES}", {"title": "Related rates"}), ("DELETE", f"/chats/{RATES}", None),
                                   ("POST", f"/chats/{TRASHED}/restore", None)):
            response = self.call(method, path, json=body) if body else self.call(method, path)
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["code"], "chats_not_available")
        started = self.call("POST", "/chats", json={})
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()["session"]["messages"], [])
        self.assertTrue(any("implicit" in " ".join(m["text"] for m in r["messages"]) for r in self.rows("tutor_chats")))
        opened = self.call("POST", f"/chats/{TITRATION}/open")
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertIsNone(self.session()["live_chat_id"])  # the old path never writes the pointer

    def test_the_panel_routes_still_answer(self):
        self.assertEqual(self.call("GET", "/tutor/chats").status_code, 200)
        self.assertEqual(self.call("POST", "/tutor/session/new", json={"session_id": SESSION}).status_code, 200)


class BeforeMigrationTests(SavedChatsBase):
    """The live database today: tutor_chats has no class_id, renamed or deleted_at, tutor_sessions no live_chat_id."""
    db_class = LegacyDB

    def setUp(self):
        super().setUp()
        legacy = lambda id, user, title, updated, **extra: {k: v for k, v in chat_row(id, user, title, updated, **extra).items() if k not in CHAT_COLUMNS}  # noqa: E731
        self.db.rows("tutor_chats").extend([
            legacy(RATES, ANA, "Exam 3 review: related rates", "2026-11-10T10:00:00+00:00", guide_id=GUIDE),
            legacy(TITRATION, ANA, "", "2026-11-12T10:00:00+00:00", messages=[ask("  How do I read   a titration curve? "), reply("Find the equivalence point.")]),
            legacy(BEN_CHAT, BEN, "Negligence vs strict liability", "2026-11-12T11:00:00+00:00"),
        ])
        for session in self.db.rows("tutor_sessions"):
            session.pop("live_chat_id")

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

    def test_the_memory_trick_still_reads_the_chats_before_the_migration(self):
        from services import memory_context
        said = [ask("Who started ATO?"), reply("Otis Allan Glazebrook founded ATO in Richmond.")]
        self.db.rows("tutor_chats").append(
            {k: v for k, v in chat_row("a0000000-0000-4000-8000-0000000000c0", ANA, "Greek life", "2026-11-14T10:00:00+00:00", messages=said).items() if k not in CHAT_COLUMNS})
        with self.assertLogs("services.memory_context", "WARNING"):  # the fake database has no full-text search
            found = memory_context.related_material(self.db, ANA, GUIDE, "Who founded ATO?", "Otis Allan Glazebrook")
        self.assertEqual([item["title"] for item in found if item["kind"] == "tutor"], ["Greek life"])

    def test_the_extensions_chat_endpoint_is_not_touched(self):
        import routers.chat as chat_router
        self.assertEqual(chat_router.router.prefix, "")
        paths = {route.path for route in chat_router.router.routes}
        self.assertEqual(paths, {"/chat"})


class MigrationFileTests(unittest.TestCase):
    SQL = (ROOT / "supabase/migrations/20261130120000_saved_chats.sql").read_text()

    def body(self):
        return "\n".join(line for line in self.SQL.splitlines() if not line.lstrip().startswith("--"))

    def test_it_is_marked_not_applied_on_its_first_line(self):
        self.assertTrue(self.SQL.splitlines()[0].startswith("-- NOT APPLIED: waiting for owner's OK"))

    def test_it_adds_to_the_existing_tables_instead_of_a_second_store(self):
        self.assertNotIn("create table", self.SQL.lower())
        for column in ("class_id uuid references public.folders(id) on delete set null", "renamed boolean not null default false",
                       "deleted_at timestamptz", "live_chat_id uuid references public.tutor_chats(id) on delete set null"):
            self.assertIn(column, self.SQL)
        self.assertIn("(user_id, class_id, updated_at desc) where deleted_at is null", self.SQL)

    def test_the_session_pointer_is_the_only_record_of_the_live_chat(self):
        body = self.body()
        self.assertIn("alter table public.tutor_sessions\n  add column if not exists live_chat_id uuid", body)
        self.assertNotIn(" live boolean", body)
        self.assertNotRegex(body, r"where live\b")
        self.assertIn("on public.tutor_sessions (live_chat_id) where live_chat_id is not null", body)
        self.assertNotIn("update public.tutor_sessions", body)  # nullable, no backfill

    def test_it_stays_service_role_only_like_the_other_tutor_tables(self):
        self.assertIn("enable row level security", self.SQL)
        self.assertIn("revoke all on table public.tutor_chats from public, anon, authenticated", self.SQL)
        self.assertNotIn("create policy", self.SQL.lower())
        self.assertNotIn("create function", self.SQL.lower())  # no database function

    def test_it_can_run_twice(self):
        self.assertEqual(self.SQL.count("add column if not exists"), 3)  # class_id is added inside the guarded block below
        self.assertEqual(self.SQL.count("create index if not exists"), 4)

    def test_it_applies_whole_or_not_at_all_and_does_not_wait_on_a_lock(self):
        lines = [line.strip() for line in self.SQL.splitlines()]
        self.assertEqual(lines.count("begin;"), 1)
        self.assertEqual(lines.count("commit;"), 1)
        self.assertLess(lines.index("begin;"), lines.index("commit;"))
        self.assertEqual(lines[lines.index("begin;") + 2], "set local lock_timeout = '5s';")
        self.assertNotIn("alter table", "\n".join(lines[:lines.index("begin;")]))  # nothing runs before the transaction opens
        self.assertIn("applied as ONE script", self.SQL)

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
        for message in ("column tutor_chats.deleted_at does not exist", "Could not find the 'deleted_at' column of 'tutor_chats' in the schema cache",
                        'column "renamed" does not exist', 'column "class_id" does not exist',
                        "column tutor_sessions.live_chat_id does not exist",
                        "Could not find the 'live_chat_id' column of 'tutor_sessions' in the schema cache"):
            code = "PGRST204" if message.startswith("Could not") else "42703"
            self.assertTrue(tutor_sessions.is_missing_saved_chats_schema(APIError({"code": code, "message": message})), message)

    def test_other_errors_that_only_contain_the_letters_are_not(self):
        for code, message in (("42P01", 'relation "public.delivery" does not exist'),
                              ("42703", 'column "live_chat_identity" does not exist'),
                              ("42703", 'column "is_renamed" does not exist'),
                              ("57014", "canceling statement due to statement timeout"),
                              ("23503", 'insert or update on table "tutor_sessions" violates foreign key constraint "tutor_sessions_live_chat_id_fkey"'),
                              ("23505", 'duplicate key value violates unique constraint "tutor_sessions_user_id_key"')):
            self.assertFalse(tutor_sessions.is_missing_saved_chats_schema(APIError({"code": code, "message": message})), message)

    def test_a_missing_table_still_counts(self):
        self.assertTrue(tutor_sessions.is_missing_saved_chats_schema(
            APIError({"code": "PGRST205", "message": "Could not find the table 'public.tutor_chats' in the schema cache"})))

    def test_selecting_filtering_inserting_and_updating_the_pointer_before_the_migration_all_fall_back(self):
        db = LegacyDB()
        db.rows("tutor_sessions").append({"id": SESSION, "user_id": ANA, "messages": []})
        for run in (lambda: db.table("tutor_sessions").select("id,live_chat_id").execute(),
                    lambda: db.table("tutor_sessions").select("id").eq("live_chat_id", LIVE).execute(),
                    lambda: db.table("tutor_sessions").insert({"user_id": BEN, "live_chat_id": None}).execute(),
                    lambda: db.table("tutor_sessions").update({"live_chat_id": None}).eq("id", SESSION).execute()):
            with self.assertRaises(Exception) as caught:
                run()
            self.assertTrue(tutor_sessions.is_missing_saved_chats_schema(caught.exception), caught.exception)


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
        # The chat Ana's Tutor session points at, with an old deleted_at (only a bug could do this; the purge still leaves it).
        self.db.rows("tutor_chats").append(chat_row(self.id(7), ANA, "Live", "2026-11-14T10:00:00+00:00", messages=[], deleted_at=ago(45)))
        self.session()["live_chat_id"] = self.id(7)

    def ids(self):
        return sorted(r["id"] for r in self.db.rows("tutor_chats"))

    def test_a_chat_deleted_31_days_ago_is_removed_and_29_days_ago_is_kept_for_every_student(self):
        self.assertEqual(saved_chats.purge_expired_chats(), 2)
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 5, 6, 7)])

    def test_a_chat_that_is_not_deleted_and_the_live_chat_are_never_removed_however_old(self):
        saved_chats.purge_expired_chats()
        self.assertIn(self.id(3), self.ids())  # deleted_at null
        self.assertIn(self.id(6), self.ids())
        self.assertIn(self.id(7), self.ids())  # the session points at it, even with an old deleted_at
        self.assertEqual(self.session()["live_chat_id"], self.id(7))

    def test_the_students_own_purge_only_touches_their_rows(self):
        saved_chats._purge_deleted(ANA)
        self.assertEqual(self.ids(), [self.id(n) for n in (2, 3, 4, 5, 6, 7)])  # Ben's old chat is still there
        saved_chats._purge_deleted(BEN)
        self.assertNotIn(self.id(4), self.ids())

    def test_the_delete_asks_for_a_count_not_the_rows(self):
        seen = []
        real = ConstraintQuery.execute

        def spy(query):
            out = real(query)
            if query.op == "delete":
                seen.append((query.minimal, query.count, out.data, out.count))
            return out
        with patch.object(ConstraintQuery, "execute", spy):
            self.assertEqual(saved_chats.purge_expired_chats(), 2)
        self.assertEqual([(minimal, data) for minimal, _, data, _ in seen], [(True, [])])
        self.assertEqual(seen[0][3], 2)

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
        with patch.object(saved_chats, "_expired", wraps=saved_chats._expired) as spy, \
                patch.object(saved_chats, "_pointed_at", wraps=saved_chats._pointed_at) as live:
            saved_chats._purge_deleted(ANA)
            saved_chats.purge_expired_chats()
        cutoffs = [call.args[1] for call in spy.call_args_list]
        self.assertGreaterEqual(len(cutoffs), 4)  # a pick and a delete, in each of the two runs
        self.assertEqual(sum(1 for x, y in zip(cutoffs, cutoffs[1:]) if x != y), 1)  # one cutoff per run, for every pick and delete
        self.assertGreaterEqual(live.call_count, 2)  # both leave out the chats a session points at
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
