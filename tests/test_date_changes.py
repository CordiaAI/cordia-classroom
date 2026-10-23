"""Phase 3: deadline changes from school email and Canvas announcements, confirmed by the student."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
NOW = datetime.now(timezone.utc).replace(microsecond=0)
DUE = (NOW + timedelta(days=6)).replace(minute=0, second=0)
ITEMS = [{"id": "canvas-1", "title": "Midterm", "due_at": DUE.isoformat(), "course": "BIO 101", "done": False, "type": "exam"},
         {"id": "canvas-2", "title": "Essay 2", "due_at": (DUE + timedelta(days=3)).isoformat(), "course": "ENG 102", "done": False}]


class Prefilter(unittest.TestCase):
    def test_only_schoolwork_timing_gets_past_the_first_pass(self):
        from services.text_processing import mentions_date_change
        for text in ("The midterm is moved to Thursday at 2pm.", "Your extension for the lab report: due Nov 3.",
                     "Reading response postponed until next week.", "Studio critique presentation rescheduled to 10/30."):
            self.assertTrue(mentions_date_change(text), text)
        for text in ("Your order has shipped and arrives Thursday.", "Great discussion in class today!", "Office hours are in room 204."):
            self.assertFalse(mentions_date_change(text), text)

    def test_school_senders_are_the_schools_domains_or_edu(self):
        from services.mail_watch import from_school
        self.assertTrue(from_school("Prof. Lee <lee@biology.state.edu>", []))
        self.assertTrue(from_school("TA <ta@mail.college.org>", ["college.org"]))
        self.assertFalse(from_school("Deals <news@shop.com>", ["college.org"]))
        self.assertFalse(from_school("no address here", ["college.org"]))


class Base(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.patches = [patch(f"{m}.get_supabase", return_value=self.db) for m in
                        ("services.mail_watch", "services.sync_state", "routers.plans", "services.google_sync")]
        self.patches.append(patch("services.mail_watch.upcoming", return_value=[dict(i) for i in ITEMS]))
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()


class Proposals(Base):
    def test_only_real_deadlines_with_sane_new_dates_become_suggestions(self):
        from services import mail_watch
        later = (DUE + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M")
        found = [
            {"item_key": "canvas-1", "kind": "moved", "new_due": later, "summary": "Midterm moved two days later."},
            {"item_key": "canvas-9", "kind": "moved", "new_due": later},             # not a real deadline
            {"item_key": "canvas-2", "kind": "extension", "new_due": "2019-01-01T10:00"},  # nonsense date
            {"item_key": "canvas-2", "kind": "moved", "new_due": None},              # no date
        ]
        with patch("services.mail_watch.read_date_change", return_value=found):
            saved = mail_watch.propose(USER, source="gmail", source_id="m1", sender="Prof. Lee <lee@x.edu>", subject="Midterm", text="moved")
        self.assertEqual(saved, 1)
        row = self.db.rows("deadline_changes")[0]
        self.assertEqual((row["item_key"], row["kind"], row["old_due"]), ("canvas-1", "moved", DUE.isoformat()))
        self.assertTrue(row["new_due"].startswith(later[:13]))

    def test_watch_reads_only_school_mail_about_timing_and_each_message_once(self):
        from services import mail_watch
        messages = {"messages": [
            {"messageId": "a", "sender": "Prof. Lee <lee@state.edu>", "subject": "Midterm moved", "messageText": "The midterm moves to Friday at 10am."},
            {"messageId": "b", "sender": "Shop <deals@shop.com>", "subject": "Sale ends Friday", "messageText": "Due to demand, sale extended to Friday."},
            {"messageId": "c", "sender": "Prof. Lee <lee@state.edu>", "subject": "Hello", "messageText": "Thanks for a great class."},
        ]}
        with patch("services.composio.active_accounts", return_value={"gmail": "ca"}), \
                patch("services.composio.run", return_value=messages), \
                patch("services.mail_watch.read_date_change", return_value=[]) as reader:
            self.assertEqual(mail_watch.watch(USER, "gmail")["checked"], 1)
            mail_watch.watch(USER, "gmail")
        self.assertEqual(reader.call_count, 1)


class Applying(unittest.TestCase):
    def test_accepted_change_moves_the_date_until_canvas_changes_it(self):
        from services.deadlines import apply_changes
        decided = NOW.isoformat()
        new_due = (DUE + timedelta(days=2)).isoformat()
        change = {"canvas-1": {"kind": "extension", "new_due": new_due, "decided_at": decided, "sender": "Prof. Lee"}}
        items = apply_changes([dict(ITEMS[0])], change)
        self.assertEqual((items[0]["due_at"], items[0]["original_due_at"]), (new_due, DUE.isoformat()))
        items = apply_changes([dict(ITEMS[0])], change, {"canvas-1": (NOW + timedelta(hours=1)).isoformat()})
        self.assertEqual(items[0]["due_at"], DUE.isoformat())  # Canvas changed it after: Canvas wins.
        items = apply_changes([dict(ITEMS[0])], {"canvas-1": {**change["canvas-1"], "kind": "cancelled"}})
        self.assertTrue(items[0]["done"] and items[0]["cancelled"])


class Accepting(Base):
    def test_accepting_moves_steps_and_drops_planned_blocks_past_the_new_date(self):
        from routers import plans
        earlier = DUE - timedelta(days=3)
        self.db.rows("deadline_changes").append({"id": "c0000000-0000-4000-8000-000000000001", "user_id": USER, "item_key": "canvas-2",
                                                 "kind": "moved", "status": "pending", "new_due": earlier.isoformat(), "source": "gmail"})
        moved = {"id": "b1", "user_id": USER, "item_key": "canvas-2", "status": "moved", "starts_at": (DUE + timedelta(days=1)).isoformat()}
        planned = {"id": "b2", "user_id": USER, "item_key": "canvas-2", "status": "planned", "starts_at": (DUE + timedelta(days=1)).isoformat()}
        self.db.rows("study_blocks").extend([moved, planned])
        self.db.rows("assignment_steps").append({"id": "s1", "user_id": USER, "item_key": "canvas-2", "position": 0, "done": False,
                                                 "due_at": (DUE + timedelta(days=2)).isoformat()})
        shifted = [{**ITEMS[1], "due_at": earlier.isoformat()}]
        with patch("routers.plans.calendar_for", return_value={"items": shifted}), patch("routers.plans.schedule", return_value=[]), \
                patch("routers.plans._is_exam", return_value=False):
            result = plans.apply_change(USER, "c0000000-0000-4000-8000-000000000001")
        self.assertEqual((result["blocks_removed"], result["steps_moved"]), (1, 1))
        self.assertEqual([b["id"] for b in self.db.rows("study_blocks")], ["b1"])  # The student's own move stays.
        self.assertEqual(self.db.rows("assignment_steps")[0]["due_at"], earlier.isoformat())
        self.assertEqual(self.db.rows("deadline_changes")[0]["status"], "accepted")


if __name__ == "__main__":
    unittest.main()
