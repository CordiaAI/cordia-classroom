"""Class suggestions, share-once default, members-only sets, saved copies, reports, screening, opt-out."""
import pathlib
import sys
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
from routers import classes, public_forms  # noqa: E402
from services.class_catalog import normalize_course_code, screen_share, suggest_class  # noqa: E402
from services.sharing import on_guide_changed  # noqa: E402

GUIDE_TEXT = "Q: What is span of control?\nA: The number of direct reports a manager supervises in organizational design."


class Session:
    def __init__(self, db):
        self.db = db

    def as_user(self, user_id):
        stack = ExitStack()
        for module in (classes, public_forms):
            stack.enter_context(patch.object(module, "get_user_id", return_value=user_id))
            stack.enter_context(patch.object(module, "get_supabase", return_value=self.db))
        return stack


class CatalogTests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(normalize_course_code("MGT-300-102").code, "MGT 300")
        self.assertEqual(normalize_course_code("fa26 mgt300.01").code, "MGT 300")
        self.assertTrue(normalize_course_code("MGT 300 / ECON 300").ambiguous)

    def test_suggestion_confidence(self):
        mgt = {"id": "a", "code": "MGT 300", "name": "Principles of Management", "summary": "Planning; leadership; organizational design; motivation"}
        film = {"id": "b", "code": "FILM 201", "name": "Film History", "summary": "silent era; montage; cinematography"}
        auto = suggest_class("Exam review MGT 300", GUIDE_TEXT, [mgt, film])
        self.assertTrue(auto.auto)
        self.assertGreaterEqual(auto.confidence, 0.9)
        soft = suggest_class("Span of control", GUIDE_TEXT + " Leadership and motivation in management planning.", [mgt, film])
        self.assertEqual(soft.class_id, "a")
        self.assertFalse(soft.auto)
        self.assertIsNone(suggest_class("Photosynthesis", "Chlorophyll absorbs light.", [film]))

    def test_screening(self):
        self.assertIsNotNone(screen_share("Exam 2 answers", "", []))
        self.assertIsNotNone(screen_share("Review", "", [{"front": "Midterm answer key", "back": "x"}]))
        test_like = "\n".join(f"{i}. Which is true?\nA. one\nB. two\nC. three" for i in range(1, 8))
        self.assertIsNotNone(screen_share("Practice", test_like, []))
        self.assertIsNone(screen_share("Span of control", GUIDE_TEXT, []))


class SharingFlowTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.s = Session(self.db)
        self.school_id = "00000000-0000-4000-8000-000000000001"
        self.db.rows("schools").append({"id": self.school_id, "name": "Test U", "canvas_domain": "testu.instructure.com", "email_domains": ["testu.edu"]})
        self.db.rows("study_guides").append({"id": "10000000-0000-4000-8000-000000000001", "user_id": "owner", "title": "MGT 300 Span of Control",
                                            "study_guide": GUIDE_TEXT, "notes": "my private notes", "flashcards": [{"front": "Span of control", "back": "Direct reports"}], "folder_id": None})

    def add(self, user, code="MGT-300-102", term="Fall 2026"):
        with self.s.as_user(user):
            return classes.add_class(classes.AddClassRequest(school_id=self.school_id, code=code, name="Management", term=term), "")["class"]

    def test_adding_a_code_links_the_library_class(self):
        # A new code makes its Library class; adding a code to an existing class links that one.
        with self.s.as_user("owner"):
            made = classes.add_class(classes.AddClassRequest(school_id=self.school_id, code="MGT 300", name="Management"), "")
            self.assertEqual(made["folder"]["class_id"], made["class"]["id"])
            self.db.rows("folders").append({"id": "20000000-0000-4000-8000-000000000001", "user_id": "owner", "name": "Film", "class_id": None})
            linked = classes.add_class(classes.AddClassRequest(school_id=self.school_id, code="FILM 201", folder_id="20000000-0000-4000-8000-000000000001"), "")
            self.assertEqual(linked["folder"]["id"], "20000000-0000-4000-8000-000000000001")
            self.assertEqual(linked["folder"]["class_id"], linked["class"]["id"])
            self.assertEqual(len([f for f in self.db.rows("folders") if f["user_id"] == "owner"]), 2)
        with self.s.as_user("outsider"), self.assertRaises(HTTPException):
            classes.add_class(classes.AddClassRequest(school_id=self.school_id, code="FILM 201", folder_id="20000000-0000-4000-8000-000000000001"), "")

    def test_share_flow_end_to_end(self):
        guide_id = "10000000-0000-4000-8000-000000000001"
        mgt = self.add("owner")
        self.add("owner", code="FILM 201")
        self.add("member", term="Spring 2026")  # same class, different term
        self.add("outsider", code="CHEM 2410")

        with self.s.as_user("owner"):
            suggestion = classes.suggest(guide_id, "")["suggestion"]
            self.assertEqual(suggestion["code"], "MGT 300")
            self.assertTrue(suggestion["auto"])          # code in title: >= 90% and one plausible class
            self.assertTrue(suggestion["ask_share"])     # first time: ask once
            self.assertIsNone(suggestion["previous_folder_id"])
            self.assertEqual(self.db.rows("shared_sets"), [])  # nothing shared until they choose
            classes.share_default(mgt["id"], classes.ShareDefaultRequest(share=True, guide_id=guide_id), "")
            state = classes.guide_sharing(guide_id, "")
            self.assertEqual((state["visibility"], state["status"]), ("class", "visible"))
            shared = self.db.rows("shared_sets")[0]
            self.assertNotIn("my private notes", str(shared))
            self.assertIsNone(shared["owner_name"])     # anonymous by default

        with self.s.as_user("member"):
            page = classes.class_page(mgt["id"], "")
            self.assertEqual(len(page["sets"]), 1)
            entry = page["sets"][0]
            self.assertEqual((entry["card_count"], entry["studied_by"]), (1, 0))
            copy_id = classes.save_copy(entry["id"], "")["guide_id"]
            classes.studied(copy_id, classes.StudiedRequest(accuracy=80), "")
            self.assertEqual(classes.class_page(mgt["id"], "")["sets"][0]["studied_by"], 1)
            self.assertFalse(classes.guide_sharing(copy_id, "")["update_available"])

        # Owner edits: the copy shows "Update available"; the copy keeps its own progress row.
        self.db.rows("study_guides")[0]["flashcards"] = [{"front": "Span of control", "back": "Direct reports"}, {"front": "Unity of command", "back": "One boss"}]
        on_guide_changed(self.db, "owner", guide_id)
        with self.s.as_user("member"):
            self.assertTrue(classes.guide_sharing(copy_id, "")["update_available"])
            classes.update_copy(copy_id, "")
            self.assertFalse(classes.guide_sharing(copy_id, "")["update_available"])

        with self.s.as_user("outsider"):
            with self.assertRaises(HTTPException) as caught:
                classes.class_page(mgt["id"], "")
            self.assertEqual(caught.exception.status_code, 403)
            with self.assertRaises(HTTPException):
                classes.get_set(shared["id"], "")

        # Three reports from three people hide it.
        for reporter in ("member", "r2", "r3"):
            if reporter != "member":
                self.add(reporter)
            with self.s.as_user(reporter):
                classes.report_set(shared["id"], classes.ReportRequest(reason="wrong"), "")
            hidden = self.db.rows("shared_sets")[0]["status"] == "hidden"
            self.assertEqual(hidden, reporter == "r3")
        with self.s.as_user("member"):
            self.assertEqual(classes.class_page(mgt["id"], "")["sets"], [])
            with self.assertRaises(HTTPException):
                classes.save_copy(shared["id"], "")

    def test_private_sets_stay_private_and_leaks_are_held(self):
        guide_id = "10000000-0000-4000-8000-000000000001"
        mgt = self.add("owner")
        self.add("member")
        with self.s.as_user("owner"):
            classes.file_guide(classes.FileRequest(guide_id=guide_id, class_id=mgt["id"]), "")
            classes.share_default(mgt["id"], classes.ShareDefaultRequest(share=False, guide_id=guide_id), "")
            self.assertEqual(classes.guide_sharing(guide_id, "")["visibility"], "private")
        with self.s.as_user("member"):
            self.assertEqual(classes.class_page(mgt["id"], "")["sets"], [])
        self.db.rows("study_guides")[0]["title"] = "Exam 2 answers"
        with self.s.as_user("owner"):
            result = classes.set_visibility(guide_id, classes.VisibilityRequest(visibility="class"), "")
            self.assertEqual(result["status"], "held")
        with self.s.as_user("member"):
            self.assertEqual(classes.class_page(mgt["id"], "")["sets"], [])

    def test_instructor_block(self):
        mgt = self.add("owner")
        instructor = SimpleNamespace(email="prof@testu.edu", email_confirmed_at="2026-10-01")
        self.db.auth.admin.get_user_by_id = lambda _uid: SimpleNamespace(user=instructor)
        with self.s.as_user("prof"):
            public_forms.block_course(public_forms.BlockRequest(school_id=self.school_id, course_code="mgt 300"), "")
        with self.s.as_user("owner"):
            self.assertTrue(classes.class_page(mgt["id"], "")["class"]["sharing_blocked"])
            classes.file_guide(classes.FileRequest(guide_id="10000000-0000-4000-8000-000000000001", class_id=mgt["id"]), "")
            with self.assertRaises(HTTPException) as caught:
                classes.set_visibility("10000000-0000-4000-8000-000000000001", classes.VisibilityRequest(visibility="class"), "")
            self.assertEqual(caught.exception.detail, "Sharing is off for this class")
        instructor.email = "someone@gmail.com"
        with self.s.as_user("prof2"):
            with self.assertRaises(HTTPException):
                public_forms.block_course(public_forms.BlockRequest(school_id=self.school_id, course_code="FILM 201"), "")

    def test_takedown_hides_set_immediately(self):
        mgt = self.add("owner")
        guide_id = "10000000-0000-4000-8000-000000000001"
        with self.s.as_user("owner"):
            classes.file_guide(classes.FileRequest(guide_id=guide_id, class_id=mgt["id"]), "")
            classes.share_default(mgt["id"], classes.ShareDefaultRequest(share=True, guide_id=guide_id), "")
        set_id = self.db.rows("shared_sets")[0]["id"]
        with patch.object(public_forms, "get_supabase", return_value=self.db):
            public_forms.takedown(public_forms.TakedownRequest(name="Pub", email="legal@pub.com", work="Chapter 3", location=f"https://classroom.cordiaai.io/class/x?set={set_id}", statement=True))
        self.assertEqual(self.db.rows("shared_sets")[0]["status"], "taken_down")



class CalendarClassesTests(unittest.TestCase):
    def test_codes_in_event_titles_become_calendar_memberships(self):
        from routers import calendar
        db = FakeDB()
        items = [{"title": "Essay 1 [MGT-300-102-FA26]"}, {"title": "Lab [CHEM 2410.01]"}, {"title": "Club meeting"}]
        with patch.object(calendar, "get_supabase", return_value=db):
            calendar._import_classes("u1", "https://testu.instructure.com/feeds/calendars/user_x.ics", items)
        self.assertEqual(sorted(r["course_code_normalized"] for r in db.rows("classes")), ["CHEM 2410", "MGT 300"])
        self.assertEqual({m["source"] for m in db.rows("class_memberships")}, {"calendar"})
        self.assertEqual(db.rows("schools")[0]["canvas_domain"], "testu.instructure.com")


if __name__ == "__main__":
    unittest.main()
