"""The Tutor as a study helper: a test to study for gets a plan with buttons, "make a Learn for it" builds
the set and opens Learn, and a finished check-in comes back to the Tutor with what to do next and when."""
import sys
from datetime import date, datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from main import app
from rate_limit import limiter  # noqa: E402
from routers import chat  # noqa: E402
from services import study_helper  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402

AUTH = {"Authorization": "Bearer test"}
ME, OTHER = "student-1", "student-2"
GUIDE = "11111111-1111-4111-8111-111111111111"
THEIRS = "22222222-2222-4222-8222-222222222222"
NOTE = "33333333-3333-4333-8333-333333333333"
WEDNESDAY = date(2026, 11, 18)

# One request per discipline: the same intent and the same plan words, whatever the subject.
DISCIPLINES = {
    "nursing": ("I need to study for my pharmacology exam on Friday", "Pharmacology Unit 2"),
    "art history": ("help me prep for the art history midterm tomorrow", "Art History: Baroque"),
    "business law": ("I have a business law final in 5 days", "Business Law — Contracts"),
    "literature": ("I've got a literature quiz Dec 3, can you help me get ready?", "Literature: Beloved"),
    "computer science": ("studying for my algorithms test next week", "Algorithms and Data Structures"),
}


class IntentAndDateTests(unittest.TestCase):
    def test_every_discipline_reads_as_studying_for_a_test(self):
        for name, (question, title) in DISCIPLINES.items():
            with self.subTest(discipline=name):
                self.assertTrue(study_helper.asks_to_study_for_test(question))
                self.assertIsNotNone(study_helper.parse_test_date(question, WEDNESDAY))
                self.assertEqual(study_helper.match_guide(question, [{"id": "x", "title": "Unrelated"}, {"id": "g", "title": title}]),
                                 {"id": "g", "title": title})

    def test_questions_and_other_requests_are_not_study_plans(self):
        for text in ("What is osmosis?", "Explain the doctrine of consideration", "make practice questions for my test",
                     "help me learn about cells", "I have to review the reading"):
            self.assertFalse(study_helper.asks_to_study_for_test(text), text)

    def test_make_a_learn_is_told_apart(self):
        for text in ("Make a Learn for it", "set up Learn for my exam", "can you build a learn set", "open Learn for biology"):
            self.assertTrue(study_helper.asks_for_learn(text), text)
        for text in ("help me learn about cells", "make it easier to learn this", "I want to learn this"):
            self.assertFalse(study_helper.asks_for_learn(text), text)

    def test_dates_are_the_students_days(self):
        parse = lambda text: study_helper.parse_test_date(text, WEDNESDAY)
        self.assertEqual(parse("test tomorrow"), date(2026, 11, 19))
        self.assertEqual(parse("exam on friday"), date(2026, 11, 20))
        self.assertEqual(parse("exam next wednesday"), date(2026, 11, 25))
        self.assertEqual(parse("exam wednesday"), WEDNESDAY)
        self.assertEqual(parse("in two weeks"), date(2026, 12, 2))
        self.assertEqual(parse("on Jan 9"), date(2027, 1, 9))
        self.assertEqual(parse("the 3rd of December"), date(2026, 12, 3))
        self.assertIsNone(parse("soon"))

    def test_short_course_names_match_titles(self):
        self.assertEqual(study_helper.match_guide("bio test friday", [{"id": "a", "title": "Chemistry"}, {"id": "b", "title": "Biology 101"}])["id"], "b")
        self.assertIsNone(study_helper.match_guide("my test friday", [{"id": "a", "title": "Chemistry"}]))


class PlanTextTests(unittest.TestCase):
    def test_a_plan_with_a_guide_and_date_starts_the_check_in(self):
        answer, plan = study_helper.plan_reply(today=WEDNESDAY, when=date(2026, 11, 23), guide={"id": GUIDE, "title": "Biology"}, exam=None)
        self.assertIn("on Monday, Nov 23 (5 days away)", answer)
        self.assertIn("**Final check** the day before, Sunday.", answer)
        self.assertEqual(plan["actions"], [{"kind": "checkin", "label": "Start the check-in quiz", "href": f"/learn/{GUIDE}?test=2026-11-23&checkin=1"}])
        self.assertEqual(plan["test_date"], "2026-11-23")

    def test_without_a_date_it_asks_for_one(self):
        answer, plan = study_helper.plan_reply(today=WEDNESDAY, when=None, guide={"id": GUIDE, "title": "Biology"}, exam=None)
        self.assertIn("tell me the test date", answer)
        self.assertEqual(plan["actions"][0]["href"], f"/learn/{GUIDE}?checkin=1")

    def test_no_slang_and_no_facts_beyond_the_students_own_titles(self):
        for when in (None, WEDNESDAY, date(2026, 11, 19), date(2026, 11, 30)):
            for guide in (None, {"id": GUIDE, "title": "Biology"}):
                answer, _ = study_helper.plan_reply(today=WEDNESDAY, when=when, guide=guide, exam=None)
                self.assertRegex(answer, r"^Let's get you ready for your test")
                self.assertNotRegex(answer.lower(), r"\byo\b|\bhey\b|great question")

    def test_check_in_replies_say_what_and_when_from_score_and_days(self):
        reply = lambda right, when, remaining=8: study_helper.checkin_reply(title="Biology", right=right, total=7, remaining=remaining, when=when, today=WEDNESDAY)
        self.assertIn("master about 2 ideas a day", reply(3, date(2026, 11, 23)))
        self.assertIn("final check on Sunday", reply(3, date(2026, 11, 23)))
        self.assertIn("Your test is tomorrow", reply(6, date(2026, 11, 19)))
        self.assertIn("Your test is today", reply(2, WEDNESDAY))
        self.assertIn("add your test date in Learn", reply(5, None))
        self.assertIn("Strong start", reply(6, None))
        self.assertIn("starting point", reply(1, None))


@patch("routers.chat.start_quiz_warmup")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.chat.get_user_id", return_value=ME)
class ChatRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        limiter.reset()  # /chat allows 30 a minute per client; other modules' tests use it too
        self.db = FakeDB()
        self.db.rows("study_guides").extend([
            {"id": GUIDE, "user_id": ME, "title": "Biology: Cells", "folder_id": None, "study_guide": "Q1: What is a cell?\nA1: A unit.",
             "notes": "", "updated_at": "2026-11-17", "flashcard_progress": {}},
            {"id": THEIRS, "user_id": OTHER, "title": "Chemistry Final Review", "folder_id": None, "study_guide": "", "notes": "", "updated_at": "2026-11-18"},
        ])
        self.db.rows("smart_notes").append({"id": NOTE, "user_id": ME, "title": "Chem notes", "folder_id": None, "content": "<p>Moles count particles.</p>"})
        self.calendar = {"connected": False, "items": []}
        self.patches = [patch("routers.chat.get_supabase", return_value=self.db),
                        patch("routers.calendar.calendar_for", side_effect=lambda _user: self.calendar),
                        patch("services.student_memory.learn_from_tutor")]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def post(self, question, **extra):
        response = self.client.post("/chat", headers=AUTH, json={"question": question, "content": "", "local_date": "2026-11-18", **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ask(self, question, **extra):
        """The web app's Tutor: every message goes through the student's Tutor session."""
        turn = {"id": "session-1", "run_id": "run-1", "active_skill": "explain", "conversation_version": 1,
                "messages": [{"role": "user", "text": question}]}
        with patch("routers.chat.claim_tutor_turn", return_value=turn), \
             patch("routers.chat.complete_tutor_turn", side_effect=lambda _u, _t, response: {**turn, "messages": [*turn["messages"], response]}), \
             patch("routers.chat.public_tutor_session", side_effect=lambda row: {"id": row["id"], "messages": row["messages"]}):
            return self.post(question, session_id="session-1", conversation_version=1, **extra)

    def test_studying_for_a_test_gets_a_plan_with_the_students_own_guide(self, *_):
        body = self.ask("I need to study for my bio test on Friday")
        self.assertEqual(body["action"], "study_plan")
        self.assertEqual(body["study_plan"]["guide"], {"id": GUIDE, "title": "Biology: Cells"})
        self.assertEqual(body["study_plan"]["actions"][0]["href"], f"/learn/{GUIDE}?test=2026-11-20&checkin=1")

    def test_another_students_guide_is_never_offered(self, *_):
        body = self.ask("I need to study for my chemistry final")
        self.assertIsNone(body["study_plan"]["guide"])
        self.assertEqual([action["kind"] for action in body["study_plan"]["actions"]], ["attach", "link"])
        self.assertNotIn(THEIRS, str(body))

    def test_a_selected_note_is_offered_as_the_learn_set(self, *_):
        body = self.ask("I need to study for my chem test", note_id=NOTE)
        self.assertEqual(body["study_plan"]["actions"], [{"kind": "build", "label": "Build the Learn set", "prompt": "Make a Learn for it"}])
        self.assertIn("Chem notes", body["answer"])

    def test_a_selected_guide_for_another_class_is_not_assumed(self, *_):
        body = self.ask("I need to study for my chemistry final", guide_id=GUIDE)
        self.assertIsNone(body["study_plan"]["guide"])
        self.assertIsNone(body.get("source"))

    def test_a_canvas_exam_without_a_guide_offers_the_review_set_and_its_date(self, *_):
        self.calendar = {"connected": True, "items": [{"id": "canvas-77", "title": "Midterm Exam", "course": "HIST 210", "type": "exam",
                                                       "due_at": "2026-11-24T17:00:00Z", "done": False}]}
        body = self.ask("help me prep for the hist midterm")
        self.assertEqual(body["study_plan"]["test_date"], "2026-11-24")
        self.assertEqual(body["study_plan"]["actions"][0], {"kind": "canvas_review", "label": "Build it from Canvas", "item_key": "canvas-77"})

    def test_make_a_learn_builds_once_and_opens_learn(self, *_):
        built = ("Q1: What is a mole?\nA1: A count of particles.", [{"front": "What is a mole?", "back": "A count of particles."}])
        with patch.dict(chat.GUIDE_KINDS, {"guide": ("Study Guide", "Study guide", lambda *_: built)}):
            first = self.ask("Make a Learn for it", note_id=NOTE)
            made = [row for row in self.db.rows("study_guides") if row.get("source_id") == NOTE]
            self.assertEqual(len(made), 1)
            made[0]["created_at"] = datetime.now(timezone.utc).isoformat()  # built just now
            second = self.ask("make a learn for it", note_id=NOTE)
        self.assertEqual(first["action"], "navigate")
        self.assertEqual(first["link"]["href"], f"/learn/{made[0]['id']}?checkin=1")
        self.assertEqual(second["link"], first["link"])
        self.assertEqual(len([row for row in self.db.rows("study_guides") if row.get("source_id") == NOTE]), 1)

    def test_make_a_learn_for_a_selected_guide_opens_it(self, *_):
        body = self.ask("set up Learn for it", guide_id=GUIDE)
        self.assertEqual(body["link"]["href"], f"/learn/{GUIDE}?checkin=1")

    def test_make_a_learn_with_nothing_selected_asks_for_material(self, *_):
        body = self.ask("Make a Learn for it")
        self.assertEqual(body["study_plan"]["actions"], [{"kind": "attach", "label": "Attach notes"}])

    def turn(self, plan, question):
        return {"id": "session-1", "run_id": "run-1", "active_skill": "explain", "conversation_version": 3,
                "messages": [{"role": "user", "text": "I have a bio test"}, {"role": "ai", "text": "Plan", "study_plan": plan},
                             {"role": "user", "text": question}]}

    def ask_in_session(self, question, plan):
        turn = self.turn(plan, question)
        with patch("routers.chat.claim_tutor_turn", return_value=turn), \
             patch("routers.chat.complete_tutor_turn", side_effect=lambda _u, _t, response: {**turn, "messages": [*turn["messages"], response]}), \
             patch("routers.chat.public_tutor_session", side_effect=lambda row: {"id": row["id"], "messages": row["messages"]}):
            return self.post(question, session_id="session-1", conversation_version=3)

    def test_make_a_learn_continues_the_last_plan_with_its_date(self, *_):
        plan = {"guide": {"id": GUIDE, "title": "Biology: Cells"}, "test_date": "2026-11-23", "exam": None, "actions": []}
        body = self.ask_in_session("ok make a Learn for it", plan)
        self.assertEqual(body["link"]["href"], f"/learn/{GUIDE}?test=2026-11-23&checkin=1")
        self.assertEqual(body["session"]["messages"][-1]["link"], body["link"])

    def test_the_date_asked_for_completes_the_plan(self, *_):
        plan = {"guide": {"id": GUIDE, "title": "Biology: Cells"}, "test_date": None, "exam": None, "actions": []}
        body = self.ask_in_session("It's on Friday", plan)
        self.assertEqual(body["action"], "study_plan")
        self.assertEqual(body["study_plan"]["test_date"], "2026-11-20")
        self.assertEqual(body["session"]["messages"][-1]["study_plan"]["actions"][0]["href"], f"/learn/{GUIDE}?test=2026-11-20&checkin=1")

    def test_ordinary_questions_still_reach_the_tutor(self, *_):
        with patch("routers.chat.answer_question", return_value="Osmosis is water moving across a membrane.") as answer, \
             patch("routers.chat.learning_guidance", return_value=""), patch("routers.chat.style_instruction", return_value=""):
            body = self.ask("What is osmosis?", guide_id=GUIDE)
        answer.assert_called_once()
        self.assertIsNone(body.get("study_plan"))


@patch("routers.tutor.get_user_id", return_value=ME)
class CheckinRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        limiter.reset()  # /chat allows 30 a minute per client; other modules' tests use it too
        self.db = FakeDB()
        self.db.rows("study_guides").extend([
            {"id": GUIDE, "user_id": ME, "title": "Biology: Cells"},
            {"id": THEIRS, "user_id": OTHER, "title": "Chemistry"},
        ])
        self.db.rows("tutor_sessions").append({"id": "session-1", "user_id": ME, "messages": [{"role": "user", "text": "bio test"}],
                                               "updated_at": "2026-11-18T10:00:00+00:00", "conversation_version": 2})
        self.patches = [patch("routers.tutor.get_supabase", return_value=self.db), patch("services.tutor_sessions.get_supabase", return_value=self.db)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def send(self, **body):
        payload = {"checkin_id": "learn-1", "guide_id": GUIDE, "right": 3, "total": 7, "remaining": 8,
                   "test_date": "2026-11-23", "local_date": "2026-11-18", **body}
        return self.client.post("/tutor/session/checkin", headers=AUTH, json=payload)

    def test_the_tutor_says_what_to_do_next_and_when(self, _auth):
        response = self.send()
        self.assertEqual(response.status_code, 200, response.text)
        message = response.json()["messages"][-1]
        self.assertTrue(message["text"].startswith("Check-in done on Biology: Cells: 3 of 7 right."))
        self.assertIn("Your test is in 5 days", message["text"])
        self.assertEqual(message["link"], {"href": f"/learn/{GUIDE}", "label": "Learn for Biology: Cells"})

    def test_the_same_check_in_is_posted_once(self, _auth):
        self.send()
        self.send()
        messages = self.db.rows("tutor_sessions")[0]["messages"]
        self.assertEqual(len([message for message in messages if message.get("once") == "checkin:learn-1"]), 1)

    def test_another_students_guide_is_refused(self, _auth):
        self.assertEqual(self.send(guide_id=THEIRS).status_code, 404)
        self.assertEqual(len(self.db.rows("tutor_sessions")[0]["messages"]), 1)

    def test_bad_input_is_a_4xx(self, _auth):
        self.assertEqual(self.send(right=9).status_code, 422)
        self.assertEqual(self.send(guide_id="not-a-uuid").status_code, 400)
        self.assertEqual(self.send(test_date="2026-02-31").status_code, 400)


if __name__ == "__main__":
    unittest.main()
