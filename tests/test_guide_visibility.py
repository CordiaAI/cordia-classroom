"""Guide visibility, the public guide page, saves and copies (social plan, Stage 3)."""
from pathlib import Path
import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402
from services import sharing  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"   # the owner
BEN = "bbbbbbbb-0000-4000-8000-000000000002"   # Ana's friend and classmate
CAT = "cccccccc-0000-4000-8000-000000000003"   # a stranger, not in the class
DAN = "dddddddd-0000-4000-8000-000000000004"   # a classmate Ana blocked
EVE = "eeeeeeee-0000-4000-8000-000000000005"   # an admin
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN, "eve": EVE}
CLASS = "c0000000-0000-4000-8000-000000000001"
BLOCKED_CLASS = "c0000000-0000-4000-8000-000000000002"
TERM = "70000000-0000-4000-8000-000000000001"
FOLDER = "f0000000-0000-4000-8000-000000000001"
BLOCKED_FOLDER = "f0000000-0000-4000-8000-000000000002"
GUIDE = "10000000-0000-4000-8000-000000000001"
MODULES = ("guide_sharing", "guides", "profiles", "public_forms", "admin", "classes")


def auth(name):
    return {"Authorization": f"Bearer {name}"} if name else {}


class GuideVisibilityTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for name, uid in IDS.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title() + " Test",
                                                   "profile_visibility": "public"})
        self.db.rows("app_admins").append({"user_id": EVE})
        self.db.rows("classes").extend([
            {"id": CLASS, "course_code_normalized": "MGT 300", "sharing_blocked": False},
            {"id": BLOCKED_CLASS, "course_code_normalized": "FILM 201", "sharing_blocked": True},
        ])
        self.db.rows("class_terms").append({"id": TERM, "class_id": CLASS, "term": "FA26"})
        for uid in (ANA, BEN, DAN):
            self.db.rows("class_memberships").append({"user_id": uid, "class_term_id": TERM})
        self.db.rows("folders").extend([{"id": FOLDER, "user_id": ANA, "class_id": CLASS},
                                        {"id": BLOCKED_FOLDER, "user_id": ANA, "class_id": BLOCKED_CLASS}])
        self.db.rows("friendships").append({"user_a": ANA, "user_b": BEN, "requested_by": ANA, "status": "accepted"})
        self.db.rows("user_blocks").append({"blocker_id": ANA, "blocked_id": DAN})
        self.db.rows("study_guides").append(self.guide(GUIDE))
        self.client = TestClient(main.app)

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        self.patches = [patch(f"routers.{m}.get_user_id", side_effect=who) for m in MODULES]
        self.patches += [patch(f"routers.{m}.get_supabase", return_value=self.db) for m in MODULES]
        self.patches += [patch("routers.quiz.start_quiz_warmup"), patch("routers.guides.start_quiz_warmup")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def guide(self, guide_id, **fields):
        return {"id": guide_id, "user_id": ANA, "title": "Supply chains", "notes": "# Supply chains\nLead time\n[IMG:x]\nSafety stock",
                "study_guide": "Q: What is lead time?\nA: The wait between order and delivery.", "flashcards": [],
                "flashcard_progress": {"0": {"box": 3}}, "folder_id": FOLDER, "visibility": "private", "attribution": "named",
                "version": 1, "review_status": "ok", "hold_reason": None, "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00",
                **fields}

    def row(self, guide_id=GUIDE):
        return next(g for g in self.db.rows("study_guides") if g["id"] == guide_id)

    def call(self, method, who, path, **kw):
        return getattr(self.client, method)(path, headers=auth(who), **kw)

    def accept_honor_code(self, uid=ANA):
        next(r for r in self.db.rows("user_profiles") if r["id"] == uid)["honor_code_accepted_at"] = "2026-11-01T00:00:00+00:00"

    # The matrix -------------------------------------------------------------------------------------
    def test_visibility_matrix(self):
        expected = {
            #            private link classroom public
            "ana": (200, 200, 200, 200),
            "ben": (404, 200, 200, 200),   # friend and classmate
            "cat": (404, 200, 404, 200),   # stranger outside the class
            "dan": (404, 404, 404, 404),   # blocked, even though he's in the class
            None: (404, 200, 404, 200),    # signed out
        }
        for column, visibility in enumerate(("private", "link", "classroom", "public")):
            self.row()["visibility"] = visibility
            for viewer, statuses in expected.items():
                with self.subTest(visibility=visibility, viewer=viewer):
                    response = self.call("get", viewer, f"/guides/{GUIDE}/public")
                    self.assertEqual(response.status_code, statuses[column])
                    if response.status_code == 404:
                        self.assertEqual(response.json()["detail"], "Guide not found")

    def test_the_block_hides_it_in_both_directions(self):
        self.row()["visibility"] = "public"
        self.db.rows("user_blocks").append({"blocker_id": CAT, "blocked_id": ANA})
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 404)

    def test_held_hidden_and_opted_out_guides_show_only_to_the_owner(self):
        self.row()["visibility"] = "public"
        for change in ({"review_status": "held", "hold_reason": "Copyright report"}, {"review_status": "hidden"},
                       {"review_status": "ok", "folder_id": BLOCKED_FOLDER}):
            self.row().update(change)
            with self.subTest(change=change):
                self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 404)
                self.assertEqual(self.call("get", None, f"/guides/{GUIDE}/public").status_code, 404)
                mine = self.call("get", "ana", f"/guides/{GUIDE}/public")
                self.assertEqual(mine.status_code, 200)
                self.assertTrue(mine.json()["guide"]["is_owner"])

    def test_bad_ids_are_rejected(self):
        self.assertEqual(self.call("get", None, "/guides/not-a-uuid/public").status_code, 400)
        self.assertEqual(self.call("get", None, "/guides/10000000-0000-4000-8000-00000000ffff/public").status_code, 404)

    # What the page carries --------------------------------------------------------------------------
    def test_public_card(self):
        self.row().update({"visibility": "public"})
        self.db.rows("guide_saves").append({"user_id": CAT, "guide_id": GUIDE, "pinned_version": 1})
        guide = self.call("get", "ben", f"/guides/{GUIDE}/public").json()["guide"]
        self.assertEqual(guide["title"], "Supply chains")
        self.assertEqual(guide["question_count"], 1)
        self.assertEqual(guide["outline"], ["# Supply chains", "Lead time", "Safety stock"])
        self.assertEqual(guide["studied_by"], 1)
        self.assertEqual(sorted(guide["author"]), ["display_name", "initials", "username", "verified"])
        self.assertFalse(guide["author"]["verified"], "verified only for a confirmed instructor email (Stage 8)")
        self.assertEqual(guide["author"]["username"], "ana")
        self.assertFalse(guide["is_owner"])
        self.assertFalse(guide["saved"])
        for key in ("user_id", "folder_id", "flashcard_progress", "notes", "study_guide", "review_status"):
            self.assertNotIn(key, guide)

    def test_anonymous_guides_leak_nothing_about_the_author(self):
        self.row().update({"visibility": "public", "attribution": "anonymous"})
        for viewer in ("ben", "cat", None):
            with self.subTest(viewer=viewer):
                payload = self.call("get", viewer, f"/guides/{GUIDE}/public").json()
                self.assertIsNone(payload["guide"]["author"])
                text = json.dumps(payload).lower()
                for secret in (ANA, "ana test", '"ana"', "@ana"):
                    self.assertNotIn(secret, text)
        self.call("post", "ben", f"/guides/{GUIDE}/save")
        saved = json.dumps(self.call("get", "ben", "/guides/saved").json()).lower()
        self.assertNotIn(ANA, saved)
        self.assertNotIn("ana test", saved)
        # Its class set snapshot carries no name either, even with "show my first name" on.
        self.db.rows("sharing_settings").append({"user_id": ANA, "show_first_name": True})
        with patch.object(sharing, "first_name", return_value="Ana"):
            snapshot = sharing.upsert_share(self.db, ANA, {"id": GUIDE, "title": "Supply chains", "study_guide": "", "flashcards": []}, CLASS, "class")
        self.assertIsNone(snapshot["owner_name"])
        # And the profile's Guides tab doesn't list it.
        self.assertEqual(self.call("get", "cat", "/profiles/ana").json()["guides"], [])

    def test_profile_lists_public_named_guides(self):
        self.row().update({"visibility": "public"})
        self.db.rows("study_guides").append(self.guide("10000000-0000-4000-8000-000000000002", visibility="link"))
        self.db.rows("study_guides").append(self.guide("10000000-0000-4000-8000-000000000003", visibility="public", review_status="held"))
        guides = self.call("get", "cat", "/profiles/ana").json()["guides"]
        self.assertEqual([g["id"] for g in guides], [GUIDE])
        self.assertEqual(guides[0]["question_count"], 1)

    # Visibility changes -----------------------------------------------------------------------------
    def test_honor_code_gate(self):
        for visibility in ("public", "link"):
            with self.subTest(visibility=visibility):
                response = self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": visibility})
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.json()["detail"], "honor_code_required")
                self.assertEqual(self.row()["visibility"], "private")
        # Class-only sharing doesn't need it.
        self.assertEqual(self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "classroom"}).status_code, 200)
        accepted = self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "public", "accept_honor_code": True})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["visibility"], "public")
        profile = next(r for r in self.db.rows("user_profiles") if r["id"] == ANA)
        self.assertTrue(profile["honor_code_accepted_at"])
        # Once is enough.
        self.assertEqual(self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "link"}).status_code, 200)
        self.assertTrue(self.call("get", "ana", "/profiles/me").json()["honor_code_accepted"])

    def test_only_the_owner_changes_visibility(self):
        self.accept_honor_code(BEN)
        response = self.call("patch", "ben", f"/guides/{GUIDE}/visibility", json={"visibility": "public"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.row()["visibility"], "private")

    def test_class_rules(self):
        self.accept_honor_code()
        self.row()["folder_id"] = None
        self.assertEqual(self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "classroom"}).status_code, 400)
        self.row()["folder_id"] = BLOCKED_FOLDER
        response = self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "public"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "private"}).status_code, 200)

    def test_class_sets_stay_in_step(self):
        self.accept_honor_code()
        self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "public"})
        shared = self.db.rows("shared_sets")[0]
        self.assertEqual((shared["visibility"], shared["class_id"], shared["status"]), ("class", CLASS, "visible"))
        self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "link"})
        self.assertEqual(self.db.rows("shared_sets")[0]["visibility"], "private")
        self.assertEqual(self.row()["visibility"], "link")  # the old switch never overrides the chip
        self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "classroom"})
        self.assertEqual(self.db.rows("shared_sets")[0]["visibility"], "class")
        # The old class-sharing switch moves the guide between private and class-only.
        sharing.upsert_share(self.db, ANA, self.row(), CLASS, "private")
        self.assertEqual(self.row()["visibility"], "private")
        sharing.upsert_share(self.db, ANA, self.row(), CLASS, "class")
        self.assertEqual(self.row()["visibility"], "classroom")

    def test_attribution_toggle(self):
        response = self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"attribution": "anonymous"})
        self.assertEqual(response.json()["attribution"], "anonymous")
        self.assertEqual(self.row()["attribution"], "anonymous")
        self.assertEqual(self.row()["visibility"], "private")

    def test_leak_check_holds_and_releases(self):
        self.accept_honor_code()
        self.row()["title"] = "Midterm answer key"
        response = self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "public"}).json()
        self.assertEqual((response["review_status"], response["hold_reason"]), ("held", "Looks like an exam or answer key"))
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 404)
        # Fixing the title through the normal editor lifts the check's own hold.
        self.call("patch", "ana", f"/guides/{GUIDE}", json={"title": "Supply chains"})
        self.assertEqual(self.row()["review_status"], "ok")
        self.assertEqual(self.row()["version"], 2)
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 200)

    def test_renaming_is_screened_too(self):
        self.accept_honor_code()
        self.call("patch", "ana", f"/guides/{GUIDE}/visibility", json={"visibility": "public"})
        self.call("patch", "ana", f"/guides/{GUIDE}/rename", json={"title": "Final exam answer key"})
        self.assertEqual((self.row()["review_status"], self.row()["version"]), ("held", 2))

    def test_edits_make_a_new_version(self):
        self.call("patch", "ana", f"/guides/{GUIDE}", json={"title": "Supply chains", "notes": "new"})
        self.assertEqual(self.row()["version"], 2)
        self.call("patch", "ana", f"/guides/{GUIDE}", json={"title": "Supply chains", "folder_id": FOLDER})
        self.assertEqual(self.row()["version"], 3)  # title is always sent by the editor

    # New guides -------------------------------------------------------------------------------------
    def test_new_guides_default_public_only_after_the_honor_code(self):
        body = {"title": "Cell biology", "keep_title": True, "notes": "Cells", "share_default": True}
        first = self.call("post", "ana", "/guides", json=body).json()["guide"]
        self.assertEqual(first.get("visibility", "private"), "private")
        self.accept_honor_code()
        second = self.call("post", "ana", "/guides", json=body).json()["guide"]
        self.assertEqual((second["visibility"], second["attribution"]), ("public", "named"))
        plain = self.call("post", "ana", "/guides", json={**body, "share_default": False}).json()["guide"]
        self.assertEqual(plain.get("visibility", "private"), "private")
        opted_out = self.call("post", "ana", "/guides", json={**body, "folder_id": BLOCKED_FOLDER}).json()["guide"]
        self.assertEqual(opted_out.get("visibility", "private"), "private")

    # Saving -----------------------------------------------------------------------------------------
    def test_save_and_saved_list(self):
        self.row().update({"visibility": "public", "version": 4})
        self.assertEqual(self.call("post", "ben", f"/guides/{GUIDE}/save").json(), {"saved": True})
        self.call("post", "ben", f"/guides/{GUIDE}/save")  # twice is still one save
        self.assertEqual(len(self.db.rows("guide_saves")), 1)
        self.assertEqual(self.db.rows("guide_saves")[0]["pinned_version"], 4)
        saved = self.call("get", "ben", "/guides/saved").json()["guides"]
        self.assertEqual(saved[0]["title"], "Supply chains")
        self.assertTrue(saved[0]["available"])
        self.assertTrue(self.call("get", "ben", f"/guides/{GUIDE}/public").json()["guide"]["saved"])
        self.row()["visibility"] = "private"
        saved = self.call("get", "ben", "/guides/saved").json()["guides"]
        self.assertEqual(saved, [{"id": GUIDE, "title": None, "available": False, "saved_at": saved[0]["saved_at"]}])
        self.assertEqual(self.call("delete", "ben", f"/guides/{GUIDE}/save").json(), {"saved": False})
        self.assertEqual(self.db.rows("guide_saves"), [])

    def test_save_rules(self):
        self.assertEqual(self.call("post", "cat", f"/guides/{GUIDE}/save").status_code, 404)  # private
        self.row()["visibility"] = "public"
        self.assertEqual(self.call("post", "ana", f"/guides/{GUIDE}/save").status_code, 400)  # your own
        self.assertEqual(self.call("post", "dan", f"/guides/{GUIDE}/save").status_code, 404)  # blocked
        self.assertEqual(self.call("post", None, f"/guides/{GUIDE}/save").status_code, 401)

    # Copies -----------------------------------------------------------------------------------------
    def test_copy_lineage(self):
        self.row().update({"visibility": "public", "version": 3, "quiz_questions": [{"q": 1}]})
        made = self.call("post", "ben", f"/guides/{GUIDE}/copy", json={}).json()["guide_id"]
        copy = self.row(made)
        self.assertEqual((copy["user_id"], copy["forked_from_guide_id"], copy["forked_from_version"]), (BEN, GUIDE, 3))
        self.assertEqual((copy["visibility"], copy["title"]), ("private", "Supply chains"))
        # The copy keeps the original's questions, each with its idea id (Stage 4), so progress can follow them.
        self.assertEqual([{k: v for k, v in q.items() if k != "idea_id"} for q in copy["quiz_questions"]], [{"q": 1}])
        self.assertTrue(all(q.get("idea_id") for q in copy["quiz_questions"]))
        self.assertNotIn("flashcard_progress", copy)  # Ana's progress is hers
        self.assertNotIn("folder_id", copy)
        self.assertEqual(self.call("get", "ben", f"/guides/{GUIDE}/public").json()["guide"]["my_copy_id"], made)
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").json()["guide"]["studied_by"], 1)
        # A copy of someone else's guide can't be shared on.
        self.accept_honor_code(BEN)
        response = self.call("patch", "ben", f"/guides/{made}/visibility", json={"visibility": "public"})
        self.assertEqual(response.status_code, 400)

    def test_copy_carries_progress(self):
        self.row().update({"visibility": "public", "version": 2})
        first = self.call("post", "ben", f"/guides/{GUIDE}/copy", json={}).json()["guide_id"]
        self.row(first)["flashcard_progress"] = {"0": {"box": 5}}
        again = self.call("post", "ben", f"/guides/{GUIDE}/copy", json={"carry_progress": True}).json()["guide_id"]
        self.assertEqual(self.row(again)["flashcard_progress"], {"0": {"box": 5}})
        self.row()["version"] = 3  # a newer version: the old progress doesn't fit it
        newer = self.call("post", "ben", f"/guides/{GUIDE}/copy", json={"carry_progress": True}).json()["guide_id"]
        self.assertNotIn("flashcard_progress", self.row(newer))
        own = self.call("post", "ana", f"/guides/{GUIDE}/copy", json={"carry_progress": True}).json()["guide_id"]
        self.assertEqual(self.row(own)["flashcard_progress"], {"0": {"box": 3}})
        # Copying your own guide is just a copy: it can be shared like any of yours.
        self.accept_honor_code()
        self.assertEqual(self.call("patch", "ana", f"/guides/{own}/visibility", json={"visibility": "public"}).status_code, 200)

    def test_cannot_copy_what_you_cannot_see(self):
        self.assertEqual(self.call("post", "cat", f"/guides/{GUIDE}/copy", json={}).status_code, 404)
        self.row()["visibility"] = "classroom"
        self.assertEqual(self.call("post", "cat", f"/guides/{GUIDE}/copy", json={}).status_code, 404)
        self.assertEqual(self.call("post", "ben", f"/guides/{GUIDE}/copy", json={}).status_code, 200)

    # Reports and takedowns --------------------------------------------------------------------------
    def test_takedown_holds_the_guide_until_an_admin_decides(self):
        self.row()["visibility"] = "public"
        body = {"name": "Pub", "email": "legal@pub.com", "work": "Chapter 3", "statement": True,
                "location": f"https://classroom.cordiaai.io/sets/{GUIDE}"}
        self.assertEqual(self.client.post("/copyright/takedown", json=body).status_code, 200)
        self.assertEqual((self.row()["review_status"], self.row()["hold_reason"]), ("held", "Copyright report"))
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 404)
        takedown = self.db.rows("copyright_takedowns")[0]
        self.assertEqual(takedown["guide_id"], GUIDE)
        queue = self.call("get", "eve", "/admin/queue").json()
        self.assertEqual([g["id"] for g in queue["guides"]], [GUIDE])
        self.call("post", "eve", f"/admin/takedowns/{takedown['id']}", json={"action": "rejected"})
        self.assertEqual(self.row()["review_status"], "ok")
        self.assertEqual(self.call("get", "cat", f"/guides/{GUIDE}/public").status_code, 200)

    def test_actioned_takedown_hides_the_guide(self):
        self.row()["visibility"] = "public"
        body = {"name": "Pub", "email": "legal@pub.com", "work": "Chapter 3", "statement": True,
                "location": f"https://classroom.cordiaai.io/sets/{GUIDE}"}
        self.client.post("/copyright/takedown", json=body)
        takedown = self.db.rows("copyright_takedowns")[0]
        self.call("post", "eve", f"/admin/takedowns/{takedown['id']}", json={"action": "actioned"})
        self.assertEqual(self.row()["review_status"], "hidden")
        self.assertEqual(self.call("get", "ana", f"/guides/{GUIDE}/public").json()["guide"]["review_status"], "hidden")

    def test_admin_releases_or_hides_a_guide(self):
        self.row().update({"visibility": "public", "review_status": "held", "hold_reason": "Looks like an exam or answer key"})
        self.assertEqual(self.call("post", "ana", f"/admin/guides/{GUIDE}", json={"status": "ok"}).status_code, 403)
        self.call("post", "eve", f"/admin/guides/{GUIDE}", json={"status": "ok"})
        self.assertEqual((self.row()["review_status"], self.row()["hold_reason"]), ("ok", None))
        self.call("post", "eve", f"/admin/guides/{GUIDE}", json={"status": "hidden"})
        self.assertEqual(self.row()["review_status"], "hidden")

    def test_visibility_review_count(self):
        self.row().update({"visibility": "classroom", "visibility_migrated": True})
        self.assertEqual(self.call("get", "ana", "/guides/visibility-review").json(), {"count": 1})
        self.row()["visibility"] = "public"
        self.assertEqual(self.call("get", "ana", "/guides/visibility-review").json(), {"count": 0})

    def test_routes_are_not_read_as_guide_ids(self):
        # /guides/saved and /guides/visibility-review must reach this router, not GET /guides/{id}.
        self.assertEqual(self.call("get", "ana", "/guides/saved").status_code, 200)
        self.assertEqual(self.call("get", "ana", "/guides/visibility-review").status_code, 200)


if __name__ == "__main__":
    unittest.main()
