"""Phase 1 connector sync: scheduling rules, Google Tasks/Calendar two-way sync, and kickoff plans."""
from datetime import date, datetime, timedelta, timezone
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

    def test_short_slots_are_skipped_so_the_full_time_is_placed(self):
        today = datetime(2026, 11, 2, tzinfo=ZONE)
        slots = [(today.replace(hour=21, minute=15), today.replace(hour=22))]
        slots += planner.free_slots([], (today + timedelta(days=1)).replace(hour=9), today + timedelta(days=6), ZONE)
        for hour in (None, 19):
            blocks = planner.place_blocks(120, slots, ZONE, preferred_hour=hour)
            self.assertEqual(sum((b - a).seconds // 60 for a, b in blocks), 120)
            self.assertNotIn(today.date(), [a.astimezone(ZONE).date() for a, _ in blocks])

    def _evening(self, hour, minute, minutes=120, days=6):
        """place_blocks as schedule() calls it, for a plan made at hour:minute Chicago time."""
        now = datetime(2026, 11, 9, hour, minute, tzinfo=ZONE)
        start = planner._round_up(now + timedelta(hours=1))
        due = datetime.combine((now + timedelta(days=days)).date(), datetime.min.time(), ZONE).replace(hour=20)
        slots = planner.free_slots([], start, due, ZONE)
        return planner.place_blocks(minutes, slots, ZONE), slots

    def test_a_short_evening_never_loses_a_block(self):
        # 8:00-8:35 pm used to pick tonight's 25-59 free minutes for a 60-minute block and drop it.
        for hour, minute in ((20, 0), (20, 10), (20, 20), (20, 30), (20, 35), (19, 40), (21, 0)):
            with self.subTest(at=f"{hour}:{minute:02d}"):
                blocks, slots = self._evening(hour, minute)
                self.assertGreaterEqual(sum((b - a).seconds // 60 for a, b in blocks), 120)
                self.assertTrue(all(any(s0 <= a and b <= s1 for s0, s1 in slots) for a, b in blocks), "inside free time")
                days = [a.astimezone(ZONE).date() for a, _ in blocks]
                self.assertEqual(len(days), len(set(days)), "one block a day")

    def test_right_before_the_window_closes_the_time_goes_to_later_days(self):
        for hour, minute in ((20, 50), (21, 30), (21, 50)):
            with self.subTest(at=f"{hour}:{minute:02d}"):
                blocks, _ = self._evening(hour, minute)
                self.assertGreaterEqual(sum((b - a).seconds // 60 for a, b in blocks), 120)
                self.assertTrue(all(a.astimezone(ZONE).date() > date(2026, 11, 9) for a, _ in blocks), "nothing tonight")

    def test_across_midnight(self):
        # Planned at 11:30 pm: the search starts after midnight and the first block is the next morning.
        blocks, _ = self._evening(23, 30)
        self.assertGreaterEqual(sum((b - a).seconds // 60 for a, b in blocks), 120)
        self.assertTrue(all(a.astimezone(ZONE).hour >= planner.DAY_START for a, _ in blocks))
        # A deadline just after midnight, planned at 7:40 pm: tonight's 75 minutes are all there is.
        now = datetime(2026, 11, 9, 19, 40, tzinfo=ZONE)
        slots = planner.free_slots([], planner._round_up(now + timedelta(hours=1)), datetime(2026, 11, 10, 0, 30, tzinfo=ZONE), ZONE)
        blocks = planner.place_blocks(120, slots, ZONE)
        self.assertEqual([(a.astimezone(ZONE).strftime("%H:%M"), (b - a).seconds // 60) for a, b in blocks], [("20:45", 75)])

    def test_when_free_time_runs_out_every_day_is_used_as_far_as_it_holds(self):
        day = datetime(2026, 11, 9, tzinfo=ZONE)
        slots = [(day.replace(hour=21, minute=15), day.replace(hour=22)), (day.replace(day=10, hour=9), day.replace(day=10, hour=9, minute=40))]
        blocks = planner.place_blocks(120, slots, ZONE)
        self.assertEqual(sorted((b - a).seconds // 60 for a, b in blocks), [40, 45])

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


# Kickoff runs on a fixed clock: 8:10 pm in Chicago (02:10 UTC), one of the times that used to
# lose a block, with the deadline six days later.
KICKOFF_NOW = datetime(2026, 11, 10, 2, 10, tzinfo=timezone.utc)
KICKOFF_DUE = KICKOFF_NOW + timedelta(days=6) - timedelta(minutes=10)
KICKOFF_ITEMS = [{**ITEMS[0], "due_at": KICKOFF_DUE.isoformat()}]


class Kickoff(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("canvas_assignments").append({"user_id": USER, "canvas_assignment_id": 1, "title": "Lab report", "points_possible": 50,
                                                   "submission_types": ["online_upload"], "description": "Write up the lab.", "rubric": None,
                                                   "is_exam": False})
        self.patches = [
            patch("routers.plans.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("routers.plans.calendar_for", return_value={"items": KICKOFF_ITEMS}),
            patch("services.composio.configured", return_value=False),
            patch("routers.plans._now", return_value=KICKOFF_NOW),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_plan_falls_back_when_the_model_fails_and_schedules_before_the_deadline(self):
        from routers import plans
        with patch("routers.plans.plan_assignment", side_effect=RuntimeError("down")):
            plan = plans.make_plan(USER, KICKOFF_ITEMS[0])
        self.assertEqual(plan["effort_minutes"], 120)
        self.assertEqual(len(plan["steps"]), 3)
        self.assertEqual(plan["steps"][-1]["due_at"], KICKOFF_DUE.isoformat())
        added, wanted = plans.schedule_with_totals(USER, KICKOFF_ITEMS[0], ZONE)
        self.assertTrue(added)
        self.assertTrue(all(datetime.fromisoformat(b["ends_at"]) <= KICKOFF_DUE for b in added))
        self.assertEqual(wanted, 120)
        self.assertGreaterEqual(plans.block_minutes(added), 120)
        self.assertEqual(plans.schedule(USER, KICKOFF_ITEMS[0], ZONE), [])  # Already covered: nothing doubled.

    def test_a_shortfall_is_reported_not_dropped(self):
        from routers import plans
        # Planned at 7:10 pm, due at 12:30 am: tonight's 8:15-10 pm is the only free time, and one
        # block (one a day) is at most 90 minutes, so 90 of the 120 needed fit.
        item = {**KICKOFF_ITEMS[0], "due_at": (KICKOFF_NOW + timedelta(hours=4, minutes=20)).isoformat()}
        with patch("routers.plans.plan_assignment", side_effect=RuntimeError("down")), \
             patch("routers.plans.calendar_for", return_value={"items": [item]}), \
             patch("routers.plans._now", return_value=KICKOFF_NOW - timedelta(hours=1)):
            added, wanted = plans.schedule_with_totals(USER, item, ZONE)
        self.assertEqual(wanted, 120)
        self.assertEqual(plans.block_minutes(added), 90)  # One block a day, at most MAX_BLOCK long.
        # Too close to the deadline for any block: the whole amount is the shortfall.
        late = {**item, "id": "canvas-2", "due_at": (KICKOFF_NOW + timedelta(minutes=20)).isoformat()}
        with patch("routers.plans.plan_assignment", side_effect=RuntimeError("down")):
            added, wanted = plans.schedule_with_totals(USER, late, ZONE)
        self.assertEqual(added, [])
        self.assertEqual(wanted, sum(step["minutes"] for step in plans._plan(USER, "canvas-2")["steps"]))
        self.assertGreater(wanted, 0)

    def test_model_steps_are_used_when_usable(self):
        from routers import plans
        made = {"effort_minutes": 150, "basis": "A 50-point lab write-up.", "steps": [{"title": "Analyze the data", "minutes": 60}, {"title": "Write it up", "minutes": 90}]}
        with patch("routers.plans.plan_assignment", return_value=made):
            plan = plans.make_plan(USER, ITEMS[0])
        self.assertEqual([s["title"] for s in plan["steps"]], ["Analyze the data", "Write it up"])
        self.assertEqual(plan["effort_basis"], "A 50-point lab write-up.")


if __name__ == "__main__":
    unittest.main()
