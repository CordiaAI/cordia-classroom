"""Phase 1 connector sync: scheduling rules, Google Tasks/Calendar two-way sync, and kickoff plans."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
from services import planner  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
ZONE = ZoneInfo("America/Chicago")
NOW = datetime.now(timezone.utc).replace(microsecond=0)
DUE = (NOW + timedelta(days=6)).replace(minute=0, second=0)
ITEMS = [{"id": "canvas-1", "title": "Lab report", "due_at": DUE.isoformat(), "course": "BIO 101", "done": False, "type": "assignment"}]


class PlannerRules(unittest.TestCase):
    def test_steps_are_staggered_back_from_the_deadline(self):
        dues = planner.stagger(3, DUE, NOW)
        self.assertEqual(dues[-1], DUE)
        self.assertTrue(NOW < dues[0] < dues[1] < dues[2])

    def test_free_slots_skip_busy_time_and_nights(self):
        day = datetime(2026, 11, 2, tzinfo=ZONE)
        busy = [(day.replace(hour=10), day.replace(hour=12))]
        slots = planner.free_slots(busy, day.replace(hour=8), day.replace(hour=23), ZONE)
        self.assertEqual([(a.hour, b.hour) for a, b in slots], [(9, 10), (12, 22)])

    def test_blocks_spread_one_per_day_and_follow_preferred_hour(self):
        start = datetime(2026, 11, 2, 8, tzinfo=ZONE)
        slots = planner.free_slots([], start, start + timedelta(days=4), ZONE)
        blocks = planner.place_blocks(240, slots, ZONE, preferred_hour=19)
        days = [b[0].date() for b in blocks]
        self.assertEqual(len(days), len(set(days)))
        self.assertGreaterEqual(sum((b - a).seconds // 60 for a, b in blocks), 240)
        self.assertTrue(all(a.astimezone(ZONE).hour == 19 for a, _ in blocks))

    def test_exam_sessions_get_shorter_and_skip_the_past(self):
        sessions = planner.exam_sessions(NOW + timedelta(days=4), NOW)
        self.assertEqual([d for d, _ in sessions], [3, 2, 1])
        self.assertEqual([m for _, m in sessions], sorted([m for _, m in sessions], reverse=True))

    def test_preferred_hour_needs_three_moves(self):
        moved = [datetime(2026, 11, d, 1, tzinfo=timezone.utc) for d in (2, 3)]
        self.assertIsNone(planner.preferred_hour(moved, ZONE))
        self.assertEqual(planner.preferred_hour(moved + [datetime(2026, 11, 4, 1, tzinfo=timezone.utc)], ZONE), 19)


class GoogleSync(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("connector_settings").extend([
            {"user_id": USER, "connector": "gtasks", "container_id": "list-cordia", "stats": {"time_zone": "America/Chicago"}},
            {"user_id": USER, "connector": "gcal", "container_id": "cal-cordia", "stats": {"time_zone": "America/Chicago"}},
        ])
        self.calls = []
        self.remote_tasks = {}
        self.remote_events = {}
        self.patches = [
            patch("services.google_sync.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("services.composio.active_accounts", return_value={"gtasks": "ca_t", "gcal": "ca_c"}),
            patch("services.composio.run", side_effect=self.run_tool),
            patch("routers.calendar.calendar_for", side_effect=lambda _u: {"items": ITEMS}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def run_tool(self, account, user, slug, args):
        self.calls.append((slug, args))
        if slug == "GOOGLETASKS_LIST_TASKS":
            return {"tasks": list(self.remote_tasks.values())}
        if slug == "GOOGLETASKS_INSERT_TASK":
            task_id = f"t{len(self.remote_tasks) + 1}"
            self.remote_tasks[task_id] = {"id": task_id, "status": "needsAction", **{k: v for k, v in args.items() if k != "tasklist_id"}}
            return {"id": task_id}
        if slug == "GOOGLETASKS_PATCH_TASK":
            self.remote_tasks[args["task_id"]].update({k: v for k, v in args.items() if k not in ("tasklist_id", "task_id")})
            return {}
        if slug == "GOOGLECALENDAR_EVENTS_LIST":
            return {"items": list(self.remote_events.values())}
        if slug == "GOOGLECALENDAR_CREATE_EVENT":
            event_id = f"e{len(self.remote_events) + 1}"
            self.remote_events[event_id] = {"id": event_id, "status": "confirmed",
                                            "start": {"dateTime": args["start_datetime"] + "-06:00"}, "end": {"dateTime": args["end_datetime"] + "-06:00"}}
            return {"id": event_id}
        raise AssertionError(slug)

    def test_tasks_go_to_the_cordia_list_once_with_subtasks(self):
        from services import google_sync
        self.db.rows("assignment_steps").append({"id": "s1", "user_id": USER, "item_key": "canvas-1", "position": 0, "title": "Outline",
                                                 "minutes": 30, "due_at": (NOW + timedelta(days=2)).isoformat(), "done": False})
        google_sync.sync_tasks(USER)
        google_sync.sync_tasks(USER)
        inserts = [args for slug, args in self.calls if slug == "GOOGLETASKS_INSERT_TASK"]
        self.assertEqual(len(inserts), 2)
        self.assertTrue(all(a["tasklist_id"] == "list-cordia" for a in inserts))
        self.assertEqual(inserts[1]["task_parent"], "t1")
        self.assertEqual({(r["kind"], r["cordia_id"]) for r in self.db.rows("connector_links")}, {("task", "canvas-1"), ("subtask", "step:s1")})

    def test_checking_off_in_google_marks_done_and_deleting_is_respected(self):
        from services import google_sync
        self.db.rows("assignment_steps").append({"id": "s1", "user_id": USER, "item_key": "canvas-1", "position": 0, "title": "Outline",
                                                 "minutes": 30, "due_at": (NOW + timedelta(days=2)).isoformat(), "done": False})
        google_sync.sync_tasks(USER)
        self.remote_tasks["t2"]["status"] = "completed"
        del self.remote_tasks["t1"]
        google_sync.sync_tasks(USER)
        self.assertTrue(self.db.rows("assignment_steps")[0]["done"])
        self.assertTrue(next(r for r in self.db.rows("connector_links") if r["kind"] == "task")["removed_by_student"])
        inserts = [args for slug, args in self.calls if slug == "GOOGLETASKS_INSERT_TASK"]
        self.assertEqual(len(inserts), 2)  # The deleted task isn't put back.

    def test_moved_and_deleted_blocks_keep_the_students_choice(self):
        from services import google_sync
        start = (NOW + timedelta(days=1)).replace(minute=0)
        for block_id in ("b1", "b2"):
            self.db.rows("study_blocks").append({"id": block_id, "user_id": USER, "item_key": "canvas-1", "kind": "work", "status": "planned",
                                                 "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()})
        google_sync.sync_calendar(USER)
        self.assertEqual(len(self.remote_events), 2)
        later = (start + timedelta(hours=3)).astimezone(ZONE)
        self.remote_events["e1"]["start"] = {"dateTime": later.isoformat()}
        self.remote_events["e1"]["end"] = {"dateTime": (later + timedelta(minutes=60)).isoformat()}
        self.remote_events["e2"]["status"] = "cancelled"
        google_sync.sync_calendar(USER)
        b1, b2 = self.db.rows("study_blocks")
        self.assertEqual((b1["status"], b2["status"]), ("moved", "removed"))
        self.assertEqual(datetime.fromisoformat(b1["starts_at"]), later)
        self.assertEqual(len([c for c in self.calls if c[0] == "GOOGLECALENDAR_CREATE_EVENT"]), 2)  # Nothing recreated.


class Kickoff(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("canvas_assignments").append({"user_id": USER, "canvas_assignment_id": 1, "title": "Lab report", "points_possible": 50,
                                                   "submission_types": ["online_upload"], "description": "Write up the lab.", "rubric": None,
                                                   "is_exam": False})
        self.patches = [
            patch("routers.plans.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("routers.plans.calendar_for", return_value={"items": ITEMS}),
            patch("services.composio.configured", return_value=False),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_plan_falls_back_when_the_model_fails_and_schedules_before_the_deadline(self):
        from routers import plans
        with patch("routers.plans.plan_assignment", side_effect=RuntimeError("down")):
            plan = plans.make_plan(USER, ITEMS[0])
        self.assertEqual(plan["effort_minutes"], 120)
        self.assertEqual(len(plan["steps"]), 3)
        self.assertEqual(plan["steps"][-1]["due_at"], DUE.isoformat())
        added = plans.schedule(USER, ITEMS[0], ZONE)
        self.assertTrue(added)
        self.assertTrue(all(datetime.fromisoformat(b["ends_at"]) <= DUE for b in added))
        self.assertGreaterEqual(sum((datetime.fromisoformat(b["ends_at"]) - datetime.fromisoformat(b["starts_at"])).seconds // 60 for b in added), 120)
        self.assertEqual(plans.schedule(USER, ITEMS[0], ZONE), [])  # Already covered: nothing doubled.

    def test_model_steps_are_used_when_usable(self):
        from routers import plans
        made = {"effort_minutes": 150, "basis": "A 50-point lab write-up.", "steps": [{"title": "Analyze the data", "minutes": 60}, {"title": "Write it up", "minutes": 90}]}
        with patch("routers.plans.plan_assignment", return_value=made):
            plan = plans.make_plan(USER, ITEMS[0])
        self.assertEqual([s["title"] for s in plan["steps"]], ["Analyze the data", "Write it up"])
        self.assertEqual(plan["effort_basis"], "A 50-point lab write-up.")


if __name__ == "__main__":
    unittest.main()
