"""Social plan, Stage 10: the Activity feed's privacy, the weekly friends leaderboard (opt-in,
minors hidden, effort not scores), the classroom group streak, and the Tutor that answers only from a
guide the viewer can see."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import json
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
from services import group_streak, guide_tutor, leaderboard  # noqa: E402

NAMES = ["ana", "ben", "cat", "dan", "kim", "lee", "min", "sam"]
U = {name: f"{i:08d}-0000-4000-8000-00000000000{i}" for i, name in enumerate(NAMES, start=1)}
ROOM, OTHER_ROOM, HELD_ROOM = ("20000000-0000-4000-8000-00000000000%d" % i for i in (1, 2, 3))
NOW = datetime.now(timezone.utc)


def iso(days=0.0, hours=0.0):
    return (NOW + timedelta(days=days, hours=hours)).isoformat()


def gid(n):
    return f"10000000-0000-4000-8000-0000000000{n:02d}"


def guide(n, owner, **extra):
    base = {"id": gid(n), "user_id": U[owner], "title": f"Guide {n}", "notes": f"- Outline line for guide {n}",
            "study_guide": f"Q1: What is idea {n}?\nA1: Idea {n} is explained in guide {n}.", "flashcards": [], "folder_id": None,
            "visibility": "public", "attribution": "named", "version": 1, "review_status": "ok", "hold_reason": None,
            "forked_from_guide_id": None, "created_at": iso(-40), "published_at": iso(-1)}
    return {**base, **extra}


def befriend(db, a, b):
    lo, hi = sorted([U[a], U[b]])
    db.rows("friendships").append({"user_a": lo, "user_b": hi, "status": "accepted", "requested_by": U[a]})


class Base(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for name, uid in U.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title(), "profile_visibility": "public",
                                                  "review_status": "held" if name == "kim" else "ok", "is_minor": name == "min",
                                                  "show_streak": name in ("lee", "ben"), "leaderboard_opt_in": False,
                                                  "timezone": "UTC", "created_at": "2026-10-01T00:00:00+00:00"})

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in U:
                raise HTTPException(status_code=401, detail="Sign in")
            return U[name]
        self.patches = route_patches(("social", "profiles", "classrooms", "guide_sharing"), who, self.db)
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true", "MINOR_SAFETY": ""})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def call(self, method, who, path, **kw):
        rate_limit._hits.clear()
        return getattr(self.client, method)(path, headers={"Authorization": f"Bearer {who}"}, **kw)


class ActivityTests(Base):
    def setUp(self):
        super().setUp()
        for followee in ("ben", "cat", "kim", "sam"):
            self.db.rows("follows").append({"follower_id": U["ana"], "followee_id": U[followee], "status": "active"})
        self.db.rows("user_blocks").append({"blocker_id": U["ana"], "blocked_id": U["cat"]})
        self.db.rows("study_guides").extend([
            guide(1, "ben"),                                   # shown
            guide(2, "ben", attribution="anonymous"),          # anonymous: never names the author
            guide(3, "ben", review_status="held"),             # held for review
            guide(4, "ben", visibility="private"),             # private
            guide(5, "ben", published_at=iso(-45)),            # too old
            guide(6, "cat"),                                   # blocked
            guide(7, "kim"),                                   # held profile
            guide(8, "dan"),                                   # not followed
            guide(9, "dan", visibility="private"),             # shared to the classroom, still private
            guide(10, "dan", visibility="link"),               # shared to the classroom, ana can see it
            guide(11, "sam", visibility="link"),               # followed but only a link guide
        ])
        room = {"owner_id": U["dan"], "kind": "study_group", "visibility": "unlisted", "archived_at": None, "review_status": "ok"}
        self.db.rows("classrooms").extend([{**room, "id": ROOM, "name": "Bio group"}, {**room, "id": OTHER_ROOM, "name": "Not mine"},
                                           {**room, "id": HELD_ROOM, "name": "Held group", "review_status": "held"}])
        for rid in (ROOM, HELD_ROOM):
            self.db.rows("classroom_members").append({"classroom_id": rid, "user_id": U["ana"], "role": "member", "status": "active"})
        for rid, item, when in ((ROOM, gid(10), iso(-2)), (ROOM, gid(9), iso(-2)), (OTHER_ROOM, gid(10), iso(-2)), (HELD_ROOM, gid(10), iso(-2))):
            self.db.rows("classroom_activity").append({"classroom_id": rid, "actor_id": U["dan"], "kind": "guide_added",
                                                       "payload": {"item_id": item}, "created_at": when})
        befriend(self.db, "ana", "lee")
        befriend(self.db, "ana", "ben")
        befriend(self.db, "ana", "dan")
        today = NOW.date()
        self.db.rows("user_streaks").extend([
            {"user_id": U["lee"], "current_streak": 9, "last_study_date": today.isoformat()},     # 7 reached 2 days ago
            {"user_id": U["dan"], "current_streak": 40, "last_study_date": today.isoformat()},    # doesn't show streaks
            {"user_id": U["ben"], "current_streak": 8, "last_study_date": (today - timedelta(days=5)).isoformat()},  # lapsed
        ])

    def test_the_feed_shows_only_what_the_viewer_may_see(self):
        items = self.call("get", "ana", "/social/activity").json()["items"]
        seen = {(i["kind"], (i.get("guide") or {}).get("id"), i["actor"]["username"]) for i in items}
        self.assertIn(("guide_published", gid(1), "ben"), seen)
        self.assertIn(("classroom_guide", gid(10), "dan"), seen)
        self.assertIn(("streak", None, "lee"), seen)
        published = {i["guide"]["id"] for i in items if i["kind"] == "guide_published"}
        self.assertEqual(published, {gid(1)}, "no anonymous, held, private, old, blocked, held-profile, unfollowed or link guides")
        rooms = [i["classroom"]["name"] for i in items if i["kind"] == "classroom_guide"]
        self.assertEqual(rooms, ["Bio group"], "only your rooms, not held ones, and only guides you can see")
        self.assertEqual([i["days"] for i in items if i["kind"] == "streak"], [7], "only friends who show their streak, and not lapsed")
        self.assertNotIn("actor_id", items[0])
        self.assertEqual(self.call("get", "kim", "/social/activity").json()["items"], [], "kim follows no one")

    def test_your_own_classroom_additions_and_blocked_actors_stay_out(self):
        self.db.rows("user_blocks").append({"blocker_id": U["dan"], "blocked_id": U["ana"]})
        kinds = [i["kind"] for i in self.call("get", "ana", "/social/activity").json()["items"]]
        self.assertNotIn("classroom_guide", kinds, "a block either way hides their additions")

    def test_signed_out_is_refused(self):
        self.assertEqual(self.client.get("/social/activity").status_code, 401)


class LeaderboardTests(Base):
    def setUp(self):
        super().setUp()
        for friend in ("ben", "cat", "min", "lee"):
            befriend(self.db, "ana", friend)
        self.week = leaderboard.week_start("UTC")

    def session(self, who, minutes, at=None, kind="flashcard"):
        self.db.rows("study_sessions").append({"user_id": U[who], "duration_seconds": minutes * 60, "session_type": kind,
                                               "started_at": (at or self.week + timedelta(hours=10)).isoformat()})

    def event(self, who, item, at):
        self.db.rows("learning_events").append({"user_id": U[who], "item_id": item, "occurred_at": at.isoformat()})

    def join(self, who):
        return self.call("patch", who, "/profiles/me", json={"leaderboard_opt_in": True})

    def test_opt_in_and_only_people_who_joined(self):
        self.assertEqual(self.call("get", "ana", "/social/leaderboard").json(), {"joined": False, "can_join": True, "people": []})
        self.assertTrue(self.join("ana").json()["leaderboard_opt_in"])
        self.join("ben")
        self.join("lee")
        self.call("patch", "lee", "/profiles/me", json={"leaderboard_opt_in": False})  # left again
        names = [p["username"] for p in self.call("get", "ana", "/social/leaderboard").json()["people"]]
        self.assertEqual(sorted(names), ["ana", "ben"], "cat never joined, lee left")

    def test_minors_are_never_on_it(self):
        self.assertEqual(self.join("min").status_code, 403)
        self.db.rows("user_profiles")[NAMES.index("min")]["leaderboard_opt_in"] = True  # set before they were marked a minor
        self.join("ana")
        names = [p["username"] for p in self.call("get", "ana", "/social/leaderboard").json()["people"]]
        self.assertNotIn("min", names)
        self.assertEqual(self.call("get", "min", "/social/leaderboard").json()["can_join"], False)
        self.assertFalse(self.call("get", "min", "/profiles/me").json()["can_join_leaderboard"])

    def test_effort_minutes_and_reviews_never_scores(self):
        self.join("ana")
        self.join("ben")
        self.session("ana", 30)
        self.session("ana", 20, kind="browse")                         # browsing isn't studying
        self.session("ana", 50, at=self.week - timedelta(hours=1))     # last week
        self.session("ben", 10)
        day1 = self.week + timedelta(hours=1)
        self.event("ben", "idea-a", self.week - timedelta(days=3))     # first studied before
        self.event("ben", "idea-a", day1)                              # a review this week
        self.event("ben", "idea-a", day1 + timedelta(minutes=5))       # same idea same day: once
        self.event("ben", "idea-b", day1)                              # new idea: not a review
        self.event("ben", "idea-b", day1 + timedelta(days=1))          # back the next day: a review
        self.db.rows("quiz_attempts").append({"user_id": U["ben"], "score": 100, "completed_at": day1.isoformat()})
        people = {p["username"]: p for p in self.call("get", "ana", "/social/leaderboard").json()["people"]}
        self.assertEqual((people["ana"]["minutes"], people["ana"]["reviews"], people["ana"]["points"]), (30, 0, 30))
        self.assertEqual((people["ben"]["minutes"], people["ben"]["reviews"], people["ben"]["points"]), (10, 2, 12))
        self.assertEqual([people["ana"]["rank"], people["ben"]["rank"]], [1, 2])
        self.assertNotIn("score", people["ben"])

    def test_blocked_and_held_friends_are_left_out(self):
        self.join("ana")
        self.join("ben")
        self.db.rows("user_blocks").append({"blocker_id": U["ben"], "blocked_id": U["ana"]})
        self.assertEqual([p["username"] for p in self.call("get", "ana", "/social/leaderboard").json()["people"]], ["ana"])

    def test_week_starts_monday_in_the_viewers_zone(self):
        wednesday = datetime(2026, 11, 11, 15, 0, tzinfo=timezone.utc)
        self.assertEqual(leaderboard.week_start("UTC", wednesday), datetime(2026, 11, 9, tzinfo=timezone.utc))
        self.assertEqual(leaderboard.week_start("America/Los_Angeles", wednesday), datetime(2026, 11, 9, 8, tzinfo=timezone.utc))
        self.assertEqual(leaderboard.week_start("Not/AZone", wednesday), datetime(2026, 11, 9, tzinfo=timezone.utc))


class GroupStreakTests(Base):
    def setUp(self):
        super().setUp()
        self.room = {"id": ROOM, "owner_id": U["ana"], "name": "Bio group", "kind": "study_group", "visibility": "unlisted",
                     "archived_at": None, "review_status": "ok"}
        self.db.rows("classrooms").append(self.room)
        for name in ("ana", "ben", "cat", "dan"):
            self.db.rows("classroom_members").append({"classroom_id": ROOM, "user_id": U[name], "role": "owner" if name == "ana" else "member", "status": "active"})
        self.now = datetime(2026, 11, 20, 18, 0, tzinfo=timezone.utc)

    def studied(self, who, days_ago, seconds=600):
        at = self.now - timedelta(days=days_ago, hours=2)
        self.db.rows("study_sessions").append({"user_id": U[who], "started_at": at.isoformat(), "duration_seconds": seconds, "session_type": "quiz"})

    def test_half_the_members_make_a_day(self):
        for days_ago in (1, 2, 3):
            self.studied("ana", days_ago)
            self.studied("ben", days_ago)
        self.studied("ana", 4)                 # only one of four: the run stops here
        self.studied("cat", 0)                 # today: one of the two needed
        self.studied("dan", 0, seconds=30)     # under a minute doesn't count
        result = group_streak.streak(self.db, self.room, self.now)
        self.assertEqual(result["streak"], 3)
        self.assertEqual(result["today"], {"studied": 1, "members": 4, "needed": 2, "counts": False})
        self.studied("ben", 0)
        result = group_streak.streak(self.db, self.room, self.now)
        self.assertEqual((result["streak"], result["today"]["counts"]), (4, True), "today joins once it's reached")

    def test_route_is_members_only_and_shows_no_names(self):
        self.studied("ana", 0)
        self.studied("ben", 0)
        body = self.call("get", "dan", f"/classrooms/{ROOM}/streak").json()
        self.assertEqual(set(body), {"streak", "today"})
        self.assertNotIn(U["ana"], json.dumps(body))
        self.assertEqual(self.call("get", "kim", f"/classrooms/{ROOM}/streak").status_code, 404)

    def test_odd_sizes_round_up(self):
        self.assertEqual([group_streak.needed(n) for n in (1, 2, 3, 4, 5)], [1, 1, 2, 2, 3])


def reply(payload):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])


class GuideTutorTests(Base):
    def setUp(self):
        super().setUp()
        self.db.rows("study_guides").extend([
            guide(1, "ben", study_guide="Q1: What does ATP store?\nA1: Energy for the cell.\nQ2: Where is ATP made?\nA2: In the mitochondria."),
            guide(2, "ben", visibility="private", study_guide="Q1: SECRET question?\nA1: SECRET answer."),
            guide(3, "dan", study_guide="Q1: OTHER guide question?\nA1: OTHER answer."),
        ])
        self.chat = MagicMock(return_value=reply({"covered": True, "answer": "ATP stores energy for the cell.", "ideas": [1, 7]}))
        self.limits = [patch("services.entitlements.require"), patch("services.entitlements.record")]
        self.require, self.record = (p.start() for p in self.limits)
        self.llm = [patch("services.guide_tutor.llm.chat", self.chat), patch("services.guide_tutor.llm.get_openai_client", return_value=None)]
        for p in self.llm:
            p.start()

    def tearDown(self):
        for p in self.llm + self.limits:
            p.stop()
        super().tearDown()

    def ask(self, who, guide_id, question="What does ATP store?", detail="short"):
        return self.call("post", who, f"/guides/{guide_id}/ask", json={"question": question, "detail": detail})

    def test_answers_from_this_guide_only_and_cites_the_idea(self):
        body = self.ask("ana", gid(1)).json()
        self.assertEqual((body["covered"], body["answer"]), (True, "ATP stores energy for the cell."))
        self.assertEqual([c["question"] for c in body["cited"]], ["What does ATP store?"], "made-up idea 7 is dropped")
        prompt = json.dumps(self.chat.call_args.kwargs["messages"])
        self.assertIn("Where is ATP made?", prompt)
        self.assertNotIn("OTHER", prompt)
        self.assertNotIn("SECRET", prompt)
        self.assertEqual(self.chat.call_args.args[1], "guide_tutor_short")
        self.require.assert_called_once_with(U["ana"], "tutor")
        self.record.assert_called_once_with(U["ana"], "tutor")

    def test_says_plainly_when_the_guide_doesnt_cover_it(self):
        self.chat.return_value = reply({"covered": False, "answer": "Photosynthesis happens in chloroplasts.", "ideas": []})
        body = self.ask("ana", gid(1), "How does photosynthesis work?").json()
        self.assertEqual(body, {"covered": False, "answer": guide_tutor.NOT_COVERED, "cited": []})

    def test_never_loads_a_guide_the_viewer_cant_see(self):
        self.assertEqual(self.ask("ana", gid(2)).status_code, 404, "private")
        self.db.rows("user_blocks").append({"blocker_id": U["ben"], "blocked_id": U["ana"]})
        self.assertEqual(self.ask("ana", gid(1)).status_code, 404, "blocked")
        self.db.rows("study_guides")[0]["review_status"] = "held"
        self.assertEqual(self.ask("cat", gid(1)).status_code, 404, "held")
        self.chat.assert_not_called()
        self.require.assert_not_called()

    def test_explain_more_uses_the_build_model_and_owners_can_ask_too(self):
        self.ask("ben", gid(2), detail="long")
        self.assertEqual(self.chat.call_args.args[1], "guide_tutor_long")
        self.assertIn("SECRET", json.dumps(self.chat.call_args.kwargs["messages"]), "the owner can ask about their private guide")

    def test_a_broken_reply_isnt_charged(self):
        self.chat.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="not json"))])
        self.assertEqual(self.ask("ana", gid(1)).status_code, 502)
        self.record.assert_not_called()

    def test_models_are_sonnet_and_haiku_never_opus(self):
        from services import models
        self.assertEqual(models.FEATURES["guide_tutor_short"].role, models.LIGHT)
        self.assertEqual(models.FEATURES["guide_tutor_long"].role, models.BUILD)
        for feature in ("guide_tutor_short", "guide_tutor_long"):
            self.assertNotIn("opus", models.model_for(feature).lower())


if __name__ == "__main__":
    unittest.main()
