"""Copyright takedowns: reports are reviewed by staff before anything is held or removed."""
from datetime import datetime, timezone
from pathlib import Path
import os
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB, route_patches  # noqa: E402
from services import takedowns  # noqa: E402

OWNER = "aaaaaaaa-0000-4000-8000-000000000001"
ADMIN = "eeeeeeee-0000-4000-8000-000000000005"
GUIDE = "10000000-0000-4000-8000-000000000001"
SET = "50000000-0000-4000-8000-000000000001"
USERS = {"owner": OWNER, "eve": ADMIN}
MIGRATION = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261127120000_copyright_takedown_review.sql"


def report(**fields):
    return {"name": "Pub", "email": "legal@pub.com", "work": "Chapter 3", "statement": True,
            "location": f"https://classroom.cordiaai.io/sets/{GUIDE}", **fields}


class TakedownTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.db.rows("app_admins").append({"user_id": ADMIN})
        self.db.rows("user_profiles").append({"id": OWNER, "username": "ana", "name": "Ana", "email": "ana@example.edu"})
        self.db.rows("study_guides").append({"id": GUIDE, "user_id": OWNER, "title": "Supply chains", "visibility": "public",
                                             "review_status": "ok", "hold_reason": None})
        self.db.rows("shared_sets").append({"id": SET, "guide_id": GUIDE, "owner_id": OWNER, "class_id": "c1", "title": "Supply chains",
                                            "visibility": "class", "status": "visible", "hold_reason": None})
        self.client = TestClient(main.app)

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in USERS:
                raise HTTPException(status_code=401, detail="Sign in")
            return USERS[name]
        self.patches = route_patches(("public_forms", "admin", "notifications"), who, self.db)
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def guide(self):
        return self.db.rows("study_guides")[0]

    def shared(self):
        return self.db.rows("shared_sets")[0]

    def send(self, ip="203.0.113.7", **fields):
        return self.client.post("/copyright/takedown", json=report(**fields), headers={"Fly-Client-IP": ip})

    def admin(self, path, body=None):
        return self.client.post(path, json=body or {}, headers={"Authorization": "Bearer eve"})

    # Reports --------------------------------------------------------------------------------------
    def test_a_report_changes_no_visibility(self):
        self.assertEqual(self.send().status_code, 200)
        self.assertEqual((self.guide()["review_status"], self.guide()["hold_reason"]), ("ok", None))
        self.assertEqual((self.shared()["status"], self.shared()["hold_reason"]), ("visible", None))
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual((row["status"], row["guide_id"], row["set_id"]), ("received", GUIDE, SET))

    def test_a_duplicate_report_attaches_instead_of_queueing_again(self):
        self.send()
        self.send(name="Other", email="other@pub.com", location=f"https://classroom.cordiaai.io/class/x?set={SET}")
        rows = self.db.rows("copyright_takedowns")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["duplicate_count"], 1)
        queue = self.client.get("/admin/queue", headers={"Authorization": "Bearer eve"}).json()
        self.assertEqual(len(queue["takedowns"]), 1)
        # Once that report is decided, a new one can be filed.
        rows[0]["status"] = "rejected"
        self.send()
        self.assertEqual(len(self.db.rows("copyright_takedowns")), 2)

    def test_a_duplicate_is_acknowledged_before_the_migration(self):
        self.send()
        real_table = self.db.table

        def table(name):
            query = real_table(name)
            if name == "copyright_takedowns":
                update = query.update
                query.update = lambda payload: (_ for _ in ()).throw(RuntimeError("column duplicate_count does not exist")) if "duplicate_count" in payload else update(payload)
            return query
        with patch.object(self.db, "table", side_effect=table):
            self.assertEqual(self.send().status_code, 200)
        self.assertEqual(len(self.db.rows("copyright_takedowns")), 1)

    def test_the_honeypot_saves_nothing_and_answers_the_same(self):
        real = self.send()
        trapped = self.send(website="http://spam.example", location="https://classroom.cordiaai.io/sets/other")
        self.assertEqual((trapped.status_code, trapped.json()), (real.status_code, real.json()))
        self.assertEqual(len(self.db.rows("copyright_takedowns")), 1)
        self.assertEqual(len([n for n in self.db.rows("notifications") if n["kind"] == "copyright_report"]), 1)

    def test_the_per_ip_limit(self):
        for i in range(5):
            self.assertEqual(self.send(location=f"https://example.com/page-{i}").status_code, 200)
        self.assertEqual(self.send(location="https://example.com/page-6").status_code, 429)
        self.assertEqual(self.send(ip="198.51.100.9", location="https://example.com/page-7").status_code, 200)

    def test_the_daily_cap_is_read_from_the_database_so_it_holds_across_machines(self):
        today = datetime.now(timezone.utc).isoformat()
        # Reports another machine saved today: this process has never counted them in memory.
        for i in range(takedowns.DAILY_CAP):
            self.db.rows("copyright_takedowns").append({"id": f"t{i}", "status": "rejected", "location": f"x{i}", "created_at": today})
        rate_limit._hits.clear()
        refused = self.send(ip="192.0.2.44")
        self.assertEqual(refused.status_code, 429)
        self.assertIn("support@cordiaai.io", refused.json()["detail"])
        self.assertEqual(len(self.db.rows("copyright_takedowns")), takedowns.DAILY_CAP)
        # Yesterday's reports don't count.
        for row in self.db.rows("copyright_takedowns"):
            row["created_at"] = "2026-01-01T00:00:00+00:00"
        self.assertEqual(self.send(ip="192.0.2.45").status_code, 200)

    # The owner is told ----------------------------------------------------------------------------
    def test_the_owner_is_notified_once(self):
        self.send()
        self.send()  # a duplicate doesn't notify again
        notes = [n for n in self.db.rows("notifications") if n["kind"] == "copyright_report"]
        self.assertEqual(len(notes), 1)
        self.assertEqual((notes[0]["user_id"], notes[0]["payload"]["guide_id"], notes[0]["payload"]["title"]), (OWNER, GUIDE, "Supply chains"))

    def test_a_notification_failure_never_fails_the_report(self):
        real_table = self.db.table

        def table(name):
            if name == "notifications":
                raise RuntimeError("relation notifications does not exist")
            return real_table(name)
        with patch.object(self.db, "table", side_effect=table):
            self.assertEqual(self.send().status_code, 200)
        self.assertEqual(len(self.db.rows("copyright_takedowns")), 1)

    def test_the_owner_sees_the_notification(self):
        self.send()
        items = self.client.get("/notifications", headers={"Authorization": "Bearer owner"}).json()["items"]
        self.assertEqual([(i["kind"], i["actor"], i["item"]["title"]) for i in items], [("copyright_report", None, "Supply chains")])

    def test_a_profile_report_changes_nothing_until_staff_take_it_down(self):
        profile = self.db.rows("user_profiles")[0]
        profile.update({"profile_visibility": "public", "review_status": "ok", "hold_reason": None})
        self.assertEqual(self.send(location="https://classroom.cordiaai.io/u/ana").status_code, 200)
        self.assertEqual((profile["review_status"], profile["hold_reason"]), ("ok", None))
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual((row["profile_id"], row.get("guide_id")), (OWNER, None))
        note = next(n for n in self.db.rows("notifications") if n["kind"] == "copyright_report")
        self.assertEqual((note["user_id"], note["payload"]["profile"]), (OWNER, True))
        self.send(location="https://classroom.cordiaai.io/u/ana")  # attaches
        self.assertEqual(len(self.db.rows("copyright_takedowns")), 1)
        queue = self.client.get("/admin/queue", headers={"Authorization": "Bearer eve"}).json()
        self.assertEqual(queue["takedowns"][0]["target"]["kind"], "profile")
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}/hold").status_code, 400)
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}", {"action": "actioned"}).status_code, 400)
        self.admin(f"/admin/takedowns/{row['id']}", {"action": "actioned", "reporter_confirmed": True})
        self.assertEqual(profile["review_status"], "hidden")

    # Staff ----------------------------------------------------------------------------------------
    def test_taking_down_requires_the_confirmation_tick_and_records_who(self):
        self.send()
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}", {"action": "actioned"}).status_code, 400)
        self.assertEqual(self.guide()["review_status"], "ok")
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}", {"action": "actioned", "reporter_confirmed": True}).status_code, 200)
        self.assertEqual((self.guide()["review_status"], self.shared()["status"]), ("hidden", "taken_down"))
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual((row["status"], row["confirmed_by"], row["actioned_by"]), ("actioned", ADMIN, ADMIN))
        self.assertTrue(row["confirmed_at"])
        # Decided reports can't be decided again.
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}", {"action": "rejected"}).status_code, 409)

    def test_reject_restores_only_what_this_report_held(self):
        self.send()
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}/hold").status_code, 200)
        self.assertEqual((self.guide()["review_status"], self.shared()["status"]), ("held", "held"))
        self.assertEqual(self.db.rows("copyright_takedowns")[0]["guide_status_before"], "ok")
        self.admin(f"/admin/takedowns/{row['id']}", {"action": "rejected"})
        self.assertEqual((self.guide()["review_status"], self.guide()["hold_reason"]), ("ok", None))
        self.assertEqual((self.shared()["status"], self.shared()["hold_reason"]), ("visible", None))

    def test_reject_never_clears_a_hold_for_another_reason(self):
        self.guide().update({"review_status": "held", "hold_reason": "Looks like an exam or answer key"})
        self.shared().update({"status": "held", "hold_reason": "Reported by classmates"})
        self.send()
        row = self.db.rows("copyright_takedowns")[0]
        self.admin(f"/admin/takedowns/{row['id']}/hold")  # already held: nothing of this report's to undo
        self.admin(f"/admin/takedowns/{row['id']}", {"action": "rejected"})
        self.assertEqual((self.guide()["review_status"], self.guide()["hold_reason"]), ("held", "Looks like an exam or answer key"))
        self.assertEqual((self.shared()["status"], self.shared()["hold_reason"]), ("held", "Reported by classmates"))

    def test_reject_without_a_hold_changes_nothing(self):
        self.send()
        self.guide().update({"review_status": "held", "hold_reason": "Reported by classmates"})
        row = self.db.rows("copyright_takedowns")[0]
        self.admin(f"/admin/takedowns/{row['id']}", {"action": "rejected"})
        self.assertEqual((self.guide()["review_status"], self.guide()["hold_reason"]), ("held", "Reported by classmates"))

    def test_hold_and_take_down_say_so_before_the_migration(self):
        self.send()
        row = self.db.rows("copyright_takedowns")[0]
        real_table = self.db.table

        def table(name):
            query = real_table(name)
            if name == "copyright_takedowns":
                update = query.update
                query.update = lambda payload: (_ for _ in ()).throw(RuntimeError("column does not exist")) if {"guide_status_before", "confirmed_by"} & set(payload) else update(payload)
            return query
        with patch.object(self.db, "table", side_effect=table):
            self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}/hold").status_code, 503)
            self.assertEqual(self.admin(f"/admin/takedowns/{row['id']}", {"action": "actioned", "reporter_confirmed": True}).status_code, 503)
        self.assertEqual(self.guide()["review_status"], "ok")

    # Discover --------------------------------------------------------------------------------------
    def test_the_reports_stat_counts_only_actioned_takedowns(self):
        sql = MIGRATION.read_text()
        self.assertTrue(sql.startswith("-- NOT APPLIED: waiting for owner's OK."))
        view = sql.split("create materialized view public.guide_quality as", 1)[1].split("with no data;", 1)[0]
        takedown_count = re.findall(r"from public\.copyright_takedowns t where ([^)]*)\)", view)
        self.assertEqual(takedown_count, ["t.guide_id = g.id and t.status = 'actioned'"])
        self.assertIn("refresh materialized view public.guide_quality;", sql)


if __name__ == "__main__":
    unittest.main()
