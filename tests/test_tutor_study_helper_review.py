"""F6 review follow-up (F6b): every probe sentence from the independent review, kept as a test.

- Intent: an ordinary question that happens to contain "test", "final" or "quiz" never becomes a study
  plan; real "I have a test" requests in every discipline still do. "Learn" counts only as the product.
- The extension side panel (no session_id) always gets a normal text answer; no guide is ever built from it.
- Grounding: plain answers are not marked unchecked; answers that state counts, amounts or names are.
- Openers: slang and filler openers are stripped only when punctuation follows them.
- Dates: "chapters 3/4", "sections 1/2" and "what should I do today?" are not test dates.
- A check-in posted while a Tutor turn is running is kept when the turn completes.
"""
import sys
from datetime import date
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from main import app  # noqa: E402
from rate_limit import limiter  # noqa: E402
from routers import chat  # noqa: E402
from services import study_helper, tutor_sessions  # noqa: E402
from services.tutor_voice import plain_opening, states_specifics  # noqa: E402
from fake_supabase import FakeDB  # noqa: E402

AUTH = {"Authorization": "Bearer test"}
ME = "student-1"
GUIDE = "11111111-1111-4111-8111-111111111111"
NOTE = "33333333-3333-4333-8333-333333333333"
WEDNESDAY = date(2026, 11, 18)

# ---- Intent ----

# The reviewer's 25 ordinary questions (finding 1): none of them is a request for a study plan.
ORDINARY = {
    "nursing": [
        "Is the Allen test on radial artery done before an ABG? I'm reviewing it",
        "Help me review the Allen test steps",
        "What's the Romberg test and how do I prepare the patient for it?",
        "I'm reviewing the final stage of labor, what happens?",
        "Review the rationale for the last NCLEX practice quiz answer",
        "I have a test tube question: why does the precipitate form?",
    ],
    "art history": [
        "Studying Monet's later work, why did his final paintings get so blurry?",
        "Can you review this practice test question with me?",
        "I'm ready for the next quiz question",
    ],
    "business law": [
        "Help me review the Howey test for securities",
        "Can you help me prepare for the bar exam essay on the Howey test?",
        "What's the business judgment rule? I have the final case brief due",
        "I got the quiz back, why was question 2 wrong?",
    ],
    "literature": [
        "Help me revise the final paragraph of my essay on Gatsby",
        "Review the final scene of Hamlet with me",
        "What happens in the final act of Macbeth? I'm preparing a presentation",
        "Explain the final cause in Aristotle; I'm reviewing for class",
    ],
    "computer science": [
        "I'm studying how to write unit tests in Python",
        "Review my unit tests for this function",
        "How do I prepare a test case for binary search?",
        "I'm reviewing the t-test vs z-test, what's the difference?",
        "Can you review my answer to quiz question 3?",
        "We got a final answer of 42, is that right?",
    ],
    "general": [
        "what will be on the test about mitosis?",
        "I have a question about the final exam format",
    ],
}

# Real study requests: the reviewer's six (L11 included) and more in each discipline.
STUDYING = {
    "nursing": ["I need to study for my pharmacology exam on Friday", "I have an exam on Friday",
                "help me get ready for my NCLEX practice test", "my med-surg final is next week", "I need to study for my bio test"],
    "art history": ["my art history final is next week, help", "help me prep for the art history midterm tomorrow",
                    "I've got an art history quiz Thursday"],
    "business law": ["test tomorrow on contracts, what should I do", "I have a business law final in 5 days",
                     "studying for my contracts exam, where do I start?"],
    "literature": ["I've got a literature quiz Dec 3, can you help me get ready?", "help me prep for the midterm",
                   "I need to study for my English test"],
    "computer science": ["I've got a quiz Thursday in CS 101", "studying for my algorithms test next week",
                         "exam tomorrow in data structures, help"],
}

# "Learn" as an ordinary verb (finding 2): never a request to build a Learn set.
LEARN_ORDINARY = [
    "Make me a list of things to learn for the quiz",
    "Help me make sense of what I need to learn for the final",
    "Make a learning plan for chapter 3",
    "What did we learn for today? make it short",
    "Can you open the learn page?",
    "start learning for the exam",
    "I want to start to learn for my exam",
    "Make a flashcard set so I can learn for the test",
    "Create a summary of what to learn for Friday",
    "Generate examples of how to learn for a test efficiently",
]
LEARN_REQUESTS = ["Make a Learn for it", "make a learn for it", "set up Learn for my exam", "can you build a learn set",
                  "open Learn for biology", "ok make a Learn for it", "start a Learn round", "Learn for this, please"]


class IntentTests(unittest.TestCase):
    def test_ordinary_questions_in_every_discipline_are_not_study_plans(self):
        hits = [question for questions in ORDINARY.values() for question in questions if study_helper.asks_to_study_for_test(question)]
        self.assertEqual(sum(len(questions) for questions in ORDINARY.values()), 25)
        self.assertEqual(hits, [])

    def test_real_study_requests_in_every_discipline_are_recognised(self):
        for discipline, questions in STUDYING.items():
            for question in questions:
                with self.subTest(discipline=discipline, question=question):
                    self.assertTrue(study_helper.asks_to_study_for_test(question))

    def test_a_question_asking_to_study_for_a_test_the_student_sits_is_a_plan_request(self):
        for question in ["Can we study for my biology exam?", "Could you help me study for my contracts final?",
                         "Will you help me prep for my art history midterm?", "Can you review for my nursing pharmacology quiz?",
                         "Could we get ready for my literature test on Friday?", "Can we study for the CS 101 final?"]:
            with self.subTest(question=question):
                self.assertTrue(study_helper.asks_to_study_for_test(question))

    def test_a_question_about_the_content_of_a_test_is_not(self):
        for question in ["What will be on the test about mitosis?", "Can we review the Howey test for securities?",
                         "Could you explain what the final exam covers?", "Can you study this practice test question with me?",
                         "Can we go over my unit tests?"]:
            with self.subTest(question=question):
                self.assertFalse(study_helper.asks_to_study_for_test(question))

    def test_a_question_about_learn_is_not_a_learn_request(self):
        for question in ["How does a Learn session work?", "What is a Learn set?", "Why does a Learn round start with a quiz?",
                         "Can you explain a Learn session?", "Is a Learn set the same as flashcards?"]:
            with self.subTest(question=question):
                self.assertFalse(study_helper.asks_for_learn(question))

    def test_requests_for_learn_stay_requests_even_when_polite_or_after_a_question(self):
        for question in ["Make a Learn for it", "Open Learn on this", "Can you make a Learn set from my notes?",
                         "Could you open a Learn session for my chem notes?", "How does it work? Make a Learn for it."]:
            with self.subTest(question=question):
                self.assertTrue(study_helper.asks_for_learn(question))

    def test_learn_as_a_verb_is_not_a_learn_request(self):
        self.assertEqual([text for text in LEARN_ORDINARY if study_helper.asks_for_learn(text)], [])

    def test_learn_as_the_product_is(self):
        self.assertEqual([text for text in LEARN_REQUESTS if not study_helper.asks_for_learn(text)], [])


# ---- Second review (F6c): Learn is a closed grammar the whole sentence must match ----

# The reviewer's 18 questions about Learn (rook-f6b/intent_new.py learn_q) and the planner's harder ones.
LEARN_QUESTIONS = [
    "How long does a Learn round take?", "Does the Learn set use my flashcards?", "What happens when I finish a Learn session?",
    "Where do I find my Learn set?", "Which guide does a Learn session use?", "Tell me about the Learn set",
    "Do you know how a Learn round scores me?", "Can a Learn set be shared?", "So how do I start a Learn round?",
    "I'm confused about what a Learn session is", "Should I make a Learn set or flashcards?", "Why would I open Learn for this?",
    "Explain what a Learn round is, please", "I don't get the Learn session thing", "When should I start a Learn round?",
    "Is it worth it to make a Learn set for this?", "Hmm, what's a Learn session?", "Wait, can you tell me what a Learn round does?",
    "Make a Learn set or a quiz, which is better?", "Make a Learn set?", "Start a Learn round? Or review the guide first?",
    "Can you make a Learn set? Or is that only for guides?", "Before I make a Learn set, what does it include?",
    "The button says Start a Learn round but nothing happens", "make me learn for the test", "Don't make a Learn set yet",
    "How do I make a Learn set for Hamlet?", "Would a Learn round help with dosage calculations?",
    "Could I start a Learn session without a guide?",
]
# The reviewer's 12 requests (learn_r) and one per discipline; the last two put the request next to another sentence.
LEARN_ASKED = [
    "Make a Learn set for my pharm notes", "Open Learn for this", "Start a Learn round", "Please build a Learn set from this",
    "Can you start a Learn session for me?", "Let's open a Learn round on chapter 4", "Learn for this.", "Okay, make me a Learn for it",
    "Create a learn set please", "Could you build me a Learn set?", "Set up Learn for my exam", "I want a Learn session on this guide",
    "Build a Learn set from my torts outline", "Start a Learn round on the Baroque unit", "Make a Learn set for Beloved",
    "Please create a Learn set for data structures", "Start a Learn round on sterile technique",
    "How does it work? Make a Learn for it.", "Make a Learn set for it. My test is Friday.",
]


class LearnGrammarTests(unittest.TestCase):
    def test_no_question_about_learn_is_a_request(self):
        self.assertEqual([text for text in LEARN_QUESTIONS if study_helper.asks_for_learn(text)], [])
        self.assertEqual([text for text in LEARN_QUESTIONS if study_helper.split_learn_request(text)[0]], [])

    def test_every_request_for_learn_is(self):
        self.assertEqual([text for text in LEARN_ASKED if not study_helper.asks_for_learn(text)], [])

    def test_a_polite_question_is_an_ask_and_an_imperative_is_a_do(self):
        for text in ["Can you start a Learn session for me?", "Could you build me a Learn set?", "can you build a learn set",
                     "Can you make a Learn set from my notes?"]:
            with self.subTest(text=text):
                self.assertEqual(study_helper.split_learn_request(text)[0], "ask")
        for text in ["Make a Learn for it", "Start a Learn round on sterile technique", "Please build a Learn set from this",
                     "How does it work? Make a Learn for it.", "Learn for this."]:
            with self.subTest(text=text):
                self.assertEqual(study_helper.split_learn_request(text)[0], "do")

    def test_the_rest_is_what_is_left_once_the_request_is_taken_out(self):
        self.assertEqual(study_helper.split_learn_request("Make a Learn set for it. My test is Friday."), ("do", "My test is Friday."))
        self.assertEqual(study_helper.split_learn_request("How does it work? Make a Learn for it."), ("do", "How does it work?"))
        self.assertEqual(study_helper.split_learn_request("What is a Learn set?"), (None, "What is a Learn set?"))


# ---- Routes: the web Tutor (session) and the extension side panel (no session) ----

EXTENSION = {"content": "Moles count particles. Avogadro's number relates moles to particles. " * 5, "history": [],
             "rich_text": True, "mode": "short", "context_title": "Chem 101 Week 3",
             "context_url": "https://canvas.example.edu/courses/1/pages/week-3"}
BUILT = ("Q1: What is a mole?\nA1: A count of particles.", [{"front": "What is a mole?", "back": "A count."}])


@patch("services.student_memory.learn_from_tutor")
@patch("routers.chat.style_instruction", return_value="")
@patch("routers.chat.learning_guidance", return_value="")
@patch("routers.chat.start_quiz_warmup")
@patch("routers.chat.record")
@patch("routers.chat.require", return_value={"used": 0})
@patch("routers.chat.get_user_id", return_value=ME)
class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        limiter.reset()
        self.db = FakeDB()
        self.db.rows("study_guides").append({"id": GUIDE, "user_id": ME, "title": "Biology: Cells", "folder_id": None,
                                             "study_guide": "Q1: What is a cell?\nA1: A unit.", "notes": "", "updated_at": "2026-11-17",
                                             "flashcard_progress": {}})
        self.db.rows("smart_notes").append({"id": NOTE, "user_id": ME, "title": "Chem notes", "folder_id": None, "content": "<p>Moles count particles.</p>"})
        self.patches = [patch("routers.chat.get_supabase", return_value=self.db),
                        patch("routers.calendar.calendar_for", return_value={"connected": False, "items": []}),
                        patch("routers.chat.answer_question", return_value="ANSWERED"),
                        patch("routers.chat._app_action", return_value=None),
                        patch("routers.chat.connectors.tutor_material", return_value=None),
                        patch.dict(chat.GUIDE_KINDS, {"guide": ("Study Guide", "Study guide", lambda *_: BUILT)})]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def guides(self):
        return len(self.db.rows("study_guides"))

    def in_session(self, question, **extra):
        limiter.reset()  # 30 a minute per client
        turn ={"id": "session-1", "run_id": "run-1", "active_skill": "explain", "conversation_version": 1,
                "messages": [{"role": "user", "text": question}]}
        with patch("routers.chat.claim_tutor_turn", return_value=turn), \
             patch("routers.chat.complete_tutor_turn", side_effect=lambda _u, _t, response: {**turn, "messages": [*turn["messages"], response]}), \
             patch("routers.chat.public_tutor_session", side_effect=lambda row: {"id": row["id"], "messages": row["messages"]}):
            response = self.client.post("/chat", headers=AUTH, json={"question": question, "content": "", "local_date": "2026-11-18",
                                                                     "session_id": "session-1", "conversation_version": 1, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_the_reviewers_probes_reach_the_tutor_and_build_nothing(self, *_):
        for question, extra in [("Review the final scene of Hamlet with me", {"guide_id": GUIDE}),
                                ("Help me review the Allen test steps", {"guide_id": GUIDE}),
                                ("I'm studying how to write unit tests in Python", {}),
                                ("I got the quiz back, why was question 2 wrong?", {"guide_id": GUIDE}),
                                ("Create a summary of what to learn for Friday", {"note_id": NOTE}),
                                ("Make a flashcard set so I can learn for the test", {"note_id": NOTE}),
                                ("Can you open the learn page?", {"note_id": NOTE})]:
            with self.subTest(question=question):
                before = self.guides()
                body = self.in_session(question, **extra)
                self.assertIsNone(body.get("study_plan"))
                self.assertNotEqual(body.get("action"), "navigate")
                self.assertEqual(self.guides(), before)

    def test_a_real_study_request_from_the_web_still_gets_a_plan(self, *_):
        body = self.in_session("my art history final is next week, help")
        self.assertEqual(body["action"], "study_plan")
        body = self.in_session("Make a Learn for it", note_id=NOTE)
        self.assertEqual(body["action"], "navigate")

    def test_a_question_about_learn_never_builds_or_opens_anything(self, *_):
        for question in LEARN_QUESTIONS:
            for extra in ({"note_id": NOTE}, {"guide_id": GUIDE}):
                with self.subTest(question=question, selected=list(extra)[0]):
                    before = self.guides()
                    body = self.in_session(question, **extra)
                    self.assertIsNone(body.get("action"))
                    self.assertEqual(body["answer"], "ANSWERED")
                    self.assertEqual(self.guides(), before)

    def test_a_request_for_learn_on_a_selected_guide_opens_it(self, *_):
        for question in LEARN_ASKED:
            with self.subTest(question=question):
                before = self.guides()
                body = self.in_session(question, guide_id=GUIDE)
                self.assertEqual(body["action"], "navigate")
                self.assertTrue(body["link"]["href"].startswith(f"/learn/{GUIDE}"))
                self.assertEqual(self.guides(), before)

    def test_a_question_shaped_request_never_builds_it_offers_the_build_button(self, *_):
        for question in ["Can you make a Learn set from my notes?", "Can you make a Learn set from a PDF?"]:
            with self.subTest(question=question):
                before = self.guides()
                body = self.in_session(question, note_id=NOTE)
                self.assertEqual(self.guides(), before)
                self.assertEqual(body["action"], "study_plan")
                self.assertIn("I'll turn Chem notes into a Learn set", body["answer"])
                self.assertEqual(body["study_plan"]["actions"], [{"kind": "build", "label": "Build the Learn set", "prompt": "Make a Learn for it"}])
                # The button's own words are an imperative, so pressing it builds.
                self.assertEqual(study_helper.split_learn_request(body["study_plan"]["actions"][0]["prompt"])[0], "do")

    def test_make_a_learn_for_it_builds_once(self, *_):
        before = self.guides()
        body = self.in_session("Make a Learn for it", note_id=NOTE)
        self.assertEqual(self.guides(), before + 1)
        self.assertEqual(body["action"], "navigate")

    def test_the_extension_gets_its_normal_answer_for_learn_questions_and_requests(self, *_):
        for question in ["Can you make a Learn set from my notes?", "Can you make a Learn set from a PDF?", "Make a Learn for it",
                         *LEARN_QUESTIONS[:6], *LEARN_ASKED[:6]]:
            with self.subTest(question=question):
                limiter.reset()
                before = self.guides()
                response = self.client.post("/chat", headers=AUTH, json={"question": question, **EXTENSION})
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                self.assertEqual(body["answer"], "ANSWERED")
                self.assertIsNone(body.get("action"))
                self.assertIsNone(body.get("study_plan"))
                self.assertEqual(self.guides(), before)

    def test_the_extension_side_panel_gets_its_normal_answer_for_every_probe(self, *_):
        # The side panel's request (extension/background.js askTutor): no session_id, no local_date.
        probes = [question for questions in STUDYING.values() for question in questions] + LEARN_REQUESTS + LEARN_ORDINARY \
            + ["It's on Friday", "I need to study for my chem test on Friday"]
        for question in probes:
            with self.subTest(question=question):
                limiter.reset()  # 30 a minute per client
                before = self.guides()
                response = self.client.post("/chat", headers=AUTH, json={"question": question, **EXTENSION})
                self.assertEqual(response.status_code, 200, response.text)
                body = response.json()
                self.assertEqual(body["answer"], "ANSWERED")
                self.assertIsNone(body.get("action"))
                self.assertIsNone(body.get("study_plan"))
                self.assertIsNone(body.get("link"))
                self.assertEqual(self.guides(), before)


# ---- Grounding ----

# Plain answers that explain without stating a specific name, count, amount or date. Ten per discipline;
# the reviewer's plain answers (ground.py, ground2.py) are among them, word for word.
PLAIN = {
    "nursing": [
        ("what does a beta blocker do?", "Beta blockers slow the heart rate and lower blood pressure. They block adrenaline at beta receptors, so the heart beats with less force."),
        ("why do we check potassium before giving digoxin?", "Low potassium makes digoxin toxicity more likely. Check the level first, and hold the dose and tell the provider if it is low."),
        ("what's the difference between type 1 and type 2 diabetes?", "In type 1, the body makes little or no insulin. In type 2, the body makes insulin but the cells respond poorly to it."),
        ("what is preload?", "Preload is how much the heart muscle is stretched at the end of filling. More blood returning to the heart means more preload, as the Frank-Starling law describes."),
        ("nursing: which drugs raise bleeding risk?", "NSAIDs and anticoagulants both raise bleeding risk. Watch for bruising and dark stools."),
        ("what do SSRIs treat?", "They treat depression and anxiety. SSRIs keep more serotonin available between nerve cells."),
        ("why monitor sodium?", "Low Na can cause confusion and seizures. Correct it slowly."),
        ("what is a vital sign?", "Vital signs are temperature, pulse, breathing rate and blood pressure. Some places add pain or oxygen saturation as a fifth or sixth sign."),
        ("explain the Krebs cycle", "It breaks down acetyl CoA to release energy carriers. It happens in the mitochondria, and each turn makes NADH and FADH2."),
        ("what is afterload?", "Afterload is the pressure the heart has to push against to eject blood. High blood pressure raises it, so the heart works harder with each beat."),
    ],
    "art history": [
        ("what makes gothic architecture gothic?", "Gothic buildings use pointed arches, ribbed vaults and flying buttresses. These let walls be thinner and hold large stained glass windows."),
        ("what is impressionism?", "Impressionism is a style that captures light and a passing moment with quick, visible brushstrokes. Painters often worked outdoors."),
        ("explain one-point perspective", "One-point perspective makes parallel lines meet at a single vanishing point on the horizon. It creates the look of depth on a flat surface."),
        ("what is a fresco?", "A fresco is paint applied to wet plaster, so the color becomes part of the wall. Italian Renaissance painters used it for large church walls."),
        ("what is contrapposto?", "Contrapposto is a pose where a figure puts its weight on one leg. The hips and shoulders tilt in opposite directions, so the body looks relaxed."),
        ("what is a still life?", "A still life is a picture of objects that don't move, such as fruit, flowers or cups. Artists use it to study light, texture and arrangement."),
        ("what is iconography?", "Iconography is the study of the symbols and figures in an image and what they mean. A key or a skull, for example, can carry a meaning viewers recognised."),
        ("what did patrons do?", "A patron paid an artist to make a work and often chose its subject. Patrons shaped what art got made and how it looked."),
        ("what is abstract art?", "Abstract art doesn't try to show things as they look. It uses shape, color and line to make its effect on their own."),
        ("what is a medium in art?", "The medium is the material an artist works in, like oil paint, marble or ink. Each one limits and shapes what the artist can do."),
    ],
    "business law": [
        ("what is consideration in a contract?", "Consideration is something of value each side gives up. Without it, a promise is usually not enforceable as a contract."),
        ("what is the difference between an LLC and a corporation?", "An LLC gives owners limited liability with flexible tax treatment. A corporation is a separate legal entity owned by shareholders, with more formal rules."),
        ("what is promissory estoppel?", "Promissory estoppel lets a court enforce a promise when someone relied on it and would be harmed. It fills the gap when there is no consideration."),
        ("what is a tort?", "A tort is a civil wrong that causes harm, like negligence. The injured person can sue for damages in court rather than the State bringing charges."),
        ("what is a fiduciary duty?", "A fiduciary duty is a duty to act in someone else's best interest. A company's directors, for example, must put the company ahead of their own gain."),
        ("how does a contract form?", "A contract forms when one side makes an offer and the other accepts it on the same terms. A reply that changes the terms is a counteroffer, not an acceptance."),
        ("what is negligence?", "Negligence is a failure to take the care a reasonable person would take. The injured person has to show a duty, a breach of it, and harm the breach caused."),
        ("what is an agent?", "An agent acts for someone else, called the principal. What the agent agrees to within their authority binds the principal."),
        ("what happens when a contract is broken?", "The usual remedy is money damages that put the other side where they would have been. A court orders the promise carried out only when money can't fix the harm."),
        ("what is limited liability?", "Limited liability means owners can lose what they put into the business but not their personal assets. Creditors can only go after the business itself."),
    ],
    "literature": [
        ("what is dramatic irony?", "Dramatic irony is when the audience knows something a character does not. It builds tension because we watch the character act without that knowledge."),
        ("what is the theme of Hamlet?", "Hamlet explores revenge, doubt and how hard it is to act. The prince keeps delaying, and that delay drives the tragedy."),
        ("what is a metaphor?", "A metaphor says one thing is another to show a likeness. For example, \"time is a thief\" suggests time takes things from us. It comes from the Greek word for carrying over."),
        ("what is an unreliable narrator?", "An unreliable narrator tells the story in a way we can't fully trust. Their bias, gaps or mistakes make the reader question what really happened."),
        ("what is foreshadowing?", "Foreshadowing is a hint early in a story about what will happen later. It builds suspense and makes the ending feel earned."),
        ("what is a motif?", "A motif is an image, idea or phrase that comes back again and again in a work. Each time it returns, it adds to the larger meaning."),
        ("what is free verse?", "Free verse is poetry without a set rhyme scheme or regular meter. It follows the rhythm of natural speech instead."),
        ("what is the climax of a story?", "The climax is the turning point, where the main conflict reaches its highest tension. After it, the story moves toward its resolution."),
        ("what is a protagonist?", "The protagonist is the main character, the one the story follows. Their goals and struggles drive the plot."),
        ("what does tone mean in literature?", "Tone is the writer's attitude toward the subject or the reader. Word choice, rhythm and detail all shape whether it feels playful, bitter or calm."),
    ],
    "computer science": [
        ("what is recursion?", "Recursion is when a function calls itself on a smaller version of the problem. Each call needs a base case, or it never stops."),
        ("what is big O notation?", "Big O describes how running time grows as the input grows. For example, a loop over n items is O(n)."),
        ("what's a hash table?", "A hash table stores key and value pairs. A hash function turns each key into an index, so lookups are fast on average."),
        ("how does binary search work?", "Binary search checks the middle item of a sorted list. If the target is smaller, it searches the left half; otherwise, the right half. It repeats until it finds the item."),
        ("what does git rebase do?", "Rebase moves your commits so they sit on top of another branch. Git rewrites them one by one as new commits."),
        ("what is a python list comprehension?", "A list comprehension builds a list in one line, like [x * 2 for x in nums]. Python reads it left to right."),
        ("how does dict.get work in python?", "It returns the value for a key, or a default if the key is missing. It never raises an error, so it returns None when no default is given."),
        ("how do I check a key in a dict?", "Use the in operator. It returns True if the key exists and False if not."),
        ("what is a linked list?", "A linked list stores items in nodes. Each node points to the next one.\n```\nclass Node:\n    def __init__(self, value):\n        self.value = value\n        self.next = None\n```"),
        ("explain recursion with steps", "Recursion solves a problem by solving smaller copies of it.\n1. **Find the base case**\nThe smallest input you can answer directly.\n> Without it, the calls never end.\n2. **Reduce the problem**\nCall the function on a smaller input.\n> Each call gets closer to the base case."),
    ],
}

# Everyday sentences with "one", "two", "Step 2" (finding 4): not facts.
COUNT_NOISE = ["Each one is processed once.", "Two plus two is four.", "Step 2 is the same.", "The left one has more weight.",
               "This one was the first draft.", "Use `range(10)` to loop ten times.", "Call `print(True)` and it prints True."]

# Answers that state a specific count, amount, date or name (finding 5 and the reviewer's flagged set).
SPECIFIC = [
    ("who founded the KKK?", "It was founded by six Confederate veterans in Pulaski, Tennessee."),
    ("who founded the KKK?", "It was founded by six Confederate veterans."),
    ("who founded the klan?", "It was founded by six former soldiers."),
    ("who founded the klan?", "Six veterans founded it."),
    ("who founded the klan?", "It was started by six men."),
    ("who founded the klan?", "It was started by six former Confederate officers."),
    ("how many justices on the supreme court?", "There are nine justices."),
    ("how many people signed the declaration of independence?", "Fifty-six people signed it."),
    ("how many bones in the adult body?", "An adult has 206 bones."),
    ("how many members in the original group?", "The group had a dozen members at first."),
    ("when did ww2 end?", "It ended in 1945."),
    ("what is the normal potassium level?", "Normal potassium is 3.5 to 5.0 mEq/L."),
    ("what is the normal heart rate?", "A normal resting heart rate is 60 to 100 beats per minute."),
    ("how many lines in a sonnet?", "A sonnet has fourteen lines."),
    ("how long was the hundred years war?", "It actually lasted 116 years."),
    ("who wrote the federalist papers?", "They were written by three authors under a shared pen name."),
    ("who were the founders?", "There were six of them."),
    ("how many children did he have?", "He had six children."),
    ("what is a typical adult dose?", "The usual adult dose is 500 mg every 6 hours."),
    ("who painted it?", "It was painted by Rembrandt van Rijn for a civic guard company."),
]


class GroundingTests(unittest.TestCase):
    def test_plain_answers_are_flagged_at_most_one_in_ten_per_discipline(self):
        for discipline, cases in PLAIN.items():
            self.assertEqual(len(cases), 10)
            flagged = [answer for question, answer in cases if states_specifics(answer, question)]
            with self.subTest(discipline=discipline):
                self.assertLessEqual(len(flagged), 1, flagged)

    def test_everyday_numbers_code_and_symbols_are_not_facts(self):
        self.assertEqual([text for text in COUNT_NOISE if states_specifics(text, "")], [])

    def test_answers_that_state_counts_amounts_dates_or_names_are_flagged(self):
        self.assertEqual([answer for question, answer in SPECIFIC if not states_specifics(answer, question)], [])


# ---- Second review (F6c): names at the start of a sentence, amounts, and questions that ask for a specific ----

# The reviewer's 48 plain answers that were not flagged (rook-f6b/ground_new.py), word for word.
SECOND_PLAIN = [
    ('what is afterload?', 'Afterload is the resistance the ventricle pushes against to eject blood. Higher resistance means the heart works harder with each beat.'),
    ('why do we elevate the head of the bed?', 'Raising the head of the bed helps the lungs expand and lowers the chance of aspiration. It also eases breathing for patients with heart failure.'),
    ('what is a nursing diagnosis?', "A nursing diagnosis names a patient's response to a health problem, not the disease itself. It guides which interventions the nurse plans."),
    ('why check a pulse before giving a cardiac drug?', "Some cardiac drugs slow the heart. Checking the pulse first tells you whether it's safe to give the dose or hold it and call the provider."),
    ('what is the difference between edema and dehydration?', 'Edema is extra fluid trapped in the tissues, while dehydration is too little fluid in the body overall. One swells the tissues; the other dries them out.'),
    ('why do we turn bedbound patients?', 'Turning shifts pressure off bony areas so the skin keeps its blood supply. Without it, pressure injuries can form quickly.'),
    ('what is therapeutic communication?', 'Therapeutic communication uses listening, open questions and reflection to help the patient share concerns. The focus stays on the patient, not the nurse.'),
    ('what is a sterile field?', 'A sterile field is an area kept free of microorganisms for a procedure. Anything that touches it must be sterile too, or the field is contaminated.'),
    ('how do diuretics work?', 'Diuretics make the kidneys pass more salt and water. That lowers the fluid volume in the blood vessels, which can bring blood pressure down.'),
    ('what is a fresco?', 'A fresco is painted onto wet plaster, so the pigment becomes part of the wall as it dries. Artists had to work fast, one section at a time.'),
    ('what is iconography?', 'Iconography is the study of the symbols and subjects in an image. It asks what the objects, gestures and figures were meant to signal to viewers.'),
    ('what is sfumato?', 'Sfumato is a soft blending of tones with no hard outlines. Edges melt into shadow, which gives faces a hazy, lifelike look.'),
    ('what is abstract expressionism?', 'Abstract expressionism puts gesture and feeling ahead of recognizable subjects. The act of painting itself becomes part of the meaning.'),
    ('why is linear perspective important?', 'Linear perspective lets a flat surface suggest depth. Lines that recede toward a vanishing point make the space feel measurable and real.'),
    ('what is a still life?', "A still life shows objects that don't move, like fruit, flowers or tableware. Artists use it to study light, texture and arrangement."),
    ('what is the difference between a relief and a sculpture in the round?', 'A relief projects from a flat background and is meant to be seen from the front. A sculpture in the round stands free and can be viewed from every side.'),
    ('what does patronage mean in art?', 'Patronage is the support of artists by people or institutions who pay for their work. Patrons often shaped the subject, size and setting of what was made.'),
    ('what is impasto?', 'Impasto is paint laid on thickly, so brush or knife marks stay visible. The texture catches light and adds energy to the surface.'),
    ('what is a breach of contract?', 'A breach happens when one party fails to do what the contract requires without a legal excuse. The other party may then seek a remedy, such as damages.'),
    ('what is an agency relationship?', 'In an agency relationship, one person acts on behalf of another with their consent. The principal can be bound by what the agent does within their authority.'),
    ('what is a tort?', 'A tort is a civil wrong that causes harm to someone, apart from a broken contract. The injured person can sue for compensation.'),
    ('what is limited liability?', 'Limited liability means owners can lose what they invested in the business, but their personal assets are usually protected from its debts.'),
    ('what is a fiduciary duty?', "A fiduciary duty requires someone to act in another person's best interest, with loyalty and care. Directors owe this to the company they serve."),
    ('what is mitigation of damages?', "Mitigation means the injured party must take reasonable steps to limit their losses after a breach. They can't recover for harm they could easily have avoided."),
    ('what is the parol evidence rule?', 'The parol evidence rule limits using earlier or outside statements to change the terms of a written contract that the parties meant to be final.'),
    ('what is a warranty?', 'A warranty is a promise about the quality or condition of goods. If the goods fall short, the buyer may have a claim against the seller.'),
    ('what is vicarious liability?', "Vicarious liability holds one party responsible for another's actions, like an employer for an employee acting within the job."),
    ('what is a partnership?', 'A partnership is a business owned by two or more people who share profits and, usually, responsibility for its debts.'),
    ('what is a motif?', 'A motif is an image, idea or phrase that keeps coming back in a work. Each return adds weight and helps build the theme.'),
    ('what is stream of consciousness?', "Stream of consciousness follows a character's thoughts as they flow, jumping between memories, feelings and impressions without tidy order."),
    ('what is an unreliable narrator?', "An unreliable narrator tells the story in a way the reader can't fully trust. Gaps or contradictions invite the reader to read between the lines."),
    ('what is a tragic flaw?', 'A tragic flaw is a trait that leads the hero toward downfall. Pride, ambition or indecision are common examples.'),
    ('what is free verse?', "Free verse is poetry without a set meter or rhyme scheme. Its rhythm comes from the natural flow of speech and the poet's line breaks."),
    ('what is an epistolary novel?', 'An epistolary novel tells its story through letters, diary entries or other documents. Readers piece events together from what each writer reveals.'),
    ('what is the climax of a story?', 'The climax is the point of highest tension, where the central conflict comes to a head. After it, events begin to wind down.'),
    ('what is satire?', 'Satire uses humor, irony or exaggeration to criticize people, institutions or ideas. It often aims to provoke change, not just laughter.'),
    ('what is a bildungsroman?', 'A bildungsroman follows a young character growing up, from youth into maturity. The story tracks how experiences shape who they become.'),
    ('what is imagery?', 'Imagery is language that appeals to the senses, helping readers see, hear, smell, taste or feel a scene. It makes abstract ideas concrete.'),
    ('what is a stack?', 'A stack stores items so the last one added is the first one removed. Think of a pile of plates: you take from the top.'),
    ('what is a race condition?', 'A race condition happens when the result depends on the timing of threads that share data. If they interleave badly, the data ends up wrong.'),
    ('what is polymorphism?', 'Polymorphism lets different types respond to the same call in their own way. A draw method might render a circle or a square depending on the object.'),
    ('what is a REST API?', 'A REST API exposes resources at URLs and uses HTTP methods like GET and POST to read or change them. Each request carries what the server needs.'),
    ('what is memoization?', 'Memoization stores the results of expensive calls, so the same input returns the saved answer instead of recomputing it.'),
    ('what does a compiler do?', 'A compiler translates source code into a lower-level form, such as machine code, before the program runs. It also catches many errors early.'),
    ('what is a linked list?', 'A linked list stores items in nodes, and each node points to the next one. Inserting in the middle is cheap, but finding an item means walking the list.'),
    ('what is an index in a database?', 'An index is a structure that speeds up lookups on a column. The database can jump to matching rows instead of scanning the whole table.'),
    ('what is a pure function?', 'A pure function returns the same output for the same input and changes nothing outside itself. That makes it easy to test and reason about.'),
    ("what's the difference between a process and a thread?", 'A process has its own memory space, while threads inside a process share memory. Threads are lighter to create, but sharing makes bugs easier.'),
]
# Plain sentences that start with a capital modifier, a capitalized common phrase or a symbol.
SECOND_PLAIN_SHORT = ["The Greek word means measure.", "Italian painters used linear perspective.", "Binary search halves the list each time.",
                      "Big O describes growth.", "Free verse has no set meter.", "Sterile technique keeps the field clean.",
                      "Contract law protects promises."]
# A full name at the start of a sentence, a currency amount, a percent, or a question that asks for a specific.
SECOND_SPECIFIC = [("", "Toni Morrison wrote it."), ("", "Tim Berners-Lee invented it."), ("", "Alexander Fleming discovered it by accident."),
                   ("", "Florence Nightingale founded modern nursing."), ("", "Ada Lovelace wrote the first program."),
                   ("", "Chief Justice Marshall wrote the opinion."), ("", "Jan van Eyck painted it."),
                   ("", "Sales of goods for $500 or more need a writing."), ("", "About 60 percent of an adult's weight is water."),
                   ("", "About sixty percent of cases settle."), ("who wrote it?", "Morrison wrote it.")]


class SecondGroundingTests(unittest.TestCase):
    def test_the_reviewers_plain_answers_stay_plain(self):
        self.assertEqual(len(SECOND_PLAIN), 48)
        self.assertEqual([answer for question, answer in SECOND_PLAIN if states_specifics(answer, question)], [])

    def test_capital_modifiers_and_common_phrases_at_the_start_stay_plain(self):
        self.assertEqual([text for text in SECOND_PLAIN_SHORT if states_specifics(text, "")], [])

    def test_names_at_the_start_amounts_percents_and_who_questions_are_flagged(self):
        self.assertEqual([answer for question, answer in SECOND_SPECIFIC if not states_specifics(answer, question)], [])

    def test_a_question_that_asks_for_a_specific_flags_the_answer(self):
        for question in ["who wrote it?", "Whom did she marry?", "whose idea was it?", "what year did it end?", "Which year was it signed?",
                         "what date is the holiday?", "how many are there?", "How old was he?", "what percent of cases settle?"]:
            with self.subTest(question=question):
                self.assertTrue(states_specifics("It was settled then.", question))
        self.assertFalse(states_specifics("It was settled then.", "why was it settled?"))

    def test_an_amount_the_student_gave_is_not_a_new_fact(self):
        self.assertFalse(states_specifics("Yes, $500 is the line for goods.", "is the threshold $500?"))


# ---- Openers (finding 6) ----

KEPT = ["Yo-yo dieting raises risk.", "Hey Jude is a Beatles song.", "Dude ranches were common in the West.",
        "What's up with mitosis is that it splits.", "Good question to ask: is it alive?", "Okay so-called experts disagree.",
        "OK so what?", "Heyday of the Renaissance was brief.", "Great Questions in Philosophy is a book.", "Supply rises.",
        "Bro-ken lines are dashed.", "Sup-port the joint.", "Yo"]
STRIPPED = {"Yo, here's the deal.": "Here's the deal.", "Great question! Mitosis splits a cell.": "Mitosis splits a cell.",
            "Hey there! A tort is a civil wrong.": "A tort is a civil wrong.", "Good question. Irony is a gap.": "Irony is a gap.",
            "Yo — let's go.": "Let's go.", "Okay so, the heart pumps.": "The heart pumps."}


class OpeningTests(unittest.TestCase):
    def test_real_words_at_the_start_are_kept(self):
        self.assertEqual({text: plain_opening(text) for text in KEPT}, {text: text for text in KEPT})

    def test_slang_and_filler_openers_followed_by_punctuation_are_dropped(self):
        self.assertEqual({text: plain_opening(text) for text in STRIPPED}, STRIPPED)

    def test_a_slang_word_ending_a_sentence_is_a_word_not_an_opener(self):
        # Low 5: slang takes a comma, "!" or a dash; only "great/good question" may end with a period.
        for text in ["Fam. Medicine is a specialty.", "Sup. Mitosis splits a cell.", "Bro. Code is a set of rules.", "Lol. Cats purr."]:
            with self.subTest(text=text):
                self.assertEqual(plain_opening(text), text)
        self.assertEqual(plain_opening("Yo! Let's go."), "Let's go.")
        self.assertEqual(plain_opening("Good question. Irony is a gap."), "Irony is a gap.")


# ---- Dates (finding 9) and the plan's date label (finding 13) ----

class DateTests(unittest.TestCase):
    def parse(self, text):
        return study_helper.parse_test_date(text, WEDNESDAY)

    def test_chapter_and_section_numbers_are_not_dates(self):
        self.assertEqual(self.parse("quiz on chapters 3/4 on Friday"), date(2026, 11, 20))
        self.assertIsNone(self.parse("I need to study sections 1/2 for the test"))
        self.assertIsNone(self.parse("review chapters 3/4"))

    def test_today_is_a_test_date_only_when_the_test_is_today(self):
        self.assertIsNone(self.parse("what should I do today?"))
        self.assertIsNone(self.parse("I want to study today for my exam"))
        self.assertEqual(self.parse("my exam is today"), WEDNESDAY)
        self.assertEqual(self.parse("test today, help"), WEDNESDAY)

    def test_written_dates_still_work(self):
        self.assertEqual(self.parse("exam on 12/3"), date(2026, 12, 3))
        self.assertEqual(self.parse("test due 12/3"), date(2026, 12, 3))
        self.assertEqual(self.parse("my final is Dec 3"), date(2026, 12, 3))
        self.assertEqual(self.parse("test tomorrow on contracts"), date(2026, 11, 19))

    def test_the_test_word_takes_is_or_an_apostrophe_s_in_every_date_rule(self):
        # Low 6: "my exam's today", "the quiz’s on 12/3" (curly), "my final's tomorrow".
        self.assertEqual(self.parse("my exam's today"), WEDNESDAY)
        self.assertEqual(self.parse("my exam’s today"), WEDNESDAY)
        self.assertEqual(self.parse("the quiz’s on 12/3"), date(2026, 12, 3))
        self.assertEqual(self.parse("the test's 12/3"), date(2026, 12, 3))
        self.assertEqual(self.parse("my final is on 12/3"), date(2026, 12, 3))
        for text in ["my exam's tomorrow", "my bio exam’s on Friday", "the midterm is next week", "my quiz’s Dec 3"]:
            with self.subTest(text=text):
                self.assertTrue(study_helper.asks_to_study_for_test(text))

    def test_the_plan_names_the_day_short(self):
        answer, _ = study_helper.plan_reply(today=WEDNESDAY, when=date(2026, 11, 23), guide={"id": GUIDE, "title": "Biology"}, exam=None)
        self.assertIn("on Mon, Nov 23 (5 days away)", answer)


# ---- A check-in posted during a running Tutor turn (finding 15) ----

class MidTurnCheckinTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.rows("tutor_sessions").append({"id": "session-1", "user_id": ME, "messages": [{"role": "ai", "text": "Hi"}],
                                               "updated_at": "2026-11-18T10:00:00+00:00", "conversation_version": 2,
                                               "status": "idle", "run_id": None})
        self.patch = patch("services.tutor_sessions.get_supabase", return_value=self.db)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_the_check_in_survives_the_turn(self):
        turn = tutor_sessions.claim_tutor_turn(ME, "session-1", 2, "what is osmosis?", None)
        posted = tutor_sessions.append_tutor_message(ME, "Check-in done on Biology: 3 of 7 right.", once="checkin:learn-1")
        self.assertIsNotNone(posted)
        done = tutor_sessions.complete_tutor_turn(ME, turn, {"answer": "Osmosis is water moving across a membrane."})
        texts = [message["text"] for message in done["messages"]]
        self.assertEqual(texts, ["Hi", "what is osmosis?", "Check-in done on Biology: 3 of 7 right.", "Osmosis is water moving across a membrane."])
        self.assertEqual(done["conversation_version"], 3)
        self.assertEqual(done["status"], "idle")

    def test_a_turn_with_nothing_posted_completes_as_before(self):
        turn = tutor_sessions.claim_tutor_turn(ME, "session-1", 2, "what is osmosis?", None)
        done = tutor_sessions.complete_tutor_turn(ME, turn, {"answer": "Water moving across a membrane."})
        self.assertEqual([message["text"] for message in done["messages"]], ["Hi", "what is osmosis?", "Water moving across a membrane."])


if __name__ == "__main__":
    unittest.main()
