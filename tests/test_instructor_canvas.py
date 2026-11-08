"""Stage 8: instructor dashboard and CSV (consent only), course opt-outs, classmate suggestions and the
"find me" toggle, and verified-instructor badges."""
from pathlib import Path
from types import SimpleNamespace
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
from fake_supabase import route_patches  # noqa: E402
from test_guide_progress import DB  # noqa: E402
from services import classroom_study as cstudy, ideas  # noqa: E402

NAMES = ["ana", "ben", "cat", "dan", "eve", "fra", "gus", "hal", "ivy"]
IDS = {n: f"{i:08x}-0000-4000-8000-{i:012x}" for i, n in enumerate(NAMES, 1)}
ANA, BEN, CAT, DAN, EVE, FRA, GUS, HAL, IVY = (IDS[n] for n in NAMES)
ROOM = "c1a55000-0000-4000-8000-000000000001"
G1 = "10000000-0000-4000-8000-000000000001"
G2 = "10000000-0000-4000-8000-000000000002"
C1 = "c0000000-0000-4000-8000-000000000001"   # BIO 101
C2 = "c0000000-0000-4000-8000-000000000002"   # CHEM 120
T1 = "70000000-0000-4000-8000-000000000001"   # BIO 101, Fall 2026 (this term)
T0 = "70000000-0000-4000-8000-000000000000"   # BIO 101, Spring 2026
T2 = "70000000-0000-4000-8000-000000000002"   # CHEM 120, Fall 2026
F1 = "f0000000-0000-4000-8000-000000000001"   # Ana's BIO 101 folder
MODULES = ("classrooms", "profiles", "public_forms", "guide_sharing")
TERM = "Fall 2026"


def qa(prefix, n):
    pairs = [(f"What is {prefix} term {i}?", f"The meaning of {prefix} term {i}") for i in range(n)]
    return "\n".join(f"Q{i + 1}: {q}\nA{i + 1}: {a}" for i, (q, a) in enumerate(pairs)), [{"front": q, "back": a} for q, a in pairs]


def guide(gid, owner, title, n, folder=None, visibility="classroom"):
    text, cards = qa(title.lower(), n)
    return {"id": gid, "user_id": owner, "title": title, "notes": "", "study_guide": text, "flashcards": cards, "quiz_questions": None,
            "flashcard_progress": {}, "folder_id": folder, "visibility": visibility, "attribution": "named", "version": 1,
            "review_status": "ok", "hold_reason": None, "forked_from_guide_id": None, "created_at": "2026-11-01T00:00:00+00:00"}


def progress_for(title, n, level):
    today = cstudy.today_iso()
    return {ideas.stable_id(f"What is {title.lower()} term {i}?"): {"l": level, "at": today} for i in range(n)}


class Stage8(unittest.TestCase):
    def setUp(self):
        rate_limit._hits.clear()
        self.db = DB()
        self.confirmed = {}  # user id -> confirmed email
        self.db.auth = SimpleNamespace(admin=SimpleNamespace(get_user_by_id=self._user))
        for name, uid in IDS.items():
            self.db.rows("user_profiles").append({"id": uid, "username": name, "name": name.title() + " Test", "email": f"{name}@school.edu",
                                                  "profile_visibility": "public"})
        self.db.rows("classes").extend([{"id": C1, "course_code_normalized": "BIO 101", "display_name": "Biology", "sharing_blocked": False},
                                        {"id": C2, "course_code_normalized": "CHEM 120", "display_name": "Chemistry", "sharing_blocked": False}])
        self.db.rows("class_terms").extend([{"id": T1, "class_id": C1, "term": TERM}, {"id": T0, "class_id": C1, "term": "Spring 2026"},
                                            {"id": T2, "class_id": C2, "term": TERM}])
        self.db.rows("folders").append({"id": F1, "user_id": ANA, "name": "BIO 101", "class_id": C1})
        self.db.rows("study_guides").extend([guide(G1, ANA, "Cells", 4), guide(G2, ANA, "Genes", 3)])
        self.db.rows("classrooms").append({"id": ROOM, "name": "BIO 101 Fall", "kind": "instructor_class", "visibility": "unlisted",
                                           "join_policy": "auto", "members_can_add": False, "members_can_invite": True, "owner_id": ANA,
                                           "archived_at": None, "class_id": None})
        for uid, role, share in ((ANA, "owner", False), (BEN, "member", True), (CAT, "member", False), (DAN, "member", True)):
            self.db.rows("classroom_members").append({"classroom_id": ROOM, "user_id": uid, "role": role, "status": "active",
                                                      "progress_visible_to_staff": share, "joined_at": "2026-10-01T00:00:00+00:00"})
        self.db.rows("classroom_items").extend([
            {"classroom_id": ROOM, "item_type": "guide", "item_id": G1, "position": 1, "milestone_label": "Unit 1 quiz", "milestone_date": "2099-01-10"},
            {"classroom_id": ROOM, "item_type": "guide", "item_id": G2, "position": 2}])
        # Ben mastered Cells; Dan is still learning Cells; Cat mastered everything but doesn't share.
        self.db.rows("guide_progress").extend([
            {"user_id": BEN, "guide_id": G1, "progress": progress_for("Cells", 4, 3)},
            {"user_id": DAN, "guide_id": G1, "progress": progress_for("Cells", 4, 1)},
            {"user_id": CAT, "guide_id": G1, "progress": progress_for("Cells", 4, 3)},
            {"user_id": CAT, "guide_id": G2, "progress": progress_for("Genes", 3, 3)}])

        def who(header):
            from fastapi import HTTPException
            name = (header or "").split(" ", 1)[-1]
            if name not in IDS:
                raise HTTPException(status_code=401, detail="Sign in")
            return IDS[name]
        self.patches = route_patches(MODULES, who, self.db)
        self.patches += [patch.dict(os.environ, {"CLASSROOMS": "true", "PER_VIEWER_PROGRESS": "true"}),
                         patch("services.classmates.term_for", return_value=TERM)]
        for p in self.patches:
            p.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def _user(self, uid):
        email = self.confirmed.get(uid)
        return SimpleNamespace(user=SimpleNamespace(email=email, email_confirmed_at="2026-09-01T00:00:00Z" if email else None))

    def get(self, who, path):
        return self.client.get(path, headers={"Authorization": f"Bearer {who}"})

    def post(self, who, path, body):
        return self.client.post(path, json=body, headers={"Authorization": f"Bearer {who}"})

    def verify(self, name, class_id):
        self.confirmed[IDS[name]] = f"{name}@school.edu"
        self.db.rows("instructor_blocks").append({"class_id": class_id, "email": f"{name}@school.edu"})

    # 1. Dashboard and CSV ---------------------------------------------------------------------------
    def test_dashboard_counts_only_members_who_share(self):
        out = self.get("ana", f"/classrooms/{ROOM}/instructor")
        self.assertEqual(out.status_code, 200, out.text)
        data = out.json()
        members = {m["username"]: m for m in data["members"]}
        self.assertEqual(set(members), {"ben", "cat", "dan"})
        self.assertTrue(members["ben"]["sharing"] and members["dan"]["sharing"])
        self.assertFalse(members["cat"]["sharing"])
        self.assertIsNone(members["cat"]["readiness"], "a member who doesn't share shows no progress")
        self.assertEqual((data["sharing"], data["not_sharing"]), (2, 1))
        cells = next(g for g in data["guides"] if g["id"] == G1)
        self.assertEqual((cells["mastered"], cells["learning"]), (4, 4), "Ben's 4 mastered and Dan's 4 learning; Cat's never counted")
        genes = next(g for g in data["guides"] if g["id"] == G2)
        self.assertEqual(genes["mastered"], 0, "Cat mastered Genes but doesn't share")
        self.assertTrue(all(w["guide_title"] == "Genes" for w in data["weakest"][:3]), "the untouched guide's ideas are the weakest")
        self.assertEqual(data["milestones"][0]["label"], "Unit 1 quiz")
        self.assertGreater(data["milestones"][0]["days_left"], 0)
        self.assertNotIn("_per_member", data)

    def test_csv_has_only_sharing_members(self):
        out = self.get("ana", f"/classrooms/{ROOM}/instructor.csv")
        self.assertEqual(out.status_code, 200, out.text)
        self.assertIn("text/csv", out.headers["content-type"])
        self.assertIn("attachment", out.headers["content-disposition"])
        body = out.text
        usernames = {line.split(",")[1] for line in body.strip().splitlines()[1:]}
        self.assertEqual(usernames, {"ben", "dan"}, "Cat doesn't share, so Cat isn't in the file")
        self.assertEqual(len(body.strip().splitlines()), 1 + 2 * 2, "a header and one row per sharing member and guide")

    def test_csv_cells_cannot_run_as_formulas(self):
        self.db.rows("user_profiles")[1]["display_name"] = "=HYPERLINK(1)"
        self.assertIn("'=HYPERLINK(1)", self.get("ana", f"/classrooms/{ROOM}/instructor.csv").text)

    def test_dashboard_is_for_staff_of_instructor_classes_only(self):
        self.assertEqual(self.get("ben", f"/classrooms/{ROOM}/instructor").status_code, 403)
        self.assertEqual(self.get("ben", f"/classrooms/{ROOM}/instructor.csv").status_code, 403)
        self.assertEqual(self.get("eve", f"/classrooms/{ROOM}/instructor").status_code, 404)
        self.db.rows("classrooms")[0]["kind"] = "study_group"
        self.assertEqual(self.get("ana", f"/classrooms/{ROOM}/instructor").status_code, 403)

    # 2. Opt-outs ------------------------------------------------------------------------------------
    def test_opted_out_course_classroom_takes_no_guides_except_from_its_instructor(self):
        self.db.rows("classrooms")[0]["class_id"] = C1
        self.db.rows("classes")[0]["sharing_blocked"] = True
        G3 = "10000000-0000-4000-8000-000000000003"
        self.db.rows("study_guides").append(guide(G3, ANA, "Tissues", 2, visibility="private"))
        out = self.post("ana", f"/classrooms/{ROOM}/items", {"item_type": "guide", "item_id": G3})
        self.assertEqual(out.status_code, 403)
        self.assertIn("BIO 101", out.json()["detail"])
        self.assertEqual(self.db.rows("study_guides")[-1]["visibility"], "private", "nothing was shared before the check")
        self.verify("ana", C1)
        self.assertEqual(self.post("ana", f"/classrooms/{ROOM}/items", {"item_type": "guide", "item_id": G3}).status_code, 200)

    def test_an_opted_out_courses_guides_stay_out_of_other_course_classrooms(self):
        self.db.rows("classrooms")[0]["class_id"] = C2
        self.db.rows("classes")[0]["sharing_blocked"] = True
        G3 = "10000000-0000-4000-8000-000000000003"
        self.db.rows("study_guides").append(guide(G3, ANA, "Tissues", 2, folder=F1, visibility="private"))
        self.assertEqual(self.post("ana", f"/classrooms/{ROOM}/items", {"item_type": "guide", "item_id": G3}).status_code, 403)
        self.assertEqual(self.post("ana", f"/classrooms/{ROOM}/items", {"item_type": "folder", "item_id": F1}).status_code, 403)
        # A classroom with no course isn't a course classroom: the opt-out doesn't apply there.
        self.db.rows("classrooms")[0]["class_id"] = None
        self.assertEqual(self.post("ana", f"/classrooms/{ROOM}/items", {"item_type": "guide", "item_id": G3}).status_code, 200)

    def test_instructors_see_what_their_opt_out_hides(self):
        self.db.rows("classes")[0]["sharing_blocked"] = True
        self.db.rows("study_guides").append({**guide("10000000-0000-4000-8000-000000000009", BEN, "Public cells", 2, folder=F1), "visibility": "public"})
        self.db.rows("classrooms")[0]["class_id"] = C1
        self.db.rows("shared_sets").append({"id": "s1", "class_id": C1, "guide_id": G1})
        self.assertEqual(self.get("ana", "/instructors/opt-outs").json()["courses"], [], "not verified: nothing to show")
        self.verify("ana", C1)
        course = self.get("ana", "/instructors/opt-outs").json()["courses"][0]
        self.assertEqual((course["code"], course["hidden_from_discover"], course["class_sets_kept_private"], course["classrooms_locked"]),
                         ("BIO 101", 1, 1, 1))

    # 3. Suggestions and the toggle ------------------------------------------------------------------
    def _classmates(self):
        for name in ("ana", "ben", "cat", "dan", "fra", "gus", "hal", "ivy"):
            self.db.rows("class_memberships").append({"user_id": IDS[name], "class_term_id": T1})
        self.db.rows("class_memberships").append({"user_id": EVE, "class_term_id": T0})   # last term
        profiles = {p["id"]: p for p in self.db.rows("user_profiles")}
        profiles[CAT]["profile_visibility"] = "private"
        profiles[FRA]["is_minor"] = True                                   # minor, default off
        profiles[GUS].update({"is_minor": True, "find_by_classmates": True})  # minor who opted in
        profiles[HAL]["find_by_classmates"] = False
        self.db.rows("user_blocks").append({"blocker_id": DAN, "blocked_id": ANA})
        lo, hi = sorted([ANA, IVY])
        self.db.rows("friendships").append({"user_a": lo, "user_b": hi, "status": "accepted"})

    def test_classmates_are_suggested_only_when_findable(self):
        self._classmates()
        data = self.get("ana", "/classrooms/suggestions").json()
        people = {p["username"]: p for p in data["classmates"]}
        self.assertEqual(set(people), {"ben", "gus"})
        self.assertEqual(people["ben"]["courses"], ["BIO 101"])
        self.assertFalse(people["gus"]["can_follow"], "minors take follows from friends only")
        self.assertEqual(data["courses"], ["BIO 101"])

    def test_a_minor_gets_no_people(self):
        self._classmates()
        self.db.rows("user_profiles")[0]["is_minor"] = True
        self.assertEqual(self.get("ana", "/classrooms/suggestions").json()["classmates"], [])

    def test_course_classrooms_are_suggested(self):
        self.db.rows("class_memberships").append({"user_id": EVE, "class_term_id": T1})
        R2, R3 = "c1a55000-0000-4000-8000-000000000002", "c1a55000-0000-4000-8000-000000000003"
        self.db.rows("classrooms").extend([
            {"id": R2, "name": "BIO study group", "kind": "study_group", "class_id": C1, "owner_id": BEN, "visibility": "public", "join_policy": "auto", "archived_at": None},
            {"id": R3, "name": "Hidden group", "kind": "study_group", "class_id": C1, "owner_id": BEN, "visibility": "unlisted", "join_policy": "auto", "archived_at": None}])
        self.db.rows("classrooms")[0].update({"class_id": C1, "visibility": "public"})
        rooms = self.get("eve", "/classrooms/suggestions").json()["classrooms"]
        self.assertEqual([r["name"] for r in rooms], ["BIO 101 Fall", "BIO study group"], "instructor class first; unlisted never")
        self.db.rows("user_blocks").append({"blocker_id": EVE, "blocked_id": BEN})
        self.assertEqual([r["name"] for r in self.get("eve", "/classrooms/suggestions").json()["classrooms"]], ["BIO 101 Fall"])
        self.assertEqual([r["name"] for r in self.get("ben", "/classrooms/suggestions").json()["classrooms"]], [], "Ben isn't taking BIO 101 this term")

    def test_find_me_toggle_defaults_and_saves(self):
        me = self.client.get("/profiles/me", headers={"Authorization": "Bearer ana"}).json()
        self.assertTrue(me["find_by_classmates"], "on by default for adults")
        self.db.rows("user_profiles")[5]["is_minor"] = True
        self.assertFalse(self.client.get("/profiles/me", headers={"Authorization": "Bearer fra"}).json()["find_by_classmates"], "off for minors")
        out = self.client.patch("/profiles/me", json={"find_by_classmates": False}, headers={"Authorization": "Bearer ana"})
        self.assertEqual(out.status_code, 200, out.text)
        self.assertFalse(out.json()["find_by_classmates"])
        self.assertIs(self.db.rows("user_profiles")[0]["find_by_classmates"], False)

    # 5. Verified badge ------------------------------------------------------------------------------
    def test_verified_instructors_get_a_badge(self):
        self.assertEqual(self.get("ben", "/profiles/ana").json()["badges"], [])
        self.verify("ana", C1)
        self.assertEqual(self.get("ben", "/profiles/ana").json()["badges"], [{"key": "verified_instructor", "label": "Verified instructor"}])
        # A matching email that isn't confirmed doesn't count.
        self.confirmed.pop(ANA)
        self.assertEqual(self.get("ben", "/profiles/ana").json()["badges"], [])


if __name__ == "__main__":
    unittest.main()
