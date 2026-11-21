"""T4b: what the Tutor shows while it works (backend/services/tutor_status.py, POST /tutor/status,
GET /tutor/steps, the steps noted in routers/chat.py)."""
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import app
from routers import chat
from services import tutor_status

AUTH = {"Authorization": "Bearer test"}
SESSION = "11111111-1111-4111-8111-111111111111"

# Lines a good model returns, by discipline. Each must be kept untouched.
GOOD = {
    "nursing": ("What are the signs of digoxin toxicity?", [
        "Weighing digoxin toxicity warning signs", "Connecting potassium levels to heart rhythm", "Sorting early from late symptoms"]),
    "art history": ("Why did the Impressionists paint outdoors?", [
        "Tracing Impressionism's turn to open air", "Comparing light in studio and field work", "Placing Monet among his peers"]),
    "law": ("What is the difference between a tort and a crime?", [
        "Separating private wrongs from public ones", "Comparing burden of proof in each case", "Sorting remedies from punishments"]),
    "literature": ("What does the green light mean in Gatsby?", [
        "Unpacking the green light symbol", "Tying Gatsby's longing to the American dream", "Weighing Fitzgerald's use of distance"]),
    "computer science": ("Why is binary search O(log n)?", [
        "Halving the search range each step", "Counting steps as a logarithm", "Comparing binary and linear search", "Handling C++ array bounds"]),
}


class LineRulesTests(unittest.TestCase):
    def test_good_lines_in_five_disciplines_are_kept(self):
        for field, (question, lines) in GOOD.items():
            with self.subTest(field=field):
                self.assertEqual(tutor_status.clean_lines({"lines": lines}, question), lines)

    def test_numerals_acronyms_and_proper_nouns_are_not_first_person_or_title_case(self):
        # Review fix: "I" and "US" matched with IGNORECASE and a capital count threw these out.
        kept = [
            "Tracing the causes of World War I",          # history
            "Comparing US and UK contract law",           # law
            "Weighing Phase I trial results",             # nursing
            "Placing Caravaggio in the Roman Baroque",    # art history
            "Tracing Act I of Hamlet",                    # literature
            "Placing Beowulf in Old English poetry",      # literature
            "Comparing Python and C++ memory models",     # computer science
            "Explaining Big O notation for sorting",      # computer science
            "Contrasting TCP and UDP handshakes",         # computer science
            "Weighing Vitamin A and iron intake",         # nursing
            "Sorting Henry I from Henry II",              # history
        ]
        for line in kept:
            with self.subTest(line=line):
                self.assertEqual(tutor_status.valid_line(line), line)
        self.assertEqual(tutor_status.clean_lines({"lines": kept[:3]}, "q"), kept[:3])

    def test_first_person_and_title_case_are_still_caught_by_exact_case(self):
        dropped = [
            "Working out what I know about cells",
            "Thinking I can solve this",                  # "I" after the first word is still the Tutor
            "Thinking about what I'm able to do",
            "Weighing what drives us forward",
            "Walking through our Krebs cycle",
            "Planning my route through Hamlet",
            "Tracing The Rise Of The Roman Empire",       # Title Case: capitalised small words
            "Planning A Trip Through Gaul",
            "Comparing Torts And Crimes",
            "Mapping Cells In The Body",
        ]
        for line in dropped:
            with self.subTest(line=line):
                self.assertIsNone(tutor_status.valid_line(line), line)

    def test_at_most_four_lines_and_no_repeats(self):
        lines = ["Tracing the Krebs cycle", "Tracing the krebs cycle", "Comparing glycolysis and fermentation", "Linking ATP to work",
                 "Mapping electron carriers", "Naming each enzyme"]
        self.assertEqual(tutor_status.clean_lines({"lines": lines}, "krebs"), [lines[0], lines[2], lines[3], lines[4]])

    def test_each_rule_drops_the_line_that_breaks_it(self):
        bad = {
            "too short": "Tracing cycles",
            "too long": "Tracing the Krebs cycle step by step through every stage",
            "not an -ing verb": "Krebs cycle explained simply",
            "a noun ending in ing": "Something about the Krebs cycle",
            "Title Case": "Tracing The Krebs Cycle Step By Step",
            "lower case start": "tracing the krebs cycle steps",
            "exclamation": "Tracing the Krebs cycle!",
            "emoji": "Tracing the Krebs cycle \U0001F9EC",
            "ellipsis character": "Tracing the Krebs cycle…",
            "three dots": "Tracing the Krebs cycle...",
            "searching": "Searching for Krebs cycle notes",
            "checking": "Checking the Krebs cycle details",
            "reading": "Reading about the Krebs cycle",
            "looking": "Looking up the Krebs cycle",
            "first person": "Working out what I know about the Krebs cycle",
            "first person plural": "Walking through our Krebs cycle",
            "not a string": 42,
        }
        for rule, line in bad.items():
            with self.subTest(rule=rule):
                self.assertIsNone(tutor_status.valid_line(line), line)

    def test_first_person_is_allowed_only_when_the_question_is_about_cordia(self):
        line = "Thinking about what I can help with"
        self.assertIsNone(tutor_status.valid_line(line, about_cordia_message=False))
        self.assertEqual(tutor_status.valid_line(line, about_cordia_message=True), line)
        self.assertEqual(tutor_status.clean_lines(["Thinking about what I can help with", "Choosing where to start"], "What can you do?"),
                         ["Thinking about what I can help with", "Choosing where to start"])
        self.assertEqual(tutor_status.clean_lines(["Thinking about what I can help with", "Choosing where to start"], "Why is the sky blue?"), [])
        for question in ("What can you do?", "Who are you?", "How does Cordia work?", "Are you an AI?"):
            self.assertTrue(tutor_status.about_cordia(question), question)
        for question in ("Can you explain osmosis?", "What can you tell me about the Krebs cycle?", "How do you solve a quadratic?"):
            self.assertFalse(tutor_status.about_cordia(question), question)

    def test_a_trailing_period_is_trimmed_and_wrapping_quotes_removed(self):
        self.assertEqual(tutor_status.valid_line("\"Tracing the Krebs cycle.\""), "Tracing the Krebs cycle")

    def test_fewer_than_two_good_lines_is_a_failure(self):
        self.assertEqual(tutor_status.clean_lines({"lines": ["Tracing the Krebs cycle", "Searching your notes"]}, "q"), [])
        for raw in (None, "text", {"lines": "text"}, {"other": []}, [], 7):
            self.assertEqual(tutor_status.clean_lines(raw, "q"), [])


def _client_returning(content: str):
    """A fake chat client (the OpenAI shape services.llm_calls.chat speaks) answering with `content`."""
    client = MagicMock()
    client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason="stop")],
        usage=SimpleNamespace(prompt_tokens=120, completion_tokens=40, prompt_tokens_details=SimpleNamespace(cached_tokens=0)),
    )
    return client


class StatusCallTests(unittest.TestCase):
    def test_the_call_uses_the_light_tier_with_80_tokens_and_logs_tutor_status(self):
        logged, done = [], threading.Event()
        client = _client_returning('{"lines": ["Tracing the Krebs cycle", "Linking ATP to work", "Mapping electron carriers"]}')

        def insert(row):
            logged.append(row)
            done.set()

        with patch("services.llm.get_openai_client", return_value=client), patch("services.llm_calls._insert_usage", insert):
            lines = tutor_status.status_lines("Explain the Krebs cycle", "Biology 101 notes", "BIO 101")
        self.assertTrue(done.wait(2))
        self.assertEqual(lines, ["Tracing the Krebs cycle", "Linking ATP to work", "Mapping electron carriers"])
        self.assertEqual(logged[0]["feature"], "tutor_status")
        self.assertEqual(logged[0]["model"], tutor_status_model())
        kwargs = client.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["model"], tutor_status_model())
        self.assertEqual(kwargs["max_tokens"] - _headroom(), 80)
        sent = " ".join(message["content"] for message in kwargs["messages"])
        self.assertIn("BIO 101", sent)
        self.assertIn("Biology 101 notes", sent)
        self.assertIn("Explain the Krebs cycle", sent)

    def test_the_prompt_states_every_rule_in_domain_neutral_words(self):
        self.assertIn("3 to 7 words", tutor_status.RULES)
        self.assertIn("sentence case", tutor_status.RULES)
        self.assertIn("-ing verb", tutor_status.RULES)
        self.assertIn("Use the first person only when the message asks about Cordia itself", tutor_status.RULES)
        self.assertIn("No exclamation marks, emoji or ellipsis", tutor_status.RULES)
        self.assertIn("Never say the Tutor searched, checked, read", tutor_status.RULES)
        lowered = tutor_status.RULES.lower()
        for narrow in ("discovered", "invented", "patient", "diagnos"):
            self.assertNotIn(narrow, lowered)

    def test_a_failing_call_gives_no_lines(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError("model down")
        with patch("services.llm.get_openai_client", return_value=client):
            self.assertEqual(tutor_status.status_lines("Explain osmosis"), [])

    def test_unreadable_model_output_gives_no_lines(self):
        for content in ("not json", '{"lines": 3}', '{"lines": ["Searching your notes", "Reading the question"]}', ""):
            with self.subTest(content=content), patch("services.llm.get_openai_client", return_value=_client_returning(content)), \
                    patch("services.llm_calls._insert_usage"):
                self.assertEqual(tutor_status.status_lines("Explain osmosis"), [])

    def test_a_slow_call_is_given_up_on_at_the_deadline(self):
        release = threading.Event()
        finished = []

        def slow(*_):
            release.wait(5)
            finished.append(True)
            return ["Tracing the Krebs cycle", "Linking ATP to work"]

        started = time.monotonic()
        with patch.object(tutor_status, "_ask", slow), patch.object(tutor_status, "STATUS_TIMEOUT_SECONDS", 0.3):
            lines = tutor_status.status_lines("Explain the Krebs cycle")
        self.assertEqual(lines, [])
        self.assertLess(time.monotonic() - started, 1.5)
        release.set()


def tutor_status_model():
    from services import models
    return models.model_for("tutor_status")


def _headroom():
    from services import models
    return 2048 if models.GROQ else 0


@patch("routers.tutor.get_user_id", return_value="student-1")
class StatusRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_it_needs_a_signed_in_student(self, _):
        with patch("routers.tutor.get_user_id", side_effect=HTTPException(status_code=401, detail="Missing")):
            self.assertEqual(self.client.post("/tutor/status", json={"question": "Explain osmosis"}).status_code, 401)
            self.assertEqual(self.client.get("/tutor/steps", params={"session_id": SESSION}).status_code, 401)

    def test_it_returns_the_lines_and_never_counts_toward_a_limit(self, _):
        with patch("routers.chat.require") as require, patch("routers.chat.record") as record, \
                patch("services.entitlements.require") as plan_require, patch("services.entitlements.record") as plan_record, \
                patch("services.tutor_status._ask", return_value=["Tracing osmosis across membranes", "Comparing water and solute movement"]) as ask:
            response = self.client.post("/tutor/status", headers=AUTH, json={"question": "Explain osmosis", "class_name": "BIO 101", "title": "Cells"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"lines": ["Tracing osmosis across membranes", "Comparing water and solute movement"]})
        self.assertEqual(ask.call_args.args, ("Explain osmosis", "Cells", "BIO 101"))
        for counted in (require, record, plan_require, plan_record):
            counted.assert_not_called()

    def test_tutor_status_is_not_a_limited_feature(self, _):
        from services.entitlements import FEATURES
        self.assertNotIn("tutor_status", FEATURES)

    def test_a_failed_call_still_answers_with_no_lines(self, _):
        with patch("services.tutor_status._ask", side_effect=RuntimeError("down")):
            response = self.client.post("/tutor/status", headers=AUTH, json={"question": "Explain osmosis"})
        self.assertEqual((response.status_code, response.json()), (200, {"lines": []}))

    def test_steps_are_read_for_the_students_own_session_only(self, _):
        tutor_status.begin("student-1", SESSION)
        tutor_status.note_step("Drawing a diagram")
        try:
            self.assertEqual(self.client.get("/tutor/steps", headers=AUTH, params={"session_id": SESSION}).json(), {"steps": ["Drawing a diagram"]})
            with patch("routers.tutor.get_user_id", return_value="student-2"):
                self.assertEqual(self.client.get("/tutor/steps", headers=AUTH, params={"session_id": SESSION}).json(), {"steps": []})
            self.assertEqual(self.client.get("/tutor/steps", headers=AUTH, params={"session_id": "not-an-id"}).status_code, 400)
        finally:
            tutor_status.end()
        self.assertEqual(self.client.get("/tutor/steps", headers=AUTH, params={"session_id": SESSION}).json(), {"steps": []})


@patch("routers.tutor.get_user_id", return_value="student-1")
class StatusLimitTests(unittest.TestCase):
    """Review fix: the status call spends tokens, so each student has their own limit beside the per-address one,
    and the step poll is counted per student, not per address."""

    def setUp(self):
        import rate_limit
        rate_limit._hits.clear()
        self.addCleanup(rate_limit._hits.clear)
        self.client = TestClient(app)

    def test_status_is_limited_per_student_and_a_neighbour_on_the_same_address_is_not(self, _):
        same_address = {"Fly-Client-IP": "203.0.113.7"}
        mine = {**same_address, "Authorization": "Bearer student-one"}
        neighbour = {**same_address, "Authorization": "Bearer student-two"}
        with patch("services.tutor_status._ask", return_value=[]):
            codes = [self.client.post("/tutor/status", headers=mine, json={"question": "Explain osmosis"}).status_code for _ in range(21)]
            self.assertEqual(codes[:20], [200] * 20)
            self.assertEqual(codes[20], 429)
            self.assertEqual(self.client.post("/tutor/status", headers=neighbour, json={"question": "Explain osmosis"}).status_code, 200)

    def test_the_step_poll_is_counted_per_student_not_per_address(self, _):
        same_address = {"Fly-Client-IP": "203.0.113.7"}
        mine = {**same_address, "Authorization": "Bearer student-one"}
        neighbour = {**same_address, "Authorization": "Bearer student-two"}
        params = {"session_id": SESSION}
        codes = [self.client.get("/tutor/steps", headers=mine, params=params).status_code for _ in range(241)]
        self.assertEqual(set(codes[:240]), {200})
        self.assertEqual(codes[240], 429)
        self.assertEqual(self.client.get("/tutor/steps", headers=neighbour, params=params).status_code, 200)

    def test_the_limit_answers_with_a_plain_429_the_web_app_ignores(self, _):
        mine = {"Authorization": "Bearer student-one"}
        with patch("services.tutor_status._ask", return_value=[]):
            for _ in range(20):
                self.client.post("/tutor/status", headers=mine, json={"question": "Explain osmosis"})
            response = self.client.post("/tutor/status", headers=mine, json={"question": "Explain osmosis"})
        self.assertEqual(response.status_code, 429)
        self.assertNotIn("lines", response.json())


class StepStoreTests(unittest.TestCase):
    def tearDown(self):
        tutor_status.end()

    def test_steps_keep_their_order_and_do_not_repeat_back_to_back(self):
        tutor_status.begin("u", SESSION)
        for step in ("Reading Cells", "Reading Cells", "Drawing a diagram"):
            tutor_status.note_step(step)
        self.assertEqual(tutor_status.steps_for("u", SESSION), ["Reading Cells", "Drawing a diagram"])

    def test_a_new_request_forgets_the_last_ones_steps_and_end_clears_them(self):
        tutor_status.begin("u", SESSION)
        tutor_status.note_step("Reading Cells")
        tutor_status.begin("u", SESSION)
        self.assertEqual(tutor_status.steps_for("u", SESSION), [])
        tutor_status.note_step("Reading Cells")
        tutor_status.end()
        self.assertEqual(tutor_status.steps_for("u", SESSION), [])

    def test_without_a_session_nothing_is_noted(self):
        tutor_status.begin("u", None)
        tutor_status.note_step("Reading Cells")
        self.assertEqual(tutor_status.steps_for("u", SESSION), [])

    def test_steps_older_than_the_limit_are_not_shown(self):
        tutor_status.begin("u", SESSION)
        tutor_status.note_step("Reading Cells")
        with patch.object(tutor_status, "STEP_TTL_SECONDS", -1):
            self.assertEqual(tutor_status.steps_for("u", SESSION), [])


def _turn():
    return {"id": SESSION, "run_id": "run-1", "active_skill": "explain", "conversation_version": 0, "messages": [{"role": "user", "text": "q"}]}


@patch("routers.chat.get_user_id", return_value="student-1")
@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
class RealStepTests(unittest.TestCase):
    """Each real step shows up while /chat is working on it, and only when it is really happening."""

    def setUp(self):
        self.client = TestClient(app)
        self.seen = []
        self.patches = [
            patch("routers.chat.claim_tutor_turn", return_value=_turn()),
            patch("routers.chat.complete_tutor_turn", return_value={"id": SESSION}),
            patch("routers.chat.public_tutor_session", return_value={"id": SESSION}),
            patch("services.student_memory.learn_from_tutor"),
        ]
        for item in self.patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in self.patches])

    def snapshot(self, *_args, **_kwargs):
        self.seen.append(tutor_status.steps_for("student-1", SESSION))

    def post(self, **fields):
        body = {"question": "Explain the Krebs cycle", "content": "The Krebs cycle makes ATP.", "session_id": SESSION, **fields}
        response = self.client.post("/chat", headers=AUTH, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def answer(self, *_args, **kwargs):
        self.snapshot()
        return "**Answer.**"

    def test_reading_the_selected_file_is_a_step_while_the_tutor_reads_it(self, *_):
        with patch("routers.chat.answer_question", side_effect=self.answer):
            self.post(context_title="Krebs lecture.pdf")
        self.assertEqual(self.seen, [["Reading Krebs lecture.pdf"]])

    def test_a_general_question_has_no_real_step(self, *_):
        with patch("routers.chat.answer_question", side_effect=self.answer), patch("routers.chat.ground_general_answer", side_effect=lambda a, q: a):
            self.post(content="")
        self.assertEqual(self.seen, [[]])

    def test_a_diagram_request_shows_drawing_a_diagram(self, *_):
        def written(question, material):
            self.snapshot()
            return {"title": "Krebs cycle", "text": "Cycle of steps"}

        with patch("routers.chat.write_visual_text", side_effect=written):
            self.post(question="Draw a diagram of the Krebs cycle")
        self.assertEqual(self.seen, [["Drawing a diagram"]])

    def test_a_diagram_that_cannot_be_written_is_not_left_as_a_step(self, *_):
        # Review fix: the answer carries on as text, so nobody is told about a diagram that was never drawn.
        def nothing(question, material):
            self.snapshot()  # while the Tutor really is trying to draw
            return None

        with patch("routers.chat.write_visual_text", side_effect=nothing), patch("routers.chat.answer_question", side_effect=self.answer), \
                patch("routers.chat.ground_general_answer", side_effect=lambda a, q: a):
            self.post(question="Draw a diagram of the Krebs cycle", content="")
        self.assertEqual(self.seen, [["Drawing a diagram"], []])

    def test_retracting_a_step_takes_back_only_the_newest_one(self, *_):
        tutor_status.begin("u", SESSION)
        try:
            for step in ("Drawing a diagram", "Reading Cells", "Drawing a diagram"):
                tutor_status.note_step(step)
            tutor_status.retract_step("Drawing a diagram")
            self.assertEqual(tutor_status.steps_for("u", SESSION), ["Drawing a diagram", "Reading Cells"])
            tutor_status.retract_step("Never noted")
            self.assertEqual(tutor_status.steps_for("u", SESSION), ["Drawing a diagram", "Reading Cells"])
        finally:
            tutor_status.end()

    def test_building_a_guide_shows_building_your_study_guide(self, *_):
        def built(*_a, **_k):
            self.snapshot()
            return "STUDY GUIDE", [{"q": "a"}]

        saved = SimpleNamespace(data=[{"id": "g1", "title": "Krebs lecture — Study Guide", "folder_id": None}])
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value = saved
        with patch.dict(chat.GUIDE_KINDS, {"guide": ("Study Guide", "Study guide", built)}), patch("routers.chat.get_supabase", return_value=supabase), \
                patch("routers.chat.start_quiz_warmup"), \
                patch("routers.chat.claim_tutor_turn", return_value={**_turn(), "active_skill": "build_guide"}):
            self.post(question="Build a study guide from this", skill="build_guide", context_title="Krebs lecture")
        self.assertEqual(self.seen, [["Building your study guide"]])

    def test_building_practice_problems_shows_building_your_practice_set(self, *_):
        def built(*_a, **_k):
            self.snapshot()
            return "PRACTICE", [{"q": "a"}]

        saved = SimpleNamespace(data=[{"id": "g1", "title": "Krebs lecture — Practice Problems", "folder_id": None}])
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value = saved
        with patch.dict(chat.GUIDE_KINDS, {"practice": ("Practice Problems", "Practice guide", built)}), patch("routers.chat.get_supabase", return_value=supabase), \
                patch("routers.chat.start_quiz_warmup"):
            self.post(question="Make practice problems", skill="practice", context_title="Krebs lecture")
        self.assertEqual(self.seen, [["Building your practice set"]])

    def test_a_canvas_assignment_shows_checking_canvas_then_reading_it(self, *_):
        source = {"type": "assignment", "id": "canvas-1", "title": "Lab report"}
        with patch("routers.chat._assignment_text", side_effect=lambda *a: (self.snapshot(), ("ASSIGNMENT: Lab report", source))[1]), \
                patch("routers.chat.answer_question", side_effect=self.answer):
            self.post(assignment_key="canvas-1", content="")
        self.assertEqual(self.seen, [["Checking Canvas for your assignment"], ["Checking Canvas for your assignment", "Reading Lab report"]])

    def test_a_connected_app_shows_checking_it_then_reading_what_was_found(self, *_):
        from routers import connectors
        account, found = {"notion": "acct"}, SimpleNamespace(readable=True, sub_pages=[], reason="", text_within=lambda n: ("Notes text", False))
        with patch.object(connectors, "named_app", return_value="notion"), patch.object(connectors.composio, "configured", return_value=True), \
                patch.object(connectors.composio, "active_accounts", return_value=account), \
                patch.object(connectors.connector_settings, "uses", return_value={"tutor": True}), \
                patch.object(connectors.composio, "run", side_effect=lambda *a, **k: (self.snapshot(), {"results": [{"id": "p1", "object": "page", "properties": {"title": {"title": [{"plain_text": "Week 3 notes"}]}}}]})[1]), \
                patch.object(connectors, "_notion_title", return_value="Week 3 notes"), \
                patch.object(connectors.notion_text, "read_page", return_value=found), \
                patch("routers.chat.answer_question", side_effect=self.answer):
            self.post(question='What does my Notion page "Week 3 notes" say?', content="")
        self.assertEqual(self.seen[0], ['Checking Notion for Week 3 notes'])
        self.assertEqual(self.seen[-1], ["Checking Notion for Week 3 notes", "Reading Notion: Week 3 notes"])

    def test_the_steps_are_gone_once_the_answer_is_sent(self, *_):
        with patch("routers.chat.answer_question", side_effect=self.answer):
            self.post(context_title="Krebs lecture.pdf")
        self.assertEqual(tutor_status.steps_for("student-1", SESSION), [])

    def test_a_failed_answer_clears_the_steps_too(self, *_):
        with patch("routers.chat.answer_question", side_effect=RuntimeError("boom")), patch("routers.chat.fail_tutor_turn"):
            client = TestClient(app, raise_server_exceptions=False)
            response = client.post("/chat", headers=AUTH, json={"question": "q", "content": "c", "context_title": "File", "session_id": SESSION})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(tutor_status.steps_for("student-1", SESSION), [])

    def test_the_extension_without_a_session_notes_nothing_and_its_reply_is_unchanged(self, *_):
        with patch("routers.chat.claim_tutor_turn") as claim, patch("routers.chat.answer_question", side_effect=self.answer):
            response = self.client.post("/chat", headers=AUTH, json={"question": "Explain it", "content": "Text", "context_title": "Lecture"})
        claim.assert_not_called()
        self.assertEqual(self.seen, [[]])
        self.assertNotIn("steps", response.json())
        self.assertEqual(response.json()["answer"], "**Answer.**")


@patch("routers.chat.get_user_id", return_value="student-1")
@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.tutor.get_user_id", return_value="student-1")
class NeverDelaysTheAnswerTests(unittest.TestCase):
    def test_a_slow_status_call_does_not_slow_the_answer_and_chat_never_calls_it(self, *_):
        release = threading.Event()

        def slow_ask(*_a):
            release.wait(3)
            return ["Tracing the Krebs cycle", "Linking ATP to work"]

        status_done, chat_seconds = [], []

        def run_status():
            started = time.monotonic()
            TestClient(app).post("/tutor/status", headers=AUTH, json={"question": "Explain the Krebs cycle"})
            status_done.append(time.monotonic() - started)

        def run_chat():
            started = time.monotonic()
            response = TestClient(app).post("/chat", headers=AUTH, json={"question": "Explain the Krebs cycle", "content": "ATP.", "context_title": "Notes"})
            chat_seconds.append((time.monotonic() - started, response.status_code))

        with patch.object(tutor_status, "_ask", slow_ask), patch.object(tutor_status, "STATUS_TIMEOUT_SECONDS", 1.2), \
                patch("routers.chat.answer_question", return_value="**Answer.**"), \
                patch("services.student_memory.learn_from_tutor"), \
                patch.object(tutor_status, "status_lines", wraps=tutor_status.status_lines) as lines:
            status = threading.Thread(target=run_status)
            status.start()
            time.sleep(0.15)  # the status call is in flight (and slow) when the answer is asked for
            run_chat()
            self.assertFalse(status_done, "the status call is still waiting while the answer has already come back")
            status.join(5)
            release.set()
        self.assertEqual(chat_seconds[0][1], 200)
        self.assertLess(chat_seconds[0][0], 0.6, "the answer did not wait for the status call")
        self.assertGreaterEqual(status_done[0], 1.0, "the status call really was slow")
        self.assertEqual(lines.call_count, 1, "only the status request made a status call; /chat made none")


if __name__ == "__main__":
    unittest.main()
