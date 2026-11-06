"""Classrooms (social plan, Stage 5): roles, invites, joining, items, and what members can see
(routers/classrooms.py, services/classrooms.py, guide_access.can_view, admin approval)."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
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
from services import classrooms as rooms  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"   # owner
BEN = "bbbbbbbb-0000-4000-8000-000000000002"   # Ana's friend
CAT = "cccccccc-0000-4000-8000-000000000003"   # a classmate
DAN = "dddddddd-0000-4000-8000-000000000004"   # Ana blocked him
EVE = "eeeeeeee-0000-4000-8000-000000000005"   # app admin
FAY = "ffffffff-0000-4000-8000-000000000006"   # a stranger
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN, "eve": EVE, "fay": FAY}
FOLDER = "f0000000-0000-4000-8000-000000000001"
G_PRIVATE = "10000000-0000-4000-8000-000000000001"
G_IN_FOLDER = "10000000-0000-4000-8000-000000000002"
G_PUBLIC_CAT = "10000000-0000-4000-8000-000000000003"
MODULES = ("classrooms", "guide_sharing", "admin", "notifications")


class ClassroomTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = FakeDB()
        for name, uid in IDS.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title() + " Test"})
        self.db.rows("app_admins").append({"user_id": EVE})
        self.db.rows("friendships").append({"user_a": ANA, "user_b": BEN, "requested_by": ANA, "status": "accepted"})
        self.db.rows("user_blocks").append({"blocker_id": ANA, "blocked_id": DAN})
        self.db.rows("folders").append({"id": FOLDER, "user_id": ANA, "name": "Unit 1"})
        guide = {"notes": "", "study_guide": "Q1: What is lead time?\nA1: The wait.", "flashcards": [], "attribution": "named",
                 "version": 1, "review_status": "ok", "hold_reason": None, "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"}
        self.db.rows("study_guides").extend([
            {**guide, "id": G_PRIVATE, "user_id": ANA, "title": "Private notes", "folder_id": None, "visibility": "private"},
            {**guide, "id": G_IN_FOLDER, "user_id": ANA, "title": "Folder notes", "folder_id": FOLDER, "visibility": "private"},
            {**guide, "id": G_PUBLIC_CAT, "user_id": CAT, "title": "Cat's public set", "folder_id": None, "visibility": "public"},
        ])

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        self.patches = [patch(f"routers.{m}.get_user_id", side_effect=who) for m in MODULES]
        self.patches += [patch(f"routers.{m}.get_supabase", return_value=self.db) for m in MODULES]
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true"})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def call(self, method, who, path, **kw):
        headers = {"Authorization": f"Bearer {who}"} if who else {}
        return getattr(self.client, method)(path, headers=headers, **kw)

    def make(self, who="ana", **body):
        response = self.call("post", who, "/classrooms", json={"name": "Biology group", **body})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["classroom"]

    def link(self, room_id, who="ana", **body):
        response = self.call("post", who, f"/classrooms/{room_id}/invites", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["invite"]

    def join(self, who, **body):
        return self.call("post", who, "/classrooms/join", json=body)

    def member(self, room_id, uid):
        return next((m for m in self.db.rows("classroom_members") if m["classroom_id"] == room_id and m["user_id"] == uid), None)

    # Basics ------------------------------------------------------------------------------------------
    def test_off_without_the_flag(self):
        with patch.dict(os.environ, {"CLASSROOMS": ""}):
            self.assertEqual(self.call("get", "ana", "/classrooms").status_code, 404)
            self.assertEqual(self.call("post", "ana", "/classrooms", json={"name": "x"}).status_code, 404)

    def test_create_and_defaults(self):
        group = self.make()
        self.assertEqual((group["kind"], group["visibility"], group["join_policy"], group["members_can_add"]), ("study_group", "unlisted", "auto", True))
        self.assertEqual((group["me"]["role"], group["member_count"]), ("owner", 1))
        teach = self.make(kind="instructor_class", name="Bio 101 section 2")
        self.assertEqual((teach["kind"], teach["instructor_request"], teach["members_can_add"]), ("study_group", "requested", False),
                         "an instructor class waits for an admin and works as a study group")

    def test_admin_approves_an_instructor_class_and_joining_asks_consent(self):
        room = self.make(kind="instructor_class")
        self.assertEqual(self.call("post", "ben", f"/admin/classrooms/{room['id']}", json={"approve": True}).status_code, 403)
        queue = self.call("get", "eve", "/admin/queue").json()
        self.assertEqual([r["id"] for r in queue["classrooms"]], [room["id"]])
        self.assertEqual(self.call("post", "eve", f"/admin/classrooms/{room['id']}", json={"approve": True}).json()["kind"], "instructor_class")
        invite = self.link(room["id"])
        self.assertEqual(self.join("cat", token=invite["token"]).json()["detail"], "consent_required")
        self.assertEqual(self.join("cat", token=invite["token"], share_progress=True).json()["status"], "active")
        self.assertTrue(self.member(room["id"], CAT)["progress_visible_to_staff"])
        self.call("patch", "cat", f"/classrooms/{room['id']}/me", json={"progress_visible_to_staff": False})
        self.assertFalse(self.member(room["id"], CAT)["progress_visible_to_staff"])

    # Invites ------------------------------------------------------------------------------------------
    def test_invite_expiry_max_uses_revocation_and_regenerate(self):
        room = self.make()
        once = self.link(room["id"], max_uses=1)
        self.assertEqual(self.join("ben", code=once["code"].lower()).json()["status"], "active", "codes are case-insensitive")
        self.assertEqual(self.join("cat", token=once["token"]).json()["detail"], "This invite has been used up.")
        timed = self.link(room["id"], expires_days=1)
        row = next(i for i in self.db.rows("classroom_invites") if i["id"] == timed["id"])
        row["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        self.assertEqual(self.join("cat", token=timed["token"]).json()["detail"], "This invite has expired.")
        live = self.link(room["id"])
        fresh = self.call("post", "ana", f"/classrooms/invites/{live['id']}/regenerate").json()["invite"]
        self.assertEqual(self.join("cat", token=live["token"]).json()["detail"], "This invite was turned off.")
        self.call("post", "ana", f"/classrooms/invites/{fresh['id']}/revoke")
        self.assertEqual(self.join("cat", code=fresh["code"]).status_code, 404)
        self.assertEqual(self.join("cat", code="NOTACODE").json()["detail"], "This invite isn't valid.")

    def test_preview_works_signed_out_and_hides_bad_links(self):
        room = self.make(description="Weekly review")
        invite = self.link(room["id"])
        preview = self.call("get", None, f"/join/{invite['token']}").json()
        self.assertTrue(preview["valid"])
        self.assertEqual((preview["classroom"]["name"], preview["classroom"]["member_count"], preview["classroom"]["owner"]["username"]),
                         ("Biology group", 1, "ana"))
        self.assertTrue(self.call("get", None, f"/join/{invite['code']}").json()["valid"], "a code previews too")
        self.assertFalse(self.call("get", None, "/join/not-a-real-token-at-all-xx").json()["valid"])

    def test_block_rules(self):
        room = self.make()
        invite = self.link(room["id"])
        self.assertEqual(self.join("dan", token=invite["token"]).status_code, 404, "someone the owner blocked can't join")
        self.assertFalse(self.call("get", "dan", f"/join/{invite['token']}").json()["valid"])
        # Ben joins and invites; Dan blocked Ben, so Ben's link doesn't work for Dan either.
        self.join("ben", token=invite["token"])
        self.db.rows("user_blocks").clear()
        self.db.rows("user_blocks").append({"blocker_id": DAN, "blocked_id": BEN})
        bens = self.link(room["id"], who="ben")
        self.assertEqual(self.join("dan", token=bens["token"]).status_code, 404)
        self.assertEqual(self.join("dan", token=invite["token"]).json()["status"], "active", "Ana's own link works once nobody blocks")

    def test_friend_invites_are_personal_and_one_time(self):
        room = self.make(visibility="private")
        self.assertEqual(self.call("post", "ana", f"/classrooms/{room['id']}/invites", json={}).status_code, 400, "private: no links")
        sent = self.call("post", "ana", f"/classrooms/{room['id']}/invite-friends", json={"user_ids": [BEN, CAT]}).json()
        self.assertEqual(sent["sent"], 1, "only friends are invited")
        note = self.call("get", "ben", "/notifications").json()["items"][0]
        self.assertEqual((note["kind"], note["classroom"]["name"]), ("classroom_invite", "Biology group"))
        token = note["classroom"]["token"]
        self.assertEqual(self.join("cat", token=token).json()["detail"], "This invite is for someone else.")
        self.assertEqual(self.join("ben", token=token).json()["status"], "active")
        self.call("post", "ben", f"/classrooms/{room['id']}/leave")
        self.assertEqual(self.join("ben", token=token).status_code, 404, "a personal invite works once")

    # Joining --------------------------------------------------------------------------------------------
    def test_approval_flow(self):
        room = self.make(join_policy="approval")
        invite = self.link(room["id"])
        self.assertEqual(self.join("ben", token=invite["token"]).json()["status"], "pending")
        self.assertEqual(self.call("get", "ben", f"/classrooms/{room['id']}").status_code, 404, "nothing to see while waiting")
        listed = self.call("get", "ana", f"/classrooms/{room['id']}/members").json()["members"]
        self.assertEqual({m["username"]: m["status"] for m in listed}, {"ana": "active", "ben": "pending"})
        self.assertEqual(self.call("post", "ana", f"/classrooms/{room['id']}/members/{BEN}/approve").json()["status"], "active")
        self.assertEqual(self.call("get", "ben", f"/classrooms/{room['id']}").status_code, 200)
        kinds = [a["kind"] for a in self.call("get", "ana", f"/classrooms/{room['id']}/activity").json()["activity"]]
        self.assertIn("member_joined", kinds)

    def test_member_cap(self):
        room = self.make()
        for i in range(rooms.CAPS["study_group"] - 1):
            self.db.rows("classroom_members").append({"classroom_id": room["id"], "user_id": f"0000{i:04d}-0000-4000-8000-000000000000", "role": "member", "status": "active"})
        invite = self.link(room["id"])
        self.assertEqual(self.join("ben", token=invite["token"]).json()["detail"], "This classroom is full.")

    def test_public_classroom_on_its_course_page(self):
        klass = "c0000000-0000-4000-8000-000000000001"
        self.db.rows("classes").append({"id": klass, "course_code_normalized": "BIO 101", "sharing_blocked": False})
        with patch("routers.classrooms.is_member", return_value=True):
            room = self.make(visibility="public", class_id=klass)
        listed = self.call("get", "cat", f"/classrooms/for-class/{klass}").json()["classrooms"]
        self.assertEqual([r["name"] for r in listed], ["Biology group"])
        self.assertEqual(self.call("post", "cat", f"/classrooms/{room['id']}/request-join", json={}).json()["status"], "active")
        self.assertEqual(self.call("get", "dan", f"/classrooms/for-class/{klass}").json()["classrooms"], [], "blocked: not listed")

    # Roles ----------------------------------------------------------------------------------------------
    def test_role_permission_matrix(self):
        room = self.make(members_can_add=False)
        invite = self.link(room["id"])
        for who in ("ben", "cat"):
            self.join(who, token=invite["token"])
        rid = room["id"]
        # Members can't manage.
        self.assertEqual(self.call("patch", "ben", f"/classrooms/{rid}", json={"name": "Mine now"}).status_code, 403)
        self.assertEqual(self.call("patch", "ben", f"/classrooms/{rid}/members/{CAT}", json={"role": "admin"}).status_code, 403)
        self.assertEqual(self.call("delete", "ben", f"/classrooms/{rid}/members/{CAT}").status_code, 403)
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/items", json={"item_type": "guide", "item_id": G_PUBLIC_CAT}).status_code, 403,
                         "members can't add when members_can_add is off")
        # The owner makes Ben an admin; admins manage settings and members, not roles or the owner.
        self.assertEqual(self.call("patch", "ana", f"/classrooms/{rid}/members/{BEN}", json={"role": "admin"}).json()["role"], "admin")
        self.assertEqual(self.call("patch", "ana", f"/classrooms/{rid}/members/{CAT}", json={"role": "instructor"}).status_code, 400,
                         "instructors only in approved instructor classes")
        self.assertEqual(self.call("patch", "ben", f"/classrooms/{rid}", json={"name": "Bio review"}).json()["classroom"]["name"], "Bio review")
        self.assertEqual(self.call("patch", "ben", f"/classrooms/{rid}/members/{CAT}", json={"role": "admin"}).status_code, 403)
        self.assertEqual(self.call("delete", "ben", f"/classrooms/{rid}/members/{ANA}").status_code, 403)
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/archive").status_code, 403)
        self.assertEqual(self.call("delete", "ben", f"/classrooms/{rid}/members/{CAT}").json()["status"], "removed")
        self.assertEqual(self.call("get", "cat", f"/classrooms/{rid}").status_code, 404)
        # Outsiders see nothing.
        self.assertEqual(self.call("get", "fay", f"/classrooms/{rid}/members").status_code, 404)

    def test_ownership_transfer_and_leaving(self):
        room = self.make()
        self.join("ben", token=self.link(room["id"])["token"])
        rid = room["id"]
        self.assertEqual(self.call("post", "ana", f"/classrooms/{rid}/leave").status_code, 409, "the owner hands over first")
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/transfer", json={"user_id": BEN}).status_code, 403)
        self.assertEqual(self.call("post", "ana", f"/classrooms/{rid}/transfer", json={"user_id": BEN}).json()["owner_id"], BEN)
        self.assertEqual((self.member(rid, ANA)["role"], self.member(rid, BEN)["role"]), ("admin", "owner"))
        self.assertEqual(self.call("post", "ana", f"/classrooms/{rid}/leave").json()["status"], "removed")
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/archive").json()["archived"], True)
        self.assertEqual(self.call("get", "ben", f"/classrooms/{rid}").status_code, 404)

    # Items and what members see ---------------------------------------------------------------------------
    def test_live_folder_items_and_guide_visibility(self):
        room = self.make()
        rid = room["id"]
        self.join("ben", token=self.link(rid)["token"])
        self.assertEqual(self.call("get", "ben", f"/guides/{G_IN_FOLDER}/public").status_code, 404, "private before sharing")
        self.assertEqual(self.call("post", "ana", f"/classrooms/{rid}/items", json={"item_type": "folder", "item_id": FOLDER}).status_code, 200)
        self.assertEqual(self.call("get", "ben", f"/guides/{G_IN_FOLDER}/public").status_code, 200, "a shared folder shares its guides")
        self.assertEqual(self.call("get", "fay", f"/guides/{G_IN_FOLDER}/public").status_code, 404, "still hidden from everyone else")
        # Live: a guide put in the folder later shows up too.
        later = "10000000-0000-4000-8000-000000000009"
        self.db.rows("study_guides").append({**next(g for g in self.db.rows("study_guides") if g["id"] == G_IN_FOLDER), "id": later, "title": "Added later"})
        folder = next(i for i in self.call("get", "ben", f"/classrooms/{rid}/items").json()["items"] if i["item_type"] == "folder")
        self.assertEqual(sorted(g["title"] for g in folder["folder"]["guides"]), ["Added later", "Folder notes"])
        # A held guide stays hidden, folder or not.
        next(g for g in self.db.rows("study_guides") if g["id"] == later)["review_status"] = "held"
        folder = next(i for i in self.call("get", "ben", f"/classrooms/{rid}/items").json()["items"] if i["item_type"] == "folder")
        self.assertEqual([g["title"] for g in folder["folder"]["guides"]], ["Folder notes"])

    def test_adding_a_private_guide_shares_it_with_members_only(self):
        room = self.make()
        rid = room["id"]
        self.join("ben", token=self.link(rid)["token"])
        self.call("post", "ana", f"/classrooms/{rid}/items", json={"item_type": "guide", "item_id": G_PRIVATE, "milestone_label": "Unit 1 quiz", "milestone_date": "2026-12-01"})
        self.assertEqual(next(g for g in self.db.rows("study_guides") if g["id"] == G_PRIVATE)["visibility"], "classroom")
        self.assertEqual(self.call("get", "ben", f"/guides/{G_PRIVATE}/public").status_code, 200)
        self.assertEqual(self.call("get", "fay", f"/guides/{G_PRIVATE}/public").status_code, 404)
        items = self.call("get", "ben", f"/classrooms/{rid}/items").json()["items"]
        self.assertEqual((items[0]["guide"]["title"], items[0]["milestone_label"], items[0]["milestone_date"]), ("Private notes", "Unit 1 quiz", "2026-12-01"))
        # Members add their own guides or public ones only.
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/items", json={"item_type": "guide", "item_id": G_PUBLIC_CAT}).status_code, 200)
        self.assertEqual(self.call("post", "ben", f"/classrooms/{rid}/items", json={"item_type": "folder", "item_id": FOLDER}).status_code, 404)
        # The author makes it private again: members lose it.
        next(g for g in self.db.rows("study_guides") if g["id"] == G_PRIVATE)["visibility"] = "private"
        self.assertEqual(self.call("get", "ben", f"/guides/{G_PRIVATE}/public").status_code, 404)

    def test_leaving_takes_your_items_with_you(self):
        room = self.make()
        rid = room["id"]
        self.join("ben", token=self.link(rid)["token"])
        self.call("patch", "ana", f"/classrooms/{rid}/members/{BEN}", json={"role": "admin"})
        self.call("post", "ana", f"/classrooms/{rid}/transfer", json={"user_id": BEN})
        self.call("post", "ana", f"/classrooms/{rid}/items", json={"item_type": "folder", "item_id": FOLDER})
        self.call("post", "ana", f"/classrooms/{rid}/leave")
        self.assertEqual(self.db.rows("classroom_items"), [], "Ana's folder left with her")

    def test_milestones_reorder_and_removal(self):
        room = self.make()
        rid = room["id"]
        self.call("post", "ana", f"/classrooms/{rid}/items", json={"item_type": "guide", "item_id": G_PRIVATE})
        self.call("post", "ana", f"/classrooms/{rid}/items", json={"item_type": "guide", "item_id": G_PUBLIC_CAT})
        self.call("put", "ana", f"/classrooms/{rid}/items/order", json={"items": [{"item_type": "guide", "item_id": G_PUBLIC_CAT}, {"item_type": "guide", "item_id": G_PRIVATE}]})
        titles = [i["guide"]["title"] for i in self.call("get", "ana", f"/classrooms/{rid}/items").json()["items"]]
        self.assertEqual(titles, ["Cat's public set", "Private notes"])
        self.assertEqual(self.call("patch", "ana", f"/classrooms/{rid}/items/guide/{G_PRIVATE}", json={"milestone_label": "Midterm"}).json()["milestone_label"], "Midterm")
        self.assertIn("milestone_set", [a["kind"] for a in self.call("get", "ana", f"/classrooms/{rid}/activity").json()["activity"]])
        self.assertEqual(self.call("delete", "ana", f"/classrooms/{rid}/items/guide/{G_PRIVATE}").json()["removed"], True)


if __name__ == "__main__":
    unittest.main()
