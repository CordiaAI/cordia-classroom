"""Usernames, profiles, privacy and blocking (social plan, Stage 1)."""
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
from services import usernames  # noqa: E402
from services.blocks import hidden_from, is_blocked  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"
BEN = "bbbbbbbb-0000-4000-8000-000000000002"
CAT = "cccccccc-0000-4000-8000-000000000003"
USERS = {"Bearer ana": ANA, "Bearer ben": BEN, "Bearer cat": CAT}


def auth(name):
    return {"Authorization": f"Bearer {name}"}


def ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class UsernameRuleTests(unittest.TestCase):
    def test_format(self):
        for good in ("ana", "ana.smith", "ana_s99", "a" * 24, "badminton_fan", "model"):
            self.assertIsNone(usernames.format_problem(good), good)
        self.assertEqual(usernames.format_problem("ab"), "Use at least 3 characters.")
        self.assertEqual(usernames.format_problem("a" * 25), "Use 24 characters or fewer.")
        for bad in ("ana smith", "ana-smith", "ana!", "anä"):
            self.assertEqual(usernames.format_problem(bad), "Use only letters, numbers, _ and .", bad)
        self.assertEqual(usernames.normalize("  @Ana.Smith "), "ana.smith")

    def test_reserved_words(self):
        for name in ("admin", "support", "cordia", "settings", "api", "sets", "classrooms", "join", "search",
                     "friends", "library", "dashboard", "guide", "tutor", "u"):
            self.assertIsNotNone(usernames.format_problem(name), name)
        for name in ("admin_jo", "jo.support", "cordia_help", "thecordiateam", "staff2", "official.ana"):
            self.assertEqual(usernames.format_problem(name), "That username is reserved.", name)
        self.assertIsNone(usernames.format_problem("badminton"))  # "admin" inside a word is fine


class ProfileApiTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for uid, name, school in ((ANA, "Ana Lopez", "State University"), (BEN, "Ben Ito", "City College"), (CAT, "Cat Moss", "")):
            self.db.rows("user_profiles").append({"id": uid, "name": name, "email": f"{name.split()[0].lower()}@example.edu", "university": school})
        self.db.rows("user_streaks").append({"user_id": ANA, "current_streak": 6, "last_study_date": datetime.now(timezone.utc).date().isoformat()})
        self.client = TestClient(main.app)
        self.patches = route_patches(("profiles", "social"), lambda header: USERS[header], self.db)
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def claim(self, who, name):
        return self.client.post("/profiles/me/username", headers=auth(who), json={"username": name})

    def profile(self, who):
        return next(r for r in self.db.rows("user_profiles") if r["id"] == USERS[f"Bearer {who}"])

    # Claiming and checking -------------------------------------------------------------------------
    def test_claim_check_and_suggestions(self):
        me = self.client.get("/profiles/me", headers=auth("ana")).json()
        self.assertIsNone(me["username"])
        self.assertTrue(me["suggestions"])
        self.assertTrue(all(usernames.format_problem(s) is None for s in me["suggestions"]))
        self.assertEqual(self.client.get("/profiles/check-username", params={"u": "Ana.Lopez"}, headers=auth("ana")).json(),
                         {"username": "ana.lopez", "available": True, "reason": None})
        response = self.claim("ana", "Ana.Lopez")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "ana.lopez")
        self.assertIsNone(self.profile("ana").get("username_changed_at"))  # the first claim isn't a change
        taken = self.client.get("/profiles/check-username", params={"u": "ana.lopez"}, headers=auth("ben")).json()
        self.assertEqual((taken["available"], taken["reason"]), (False, "That username is taken."))
        self.assertEqual(self.claim("ben", "ANA.LOPEZ").status_code, 409)
        self.assertEqual(self.claim("ben", "admin").status_code, 400)
        self.assertEqual(self.claim("ben", "b").json()["detail"], "Use at least 3 characters.")

    def test_thirty_day_limit(self):
        self.claim("ana", "ana")
        self.assertEqual(self.claim("ana", "ana.two").status_code, 200)  # one change right after claiming
        blocked = self.claim("ana", "ana.three")
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("You can change your username again on", blocked.json()["detail"])
        self.assertIsNotNone(self.client.get("/profiles/me", headers=auth("ana")).json()["can_change_username_at"])
        self.profile("ana")["username_changed_at"] = ago(31)
        self.assertEqual(self.claim("ana", "ana.three").status_code, 200)
        self.assertEqual(self.claim("ana", "ana.three").status_code, 200)  # same name again is a no-op

    def test_old_username_redirects_for_90_days_and_is_held(self):
        self.claim("ana", "ana")
        self.claim("ana", "ana.new")
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("ben")).json(), {"redirect": "ana.new"})
        self.assertEqual(self.claim("ben", "ana").status_code, 409)  # held for its owner
        self.db.rows("username_history")[0]["released_at"] = ago(91)
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("ben")).status_code, 404)
        self.assertEqual(self.claim("ben", "ana").status_code, 200)

    def test_taking_back_your_old_name_ends_the_hold(self):
        self.claim("ana", "ana")
        self.claim("ana", "ana.new")
        self.profile("ana")["username_changed_at"] = ago(31)
        self.assertEqual(self.claim("ana", "ana").status_code, 200)
        self.assertEqual([r["old_username"] for r in self.db.rows("username_history")], ["ana.new"])

    # Privacy ---------------------------------------------------------------------------------------
    def test_public_profile_shows_only_what_the_owner_allows(self):
        self.claim("ana", "ana")
        view = self.client.get("/profiles/ana", headers=auth("ben")).json()
        self.assertEqual(view["display_name"], "Ana")
        self.assertEqual(view["school"], "State University")
        self.assertFalse(view["limited"])
        for hidden in ("streak", "real_name", "email", "timezone"):
            self.assertNotIn(hidden, view)
        self.client.patch("/profiles/me", headers=auth("ana"), json={"show_streak": True, "show_school": False, "show_real_name": True, "display_name": "  Ana   L. "})
        view = self.client.get("/profiles/ana", headers=auth("ben")).json()
        self.assertEqual((view["streak"], view["real_name"], view["display_name"]), (6, "Ana Lopez", "Ana L."))
        self.assertNotIn("school", view)

    def test_private_and_friends_profiles_show_only_basics(self):
        self.claim("ana", "ana")
        self.client.patch("/profiles/me", headers=auth("ana"), json={"show_streak": True, "show_real_name": True})
        for visibility in ("private", "friends"):
            self.client.patch("/profiles/me", headers=auth("ana"), json={"profile_visibility": visibility})
            view = self.client.get("/profiles/ana", headers=auth("ben")).json()
            self.assertTrue(view["limited"])
            # Besides the lists, only the basics and the viewer's own standing with them (Stage 2).
            viewer_state = ("relationship", "can_follow", "follows_need_approval", "can_friend", "friend_note")
            self.assertEqual({k for k in view if k not in ("guides", "folders", "classrooms", "badges") + viewer_state},
                             {"id", "username", "display_name", "initials", "is_self", "limited"})
            own = self.client.get("/profiles/ana", headers=auth("ana")).json()
            self.assertTrue(own["is_self"])
            self.assertFalse(own["limited"])
            self.assertEqual(own["streak"], 6)

    def test_settings_are_validated(self):
        self.assertEqual(self.client.patch("/profiles/me", headers=auth("ana"), json={"profile_visibility": "everyone"}).status_code, 422)
        self.assertEqual(self.client.patch("/profiles/me", headers=auth("ana"), json={"allow_friend_requests": "all"}).status_code, 422)
        self.assertEqual(self.client.patch("/profiles/me", headers=auth("ana"), json={"display_name": "x" * 51}).status_code, 422)
        out = self.client.patch("/profiles/me", headers=auth("ana"), json={"allow_follows": "approval", "allow_friend_requests": "friends_of_friends"}).json()
        self.assertEqual((out["allow_follows"], out["allow_friend_requests"]), ("approval", "friends_of_friends"))
        self.assertEqual(self.client.patch("/profiles/me", headers=auth("ana"), json={"display_name": ""}).json()["display_name"], None)

    def test_unknown_reserved_or_malformed_names_are_404(self):
        for name in ("nobody", "admin", "a b", "x"):
            self.assertEqual(self.client.get(f"/profiles/{name}", headers=auth("ana")).status_code, 404, name)

    # Blocking --------------------------------------------------------------------------------------
    def test_block_is_symmetric_and_hides_profiles_both_ways(self):
        self.claim("ana", "ana")
        self.claim("ben", "ben")
        self.assertEqual(self.client.post(f"/social/blocks/{BEN}", headers=auth("ana")).json(), {"blocked": True})
        self.assertTrue(is_blocked(self.db, ANA, BEN) and is_blocked(self.db, BEN, ANA))
        self.assertEqual(hidden_from(self.db, BEN), {ANA})
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("ben")).status_code, 404)
        self.assertEqual(self.client.get("/profiles/ben", headers=auth("ana")).status_code, 404)
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("cat")).status_code, 200)
        listed = self.client.get("/social/blocks", headers=auth("ana")).json()["blocks"]
        self.assertEqual([(b["user_id"], b["username"]) for b in listed], [(BEN, "ben")])
        self.assertEqual(self.client.get("/social/blocks", headers=auth("ben")).json()["blocks"], [])  # they aren't told
        self.client.post(f"/social/blocks/{BEN}", headers=auth("ana"))  # twice is fine
        self.assertEqual(len(self.db.rows("user_blocks")), 1)
        self.assertEqual(self.client.delete(f"/social/blocks/{BEN}", headers=auth("ana")).json(), {"blocked": False})
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("ben")).status_code, 200)

    def test_blocked_user_gets_404_for_a_redirect_too(self):
        self.claim("ana", "ana")
        self.claim("ana", "ana.new")
        self.client.post(f"/social/blocks/{ANA}", headers=auth("ben"))
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("ben")).status_code, 404)
        self.assertEqual(self.client.get("/profiles/ana", headers=auth("cat")).json(), {"redirect": "ana.new"})

    def test_block_checks(self):
        self.assertEqual(self.client.post(f"/social/blocks/{ANA}", headers=auth("ana")).status_code, 400)
        self.assertEqual(self.client.post("/social/blocks/not-a-uuid", headers=auth("ana")).status_code, 400)
        self.assertEqual(self.client.post("/social/blocks/dddddddd-0000-4000-8000-000000000004", headers=auth("ana")).status_code, 404)

    def test_block_writes_are_rate_limited(self):
        codes = [self.client.post(f"/social/blocks/{BEN}", headers=auth("ana")).status_code for _ in range(21)]
        self.assertEqual(codes[-1], 429)


if __name__ == "__main__":
    unittest.main()
