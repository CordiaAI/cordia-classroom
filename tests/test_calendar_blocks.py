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
    {"id": "canvas-1", "title": "Argument essay draft", "due_at": (NOW + timedelta(days=4)).isoformat(), "course": "EH 101", "type": "assignment"},
    {"id": "canvas-2", "title": "Exam 3", "due_at": (NOW + timedelta(days=1)).isoformat(), "course": "MA 125", "type": "exam"},
]
B1 = "b1000000-0000-4000-8000-000000000001"
B2 = "b2000000-0000-4000-8000-000000000002"


def who(header):
    from fastapi import HTTPException
    if header not in WHO:
        raise HTTPException(status_code=401, detail="Sign in")
    return WHO[header]


class BlockRoutesSetup(unittest.TestCase):
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


class CalendarBlockRoutes(BlockRoutesSetup):
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
        at = (NOW + timedelta(hours=3)).replace(minute=0)  # Before the exam (due a day from NOW).
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

    # ---- Review round (PR 284): the reviewer's probe cases, each kept as a test ----

    def friday_due(self, hour, minute=0):
        """canvas-3, due Friday at hour:minute in Chicago (two days on)."""
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        due = datetime.combine(friday, datetime.min.time(), ZONE).replace(hour=hour, minute=minute)
        return friday, due, ITEMS + [{"id": "canvas-3", "title": "Quiz 4", "due_at": due.isoformat(), "course": "EH 101", "type": "quiz"}]

    def add(self, items, body):
        with patch("routers.plans.calendar_for", return_value={"items": items}):
            return self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"}, json={"time_zone": "America/Chicago", **body})

    def test_dropping_on_the_due_day_never_lands_after_the_deadline(self):
        # Due at 8 AM: Plan my week's window opens at 9, so there is no time before it that day.
        friday, _due, items = self.friday_due(8)
        self.assertEqual(self.add(items, {"item_key": "canvas-3", "day": friday.isoformat()}).status_code, 409)
        # Due at 9:20 AM: 20 minutes is less than the shortest block Plan my week makes.
        friday, _due, items = self.friday_due(9, 20)
        self.assertEqual(self.add(items, {"item_key": "canvas-3", "day": friday.isoformat()}).status_code, 409)
        # Due at 3 PM: the block fits before it and ends by then.
        friday, due, items = self.friday_due(15)
        made = self.add(items, {"item_key": "canvas-3", "day": friday.isoformat(), "minutes": 90})
        self.assertEqual(made.status_code, 200, made.text)
        self.assertLessEqual(datetime.fromisoformat(made.json()["block"]["ends_at"]), due)
        # The day after the deadline: refused, nothing saved.
        saturday = (NOW + timedelta(days=3)).astimezone(ZONE).date()
        late = self.add(items, {"item_key": "canvas-3", "day": saturday.isoformat()})
        self.assertEqual(late.status_code, 409, late.text)
        self.assertEqual(len([row for row in self.db.rows("study_blocks") if row["item_key"] == "canvas-3"]), 1)

    def test_an_all_day_deadline_holds_study_time_until_that_day_ends(self):
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        items = ITEMS + [{"id": "canvas-3", "title": "Reading", "due_at": f"{friday.isoformat()}T00:00:00", "all_day": True, "course": "HY 201"}]
        made = self.add(items, {"item_key": "canvas-3", "day": friday.isoformat()})
        self.assertEqual(made.status_code, 200, made.text)
        start = datetime.fromisoformat(made.json()["block"]["starts_at"]).astimezone(ZONE)
        self.assertEqual((start.date(), start.hour), (friday, 9))

    def test_an_evening_move_on_an_all_day_deadline_needs_no_saved_zone(self):
        # Round 2 probe: no zone saved (sync never turned on). The page sends the browser's zone with
        # the move, as it does with an add, so the day ends at midnight in Chicago, not in UTC.
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        items = ITEMS + [{"id": "canvas-3", "title": "Reading", "due_at": f"{friday.isoformat()}T00:00:00", "all_day": True, "course": "HY 201"}]
        self.block(B1)["item_key"] = "canvas-3"
        evening = datetime.combine(friday, datetime.min.time(), ZONE).replace(hour=19)

        def move(start, **zone):
            with patch("routers.plans.calendar_for", return_value={"items": items}):
                return self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"},
                                       json={"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat(), **zone})
        self.assertEqual(move(evening, time_zone="America/Chicago").status_code, 200)
        self.assertEqual(datetime.fromisoformat(self.block(B1)["starts_at"]), evening)
        # Truly after the deadline (Saturday evening): still refused, the block stays on Friday.
        late = move(evening + timedelta(days=1), time_zone="America/Chicago")
        self.assertEqual(late.status_code, 409, late.text)
        self.assertEqual(datetime.fromisoformat(self.block(B1)["starts_at"]), evening)
        # A zone that isn't real, with none saved, is refused like an add.
        self.assertEqual(move(evening, time_zone="Not/AZone").status_code, 400)
        # No zone at all (a page from before this round), none saved: a move in time anywhere on
        # Earth is allowed; one after the day has ended everywhere is still refused.
        self.assertEqual(move(evening - timedelta(hours=1)).status_code, 200)
        self.assertEqual(move(evening + timedelta(days=1)).status_code, 409)

    def test_no_block_starts_or_moves_past_its_deadline(self):
        _friday, due, items = self.friday_due(15)
        self.assertEqual(self.add(items, {"item_key": "canvas-3", "starts_at": (due - timedelta(minutes=30)).isoformat(), "minutes": 60}).status_code, 409)
        self.assertEqual(self.add(items, {"item_key": "canvas-3", "starts_at": (due - timedelta(minutes=60)).isoformat(), "minutes": 60}).status_code, 200)
        # canvas-1 is due four days from NOW: a move past that is refused and the block stays put.
        past = NOW + timedelta(days=4, hours=1)
        moved = self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"},
                                json={"starts_at": past.isoformat(), "ends_at": (past + timedelta(hours=1)).isoformat()})
        self.assertEqual(moved.status_code, 409, moved.text)
        self.assertEqual(self.block(B1)["status"], "planned")
        self.assertEqual(self.pushed, [ANA])  # Only the add that fit.

    def test_far_dates_and_naive_times_are_4xx_never_500(self):
        cases = [
            {"item_key": "canvas-1", "day": "9999-12-31"},
            {"item_key": "canvas-1", "day": "0001-01-01"},
            {"item_key": "canvas-1", "starts_at": "9999-12-31T23:30:00+00:00", "minutes": 60},
            {"item_key": "canvas-1", "starts_at": "0001-01-01T00:00:00+00:00", "minutes": 60},
        ]
        for body in cases:
            with self.subTest(body=body):
                response = self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"}, json=body)
                self.assertEqual(response.status_code, 400, response.text)
        for starts, ends in (("9999-12-31T23:00:00+00:00", "9999-12-31T23:59:00+00:00"), ("0001-01-01T00:00:00+00:00", "0001-01-01T01:00:00+00:00")):
            with self.subTest(starts=starts):
                response = self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"}, json={"starts_at": starts, "ends_at": ends})
                self.assertEqual(response.status_code, 400, response.text)
        # A time without a zone is read as UTC.
        start = (NOW + timedelta(hours=3)).replace(tzinfo=None)
        naive = self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"},
                                json={"starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
        self.assertEqual(naive.status_code, 200, naive.text)

    def test_an_unknown_time_zone_uses_the_saved_one(self):
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        unsaved = self.add(ITEMS, {"item_key": "canvas-1", "day": friday.isoformat(), "time_zone": "Not/AZone"})
        self.assertEqual(unsaved.status_code, 400, unsaved.text)  # None saved: refused, not read as UTC.
        self.db.rows("connector_settings").append({"user_id": ANA, "connector": "gcal", "stats": {"time_zone": "America/Chicago"}})
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        response = self.add(ITEMS, {"item_key": "canvas-1", "day": friday.isoformat(), "time_zone": "Not/AZone"})
        self.assertEqual(response.status_code, 200, response.text)
        start = datetime.fromisoformat(response.json()["block"]["starts_at"]).astimezone(ZONE)
        self.assertEqual((start.date(), start.hour), (friday, 9))  # 9 AM in Chicago, the saved zone, not UTC.

    def test_a_block_removed_in_google_is_not_moved_back(self):
        # Between the route's read and its write, a Google sync marks the block removed.
        real_table = self.db.table

        def racing(name):
            query = real_table(name)
            if name == "study_blocks":
                execute = query.execute

                def run():
                    if query.op == "update":
                        self.block(B1)["status"] = "removed"
                    return execute()
                query.execute = run
            return query
        later = NOW + timedelta(hours=5)
        with patch.object(self.db, "table", side_effect=racing):
            response = self.client.put(f"/calendar/blocks/{B1}", headers={"Authorization": "Bearer ana"},
                                       json={"starts_at": later.isoformat(), "ends_at": (later + timedelta(hours=1)).isoformat()})
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.block(B1)["status"], "removed")
        self.assertNotEqual(datetime.fromisoformat(self.block(B1)["starts_at"]), later)

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
            self.remote[event_id] = {"id": event_id, "status": "confirmed", "summary": args.get("summary"),
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

    # ---- Review round (PR 284): two quick adds must not make two Google events for one block ----

    def add_block_row(self, block_id, hours):
        start = (datetime.now(timezone.utc) + timedelta(hours=hours)).replace(minute=0, second=0, microsecond=0)
        self.db.rows("study_blocks").append({"id": block_id, "user_id": ANA, "item_key": "canvas-1", "kind": "work", "status": "planned",
                                             "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=60)).isoformat()})

    def creates(self):
        return [args for slug, args in self.calls if slug == "GOOGLECALENDAR_CREATE_EVENT"]

    def test_two_syncs_at_once_make_one_event_per_block(self):
        import threading
        from services import google_sync
        self.add_block_row(B1, 20)
        self.add_block_row(B2, 30)
        listing = threading.Barrier(2, timeout=2)
        plain = self.run_tool

        def slow(account, user, slug, args):
            # Both syncs reach Google's event list before either writes, as two requests a moment apart can.
            if slug == "GOOGLECALENDAR_EVENTS_LIST":
                try:
                    listing.wait()
                except threading.BrokenBarrierError:
                    pass  # The lock holds the second sync back: it lists after the first is done.
            return plain(account, user, slug, args)
        with patch("services.composio.run", side_effect=slow):
            threads = [threading.Thread(target=google_sync.sync_calendar, args=(ANA,)) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(5)
        self.assertEqual(len(self.creates()), 2)  # One per block, not one per sync.
        links = [row for row in self.db.rows("connector_links") if row["connector"] == "gcal"]
        self.assertEqual(sorted(row["cordia_id"] for row in links), sorted([f"block:{B1}", f"block:{B2}"]))
        self.assertFalse([row for row in links if row["external_id"].startswith("pending:")])

    def test_a_block_another_machine_is_writing_is_left_to_it(self):
        from services import google_sync
        self.add_block_row(B1, 20)
        # Another machine's sync claimed B1 a moment ago and is making its event now.
        self.db.rows("connector_links").append({"user_id": ANA, "connector": "gcal", "kind": "event", "cordia_id": f"block:{B1}",
                                                "external_id": f"pending:{B1}", "container_id": "cal-cordia", "synced_hash": "",
                                                "removed_by_student": False, "updated_at": datetime.now(timezone.utc).isoformat()})
        result = google_sync.sync_calendar(ANA)
        self.assertEqual(self.creates(), [])
        self.assertEqual(self.db.rows("study_blocks")[0]["status"], "planned")  # Not read as deleted in Google.
        self.assertEqual(result["removed"], 0)
        # A claim left by a sync that died ten minutes ago is taken over.
        self.db.rows("connector_links")[0]["updated_at"] = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
        google_sync.sync_calendar(ANA)
        self.assertEqual(len(self.creates()), 1)
        self.assertEqual(self.db.rows("connector_links")[0]["external_id"], "e1")

    def test_a_failed_create_frees_its_claim(self):
        from fastapi import HTTPException
        from services import google_sync
        self.add_block_row(B1, 20)
        plain = self.run_tool

        def failing(account, user, slug, args):
            if slug == "GOOGLECALENDAR_CREATE_EVENT":
                raise HTTPException(status_code=502, detail="Google is down")
            return plain(account, user, slug, args)
        with patch("services.composio.run", side_effect=failing):
            with self.assertRaises(HTTPException):
                google_sync.sync_calendar(ANA)
        self.assertEqual(self.db.rows("connector_links"), [])
        google_sync.sync_calendar(ANA)  # The next sync makes it.
        self.assertEqual(len(self.creates()), 1)

    # ---- Round 2 (PR 284): an event made before its link was saved is found, not made again ----

    def test_an_event_made_by_a_sync_that_died_is_adopted_not_made_twice(self):
        from services import google_sync
        self.add_block_row(B1, 20)
        block = self.db.rows("study_blocks")[0]
        start = datetime.fromisoformat(block["starts_at"]).astimezone(ZONE)
        # A sync made B1's event, then died before saving the link: only its stale claim is left.
        self.remote["e7"] = {"id": "e7", "status": "confirmed", "summary": "Work on Argument essay draft",
                             "start": {"dateTime": start.isoformat()}, "end": {"dateTime": (start + timedelta(minutes=60)).isoformat()}}
        self.db.rows("connector_links").append({"user_id": ANA, "connector": "gcal", "kind": "event", "cordia_id": f"block:{B1}",
                                                "external_id": f"pending:{B1}", "container_id": "cal-cordia", "synced_hash": "",
                                                "removed_by_student": False,
                                                "updated_at": (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()})
        result = google_sync.sync_calendar(ANA)
        self.assertEqual(self.creates(), [])
        self.assertEqual(result["added"], 1)
        links = [row for row in self.db.rows("connector_links") if row["connector"] == "gcal"]
        self.assertEqual([(row["cordia_id"], row["external_id"]) for row in links], [(f"block:{B1}", "e7")])
        google_sync.sync_calendar(ANA)
        self.assertEqual(self.creates(), [])
        # A different event at another time in Cordia's calendar is not taken for it.
        self.add_block_row(B2, 30)
        google_sync.sync_calendar(ANA)
        self.assertEqual(len(self.creates()), 1)

    def test_a_sync_asked_for_while_one_runs_returns_at_once_and_the_running_one_catches_it(self):
        import threading
        import time
        from services import google_sync
        self.add_block_row(B1, 20)
        inside = threading.Event()
        let_go = threading.Event()
        plain = self.run_tool

        def held(account, user, slug, args):
            if slug == "GOOGLECALENDAR_EVENTS_LIST" and not inside.is_set():
                inside.set()
                let_go.wait(5)
            return plain(account, user, slug, args)
        with patch("services.composio.run", side_effect=held):
            first = threading.Thread(target=google_sync.sync_calendar, args=(ANA,))
            first.start()
            self.assertTrue(inside.wait(5))
            self.add_block_row(B2, 30)  # Added while the first sync is still listing Google's events.
            began = time.monotonic()
            second = google_sync.sync_calendar(ANA)
            self.assertLess(time.monotonic() - began, 1)  # The route's answer doesn't wait on the other sync.
            self.assertTrue(second.get("busy"))
            let_go.set()
            first.join(5)
        self.assertEqual(len(self.creates()), 2)  # The running sync went round again and made B2's event.
        self.assertEqual(google_sync._running, {})  # Nothing left behind per student.


class TwoQuickAdds(BlockRoutesSetup):
    """Two study times added a moment apart on the Calendar page, each route running its own Google
    sync (routers/plans._push), with a fake Google: one event per block."""

    def setUp(self):
        super().setUp()
        for p in self.patches:
            if getattr(p, "attribute", "") == "_push":
                p.stop()
        self.db.rows("connector_settings").append({"user_id": ANA, "connector": "gcal", "container_id": "cal-cordia",
                                                   "stats": {"time_zone": "America/Chicago"}})
        self.events = {}
        self.slugs = []
        more = [
            patch("services.composio.active_accounts", return_value={"gcal": "ca_c"}),
            patch("services.composio.run", side_effect=self.google),
            patch("services.composio.configured", return_value=False),
            patch("services.google_sync._now", return_value=NOW),
        ]
        for p in more:
            p.start()
        self.patches = [p for p in self.patches if getattr(p, "attribute", "") != "_push"] + more

    def google(self, account, user, slug, args):
        import time
        self.slugs.append(slug)
        if slug == "GOOGLECALENDAR_EVENTS_LIST":
            time.sleep(0.15)  # Long enough for the other request to catch up.
            return {"items": list(self.events.values())}
        if slug == "GOOGLECALENDAR_CREATE_EVENT":
            event_id = f"e{len(self.events) + 1}"
            self.events[event_id] = {"id": event_id, "status": "confirmed", "start": {"dateTime": args["start_datetime"] + "-06:00"},
                                     "end": {"dateTime": args["end_datetime"] + "-06:00"}}
            return {"id": event_id}
        if slug == "GOOGLETASKS_LIST_TASKS":
            return {"items": []}
        return {}

    def test_two_quick_adds_make_one_event_per_block(self):
        import threading
        friday = (NOW + timedelta(days=2)).astimezone(ZONE).date()
        answers = []

        def add():
            answers.append(self.client.post("/calendar/blocks", headers={"Authorization": "Bearer ana"},
                                            json={"item_key": "canvas-1", "day": friday.isoformat(), "time_zone": "America/Chicago"}))
        threads = [threading.Thread(target=add) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual([answer.status_code for answer in answers], [200, 200], [answer.text for answer in answers])
        mine = [row for row in self.db.rows("study_blocks") if row["user_id"] == ANA]
        self.assertEqual(len(mine), 3)  # B1 and the two new ones.
        self.assertEqual(self.slugs.count("GOOGLECALENDAR_CREATE_EVENT"), 3)  # One CREATE per block, never two.
        self.assertEqual(len(self.events), 3)


if __name__ == "__main__":
    unittest.main()
