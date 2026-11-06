"""Discover (social plan, Stage 7) and the minors rules that came with it: ranking, every filter,
visibility and block exclusion, near-duplicate clustering, people and classrooms search, and each
is_minor rule (people search, profile page, "A classmate", private by default, follows)."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import discover  # noqa: E402

NOW = datetime(2026, 11, 6, 12, tzinfo=timezone.utc)
ANA = "aaaaaaaa-0000-4000-8000-000000000001"   # verified instructor (by email, in guide_quality)
BEN = "bbbbbbbb-0000-4000-8000-000000000002"   # student, Ana's friend
CAT = "cccccccc-0000-4000-8000-000000000003"   # minor
DAN = "dddddddd-0000-4000-8000-000000000004"   # blocked Ana
EVE = "eeeeeeee-0000-4000-8000-000000000005"   # the viewer, in a classroom with Ben
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN, "eve": EVE}
SCHOOL, OTHER_SCHOOL = "50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002"
BIO, LAW, BLOCKED = "c0000000-0000-4000-8000-000000000001", "c0000000-0000-4000-8000-000000000002", "c0000000-0000-4000-8000-000000000003"
F_BIO_ANA, F_BIO_BEN, F_LAW, F_BLOCKED = (f"f0000000-0000-4000-8000-00000000000{i}" for i in range(1, 5))


def gid(n):
    return f"10000000-0000-4000-8000-{n:012d}"


def qa(n):
    return "\n".join(f"Q{i}: Question {i}?\nA{i}: Answer {i}." for i in range(1, n + 1))


class DiscoverTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        self.relevance = None  # when set, the discover_guides RPC answers with these
        db = self.db

        def rpc(name, params):
            if name != "discover_guides" or self.relevance is None:
                raise RuntimeError("no such function")
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"id": k, "relevance": v} for k, v in self.relevance.items()]))
        db.rpc = rpc
        for name, uid in IDS.items():
            db.rows("user_profiles").append({"id": uid, "username": name, "display_name": name.title() + " Test", "name": name.title(),
                                             "profile_visibility": "public", "is_minor": name == "cat", "show_school": True, "university": "State U"})
        db.rows("friendships").append({"user_a": ANA, "user_b": BEN, "requested_by": ANA, "status": "accepted"})
        db.rows("user_blocks").append({"blocker_id": DAN, "blocked_id": EVE})
        db.rows("schools").extend([{"id": SCHOOL, "name": "State U"}, {"id": OTHER_SCHOOL, "name": "City College"}])
        db.rows("classes").extend([
            {"id": BIO, "school_id": SCHOOL, "course_code_normalized": "BIO 101", "display_name": "BIO 101", "sharing_blocked": False},
            {"id": LAW, "school_id": OTHER_SCHOOL, "course_code_normalized": "LAW 200", "display_name": "LAW 200", "sharing_blocked": False},
            {"id": BLOCKED, "school_id": SCHOOL, "course_code_normalized": "HIS 300", "display_name": "HIS 300", "sharing_blocked": True},
        ])
        db.rows("class_terms").extend([{"id": "t1", "class_id": LAW, "term": "2026 Spring"}])
        db.rows("folders").extend([
            {"id": F_BIO_ANA, "user_id": ANA, "class_id": BIO}, {"id": F_BIO_BEN, "user_id": BEN, "class_id": BIO},
            {"id": F_LAW, "user_id": BEN, "class_id": LAW}, {"id": F_BLOCKED, "user_id": ANA, "class_id": BLOCKED},
        ])
        base = {"flashcards": [], "attribution": "named", "visibility": "public", "review_status": "ok", "version": 1,
                "hold_reason": None, "forked_from_guide_id": None}
        self.guides = {
            1: {"user_id": ANA, "title": "Osmosis and diffusion", "notes": "Water crosses a membrane by osmosis", "study_guide": qa(25), "folder_id": F_BIO_ANA, "created_at": "2026-10-01T00:00:00+00:00"},
            2: {"user_id": BEN, "title": "Osmosis and diffusion review", "notes": "Water crosses a membrane by osmosis", "study_guide": qa(10), "folder_id": F_BIO_BEN, "created_at": "2026-10-20T00:00:00+00:00"},
            3: {"user_id": BEN, "title": "Contract formation", "notes": "Offer acceptance consideration", "study_guide": qa(70), "folder_id": F_LAW, "created_at": "2026-03-01T00:00:00+00:00"},
            4: {"user_id": CAT, "title": "Osmosis basics", "notes": "Cells and water", "study_guide": qa(5), "folder_id": None, "created_at": "2026-09-01T00:00:00+00:00"},
            5: {"user_id": DAN, "title": "Osmosis by Dan", "notes": "Blocked pair", "study_guide": qa(5), "folder_id": None, "created_at": "2026-10-01T00:00:00+00:00"},
            6: {"user_id": ANA, "title": "Osmosis private", "notes": "", "study_guide": qa(5), "folder_id": None, "visibility": "private", "created_at": "2026-10-01T00:00:00+00:00"},
            7: {"user_id": ANA, "title": "Osmosis link only", "notes": "", "study_guide": qa(5), "folder_id": None, "visibility": "link", "created_at": "2026-10-01T00:00:00+00:00"},
            8: {"user_id": ANA, "title": "Osmosis classroom only", "notes": "", "study_guide": qa(5), "folder_id": None, "visibility": "classroom", "created_at": "2026-10-01T00:00:00+00:00"},
            9: {"user_id": ANA, "title": "Osmosis held", "notes": "", "study_guide": qa(5), "folder_id": None, "review_status": "held", "created_at": "2026-10-01T00:00:00+00:00"},
            10: {"user_id": ANA, "title": "Osmosis in an opted-out course", "notes": "", "study_guide": qa(5), "folder_id": F_BLOCKED, "created_at": "2026-10-01T00:00:00+00:00"},
            11: {"user_id": BEN, "title": "Osmosis anonymous", "notes": "Anonymous set", "study_guide": qa(5), "folder_id": None, "attribution": "anonymous", "created_at": "2026-10-01T00:00:00+00:00"},
        }
        for n, g in self.guides.items():
            db.rows("study_guides").append({**base, **g, "id": gid(n)})
        db.rows("guide_quality").extend([
            {"guide_id": gid(1), "studied_by": 40, "mastery": 0.7, "retention_7d": 0.6, "reports": 0, "changed_at": "2026-10-30T00:00:00+00:00", "verified_instructor": True},
            {"guide_id": gid(2), "studied_by": 2, "mastery": 0.3, "retention_7d": None, "reports": 0, "changed_at": "2026-10-20T00:00:00+00:00", "verified_instructor": False},
            {"guide_id": gid(3), "studied_by": 5, "mastery": 0.5, "retention_7d": 0.5, "reports": 0, "changed_at": "2026-03-01T00:00:00+00:00", "verified_instructor": False},
        ])
        db.rows("classrooms").append({"id": "r1", "name": "Bio study group", "kind": "study_group", "visibility": "public", "archived_at": None,
                                      "owner_id": BEN, "class_id": BIO, "join_policy": "auto"})
        db.rows("classrooms").append({"id": "r2", "name": "Dan's bio group", "kind": "study_group", "visibility": "public", "archived_at": None,
                                      "owner_id": DAN, "class_id": BIO, "join_policy": "auto"})
        db.rows("classrooms").append({"id": "r3", "name": "Bio private group", "kind": "study_group", "visibility": "unlisted", "archived_at": None,
                                      "owner_id": BEN, "class_id": BIO, "join_policy": "auto"})
        db.rows("classroom_members").extend([
            {"classroom_id": "r1", "user_id": BEN, "role": "owner", "status": "active"},
            {"classroom_id": "r1", "user_id": EVE, "role": "member", "status": "active"},
        ])

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        modules = ("discover", "profiles", "social", "guide_sharing")
        self.patches = [patch(f"routers.{m}.get_user_id", side_effect=who) for m in modules]
        self.patches += [patch(f"routers.{m}.get_supabase", return_value=self.db) for m in modules]
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true"})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def find(self, who="eve", **params):
        response = self.client.get("/discover/guides", params=params, headers={"Authorization": f"Bearer {who}"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def titles(self, **params):
        return [g["title"] for g in self.find(**params)["guides"]]

    # Visibility -----------------------------------------------------------------------------------
    def test_only_public_unheld_guides_outside_opted_out_courses_and_blocks(self):
        titles = self.titles(q="osmosis")
        for hidden in ("Osmosis private", "Osmosis link only", "Osmosis classroom only", "Osmosis held",
                       "Osmosis in an opted-out course", "Osmosis by Dan"):
            self.assertNotIn(hidden, titles)
        self.assertIn("Osmosis basics", titles)
        # Even when the search function returns them (defence in depth), they stay out.
        self.relevance = {gid(n): 0.9 for n in (6, 7, 8, 9, 10, 5, 4)}
        self.assertEqual(self.titles(q="osmosis"), ["Osmosis basics"])

    def test_blocks_hide_both_ways(self):
        self.assertNotIn("Osmosis by Dan", self.titles(who="eve", q="osmosis"))  # Dan blocked Eve
        self.db.rows("user_blocks").append({"blocker_id": EVE, "blocked_id": BEN})
        self.assertFalse([t for t in self.titles(q="") if t.startswith("Contract")])
        self.assertEqual(self.client.get("/discover/guides", headers={}).status_code, 401)

    # Ranking --------------------------------------------------------------------------------------
    def test_rank_is_relevance_times_quality(self):
        # Equal relevance: quality decides (40 studiers, verified instructor beats 2 studiers).
        self.relevance = {gid(1): 0.5, gid(2): 0.5}
        guides = self.find(q="osmosis")["guides"]
        self.assertEqual(guides[0]["title"], "Osmosis and diffusion")
        # Much better text match wins over quality.
        self.relevance = {gid(1): 0.05, gid(3): 0.9}
        self.assertEqual(self.titles(q="contract")[0], "Contract formation")
        self.assertGreater(discover.quality(self.db.rows("guide_quality")[0], NOW), discover.quality(self.db.rows("guide_quality")[1], NOW))
        self.assertEqual(discover.quality(None), 1.0)
        reported = {**self.db.rows("guide_quality")[1], "reports": 2}
        self.assertLess(discover.quality(reported, NOW), discover.quality(self.db.rows("guide_quality")[1], NOW))

    def test_cards_show_studied_by_course_term_and_safe_authors(self):
        guides = {g["title"]: g for g in self.find(q="")["guides"]}
        top = guides["Osmosis and diffusion"]
        self.assertEqual((top["studied_by"], top["course"]["code"], top["course"]["school"], top["verified"]), (40, "BIO 101", "State U", True))
        self.assertEqual(top["author"]["username"], "ana")
        self.assertNotIn("user_id", top["author"])
        self.assertEqual(guides["Osmosis basics"]["author"], {"username": None, "display_name": "A classmate", "initials": "AC"})
        self.assertIsNone(guides["Osmosis anonymous"]["author"])
        self.assertEqual(guides["Contract formation"]["term"], "Spring 2026")      # the class's term
        self.assertEqual(guides["Osmosis basics"]["term"], "Fall 2026")            # no class: September -> Fall

    # Clustering -----------------------------------------------------------------------------------
    def test_near_duplicates_in_the_same_course_fold_into_the_best(self):
        guides = self.find(q="osmosis")["guides"]
        top = next(g for g in guides if g["title"] == "Osmosis and diffusion")
        self.assertEqual([s["title"] for s in top["similar"]], ["Osmosis and diffusion review"])
        self.assertNotIn("Osmosis and diffusion review", [g["title"] for g in guides])
        # Different courses never fold together, however alike.
        self.db.rows("study_guides")[1]["folder_id"] = F_LAW
        self.assertIn("Osmosis and diffusion review", self.titles(q="osmosis"))

    # Filters --------------------------------------------------------------------------------------
    def test_school_and_course_filters(self):
        self.assertEqual(sorted(self.titles(school=OTHER_SCHOOL)), ["Contract formation"])
        self.assertEqual(self.titles(course=BIO), ["Osmosis and diffusion"])  # with its similar folded in
        facets = self.find(q="")["facets"]
        self.assertEqual({c["name"] for c in facets["courses"]}, {"BIO 101", "LAW 200"})
        self.assertEqual(self.client.get("/discover/guides?school=nope", headers={"Authorization": "Bearer eve"}).status_code, 400)

    def test_term_filter_uses_the_class_term_or_the_semester(self):
        self.assertEqual(self.titles(term="Spring 2026"), ["Contract formation"])
        self.assertIn("Osmosis basics", self.titles(term="fall 2026"))
        self.assertNotIn("Contract formation", self.titles(term="Fall 2026"))
        self.assertEqual(discover.term_label("2026 FALL"), "Fall 2026")
        self.assertEqual(discover.semester_of("2026-06-15T00:00:00Z"), "Summer 2026")
        self.assertEqual(discover.semester_of("2026-12-01T00:00:00Z"), "Fall 2026")
        self.assertEqual(discover.semester_of("2026-05-31T00:00:00Z"), "Spring 2026")

    def test_creator_type_skips_anonymous_and_minors(self):
        self.assertEqual(self.titles(creator_type="instructor"), ["Osmosis and diffusion"])
        students = self.titles(creator_type="student")
        self.assertIn("Contract formation", students)
        for hidden in ("Osmosis basics", "Osmosis anonymous", "Osmosis and diffusion"):
            self.assertNotIn(hidden, students)

    def test_size_updated_within_and_from_my_classrooms(self):
        self.assertEqual(self.titles(size="long"), ["Contract formation"])
        self.assertIn("Osmosis and diffusion", self.titles(size="medium"))
        self.assertNotIn("Contract formation", self.titles(size="short"))
        with patch("services.discover.datetime") as clock:
            clock.now.return_value = NOW
            clock.fromisoformat = datetime.fromisoformat
            recent = self.titles(updated_within=30)
        self.assertIn("Osmosis and diffusion", recent)
        self.assertNotIn("Contract formation", recent)
        # Eve shares a classroom with Ben: Ben's named guides only (never the anonymous one).
        mine = self.titles(from_my_classrooms="true")
        self.assertIn("Contract formation", mine)
        self.assertNotIn("Osmosis anonymous", mine)
        self.assertNotIn("Osmosis basics", mine)

    # People and classrooms --------------------------------------------------------------------------
    def test_people_search_public_only_no_minors_no_blocks(self):
        def people(q, who="eve"):
            r = self.client.get("/discover/people", params={"q": q}, headers={"Authorization": f"Bearer {who}"})
            self.assertEqual(r.status_code, 200, r.text)
            return [p["username"] for p in r.json()["people"]]
        self.assertEqual(people("ana"), ["ana"])
        self.assertEqual(people("cat"), [])           # a minor never shows
        self.assertEqual(people("dan"), [])           # blocked pair
        self.db.rows("user_profiles")[1]["profile_visibility"] = "friends"
        self.assertEqual(people("ben"), [])           # not public
        self.assertEqual(people("a"), [])             # too short to search
        self.assertNotIn("user_id", self.client.get("/discover/people?q=ana", headers={"Authorization": "Bearer eve"}).json()["people"][0])

    def test_classroom_search_public_only_no_blocked_owners(self):
        r = self.client.get("/discover/classrooms", params={"q": "bio"}, headers={"Authorization": "Bearer eve"})
        self.assertEqual([c["name"] for c in r.json()["classrooms"]], ["Bio study group"])
        self.assertEqual(r.json()["classrooms"][0]["my_status"], "active")
        with patch.dict(os.environ, {"CLASSROOMS": ""}):
            self.assertEqual(self.client.get("/discover/classrooms", headers={"Authorization": "Bearer eve"}).json()["classrooms"], [])

    def test_works_before_the_migration(self):
        self.db.tables.pop("guide_quality")
        guides = self.find(q="osmosis")["guides"]
        self.assertTrue(guides)
        self.assertTrue(all(g["verified"] is False for g in guides))
        self.assertEqual(self.titles(creator_type="instructor"), [])


class MinorsRulesTests(DiscoverTests):
    """Each is_minor rule on its own route (Cat is the minor; Ana is Cat's friend in these tests)."""
    def setUp(self):
        super().setUp()
        self.db.rows("friendships").append({"user_a": ANA, "user_b": CAT, "requested_by": ANA, "status": "accepted"})

    def test_profile_visible_only_to_self_and_friends(self):
        get = lambda who: self.client.get("/profiles/cat", headers={"Authorization": f"Bearer {who}"}).status_code
        self.assertEqual(get("eve"), 404)
        self.assertEqual(get("ana"), 200)
        self.assertEqual(get("cat"), 200)

    def test_only_friends_can_follow(self):
        follow = lambda who: self.client.post(f"/social/follow/{CAT}", headers={"Authorization": f"Bearer {who}"})
        self.assertEqual(follow("eve").status_code, 403)
        self.assertEqual(follow("ana").status_code, 200)
        self.assertEqual(self.client.post(f"/social/follow/{BEN}", headers={"Authorization": "Bearer eve"}).status_code, 200)

    def test_public_sets_name_them_a_classmate(self):
        card = self.client.get(f"/guides/{gid(4)}/public", headers={"Authorization": "Bearer eve"}).json()["guide"]
        self.assertEqual(card["author"]["display_name"], "A classmate")
        self.assertIsNone(card["author"]["username"])
        other = self.client.get(f"/guides/{gid(1)}/public", headers={"Authorization": "Bearer eve"}).json()["guide"]
        self.assertEqual(other["author"]["username"], "ana")

    def test_new_sets_start_private(self):
        from routers import guides
        for row in self.db.rows("user_profiles"):
            row["honor_code_accepted_at"] = "2026-10-01T00:00:00+00:00"
        self.db.rows("study_guides").append({"id": gid(20), "user_id": CAT, "title": "New", "visibility": "private", "folder_id": None})
        self.db.rows("study_guides").append({"id": gid(21), "user_id": BEN, "title": "New", "visibility": "private", "folder_id": None,
                                             "notes": "", "study_guide": "", "review_status": "ok"})
        with patch("routers.guides.get_supabase", return_value=self.db):
            guides._publish_new(self.db, CAT, dict(self.db.rows("study_guides")[-2]))
            guides._publish_new(self.db, BEN, dict(self.db.rows("study_guides")[-1]))
        by_id = {g["id"]: g for g in self.db.rows("study_guides")}
        self.assertEqual(by_id[gid(20)]["visibility"], "private")
        self.assertEqual(by_id[gid(21)]["visibility"], "public")

    def test_people_search_leaves_them_out_even_for_friends(self):
        r = self.client.get("/discover/people", params={"q": "cat"}, headers={"Authorization": "Bearer ana"})
        self.assertEqual(r.json()["people"], [])


if __name__ == "__main__":
    unittest.main()
