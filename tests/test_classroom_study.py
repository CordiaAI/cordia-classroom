"""Studying a whole classroom and its Progress tab (social plan, Stage 6): routers/classrooms.py
study / progress / due, services/classroom_study.py."""
from pathlib import Path
import os
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import rate_limit  # noqa: E402
from fake_supabase import route_patches  # noqa: E402
from test_guide_progress import DB  # noqa: E402  (FakeDB + merge_guide_progress)
from services import ideas  # noqa: E402

ANA = "aaaaaaaa-0000-4000-8000-000000000001"   # owner of the classroom and of guide 1
BEN = "bbbbbbbb-0000-4000-8000-000000000002"   # owner of guide 2
CAT = "cccccccc-0000-4000-8000-000000000003"
DAN = "dddddddd-0000-4000-8000-000000000004"
EVE = "eeeeeeee-0000-4000-8000-000000000005"   # not a member
IDS = {"ana": ANA, "ben": BEN, "cat": CAT, "dan": DAN, "eve": EVE}
ROOM = "c1a55000-0000-4000-8000-000000000001"
G1 = "10000000-0000-4000-8000-000000000001"
G2 = "10000000-0000-4000-8000-000000000002"
FOLDER = "f0000000-0000-4000-8000-000000000001"
G3 = "10000000-0000-4000-8000-000000000003"   # in Ben's shared folder
MODULES = ("classrooms", "study", "quiz", "guide_sharing")


def qa(prefix, n):
    pairs = [(f"What is {prefix} term {i}?", f"The meaning of {prefix} term {i} in plain words") for i in range(n)]
    return "\n".join(f"Q{i + 1}: {q}\nA{i + 1}: {a}" for i, (q, a) in enumerate(pairs)), [{"front": q, "back": a} for q, a in pairs]


def guide(gid, owner, title, n, visibility="classroom", folder=None):
    text, cards = qa(title.lower(), n)
    return {"id": gid, "user_id": owner, "title": title, "notes": "", "study_guide": text, "flashcards": cards, "quiz_questions": None,
            "flashcard_progress": {}, "folder_id": folder, "visibility": visibility, "attribution": "named", "version": 1,
            "review_status": "ok", "hold_reason": None, "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"}


class ClassroomStudyTests(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = DB()
        for name, uid in IDS.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title() + " Test"})
        self.db.rows("folders").append({"id": FOLDER, "user_id": BEN, "name": "Unit 2"})
        self.db.rows("study_guides").extend([guide(G1, ANA, "Cells", 4), guide(G2, BEN, "Genes", 6), guide(G3, BEN, "Proteins", 2, "private", FOLDER)])
        self.db.rows("classrooms").append({"id": ROOM, "name": "Bio group", "kind": "study_group", "visibility": "unlisted", "join_policy": "auto",
                                           "members_can_add": True, "members_can_invite": True, "owner_id": ANA, "archived_at": None})
        for uid, role in ((ANA, "owner"), (BEN, "member"), (CAT, "member"), (DAN, "member")):
            self.db.rows("classroom_members").append({"classroom_id": ROOM, "user_id": uid, "role": role, "status": "active", "progress_visible_to_staff": False})
        self.db.rows("classroom_items").extend([
            {"classroom_id": ROOM, "item_type": "guide", "item_id": G1, "position": 1, "milestone_label": "Unit 1 quiz", "milestone_date": "2099-01-10"},
            {"classroom_id": ROOM, "item_type": "guide", "item_id": G2, "position": 2},
            {"classroom_id": ROOM, "item_type": "folder", "item_id": FOLDER, "position": 3},
        ])

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        self.patches = route_patches(MODULES, who, self.db)
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true", "PER_VIEWER_PROGRESS": "true"})]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def call(self, method, who, path, **kw):
        return getattr(self.client, method)(path, headers={"Authorization": f"Bearer {who}"}, **kw)

    def row(self, gid):
        return next(g for g in self.db.rows("study_guides") if g["id"] == gid)

    def ideas_of(self, gid, who="ana"):
        data = self.call("get", who, f"/classrooms/{ROOM}/study").json()
        return next(g for g in data["guides"] if g["id"] == gid)

    def give_levels(self, uid, gid, level):
        """A member's progress on someone else's guide: every idea at `level`."""
        cards = ideas.ensure_ids(self.row(gid)["flashcards"])[0]
        self.db.rows("guide_progress").append({"user_id": uid, "guide_id": gid, "version_seen": 1, "dismissed_version": None,
                                               "progress": {c["idea_id"]: {"l": level, "at": "2099-01-01", "q": ideas.fingerprint48(c["front"])} for c in cards},
                                               "test_date": None, "test_format": None, "updated_at": "2026-11-06T00:00:00Z"})

    # The session --------------------------------------------------------------------------------------
    def test_study_payload_spans_guides_and_folders_with_your_own_progress(self):
        data = self.call("get", "cat", f"/classrooms/{ROOM}/study").json()
        self.assertEqual([g["title"] for g in data["guides"]], ["Cells", "Genes", "Proteins"], "guide items in order, then the folder's guides")
        self.assertTrue(all(g["viewer"] for g in data["guides"]), "none of these are Cat's own")
        self.assertEqual(data["milestone"], {"label": "Unit 1 quiz", "date": "2099-01-10"})
        mine = self.call("get", "ana", f"/classrooms/{ROOM}/study").json()
        self.assertIsNone(next(g for g in mine["guides"] if g["id"] == G1)["viewer"], "Ana's own guide comes with her own progress")
        picked = self.call("get", "cat", f"/classrooms/{ROOM}/study?guide_ids={G2}").json()
        self.assertEqual([g["id"] for g in picked["guides"]], [G2])
        self.assertEqual(self.call("get", "eve", f"/classrooms/{ROOM}/study").status_code, 404)

    def test_without_per_viewer_progress_only_your_own_guides(self):
        with patch.dict(os.environ, {"PER_VIEWER_PROGRESS": ""}):
            data = self.call("get", "ben", f"/classrooms/{ROOM}/study").json()
        self.assertEqual(([g["id"] for g in data["guides"]], data["skipped"]), ([G2, G3], 1))

    def test_hidden_guides_leave_the_session(self):
        self.row(G2)["review_status"] = "held"
        self.assertNotIn(G2, [g["id"] for g in self.call("get", "cat", f"/classrooms/{ROOM}/study").json()["guides"]])

    def test_answers_land_in_each_guides_own_row(self):
        g2 = self.ideas_of(G2, "cat")
        self.call("post", "cat", f"/guides/{G2}/progress", json={"version": g2["viewer"]["version"], "cards": {"0": {"box": 2, "due": "2099-01-05", "known": True}}})
        self.assertEqual(self.row(G2)["flashcard_progress"], {}, "Ben's own guide row is untouched")
        cats = [r for r in self.db.rows("guide_progress") if r["user_id"] == CAT and r["guide_id"] == G2]
        self.assertEqual(len(cats), 1)
        self.assertEqual(list(cats[0]["progress"].values())[0]["box"], 2)
        self.assertFalse([r for r in self.db.rows("guide_progress") if r["user_id"] == CAT and r["guide_id"] == G1 and r["progress"]],
                         "nothing written to the other guides")

    # Progress tab -------------------------------------------------------------------------------------
    def test_readiness_is_weighted_by_idea_count(self):
        self.give_levels(CAT, G1, 3)   # 4 ideas mastered
        progress = self.call("get", "cat", f"/classrooms/{ROOM}/progress").json()["me"]
        by = {g["id"]: g for g in progress["guides"]}
        self.assertEqual((by[G1]["readiness"], by[G2]["readiness"], by[G3]["readiness"]), (100, 0, 0))
        self.assertEqual(progress["readiness"], round(100 * 4 / 12), "4 of 12 ideas, weighted by size")

    def test_group_view_needs_three_members_and_names_nobody(self):
        self.give_levels(CAT, G1, 3)
        self.give_levels(DAN, G1, 1)
        group = {g["id"]: g for g in self.call("get", "cat", f"/classrooms/{ROOM}/progress").json()["group"]}
        self.assertEqual((group[G1]["shown"], group[G1]["studied"]), (False, 2))
        self.assertNotIn("ideas", group[G1])
        self.give_levels(BEN, G1, 2)
        data = self.call("get", "cat", f"/classrooms/{ROOM}/progress").json()
        g1 = next(g for g in data["group"] if g["id"] == G1)
        self.assertTrue(g1["shown"])
        self.assertEqual((g1["ideas"][0]["knows"], g1["ideas"][0]["learning"]), (2, 1))
        text = str(data)
        for name in ("ben", "dan", BEN, DAN):
            self.assertNotIn(name, text, "the group view never names anyone")

    def test_instructor_sees_only_members_who_share(self):
        room = next(r for r in self.db.rows("classrooms") if r["id"] == ROOM)
        room["kind"] = "instructor_class"
        next(m for m in self.db.rows("classroom_members") if m["user_id"] == CAT)["progress_visible_to_staff"] = True
        self.give_levels(CAT, G1, 3)
        self.give_levels(DAN, G1, 3)
        staff = self.call("get", "ana", f"/classrooms/{ROOM}/progress").json()
        self.assertEqual([m["username"] for m in staff["members"]], ["cat"])
        self.assertEqual(staff["not_sharing"], 2)
        self.assertIsNone(staff["group"])
        member = self.call("get", "dan", f"/classrooms/{ROOM}/progress").json()
        self.assertNotIn("members", member, "members only see their own")

    def test_due_across_classrooms(self):
        due = self.call("get", "cat", "/classrooms/due").json()["classrooms"]
        self.assertEqual(due[0]["id"], ROOM)
        self.assertEqual(due[0]["due"], 12, "every card is new, so due")
        self.give_levels(CAT, G2, 3)
        for entry in next(r for r in self.db.rows("guide_progress") if r["user_id"] == CAT and r["guide_id"] == G2)["progress"].values():
            entry.update({"box": 4, "due": "2099-12-31"})
        self.assertEqual(self.call("get", "cat", "/classrooms/due").json()["classrooms"][0]["due"], 6)

    def test_own_test_date(self):
        response = self.call("patch", "cat", f"/classrooms/{ROOM}/me", json={"test_date": "2099-02-01"})
        self.assertEqual(response.json(), {"test_date": "2099-02-01"})
        self.assertEqual(self.call("get", "cat", f"/classrooms/{ROOM}/progress").json()["me"]["test_date"], "2099-02-01")

    def test_thirty_guides_and_five_hundred_ideas_stay_quick(self):
        self.db.rows("classroom_items").clear()
        for i in range(30):
            gid = f"20000000-0000-4000-8000-{i:012d}"
            self.db.rows("study_guides").append(guide(gid, BEN, f"Topic {i}", 17))
            self.db.rows("classroom_items").append({"classroom_id": ROOM, "item_type": "guide", "item_id": gid, "position": i})
            self.give_levels(CAT, gid, 2)
            self.give_levels(DAN, gid, 1)
        started = time.perf_counter()
        study = self.call("get", "cat", f"/classrooms/{ROOM}/study").json()
        progress = self.call("get", "cat", f"/classrooms/{ROOM}/progress").json()
        elapsed = time.perf_counter() - started
        self.assertEqual(len(study["guides"]), 30)
        self.assertEqual(sum(g["total"] for g in progress["me"]["guides"]), 510)
        self.assertLess(elapsed, 8.0, f"took {elapsed:.1f}s")


if __name__ == "__main__":
    unittest.main()
