"""Social plan, Stage 9: reports and auto-hold, the admin queue, daily limits, minors (flag on and
off), the age question, held items hidden everywhere, and profile takedowns."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB, route_patches  # noqa: E402
from services import classrooms as rooms  # noqa: E402
from services import guide_access, instructors, minors, reports  # noqa: E402

NAMES = ["ana", "ben", "cat", "dan", "eve", "min", "kim", "lee"]
U = {name: f"{i:08d}-0000-4000-8000-00000000000{i}" for i, name in enumerate(NAMES, start=1)}
G_PUBLIC = "10000000-0000-4000-8000-000000000001"
G_PRIVATE = "10000000-0000-4000-8000-000000000002"
ROOM = "20000000-0000-4000-8000-000000000001"
TEACH = "20000000-0000-4000-8000-000000000002"
MODULES = ("reports", "social", "profiles", "classrooms", "admin", "guide_sharing", "classes", "public_forms", "auth", "discover")


def iso(delta_hours=0.0):
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


class Base(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for name, uid in U.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title(), "display_name": name.title(),
                                                  "profile_visibility": "public", "allow_follows": "everyone",
                                                  "allow_friend_requests": "everyone", "review_status": "ok",
                                                  "is_minor": name == "min", "created_at": "2026-10-01T00:00:00+00:00"})
        self.db.rows("app_admins").append({"user_id": U["eve"]})
        guide = {"user_id": U["ana"], "title": "Cells", "notes": "", "study_guide": "Q1: What is a cell?\nA1: The unit of life.",
                 "flashcards": [], "folder_id": None, "attribution": "named", "version": 1, "review_status": "ok",
                 "hold_reason": None, "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"}
        self.db.rows("study_guides").extend([{**guide, "id": G_PUBLIC, "visibility": "public"},
                                             {**guide, "id": G_PRIVATE, "visibility": "private"}])
        self.db.rows("shared_sets").append({"id": "s1", "guide_id": G_PUBLIC, "owner_id": U["ana"], "status": "visible", "visibility": "class"})
        room = {"owner_id": U["ana"], "kind": "study_group", "visibility": "public", "join_policy": "auto", "members_can_add": True,
                "members_can_invite": True, "archived_at": None, "review_status": "ok", "class_id": None, "description": None}
        self.db.rows("classrooms").extend([{**room, "id": ROOM, "name": "Bio group"},
                                           {**room, "id": TEACH, "name": "Bio 101", "kind": "instructor_class", "instructor_request": "approved"}])
        for uid, role in ((U["ana"], "owner"), (U["ben"], "member"), (U["cat"], "member"), (U["dan"], "member")):
            self.db.rows("classroom_members").append({"classroom_id": ROOM, "user_id": uid, "role": role, "status": "active"})
        self.db.rows("classroom_members").append({"classroom_id": TEACH, "user_id": U["ana"], "role": "owner", "status": "active"})

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in U:
                raise HTTPException(status_code=401, detail="Sign in")
            return U[name]
        self.patches = route_patches(MODULES, who, self.db)
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true", "MINOR_SAFETY": ""})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def call(self, method, who, path, **kw):
        rate_limit._hits.clear()  # the per-minute limits are tested elsewhere
        headers = {"Authorization": f"Bearer {who}"} if who else {}
        return getattr(self.client, method)(path, headers=headers, **kw)

    def report(self, who, target_type, target_id, reason="inappropriate"):
        return self.call("post", who, "/reports", json={"target_type": target_type, "target_id": target_id, "reason": reason})

    def row(self, table, id_):
        return next(r for r in self.db.rows(table) if r["id"] == id_)


class ReportTests(Base):
    def test_three_different_people_hold_a_guide_and_its_class_set(self):
        self.assertEqual(self.report("ben", "guide", G_PUBLIC, "wrong").json(), {"ok": True, "held": False})
        self.assertEqual(self.report("ben", "guide", G_PUBLIC, "copyright").json()["held"], False, "changing a reason isn't a new reporter")
        self.report("cat", "guide", G_PUBLIC)
        self.assertEqual(self.row("study_guides", G_PUBLIC)["review_status"], "ok")
        self.assertTrue(self.report("dan", "guide", G_PUBLIC, "harassment").json()["held"])
        self.assertEqual(self.row("study_guides", G_PUBLIC)["review_status"], "held")
        self.assertEqual(self.row("shared_sets", "s1")["status"], "hidden")
        self.assertEqual(self.call("get", "kim", f"/guides/{G_PUBLIC}/public").status_code, 404, "held: hidden on /sets")
        self.assertEqual(self.call("get", "ana", f"/guides/{G_PUBLIC}/public").status_code, 200, "the owner still sees it")

    def test_three_reporters_hold_a_profile_everywhere(self):
        for who in ("ben", "cat"):
            self.report(who, "profile", U["kim"], "harassment")
        self.assertEqual(self.call("get", "lee", "/profiles/kim").status_code, 200)
        self.report("dan", "profile", U["kim"], "inappropriate")
        self.assertEqual(self.row("user_profiles", U["kim"])["review_status"], "held")
        self.assertEqual(self.call("get", "lee", "/profiles/kim").status_code, 404)
        self.assertEqual(self.call("get", "kim", "/profiles/kim").json()["review_status"], "held", "the owner sees why")
        self.assertEqual(self.call("get", "kim", "/profiles/me").json()["review_status"], "held")
        self.assertEqual(self.call("post", "lee", f"/social/follow/{U['kim']}").status_code, 404, "no follows to a held profile")
        people = self.call("get", "lee", "/discover/people?q=kim").json()["people"]
        self.assertEqual(people, [], "held profiles are left out of search")

    def test_three_reporters_hold_a_classroom_for_everyone_but_its_staff(self):
        for who in ("ben", "cat", "dan"):
            self.assertEqual(self.report(who, "classroom", ROOM, "harassment").status_code, 200)
        self.assertEqual(self.row("classrooms", ROOM)["review_status"], "held")
        self.assertEqual(self.call("get", "ben", f"/classrooms/{ROOM}").status_code, 404, "members can't open it")
        self.assertEqual(self.call("get", "ana", f"/classrooms/{ROOM}").json()["classroom"]["review_status"], "held")
        self.assertEqual(self.call("post", "kim", f"/classrooms/{ROOM}/request-join", json={}).status_code, 404, "no joining")
        self.assertEqual([r["id"] for r in self.call("get", "ben", "/classrooms").json()["classrooms"]], [], "gone from their list")
        self.assertEqual(self.call("post", "ben", f"/classrooms/{ROOM}/leave").status_code, 200, "members can still leave")

    def test_a_held_classroom_shares_nothing(self):
        self.db.rows("classroom_items").append({"classroom_id": ROOM, "item_type": "guide", "item_id": G_PUBLIC})
        guide = {**self.row("study_guides", G_PUBLIC), "visibility": "classroom"}
        with patch.object(guide_access, "course", return_value=None):
            self.assertTrue(rooms.grants(self.db, U["ben"], guide))
            self.row("classrooms", ROOM)["review_status"] = "held"
            self.assertFalse(rooms.grants(self.db, U["ben"], guide))

    def test_rules_on_what_can_be_reported(self):
        self.assertEqual(self.report("ana", "guide", G_PUBLIC).status_code, 400, "not your own")
        self.assertEqual(self.report("ben", "guide", G_PRIVATE).status_code, 404, "not one you can't see")
        self.assertEqual(self.report("ben", "profile", U["kim"], "wrong").status_code, 400, "reasons depend on the target")
        self.assertEqual(self.report("kim", "classroom", TEACH, "copied_exam").status_code, 200, "a listed classroom")
        self.row("classrooms", TEACH)["visibility"] = "unlisted"
        self.assertEqual(self.report("lee", "classroom", TEACH).status_code, 404, "an unlisted one you're not in")
        self.assertEqual(self.report(None, "guide", G_PUBLIC).status_code, 401)

    def test_twenty_reports_a_day(self):
        for i in range(reports.DAILY_LIMIT):
            self.db.rows("shared_set_reports").append({"id": f"r{i}", "target_type": "guide", "target_id": f"g{i}", "reporter_id": U["ben"],
                                                       "reason": "wrong", "status": "open", "created_at": iso(-1)})
        response = self.report("ben", "profile", U["kim"], "harassment")
        self.assertEqual(response.status_code, 429)
        for row in self.db.rows("shared_set_reports"):
            row["created_at"] = iso(-25)  # a day later, the window has moved on
        self.assertEqual(self.report("ben", "profile", U["kim"], "harassment").status_code, 200)

    def test_class_set_reports_go_to_the_guide(self):
        self.db.rows("class_terms").append({"id": "t1"})
        with patch("routers.classes._readable_set", return_value=self.row("shared_sets", "s1")):
            response = self.call("post", "ben", "/sharing/sets/s1/report", json={"reason": "harassment"})
        self.assertEqual(response.status_code, 200)
        row = self.db.rows("shared_set_reports")[0]
        self.assertEqual((row["target_type"], row["target_id"], row["set_id"]), ("guide", G_PUBLIC, "s1"))

    def test_before_the_migration_reports_say_so(self):
        with patch.object(reports, "file", side_effect=reports.Unavailable()):
            response = self.report("ben", "profile", U["kim"], "harassment")
        self.assertEqual(response.status_code, 503)


class ReasonParityTests(unittest.TestCase):
    def test_the_web_offers_the_reasons_the_server_accepts(self):
        import re
        text = (Path(__file__).resolve().parents[1] / "web" / "lib" / "reportReasons.mjs").read_text()
        block = text[text.index("export const REASONS"):]
        for target, keys in reports.REASONS.items():
            found = re.search(target + r": \[([^\]]*)\]", block)
            self.assertIsNotNone(found, target)
            self.assertEqual(re.findall(r"'(\w+)'", found.group(1)), list(keys), target)


class AdminQueueTests(Base):
    def test_queue_groups_by_target_and_filters_by_type(self):
        self.report("ben", "guide", G_PUBLIC, "wrong")
        self.report("cat", "guide", G_PUBLIC, "copyright")
        self.report("ben", "profile", U["kim"], "harassment")
        self.assertEqual(self.call("get", "ben", "/admin/queue").status_code, 403)
        queue = self.call("get", "eve", "/admin/queue").json()["reports"]
        self.assertEqual([(r["target_type"], r["count"]) for r in queue], [("guide", 2), ("profile", 1)])
        self.assertEqual(queue[0]["reasons"], {"wrong": 1, "copyright": 1})
        self.assertEqual(queue[1]["target"]["title"], "@kim")
        only = self.call("get", "eve", "/admin/queue?type=profile").json()["reports"]
        self.assertEqual([r["target_type"] for r in only], ["profile"])

    def test_clear_and_hide(self):
        for who in ("ben", "cat", "dan"):
            self.report(who, "profile", U["kim"], "harassment")
        self.assertEqual(self.call("post", "ben", f"/admin/reports/profile/{U['kim']}", json={"decision": "clear"}).status_code, 403)
        self.assertEqual(self.call("post", "eve", f"/admin/reports/profile/{U['kim']}", json={"decision": "clear"}).status_code, 200)
        self.assertEqual(self.row("user_profiles", U["kim"])["review_status"], "ok")
        self.assertEqual({r["status"] for r in self.db.rows("shared_set_reports")}, {"dismissed"})
        self.assertEqual(self.call("get", "lee", "/profiles/kim").status_code, 200)
        self.report("lee", "classroom", ROOM, "inappropriate")
        self.call("post", "eve", f"/admin/reports/classroom/{ROOM}", json={"decision": "hide"})
        self.assertEqual(self.row("classrooms", ROOM)["review_status"], "hidden")
        self.assertEqual(self.call("get", "ben", f"/classrooms/{ROOM}").status_code, 404)


class InviteLimitTests(Base):
    def test_fifty_invites_a_day(self):
        for i in range(rooms.DAILY_INVITES - 1):
            self.db.rows("classroom_invites").append({"id": f"i{i}", "classroom_id": TEACH, "token": f"{i:024d}", "short_code": "ABCDEFGH",
                                                      "created_by": U["ana"], "revoked_at": iso(-1), "created_at": iso(-2)})
        self.assertEqual(self.call("post", "ana", f"/classrooms/{ROOM}/invites", json={}).status_code, 200, "the 50th")
        self.assertEqual(self.call("post", "ana", f"/classrooms/{ROOM}/invites", json={}).status_code, 429, "the 51st")
        for row in self.db.rows("classroom_invites"):
            row["created_at"] = iso(-25)
        self.assertEqual(self.call("post", "ana", f"/classrooms/{ROOM}/invites", json={}).status_code, 200)

    def test_friend_invites_count_one_each(self):
        for i in range(rooms.DAILY_INVITES - 1):
            self.db.rows("classroom_invites").append({"id": f"i{i}", "classroom_id": TEACH, "created_by": U["ana"], "created_at": iso(-2)})
        for friend in ("kim", "lee"):
            lo, hi = sorted([U["ana"], U[friend]])
            self.db.rows("friendships").append({"user_a": lo, "user_b": hi, "status": "accepted", "requested_by": U["ana"]})
        response = self.call("post", "ana", f"/classrooms/{ROOM}/invite-friends", json={"user_ids": [U["kim"], U["lee"]]})
        self.assertEqual(response.status_code, 429, "two would make 51")


class MinorTests(Base):
    def strict(self, on=True):
        return patch.dict(os.environ, {"MINOR_SAFETY": "true" if on else ""})

    def test_flag_off_keeps_todays_rules_only(self):
        self.assertEqual(self.call("patch", "min", "/profiles/me", json={"profile_visibility": "public"}).status_code, 200)
        me = self.call("get", "min", "/profiles/me").json()
        self.assertEqual((me["profile_visibility"], me["profile_locked"]), ("public", False))
        self.row("study_guides", G_PRIVATE)["user_id"] = U["min"]
        self.assertEqual(self.call("patch", "min", f"/guides/{G_PRIVATE}/visibility", json={"visibility": "public", "accept_honor_code": True}).status_code, 200)
        self.assertEqual(self.call("post", "ben", f"/social/friends/{U['min']}").json(), {"friendship": "outgoing"})
        self.assertEqual(self.call("post", "ben", f"/social/follow/{U['min']}").status_code, 403, "follows from friends only: always on")
        self.assertEqual(self.call("post", "min", f"/classrooms/{TEACH}/request-join", json={"share_progress": False}).status_code, 200)
        self.assertFalse(minors.may_join_leaderboards(self.db, U["min"]), "never on the leaderboard: always on (Stage 10)")

    def test_flag_on(self):
        with self.strict():
            self.assertEqual(self.call("patch", "min", "/profiles/me", json={"profile_visibility": "public"}).status_code, 403)
            self.row("user_profiles", U["min"])["profile_visibility"] = "public"  # set before the flag went on
            me = self.call("get", "min", "/profiles/me").json()
            self.assertEqual((me["profile_visibility"], me["profile_locked"]), ("private", True))
            lo, hi = sorted([U["ben"], U["min"]])
            self.db.rows("friendships").append({"user_a": lo, "user_b": hi, "status": "accepted", "requested_by": U["ben"]})
            self.assertTrue(self.call("get", "ben", "/profiles/min").json()["limited"], "friends see a private profile")
            self.db.rows("friendships").clear()
            self.row("study_guides", G_PRIVATE)["user_id"] = U["min"]
            self.assertEqual(self.call("patch", "min", f"/guides/{G_PRIVATE}/visibility", json={"visibility": "public", "accept_honor_code": True}).status_code, 403)
            self.assertEqual(self.call("patch", "min", f"/guides/{G_PRIVATE}/visibility", json={"visibility": "link", "accept_honor_code": True}).status_code, 200)
            self.assertEqual(self.call("post", "ben", f"/social/friends/{U['min']}").status_code, 403, "no friend requests to minors")
            self.assertEqual(self.call("post", "min", f"/social/friends/{U['ben']}").json(), {"friendship": "outgoing"}, "they can still send one")
            self.assertEqual(self.call("post", "ben", f"/social/friends/{U['min']}").json(), {"friendship": "friends"}, "and it can be accepted")
            self.assertEqual(self.call("post", "min", f"/classrooms/{TEACH}/request-join", json={"share_progress": False}).status_code, 403)
            self.assertEqual(self.call("post", "min", f"/classrooms/{ROOM}/request-join", json={}).status_code, 200, "study groups stay open")
            with patch.object(instructors, "runs_verified_class", return_value=True):
                self.assertEqual(self.call("post", "min", f"/classrooms/{TEACH}/request-join", json={"share_progress": False}).status_code, 200)
            self.assertFalse(minors.may_join_leaderboards(self.db, U["min"]))
            self.assertTrue(minors.may_join_leaderboards(self.db, U["ben"]))

    def test_verified_school_rule(self):
        self.db.rows("schools").append({"id": "sch", "name": "Test U", "email_domains": ["testu.edu"]})
        self.db.rows("classes").append({"id": "c1", "school_id": "sch", "course_code_normalized": "BIO 101"})
        self.db.rows("instructor_blocks").append({"id": "b1", "class_id": "c1", "email": "prof@testu.edu"})
        room = {**self.row("classrooms", TEACH), "class_id": "c1"}
        self.db.auth.admin.get_user_by_id = lambda uid: SimpleNamespace(user=SimpleNamespace(email="prof@testu.edu", email_confirmed_at="2026-10-01"))
        self.assertTrue(instructors.runs_verified_class(self.db, room))
        self.db.auth.admin.get_user_by_id = lambda uid: SimpleNamespace(user=SimpleNamespace(email="prof@gmail.com", email_confirmed_at="2026-10-01"))
        self.assertFalse(instructors.runs_verified_class(self.db, room), "a confirmed email at another domain")
        self.assertFalse(instructors.runs_verified_class(self.db, {**room, "class_id": None}), "no course, no school")


class AgeTests(Base):
    def setUp(self):
        super().setUp()
        self.db.auth.admin.delete_user = MagicMock()
        self.erase = [patch("routers.billing.cancel_subscription_for_deletion"), patch("routers.auth._remove_lecture_audio"),
                      patch("routers.auth._remove_visuals"), patch("routers.auth._remove_card_images")]
        for p in self.erase:
            p.start()

    def tearDown(self):
        for p in self.erase:
            p.stop()
        super().tearDown()

    def years_ago(self, years):
        today = datetime.now(timezone.utc).date()
        return {"year": today.year - years, "month": today.month}

    def test_under_13_gets_no_account(self):
        response = self.call("post", "kim", "/auth/age", json=self.years_ago(12))
        self.assertEqual((response.status_code, response.json()["detail"]), (403, "under_13"))
        self.db.auth.admin.delete_user.assert_called_once_with(U["kim"])
        self.assertFalse([r for r in self.db.rows("user_profiles") if r["id"] == U["kim"]])

    def test_13_to_17_is_a_minor_and_ages_out(self):
        self.assertEqual(self.call("post", "kim", "/auth/age", json=self.years_ago(15)).json(), {"saved": True, "minor": True})
        self.assertTrue(self.row("user_profiles", U["kim"])["birth_month"].endswith("-01"), "only the month is kept")
        self.assertTrue(minors.is_minor(self.db, U["kim"]))
        self.row("user_profiles", U["kim"])["birth_month"] = "2000-01-01"
        self.assertFalse(minors.is_minor(self.db, U["kim"]))

    def test_adults_once_only_and_bad_dates(self):
        self.assertEqual(self.call("post", "lee", "/auth/age", json=self.years_ago(19)).json(), {"saved": True, "minor": False})
        self.assertEqual(self.call("post", "lee", "/auth/age", json=self.years_ago(30)).status_code, 409)
        self.assertEqual(self.call("post", "kim", "/auth/age", json={"year": datetime.now(timezone.utc).year + 1, "month": 1}).status_code, 400)
        self.assertEqual(self.call("post", "kim", "/auth/age", json={"year": 2000, "month": 13}).status_code, 422)

    def test_before_the_migration(self):
        broken = MagicMock(side_effect=Exception("column user_profiles.birth_month does not exist"))
        real_table = self.db.table

        def table(name):
            query = real_table(name)
            if name == "user_profiles":
                original = query.select
                query.select = lambda columns="*", **kw: broken() if "birth_month" in columns else original(columns, **kw)
            return query
        with patch.object(self.db, "table", side_effect=table):
            self.assertEqual(self.call("post", "lee", "/auth/age", json=self.years_ago(20)).status_code, 503)
            self.assertEqual(self.call("post", "kim", "/auth/age", json=self.years_ago(10)).status_code, 403, "under 13 still has no account")

    def test_new_accounts_count_as_minors_until_they_answer(self):
        self.assertTrue(minors.age_needed({"birth_month": None, "created_at": "2026-11-20T10:00:00+00:00"}))
        self.assertFalse(minors.age_needed({"birth_month": None, "created_at": "2026-10-20T10:00:00+00:00"}), "existing accounts aren't asked")
        self.assertFalse(minors.age_needed({"birth_month": "2000-01-01", "created_at": "2026-11-20T10:00:00+00:00"}))
        self.row("user_profiles", U["kim"]).update({"created_at": "2026-11-20T10:00:00+00:00", "birth_month": None})
        self.assertTrue(minors.is_minor(self.db, U["kim"]))
        self.assertEqual(minors.age_on("2010-06-01", datetime(2026, 5, 31).date()), 15)
        self.assertEqual(minors.age_on("2010-06-01", datetime(2026, 6, 1).date()), 16)


class TakedownTests(Base):
    def takedown(self, location):
        return self.call("post", None, "/copyright/takedown", json={"name": "Pub", "email": "legal@pub.com", "work": "Photo", "location": location, "statement": True})

    def test_a_profile_link_is_queued_without_a_hold(self):
        self.assertEqual(self.takedown("https://classroom.cordiaai.io/u/kim").status_code, 200)
        row = self.db.rows("copyright_takedowns")[0]
        self.assertEqual((row["profile_id"], row["set_id"]), (U["kim"], None))
        self.assertEqual(self.row("user_profiles", U["kim"])["review_status"], "ok")
        # Taking down needs staff to have confirmed the reporter by email first.
        self.assertEqual(self.call("post", "eve", f"/admin/takedowns/{row['id']}", json={"action": "actioned"}).status_code, 400)
        self.call("post", "eve", f"/admin/takedowns/{row['id']}", json={"action": "actioned", "reporter_confirmed": True})
        self.assertEqual(self.row("user_profiles", U["kim"])["review_status"], "hidden")
        self.assertEqual(self.call("get", "lee", "/profiles/kim").status_code, 404)

    def test_a_guide_link_is_queued_without_a_hold(self):
        self.takedown(f"https://classroom.cordiaai.io/sets/{G_PUBLIC}")
        self.assertEqual(self.row("study_guides", G_PUBLIC)["review_status"], "ok")
        self.assertIsNone(self.db.rows("copyright_takedowns")[0].get("profile_id"))

    def test_an_unknown_profile_is_just_recorded(self):
        self.takedown("https://classroom.cordiaai.io/u/nobody")
        self.assertIsNone(self.db.rows("copyright_takedowns")[0].get("profile_id"))


if __name__ == "__main__":
    unittest.main()
