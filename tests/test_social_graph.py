"""Follows, friends and notifications (social plan, Stage 2)."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB, route_patches  # noqa: E402
from services import social_graph as graph  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"
BEN = "bbbbbbbb-0000-4000-8000-000000000002"
CAT = "cccccccc-0000-4000-8000-000000000003"
DAN = "dddddddd-0000-4000-8000-000000000004"
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN}


def auth(name):
    return {"Authorization": f"Bearer {name}"}


class SocialGraphTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for name, uid in IDS.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title() + " Test",
                                                   "allow_follows": "everyone", "allow_friend_requests": "everyone",
                                                   "profile_visibility": "public"})
        self.client = TestClient(main.app)
        who = lambda header: IDS[header.split(" ", 1)[1]]  # noqa: E731
        self.patches = route_patches(("social", "notifications", "profiles"), who, self.db)
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def set(self, name, **fields):
        next(r for r in self.db.rows("user_profiles") if r["id"] == IDS[name]).update(fields)

    def call(self, method, who, path, **kw):
        return getattr(self.client, method)(path, headers=auth(who), **kw)

    def kinds(self, who):
        return [n["kind"] for n in self.call("get", who, "/notifications").json()["items"]]

    # Follows ---------------------------------------------------------------------------------------
    def test_follow_and_unfollow(self):
        self.assertEqual(self.call("post", "ana", f"/social/follow/{BEN}").json(), {"status": "active"})
        self.assertEqual(self.call("post", "ana", f"/social/follow/{BEN}").json(), {"status": "active"})  # once
        self.assertEqual(len(self.db.rows("follows")), 1)
        self.assertEqual([p["username"] for p in self.call("get", "ben", "/social/followers").json()["items"]], ["ana"])
        self.assertEqual([p["username"] for p in self.call("get", "ana", "/social/following").json()["items"]], ["ben"])
        self.assertEqual(self.kinds("ben"), ["follow"])
        self.call("delete", "ana", f"/social/follow/{BEN}")
        self.assertEqual(self.call("get", "ben", "/social/followers").json()["items"], [])
        self.call("post", "ana", f"/social/follow/{BEN}")  # follow again the same day: no second notification
        self.assertEqual(self.kinds("ben"), ["follow"])

    def test_follow_approval_flow_and_remove_follower(self):
        self.set("ben", allow_follows="approval")
        self.assertEqual(self.call("post", "ana", f"/social/follow/{BEN}").json(), {"status": "pending"})
        self.assertEqual(self.kinds("ben"), ["follow_request"])
        incoming = self.call("get", "ben", "/social/requests", params={"kind": "follow"}).json()["items"]
        self.assertEqual([p["username"] for p in incoming], ["ana"])
        self.assertEqual([p["username"] for p in self.call("get", "ana", "/social/requests", params={"kind": "follow", "direction": "outgoing"}).json()["items"]], ["ben"])
        self.assertEqual(self.call("get", "ben", "/social/followers").json()["items"], [])  # not until approved
        self.assertEqual(self.call("get", "ben", "/social/summary").json()["incoming_follow_requests"], 1)
        self.assertEqual(self.call("post", "ben", f"/social/follow-requests/{ANA}/approve").json(), {"status": "active"})
        self.assertEqual([p["username"] for p in self.call("get", "ben", "/social/followers").json()["items"]], ["ana"])
        self.assertEqual(self.call("post", "ben", f"/social/follow-requests/{ANA}/approve").status_code, 404)  # no longer pending
        self.call("delete", "ben", f"/social/followers/{ANA}")
        self.assertEqual(self.call("get", "ben", "/social/followers").json()["items"], [])
        self.call("post", "cat", f"/social/follow/{BEN}")
        self.assertEqual(self.call("post", "ben", f"/social/follow-requests/{CAT}/decline").json(), {"status": "none"})
        self.assertEqual(self.db.rows("follows"), [])

    def test_follow_checks(self):
        self.assertEqual(self.call("post", "ana", f"/social/follow/{ANA}").status_code, 400)
        self.assertEqual(self.call("post", "ana", "/social/follow/eeeeeeee-0000-4000-8000-000000000005").status_code, 404)
        self.assertEqual(self.call("post", "ana", "/social/follow/nope").status_code, 400)

    # Friends ---------------------------------------------------------------------------------------
    def test_friend_request_accept_creates_mutual_follows(self):
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}").json(), {"friendship": "outgoing"})
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}").json(), {"friendship": "outgoing"})
        self.assertEqual(self.kinds("ben"), ["friend_request"])
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}/accept").status_code, 404)  # can't accept your own
        self.assertEqual(self.call("get", "ben", "/social/summary").json()["incoming_friend_requests"], 1)
        self.assertEqual([p["username"] for p in self.call("get", "ana", "/social/requests", params={"direction": "outgoing"}).json()["items"]], ["ben"])
        self.assertEqual(self.call("post", "ben", f"/social/friends/{ANA}/accept").json(), {"friendship": "friends"})
        self.assertEqual(self.kinds("ana"), ["friend_accepted"])
        self.assertTrue(graph.are_friends(self.db, ANA, BEN))
        self.assertEqual({(r["follower_id"], r["followee_id"], r["status"]) for r in self.db.rows("follows")},
                         {(ANA, BEN, "active"), (BEN, ANA, "active")})
        self.assertEqual([p["username"] for p in self.call("get", "ana", "/social/friends").json()["items"]], ["ben"])
        # Removing a friend keeps the follows.
        self.assertEqual(self.call("delete", "ben", f"/social/friends/{ANA}").json(), {"friendship": "none"})
        self.assertFalse(graph.are_friends(self.db, ANA, BEN))
        self.assertEqual(len(self.db.rows("follows")), 2)

    def test_accepting_upgrades_a_pending_follow(self):
        self.set("ben", allow_follows="approval")
        self.call("post", "ana", f"/social/follow/{BEN}")
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.call("post", "ben", f"/social/friends/{ANA}/accept")
        self.assertEqual(graph.follow_row(self.db, ANA, BEN)["status"], "active")

    def test_requesting_someone_who_asked_you_accepts(self):
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.assertEqual(self.call("post", "ben", f"/social/friends/{ANA}").json(), {"friendship": "friends"})
        self.assertTrue(graph.are_friends(self.db, ANA, BEN))

    def test_decline_and_cancel(self):
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.assertEqual(self.call("post", "ben", f"/social/friends/{ANA}/decline").json(), {"friendship": "none"})
        self.assertEqual(self.db.rows("friendships"), [])
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.call("delete", "ana", f"/social/friends/{BEN}")  # take it back
        self.assertEqual(self.db.rows("friendships"), [])

    def test_who_may_send_friend_requests(self):
        self.set("ben", allow_friend_requests="nobody")
        response = self.call("post", "ana", f"/social/friends/{BEN}")
        self.assertEqual((response.status_code, response.json()["detail"]), (403, "They aren't taking friend requests."))
        self.set("ben", allow_friend_requests="friends_of_friends")
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}").status_code, 403)
        # Cat is friends with both: now Ana and Ben share a friend.
        self.call("post", "cat", f"/social/friends/{ANA}")
        self.call("post", "ana", f"/social/friends/{CAT}/accept")
        self.call("post", "ben", f"/social/friends/{CAT}")  # Ben's own rule doesn't limit who he asks
        self.call("post", "cat", f"/social/friends/{BEN}/accept")
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}").json(), {"friendship": "outgoing"})

    # Blocks ----------------------------------------------------------------------------------------
    def test_block_ends_follows_friendships_and_requests_both_ways(self):
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.call("post", "ben", f"/social/friends/{ANA}/accept")
        self.call("post", "cat", f"/social/friends/{ANA}")  # pending request from Cat
        self.call("post", "cat", f"/social/follow/{ANA}")
        self.call("post", "ana", f"/social/blocks/{BEN}")
        self.call("post", "ana", f"/social/blocks/{CAT}")
        self.assertEqual(self.db.rows("follows"), [])
        self.assertEqual(self.db.rows("friendships"), [])
        # Neither can start again, and their earlier notifications are hidden.
        self.assertEqual(self.call("post", "ben", f"/social/follow/{ANA}").status_code, 404)
        self.assertEqual(self.call("post", "ben", f"/social/friends/{ANA}").status_code, 404)
        self.assertEqual(self.kinds("ana"), [])
        self.assertEqual(self.call("get", "ana", "/social/summary").json(), {"incoming_friend_requests": 0, "incoming_follow_requests": 0, "unread_notifications": 0})

    # Limits, pages, notifications ------------------------------------------------------------------
    def test_daily_limits(self):
        long_ago = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        recent = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.db.rows("social_rate_events").extend([{"id": i, "user_id": ANA, "action": "follow", "created_at": recent} for i in range(100)])
        self.db.rows("social_rate_events").extend([{"id": 200 + i, "user_id": ANA, "action": "friend_request", "created_at": long_ago} for i in range(30)])
        blocked = self.call("post", "ana", f"/social/follow/{BEN}")
        self.assertEqual((blocked.status_code, blocked.json()["detail"]), (429, "You've reached today's limit. Try again tomorrow."))
        self.assertEqual(self.call("post", "ana", f"/social/friends/{BEN}").status_code, 200)  # old ones don't count
        for row in self.db.rows("social_rate_events"):
            row["created_at"] = long_ago
        self.assertEqual(self.call("post", "ana", f"/social/follow/{BEN}").json(), {"status": "active"})

    def test_lists_page_with_a_cursor(self):
        start = datetime(2026, 11, 1, tzinfo=timezone.utc)
        for i in range(graph.PAGE + 5):
            uid = f"{i:08x}-1111-4000-8000-000000000000"
            self.db.rows("user_profiles").append({"id": uid, "username": f"user{i}", "name": f"User {i}"})
            self.db.rows("follows").append({"follower_id": uid, "followee_id": ANA, "status": "active", "created_at": (start + timedelta(minutes=i)).isoformat()})
        first = self.call("get", "ana", "/social/followers").json()
        self.assertEqual(len(first["items"]), graph.PAGE)
        self.assertEqual(first["items"][0]["username"], f"user{graph.PAGE + 4}")  # newest first
        second = self.call("get", "ana", "/social/followers", params={"cursor": first["next_cursor"]}).json()
        self.assertEqual(len(second["items"]), 5)
        self.assertIsNone(second["next_cursor"])
        self.assertFalse({p["username"] for p in first["items"]} & {p["username"] for p in second["items"]})

    def test_notifications_read_and_summary(self):
        self.call("post", "ben", f"/social/follow/{ANA}")
        self.call("post", "cat", f"/social/friends/{ANA}")
        items = self.call("get", "ana", "/notifications").json()["items"]
        self.assertEqual([(n["kind"], n["actor"]["username"], n["read"]) for n in items],
                         [("friend_request", "cat", False), ("follow", "ben", False)])
        self.assertEqual(self.call("get", "ana", "/social/summary").json()["unread_notifications"], 2)
        self.assertEqual(self.call("post", "ana", "/notifications/read", json={"ids": [items[1]["id"]]}).json(), {"read": 1})
        self.assertEqual(self.call("get", "ana", "/social/summary").json()["unread_notifications"], 1)
        self.call("post", "ana", "/notifications/read", json={"all": True})
        self.assertEqual(self.call("get", "ana", "/social/summary").json()["unread_notifications"], 0)
        # Someone else can't mark Ana's notifications.
        self.assertEqual(self.call("post", "ben", "/notifications/read", json={"ids": [items[0]["id"]]}).json(), {"read": 0})

    # Profiles --------------------------------------------------------------------------------------
    def test_profile_relationship_and_friends_visibility(self):
        self.set("ben", profile_visibility="friends", show_streak=True, university="City College")
        view = self.call("get", "ana", "/profiles/ben").json()
        self.assertTrue(view["limited"])
        self.assertNotIn("counts", view)
        self.assertEqual(view["relationship"], {"following": "none", "follows_you": False, "friendship": "none"})
        self.call("post", "ana", f"/social/friends/{BEN}")
        self.assertEqual(self.call("get", "ana", "/profiles/ben").json()["relationship"]["friendship"], "outgoing")
        self.assertEqual(self.call("get", "ben", "/profiles/ana").json()["relationship"]["friendship"], "incoming")
        self.call("post", "ben", f"/social/friends/{ANA}/accept")
        view = self.call("get", "ana", "/profiles/ben").json()
        self.assertFalse(view["limited"])
        self.assertEqual(view["school"], "City College")
        self.assertEqual(view["relationship"], {"following": "active", "follows_you": True, "friendship": "friends"})
        self.assertEqual(view["counts"], {"followers": 1, "following": 1, "friends": 1})
        self.assertTrue(self.call("get", "cat", "/profiles/ben").json()["limited"])  # not Cat's friend
        self.set("dan", allow_friend_requests="nobody", allow_follows="approval")
        dan = self.call("get", "ana", "/profiles/dan").json()
        self.assertEqual((dan["can_friend"], dan["friend_note"], dan["follows_need_approval"]), (False, "They aren't taking friend requests.", True))


if __name__ == "__main__":
    unittest.main()
