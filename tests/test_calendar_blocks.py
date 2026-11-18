"""Study blocks moved, resized and added on the Calendar page (routers/plans.py), the blocks list it
reads (routers/calendar.py /calendar/blocks), and a move made in Cordia reaching Google Calendar
(services/google_sync.sync_calendar) instead of being read back as a move made in Google."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"
BEN = "bbbbbbbb-0000-4000-8000-000000000002"
WHO = {"Bearer ana": ANA, "Bearer ben": BEN}
ZONE = ZoneInfo("America/Chicago")
NOW = datetime(2026, 11, 18, 16, 40, tzinfo=timezone.utc)  # 10:40 am in Chicago, a Wednesday
ITEMS = [
    {"id": "canvas-1", "title": "Argument essay draft", "due_at": (NOW + timedelta(days=1)).isoformat(), "course": "EH 101", "type": "assignment"},
    {"id": "canvas-2", "title": "Exam 3", "due_at": (NOW + timedelta(days=1)).isoformat(), "course": "MA 125", "type": "exam"},
]
B1 = "b1000000-0000-4000-8000-000000000001"
B2 = "b2000000-0000-4000-8000-000000000002"


def who(header):
    from fastapi import HTTPException
    if header not in WHO:
        raise HTTPException(status_code=401, detail="Sign in")
    return WHO[header]


class CalendarBlockRoutes(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        start = NOW + timedelta(hours=2)
        self.db.rows("study_blocks").extend([
            {"id": B1, "user_id": ANA, "item_key": "canvas-1", "kind": "work", "status": "planned", "step_id": None,
             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()},
            {"id": B2, "user_id": BEN, "item_key": "canvas-1", "kind": "work", "status": "planned", "step_id": None,
             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()},
        ])
        self.pushed = []
        self.patches = [
            patch("routers.plans.get_user_id", side_effect=who),
            patch("routers.calendar.get_user_id", side_effect=who),
            patch("routers.plans.get_supabase", return_value=self.db),
            patch("routers.calendar.get_supabase", return_value=self.db),
            patch("services.google_sync.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("routers.plans.calendar_for", return_value={"items": ITEMS}),
            patch("routers.calendar.calendar_for", return_value={"items": ITEMS}),
            patch("routers.plans._now", return_value=NOW),
            patch("routers.plans._push", side_effect=self.pushed.append),
            patch("services.composio.configured", return_value=False),
        ]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def block(self, block_id):
        return next(row for row in self.db.rows("study_blocks") if row["id"] == block_id)

    def test_moving_a_block_saves_it_as_the_students_move_and_syncs(self):
        later = (NOW + timedelta(days=1, hours=1)).replace(minute=0)
        response = self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"},
                                   json={"starts_at": later.isoformat(), "ends_at": (later + timedelta(minutes=90)).isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        row = self.block(B1)
        self.assertEqual((row["status"], datetime.fromisoformat(row["starts_at"])), ("moved", later))
        self.assertEqual(datetime.fromisoformat(row["ends_at"]) - later, timedelta(minutes=90))
        self.assertEqual(response.json()["block"]["title"], "Work on Argument essay draft")
        self.assertEqual(self.pushed, [ANA])  # Google gets it through the existing sync.

    def test_only_the_callers_own_block_moves(self):
        start = NOW + timedelta(days=2)
        response = self.client.put(f"/calendar/blocks/{B2}", headers={"Authorization": "Bearer ana"},
                                   json={"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
        self.assertEqual(response.status_code, 404)
        self.assertNotEqual(datetime.fromisoformat(self.block(B2)["starts_at"]), start)
        self.assertEqual(self.pushed, [])

    def test_bad_moves_are_4xx_never_500(self):
        start = NOW + timedelta(days=1)
        cases = [
            ("not-a-uuid", {"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()}, 400),
            (B1, {"starts_at": start.isoformat(), "ends_at": start.isoformat()}, 400),
            (B1, {"starts_at": start.isoformat(), "ends_at": (start - timedelta(hours=1)).isoformat()}, 400),
            (B1, {"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=7)).isoformat()}, 400),
            (B1, {"starts_at": (NOW + timedelta(days=400)).isoformat(), "ends_at": (NOW + timedelta(days=400, hours=1)).isoformat()}, 400),
            (B1, {"starts_at": "tomorrow", "ends_at": "later"}, 422),
            (B1, {}, 422),
        ]
        for block_id, body, status in cases:
            with self.subTest(body=body):
                response = self.client.put(f"/calendar/blocks/{block_id}", headers={"Authorization": "Bearer ana"}, json=body)
                self.assertEqual(response.status_code, status, response.text)
        signed_out = self.client.put(f"/calendar/blocks/{B1}", json=cases[0][1])
        self.assertEqual(signed_out.status_code, 401)

    def test_adding_at_a_time_and_on_a_day_with_free_time(self):
        at = (NOW + timedelta(days=1)).replace(hour=20, minute=0)
        made = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"},
                                json={"item_key": "canvas-2", "starts_at": at.isoformat(), "minutes": 45})
        self.assertEqual(made.status_code, 200, made.text)
        self.assertEqual(made.json()["block"]["kind"], "review")  # An exam gets review time.
        self.assertEqual(made.json()["block"]["course"], "MA 125")
        # Dropped on Friday: the first free time in Plan my week's window (9 am-10 pm there).
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        dropped = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"},
                                   json={"item_key": "canvas-1", "day": friday.isoformat(), "minutes": 60, "time_zone": "America/Chicago"})
        self.assertEqual(dropped.status_code, 200, dropped.text)
        start = datetime.fromisoformat(dropped.json()["block"]["starts_at"]).astimezone(ZONE)
        self.assertEqual((start.date(), start.hour, start.minute), (friday, 9, 0))
        rows = [row for row in self.db.rows("study_blocks") if row["user_id"] == ANA]
        self.assertEqual(len(rows), 3)
        self.assertEqual(self.pushed, [ANA, ANA])

    def test_adding_works_around_busy_time(self):
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        busy = datetime.combine(friday, datetime.min.time(), ZONE).replace(hour=9)
        self.db.rows("study_blocks").append({"id": "b3000000-0000-4000-8000-000000000003", "user_id": ANA, "item_key": "canvas-2", "kind": "review",
                                             "status": "planned", "step_id": None, "starts_at": busy.isoformat(),
                                             "ends_at": (busy + timedelta(hours=2)).isoformat()})
        dropped = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"},
                                   json={"item_key": "canvas-1", "day": friday.isoformat(), "time_zone": "America/Chicago"})
        self.assertEqual(dropped.status_code, 200, dropped.text)
        start = datetime.fromisoformat(dropped.json()["block"]["starts_at"]).astimezone(ZONE)
        self.assertEqual((start.hour, start.minute), (11, 0))

    def test_bad_adds_are_4xx(self):
        yesterday = (NOW - timedelta(days=1)).astimezone(ZONE).date()
        cases = [
            ({"item_key": "canvas-9", "day": "2026-11-20"}, 404),        # not on the calendar
            ({"item_key": "../x", "day": "2026-11-20"}, 400),
            ({"item_key": "canvas-1"}, 400),                              # no day or time
            ({"item_key": "canvas-1", "day": yesterday.isoformat(), "time_zone": "America/Chicago"}, 400),
            ({"item_key": "canvas-1", "day": "2026-11-20", "minutes": 5}, 422),
            ({"item_key": "canvas-1", "day": "someday"}, 422),
        ]
        for body, status in cases:
            with self.subTest(body=body):
                response = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"}, json=body)
                self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(len([row for row in self.db.rows("study_blocks") if row["user_id"] == ANA]), 1)

    def test_a_full_day_is_a_409(self):
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        opens = datetime.combine(friday, datetime.min.time(), ZONE).replace(hour=9)
        self.db.rows("study_blocks").append({"id": "b4000000-0000-4000-8000-000000000004", "user_id": ANA, "item_key": "canvas-2", "kind": "review",
                                             "status": "planned", "step_id": None, "starts_at": opens.isoformat(),
                                             "ends_at": (opens + timedelta(hours=13)).isoformat()})
        response = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"},
                                    json={"item_key": "canvas-1", "day": friday.isoformat(), "time_zone": "America/Chicago"})
        self.assertEqual(response.status_code, 409)

    def test_blocks_list_carries_course_and_done(self):
        step = {"id": "s1000000-0000-4000-8000-000000000001", "user_id": ANA, "item_key": "canvas-1", "position": 0,
                "title": "Outline", "minutes": 30, "done": True}
        self.db.rows("assignment_steps").append(step)
        self.block(B1)["step_id"] = step["id"]
        with patch("routers.calendar.datetime") as clock:
            clock.now.return_value = NOW
            response = self.client.get("/calendar/blocks", headers={"Authorization": "Bearer ana"})
        self.assertEqual(response.status_code, 200, response.text)
        blocks = response.json()["blocks"]
        self.assertEqual([b["id"] for b in blocks], [B1])  # Ben's block isn't listed.
        self.assertEqual((blocks[0]["course"], blocks[0]["done"], blocks[0]["title"]), ("EH 101", True, "Argument essay draft: Outline"))


class CordiaMovesReachGoogle(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("connector_settings").append({"user_id": ANA, "connector": "gcal", "container_id": "cal-cordia",
                                                   "stats": {"time_zone": "America/Chicago"}})
        self.calls = []
        self.remote = {}
        self.patches = [
            patch("services.google_sync.get_supabase", return_value=self.db),
            patch("services.sync_state.get_supabase", return_value=self.db),
            patch("services.composio.active_accounts", return_value={"gcal": "ca_c"}),
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
        offset = "-06:00"
        if slug == "GOOGLECALENDAR_EVENTS_LIST":
            return {"items": list(self.remote.values())}
        if slug in ("GOOGLECALENDAR_CREATE_EVENT", "GOOGLECALENDAR_UPDATE_EVENT"):
            event_id = args.get("event_id") or f"e{len(self.remote) + 1}"
            self.remote[event_id] = {"id": event_id, "status": "confirmed",
                                     "start": {"dateTime": args["start_datetime"] + offset}, "end": {"dateTime": args["end_datetime"] + offset}}
            return {"id": event_id}
        raise AssertionError(slug)

    def test_a_move_in_cordia_updates_the_google_event_and_stays(self):
        from services import google_sync
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
        self.db.rows("study_blocks").append({"id": B1, "user_id": ANA, "item_key": "canvas-1", "kind": "work", "status": "planned",
                                             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()})
        google_sync.sync_calendar(ANA)
        later = start + timedelta(hours=3)
        row = self.db.rows("study_blocks")[0]
        row.update({"starts_at": later.isoformat(), "ends_at": (later + timedelta(minutes=90)).isoformat(), "status": "moved"})
        result = google_sync.sync_calendar(ANA)
        self.assertEqual(result["sent"], 1)
        updates = [args for slug, args in self.calls if slug == "GOOGLECALENDAR_UPDATE_EVENT"]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["event_id"], "e1")
        self.assertEqual(updates[0]["start_datetime"], later.astimezone(ZONE).strftime("%Y-%m-%dT%H:%M:%S"))
        self.assertEqual(datetime.fromisoformat(row["starts_at"]), later)  # Not put back to Google's old time.
        google_sync.sync_calendar(ANA)
        self.assertEqual(len([c for c in self.calls if c[0] == "GOOGLECALENDAR_UPDATE_EVENT"]), 1)  # Sent once.
        self.assertEqual(len([c for c in self.calls if c[0] == "GOOGLECALENDAR_CREATE_EVENT"]), 1)

    def test_a_move_in_google_still_wins_when_cordia_did_not_move_it(self):
        from services import google_sync
        start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(minute=0, second=0, microsecond=0)
        self.db.rows("study_blocks").append({"id": B1, "user_id": ANA, "item_key": "canvas-1", "kind": "work", "status": "planned",
                                             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()})
        google_sync.sync_calendar(ANA)
        moved = (start + timedelta(hours=5)).astimezone(ZONE)
        self.remote["e1"]["start"] = {"dateTime": moved.isoformat()}
        self.remote["e1"]["end"] = {"dateTime": (moved + timedelta(minutes=60)).isoformat()}
        google_sync.sync_calendar(ANA)
        row = self.db.rows("study_blocks")[0]
        self.assertEqual((row["status"], datetime.fromisoformat(row["starts_at"])), ("moved", moved))
        self.assertFalse([c for c in self.calls if c[0] == "GOOGLECALENDAR_UPDATE_EVENT"])
        # Then moved again in Cordia: that goes to Google.
        again = moved + timedelta(days=1)
        row.update({"starts_at": again.astimezone(timezone.utc).isoformat(), "ends_at": (again + timedelta(minutes=60)).astimezone(timezone.utc).isoformat()})
        google_sync.sync_calendar(ANA)
        self.assertEqual(len([c for c in self.calls if c[0] == "GOOGLECALENDAR_UPDATE_EVENT"]), 1)


if __name__ == "__main__":
    unittest.main()
