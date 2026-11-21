"""Learn question quality, follow-up to F5 (review of PR 275; feedback ed2eb2e2, b67047f0).

1. Facts kept: a line that is only a number ("1789", "4000", "3/4") is subject matter; only a line
   that is exactly a marker ("Slide 5", "Page 3 of 12", "p. 12", "- 3 -") is layout.
2. "As discussed in the lecture, what is X?" asks "What is X?" (the attribution goes first, then the
   question is checked), and a rewrite that still needs the file ("What is the second step?") or a
   question where the source acts ("Which characters does the excerpt introduce?") is not asked.
3. No idea is lost for want of wrong choices: fewer than 3 choices is asked typed, never removed.
4. "Help me remember" keeps a whole list trick (the 12 cranial nerves) instead of cutting it short.
5. Cleaning a saved quiz never changes what a student's progress is keyed by (question text, idea
   id, position): saved quizzes are left alone and the wording is changed only where it is shown.
"""

import json
import os
import random
import re
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # fake_supabase
os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")

from routers import quiz  # noqa: E402
from services import guide_versions, ideas, llm, retain, study_insights  # noqa: E402
from services.text_processing import (  # noqa: E402
    chunk_text, extract_slideshow_content, format_slideshow_text, shown_questions, standalone_question,
    strip_structure_markers,
)

GUIDE_ID = "00000000-0000-0000-0000-000000000001"


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class FakeDb:
    """study_guides row reads and writes, as _load_quiz uses them."""

    def __init__(self, row):
        self.row, self.updates = row, []

    def table(self, _name):
        return FakeQuery(self)


class FakeQuery:
    def __init__(self, db):
        self.db, self.update_values = db, None

    def select(self, *_):
        return self

    def eq(self, *_):
        return self

    def update(self, values):
        self.update_values = values
        return self

    def execute(self):
        if self.update_values is not None:
            self.db.updates.append(self.update_values)
            self.db.row.update(self.update_values)
            return SimpleNamespace(data=[self.db.row])
        return SimpleNamespace(data=[dict(self.db.row)])


# --- 1. Facts survive pre-processing ---------------------------------------------------------------

FACTS = {
    "history timeline": ("Timeline of the Revolution\n1789\nStorming of the Bastille\n1793\nReign of Terror begins",
                         ["1789", "1793"]),
    "nursing dose": ("Maximum daily acetaminophen dose (mg):\n4000\nfor healthy adults", ["4000"]),
    "nursing score": ("Apgar score at 1 minute\n7\nindicates mild distress", ["\n7\n"]),
    "anatomy count": ("Number of chambers in the heart:\n4", [":\n4"]),
    "music meter": ("Common time signature:\n3/4\nWaltz meter", ["3/4"]),
    "pain rating": ("Pain rating on admission:\n7/10", ["7/10"]),
    "cs byte": ("Number of bits in a byte:\n8", ["\n8"]),
    "law age": ("Minimum age to enter a binding contract:\n18", ["\n18"]),
    "literature sonnet": ("Lines in a sonnet:\n14", ["\n14"]),
    "numbered step": ("Step\n(2)\nApply the rule", ["(2)"]),
    "chapter heading": ("Chapter 11\nReorganization lets a debtor keep operating", ["Chapter 11"]),
    "section prefix": ("Section 2: Monopolization", ["Section 2: Monopolization"]),
}

# The owner's rule (F5 rebuild): only a whole line that is exactly a marker goes; every other line
# stays as it is, where it is (tests/test_question_quality_rules.py has the full list).
MARKERS = {
    "--- Slide 5 ---\nSodium\nNormal 135-145": "Sodium\nNormal 135-145",
    "Page 3 of 12\nTorts": "Torts",
    "Slide 6: Sodium balance": "Slide 6: Sodium balance",
    "Page 3 - Introduction to Contracts": "Page 3 - Introduction to Contracts",
    "Torts\n- 3 -\nNegligence": "Torts\nNegligence",
    "Torts\n— 7 —\nNegligence": "Torts\nNegligence",
    "Torts\n3 of 12\nNegligence": "Torts\n3 of 12\nNegligence",
    "p. 12\nThe green light": "The green light",
    "pg. 4\nImpasto": "Impasto",
    "Mitosis\nPage 3": "Mitosis",
    "Mitosis\nSlide 4 of 20": "Mitosis",
    "--- Page 2 ---\nChiaroscuro": "Chiaroscuro",
}


class FactsKeptTests(unittest.TestCase):
    def test_bare_numbers_are_facts_in_every_subject(self):
        for label, (text, kept) in FACTS.items():
            cleaned = strip_structure_markers(text)
            for fact in kept:
                self.assertIn(fact, cleaned, f"{label}: {cleaned!r}")

    def test_labelled_and_decorated_markers_are_still_removed(self):
        for text, expected in MARKERS.items():
            self.assertEqual(strip_structure_markers(text), expected, text)

    def test_numbers_reach_the_guide_prompt_from_every_content_type(self):
        sources = {
            # Canvas slideshow, as the extension sends it
            "slideshow": format_slideshow_text(extract_slideshow_content(
                "--- Slide 1 ---\nAcetaminophen\nMaximum daily dose (mg):\n4000\n--- Slide 2 ---\nTimeline\n1789\nBastille")),
            # OCR'd PDF pages
            "pdf": "--- Page 1 ---\nMaximum daily dose (mg):\n4000\nPage 1 of 2\n--- Page 2 ---\nTimeline\n1789\nBastille",
            # uploaded PPTX text (file_extraction)
            "pptx": "--- Slide 1 ---\nMaximum daily dose (mg):\n4000\n--- Slide 2 ---\nTimeline\n1789\nBastille",
            # a web page
            "web": "Maximum daily dose (mg):\n4000\n\nTimeline\n1789\nBastille\n- 2 -",
        }
        chat = MagicMock(return_value=reply("Q1: What is the maximum daily dose?\nA1: 4000 mg"))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            for name, text in sources.items():
                chat.reset_mock()
                llm.generate_study_guide(chunk_text(text))
                prompt = "\n".join(call.kwargs["messages"][1]["content"] for call in chat.call_args_list)
                self.assertIn("4000", prompt, name)
                self.assertIn("1789", prompt, name)
                for marker in ("--- Slide", "--- Page", "Page 1 of 2", "- 2 -"):
                    self.assertNotIn(marker, prompt, name)


# --- 2. Attribution rewritten, source questions dropped ------------------------------------------

REWRITES = {
    "As discussed in the lecture, what is the mechanism of action of furosemide?": "What is the mechanism of action of furosemide?",
    "As explained in Chapter 3, what is the parol evidence rule?": "As explained in Chapter 3, what is the parol evidence rule?",  # narrow round: a numbered chapter may be the subject's own (Chapter 11), so it is asked as written
    "As shown on Slide 4, what is the time complexity of quicksort?": "What is the time complexity of quicksort?",
    "As noted in the reading, what is impasto?": "What is impasto?",
    "As mentioned in the textbook, what is an unreliable narrator?": "What is an unreliable narrator?",
    "As described in the passage, who is the narrator of Beloved?": "Who is the narrator of Beloved?",
    "What is the parol evidence rule, as discussed in the lecture?": "What is the parol evidence rule?",
    "According to Slide 5, what is the normal serum potassium range?": "What is the normal serum potassium range?",
    "In this lecture, what is the doctrine of promissory estoppel?": "What is the doctrine of promissory estoppel?",
    "What is chiaroscuro, according to the textbook?": "What is chiaroscuro?",
    "Based on the reading, what is a binary search tree?": "What is a binary search tree?",
    "From the notes: what is consideration?": "What is consideration?",
    "According to the video, which data structure is fastest?": "Which data structure is fastest?",
    # stacked attributions come off in one pass
    "In the lecture, in Chapter 3, what is a tort?": "In Chapter 3, what is a tort?",  # narrow round: a numbered chapter may be the subject's own (Chapter 11), so it is asked as written
    "According to Slide 5, according to the lecture, what is mitosis?": "What is mitosis?",
    "From the reading: per the notes, what is a tort?": "What is a tort?",
    "What is sfumato, according to the text, according to the slides?": "What is sfumato?",
}

# Still need the file once the attribution is gone, or the source is the one acting.
SOURCE_QUESTIONS = [
    "What is the second step in the list?",
    "What is the last term in the table?",
    "What is the first item in the list?",
    "Which characters does the excerpt introduce?",
    "Which three theorists does the chapter compare?",
    "Which works does the module highlight?",
    "What example does the lecturer give for negligence?",
    "What does the professor say about heparin?",
    "Which drug is listed first?",
    "What does this excerpt reveal about Hester Prynne?",
    "Which medications are listed for Chapter 4?",
    "Which cases are discussed in Lecture 7?",
    "Name the poets mentioned in the passage.",
    "Which sorting algorithms are presented in the slides?",
    "Which data are shown in this chart?",
    "What is defined in the first section?",
]

# Narrow round: only a generic noun is left once an opening that names the source comes off, so each
# is asked as written (it was hidden before).
GENERIC_LEFTOVERS = [
    "What does the first bullet say, according to Slide 2?",
    "What are the three examples, according to the slides?",
    "What is the main idea, according to the reading?",
    "What is the author's main argument, according to the passage?",
    "Which painting appears first in the presentation?",
]

# Subject questions that share words with the patterns above: asked as they are.
SUBJECT_QUESTIONS = [
    "The nurse reviews the vital signs shown in the chart. Which finding requires action?",
    "According to the chart, what was the client's last blood pressure?",
    "What is defined in the first section of the Uniform Commercial Code?",
    "What is Problem 4 of Hilbert's problems?",
    "Which symptom appears first in hypoglycemia?",
    "What is the first step of the nursing process?",
    "What is the last step in mitosis?",
    "What is the main idea of the Monroe Doctrine?",
    "What example does Freud give of a defense mechanism?",
    "Which company is listed first on the New York Stock Exchange?",
    "What does the Chapter 13 plan require the debtor to pay?",
    "What does Section 2 of the Sherman Act prohibit?",
    "What is the section modulus of a beam?",
    "In The Great Gatsby, what does the green light symbolize?",
    "What does a Gantt chart show?",
    "What is the chart of accounts?",
]


class AttributionTests(unittest.TestCase):
    def test_attributions_are_rewritten_not_dropped(self):
        for question, expected in REWRITES.items():
            self.assertEqual(standalone_question(question), expected, question)

    def test_questions_that_need_the_file_are_not_asked(self):
        for question in SOURCE_QUESTIONS:
            self.assertIsNone(standalone_question(question), question)

    def test_subject_questions_are_asked_as_they_are(self):
        for question in [*SUBJECT_QUESTIONS, *GENERIC_LEFTOVERS]:
            self.assertEqual(standalone_question(question), question, question)

    def test_cleaning_twice_changes_nothing(self):
        for question in [*REWRITES, *SOURCE_QUESTIONS, *SUBJECT_QUESTIONS,
                         "Based on the passage (p. 4), what is irony?", "  according to the text,   what is mitosis  ?  "]:
            once = standalone_question(question)
            if once is not None:
                self.assertEqual(standalone_question(once), once, question)


# --- 3. No idea lost for want of wrong choices ----------------------------------------------------

GUIDES = {
    "nursing": [
        ("What is the normal adult serum potassium range?", "3.5-5.0 mEq/L"),
        ("What ECG change is an early sign of hyperkalemia?", "Peaked T waves"),
        ("What electrolyte imbalance causes U waves?", "Hypokalemia"),
        ("What are the classic signs of hypocalcemia?", "Tetany, Chvostek's sign, Trousseau's sign, and seizures"),
        ("Who founded modern nursing?", "Florence Nightingale"),
        ("What is the normal serum sodium range?", "135-145 mEq/L"),
        ("What are the signs of hypoglycemia?", "Shakiness, sweating, confusion, and tachycardia"),
    ],
    "art_history": [
        ("Who painted the Mona Lisa?", "Leonardo da Vinci"),
        ("Who sculpted David in 1504?", "Michelangelo"),
        ("Who painted The School of Athens?", "Raphael"),
        ("What is chiaroscuro?", "The strong contrast between light and dark in a painting"),
        ("In what year was the Sistine Chapel ceiling finished?", "1512"),
        ("What movement did Monet lead?", "Impressionism"),
    ],
    "business_law": [
        ("Who pioneered the moving assembly line?", "Henry Ford"),
        ("Which automaker entered the US market in 1986?", "Hyundai"),
        ("Who proposed scientific management?", "Frederick Taylor"),
        ("What are the elements of a valid contract?", "Offer, acceptance, consideration, capacity, and legality"),
        ("What does Chapter 11 bankruptcy allow?", "A business to reorganize its debts while it keeps operating"),
    ],
    "literature": [
        ("Who narrates The Great Gatsby?", "Nick Carraway"),
        ("Who wrote Beloved?", "Toni Morrison"),
        ("What does the green light symbolize?", "Gatsby's hope for a future with Daisy"),
        ("What are the stages of Freytag's pyramid?", "Exposition, rising action, climax, falling action, and resolution"),
    ],
    "computer_science": [
        ("What is the time complexity of binary search?", "O(log n)"),
        ("What causes a page fault?", "A program touching a page that is not in memory"),
        ("Who invented the World Wide Web?", "Tim Berners-Lee"),
        ("What are the four pillars of object-oriented programming?", "Encapsulation, abstraction, inheritance, and polymorphism"),
    ],
}


def qa_of(pairs):
    return [{"question": q, "answer": a} for q, a in pairs]


class EveryIdeaKeptTests(unittest.TestCase):
    def test_guide_derived_quizzes_keep_every_idea(self):
        for subject, pairs in GUIDES.items():
            questions = quiz._standard_questions(qa_of(pairs), random.Random(1))
            self.assertEqual([q["question"] for q in questions], [q for q, _ in pairs], subject)
            for question, (_, answer) in zip(questions, pairs):
                self.assertEqual(question["options"][question["correct_index"]], quiz.choice_text(answer))

    def test_an_idea_with_fewer_than_three_choices_is_asked_typed(self):
        for subject, pairs in GUIDES.items():
            questions = quiz._standard_questions(qa_of(pairs), random.Random(1))
            for selected in (["mc"], ["mc", "fill"], ["mc", "written"]):
                cards = retain.plan_session(questions, selected)
                kinds = {index: card["type"] for card in cards for index in card["concepts"]}
                self.assertEqual(sorted(kinds), list(range(len(pairs))), f"{subject}: every idea gets a card")
                for index, question in enumerate(questions):
                    if len(question["options"]) < retain.MIN_CHOICES:
                        self.assertNotEqual(kinds[index], "mc", f"{subject}: {question['question']}")

    def test_an_edited_guide_keeps_every_idea_in_its_quiz(self):
        for subject, pairs in GUIDES.items():
            _, _, qa = ideas.ensure_ids(None, None, qa_of(pairs))
            old = [{**q, "question": q["question"] + " (old)"} for q in quiz._standard_questions(qa, random.Random(2))]
            refreshed = guide_versions.refresh_quiz(old, qa, GUIDE_ID, 2)
            self.assertEqual([q["idea_id"] for q in refreshed], [p["idea_id"] for p in qa], subject)

    def test_ai_quizzes_keep_every_idea_and_every_choice_question_has_four(self):
        for subject, pairs in GUIDES.items():
            text = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a) in enumerate(pairs, 1))
            # One in three gets choices that don't fit; the replacement call fails.
            items = [{"distractors": [a + " and more besides", "Hyundai", "X"]} if i % 3 == 0 else
                     {"distractors": [f"{a} ({k})" for k in ("i", "ii", "iii")]} for i, (_, a) in enumerate(pairs)]
            chat = MagicMock(side_effect=[reply(json.dumps({"items": items})), RuntimeError("down")])
            db = FakeDb({"quiz_questions": None, "study_guide": text})
            with patch.multiple(quiz, chat=chat, get_openai_client=MagicMock(return_value=None),
                                remaining=MagicMock(return_value=1), record=MagicMock()):
                questions, _ = quiz._load_quiz(db, GUIDE_ID, "u1")
            self.assertEqual([q["question"] for q in questions], [q for q, _ in pairs], subject)
            for question in questions:
                if retain.can_choose(question):
                    self.assertEqual(len(question["options"]), 4, f"{subject}: {question}")
            self.assertTrue(any(not retain.can_choose(q) for q in questions), subject)
            cards = retain.plan_session(questions, ["mc"])
            self.assertEqual(len(cards), len(pairs))


# --- 4. Help me remember keeps a whole list trick --------------------------------------------------

NERVES = ("Olfactory, optic, oculomotor, trochlear, trigeminal, abducens, facial, vestibulocochlear, "
          "glossopharyngeal, vagus, accessory, and hypoglossal")
NERVE_HOOK = ("When you see cranial nerves, think 'Oh Oh Oh To Touch And Feel Very Good Velvet, Ah Heaven': "
              "Olfactory (nose), optic (eye), oculomotor (eye mover), trochlear (pulley), trigeminal (three-part face), "
              "abducens (abducts eye), facial (smile), vestibulocochlear (ear), glossopharyngeal (tongue-throat), "
              "vagus (wanders), accessory (shrug), and hypoglossal (tongue).")


class HookLengthTests(unittest.TestCase):
    def call(self, *hooks, question="What are the twelve cranial nerves in order?", answer=NERVES):
        chat = MagicMock(side_effect=[reply(json.dumps({"hook": hook, "linked": None})) for hook in hooks])
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            return llm.memory_hook(question, answer), chat

    def test_the_twelve_cranial_nerve_trick_is_kept_whole(self):
        result, chat = self.call(NERVE_HOOK)
        self.assertEqual(result, {"hook": NERVE_HOOK})
        self.assertEqual(chat.call_count, 1)

    def test_a_list_trick_fits_the_next_ask_for_another(self):
        # "Another one" sends the trick back as `previous`, which the endpoint accepts up to 600 characters.
        self.assertLessEqual(llm.HOOK_LIST_MAX_CHARS, quiz.RememberRequest.model_fields["previous"].metadata[0].max_length)

    def test_a_long_note_is_cut_at_a_sentence_never_mid_word(self):
        note = "First sentence here. " * 30
        cut = llm.student_feedback(note)
        self.assertLessEqual(len(cut), 300)
        self.assertTrue(cut.endswith("here."), cut[-30:])


# --- 5. Progress keys never change -----------------------------------------------------------------

SAVED = [
    {"question": "Which artists are listed for Chapter 1?", "options": ["a b", "c d", "e f", "g h"], "correct_index": 0, "choices_v": 2},
    {"question": "According to Slide 5, what is the normal serum potassium range?",
     "options": ["3.5-5.0 mEq/L", "2.0-3.0 mEq/L", "5.5-7.0 mEq/L", "1.0-2.5 mEq/L"], "correct_index": 0, "choices_v": 2},
    {"question": "Who painted the Mona Lisa?", "options": ["Leonardo da Vinci", "Raphael", "Titian", "Giotto"], "correct_index": 0, "choices_v": 2},
]
GUIDE_TEXT = "\n".join(f"Q{i}: {q['question']}\nA{i}: {q['options'][0]}" for i, q in enumerate(SAVED, 1))


class ProgressKeysTests(unittest.TestCase):
    def test_a_saved_quiz_is_never_rewritten_on_read(self):
        db = FakeDb({"quiz_questions": [dict(q) for q in SAVED]})
        questions, saved = quiz._load_quiz(db, GUIDE_ID, "u1")
        self.assertTrue(saved)
        self.assertEqual(db.updates, [])
        self.assertEqual([q["question"] for q in questions], [q["question"] for q in SAVED])

    def test_the_wording_changes_only_where_it_is_shown(self):
        shown = shown_questions([dict(q) for q in SAVED])
        self.assertEqual(len(shown), len(SAVED), "positions stay")
        self.assertEqual([q["question"] for q in shown], [q["question"] for q in SAVED], "the text keys hang on stays")
        self.assertTrue(shown[0].get("hidden"))
        self.assertEqual(shown[1]["shown"], "What is the normal serum potassium range?")
        self.assertNotIn("shown", shown[2])
        self.assertNotIn("hidden", shown[2])

    def test_a_quiz_entirely_about_the_source_is_shown_as_it_is(self):
        everything = [SAVED[0], {**SAVED[0], "question": "What is shown on Slide 7?"}]
        shown = shown_questions([dict(q) for q in everything])
        self.assertFalse(any(q.get("hidden") for q in shown), "never an empty quiz")

    def test_a_quiz_entirely_about_the_source_is_not_rebuilt_or_charged(self):
        everything = [dict(SAVED[0]), {**SAVED[0], "question": "What is shown on Slide 7?"}]
        db = FakeDb({"quiz_questions": everything})
        chat, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, chat=chat, record=record, get_openai_client=MagicMock(return_value=None)):
            questions, saved = quiz._load_quiz(db, GUIDE_ID, "u1")
        self.assertTrue(saved)
        self.assertEqual(len(questions), 2)
        self.assertEqual(db.updates, [])
        chat.assert_not_called()
        record.assert_not_called()

    def test_hidden_questions_are_never_asked_but_keep_their_place(self):
        shown = shown_questions([dict(q) for q in SAVED])
        self.assertEqual(retain.askable(shown), [1, 2])
        cards = retain.plan_session(shown, ["mc"], retain.pick_questions(shown))
        self.assertEqual(sorted(i for card in cards for i in card["concepts"]), [1, 2])

    def test_the_session_endpoint_serves_every_position(self):
        body = SimpleNamespace(types=["mc"], count=None, learn=False)
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), \
                patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_load_quiz", return_value=([dict(q) for q in SAVED], True)), \
                patch.object(quiz, "plan_for", return_value="free"), patch.object(quiz, "subscription_row", return_value=None):
            result = quiz.start_session(GUIDE_ID, body, authorization="Bearer t")
        self.assertEqual([q["question"] for q in result["questions"]], [q["question"] for q in SAVED])
        self.assertEqual(sorted(i for card in result["cards"] for i in card["concepts"]), [1, 2])
        self.assertEqual(sorted(result), ["cards", "pro", "questions", "types"])

    def test_parsing_a_guide_keeps_every_pair_as_written(self):
        pairs = quiz._parse_qa_pairs(GUIDE_TEXT)
        self.assertEqual([p["question"] for p in pairs], [q["question"] for q in SAVED])

    def test_idea_ids_stay_the_ones_made_from_the_saved_wording(self):
        content = guide_versions.live_content({"study_guide": GUIDE_TEXT, "quiz_questions": [dict(q) for q in SAVED]})
        expected = [ideas.stable_id(q["question"]) for q in SAVED]
        self.assertEqual([q["idea_id"] for q in content["qa"]], expected)
        self.assertEqual([q["idea_id"] for q in content["quiz"]], expected)

    def test_quiz_history_reads_the_same_questions_by_position(self):
        db = FakeDb({"quiz_questions": [dict(q) for q in SAVED]})
        questions, _ = quiz._load_quiz(db, GUIDE_ID, "u1")
        attempt = {"answers": [{"question_index": 2, "is_correct": True}, {"question_index": 1, "is_correct": False}]}
        self.assertEqual(study_insights.quiz_results(attempt, questions),
                         study_insights.quiz_results(attempt, SAVED))

    def test_another_students_version_is_the_same_list_every_time(self):
        content = {"qa": quiz._parse_qa_pairs(GUIDE_TEXT), "quiz": None, "version": 3}
        first = guide_versions.questions_for(content, GUIDE_ID)
        self.assertEqual(len(first), len(SAVED))
        self.assertEqual(first, guide_versions.questions_for(content, GUIDE_ID))
        self.assertEqual([q["question"] for q in first], [q["question"] for q in SAVED])

    def test_the_explanation_finds_the_guide_passage_for_a_reworded_question(self):
        pairs = quiz._parse_qa_pairs(GUIDE_TEXT)
        self.assertTrue(any(p["question"] == SAVED[1]["question"] for p in pairs))


# --- Medium 8: a part with no word of its own --------------------------------------------------------

class SharedWordPartTests(unittest.TestCase):
    CHAMBERS = "Left atrium, left ventricle, right atrium, and right ventricle"

    def test_a_part_with_no_word_of_its_own_needs_all_its_words_together(self):
        skipped = "Picture LEFT side: atrium then ventricle; the right ventricle pumps to lungs."
        self.assertIn("right atrium", [p.lower() for p in retain.missing_parts(skipped, self.CHAMBERS)])
        whole = "Left atrium, left ventricle, right atrium, right ventricle: L-L-R-R."
        self.assertEqual(retain.missing_parts(whole, self.CHAMBERS), [])

    def test_parts_with_a_word_of_their_own_are_unchanged(self):
        self.assertEqual(retain.missing_parts("Type 1 and gestational diabetes.", "Type 1 diabetes, Type 2 diabetes, and gestational diabetes"),
                         ["Type 2 diabetes"])
        self.assertEqual(retain.missing_parts("Remember RGRB: Romanesque, Gothic, Renaissance, Baroque.",
                                              "Romanesque, Gothic, Renaissance, and Baroque"), [])
        self.assertEqual(retain.missing_parts("An offer met by acceptance with consideration seals it.",
                                              "Offer, acceptance, and consideration"), [])


# === Second review of PR 281 ======================================================================

from services import text_processing as tp  # noqa: E402
from services.text_processing import clean_text  # noqa: E402

# --- High 1: a value or year line stays where it is, and is never dropped ----------------------------

# Every subject, both orders: an entry then its year, and a year then its entry. Joining a year to
# the line after it pins it to the wrong entry in the first order; keeping each line in place is
# right in both.
TIMELINES = {
    "art history": ["The Starry Night", "1889", "Cafe Terrace at Night", "1888", "Sunflowers", "1887"],
    "history": ["Declaration of Independence", "1776", "Constitution signed", "1787"],
    "business law": ["Marbury v. Madison", "1803", "McCulloch v. Maryland", "1819"],
    "literature": ["The Bluest Eye", "1970", "Sula", "1973", "Beloved", "1987"],
    "nursing": ["Nightingale Training School opens", "1860", "International Council of Nurses founded", "1899"],
    "computer science": ["ARPANET sends its first message", "1969", "World Wide Web proposed", "1989"],
}


def year_first(lines):
    """The same timeline written year first ("1889" / "The Starry Night")."""
    out = []
    for at in range(0, len(lines), 2):
        out += [lines[at + 1], lines[at]]
    return out


def slide_lines(text):
    slides = extract_slideshow_content(text)
    return [(slide["title"], slide["content"]) for slide in slides]


class ValueLinesStayTests(unittest.TestCase):
    def test_no_year_is_attached_to_another_entry_in_any_subject_or_order(self):
        for subject, lines in TIMELINES.items():
            for order, ordered in (("entry then year", lines), ("year then entry", year_first(lines))):
                with self.subTest(subject=subject, order=order):
                    self.assertEqual(clean_text("\n".join(ordered)).split("\n"), ordered)
                    slides = slide_lines("--- Slide 1 ---\nTimeline\n" + "\n".join(ordered))
                    self.assertEqual(slides, [("Timeline", ordered)])

    def test_the_reviewers_captures(self):
        # A page number under a heading stays a line of its own, never "Contraindications: 14".
        self.assertEqual(clean_text("--- Page 3 ---\nContraindications:\n14\nSevere hepatic impairment and known hypersensitivity").split("\n"),
                         ["--- Page 3 ---", "Contraindications:", "14", "Severe hepatic impairment and known hypersensitivity"])
        self.assertEqual(clean_text("Company profile\nFounded\n1998\nHeadquarters\nSeattle, Washington\nEmployees\n12,000").split("\n"),
                         ["Company profile", "Founded", "1998", "Headquarters", "Seattle, Washington", "Employees", "12,000"])
        self.assertEqual(clean_text("Steps:\n1.\nInitialize the array\n2.\nSort it").split("\n"),
                         ["Steps:", "1.", "Initialize the array", "2.", "Sort it"])
        self.assertEqual(clean_text("Statute of limitations for written contracts (years):\n6\nin most states").split("\n"),
                         ["Statute of limitations for written contracts (years):", "6", "in most states"])

    def test_slides_never_merge(self):
        text = ("Slide 1\nRevolution\nStorming of the Bastille\n1789\nSlide 2\nTerror\nRobespierre's Committee of Public Safety")
        self.assertEqual(slide_lines(text), [("Revolution", ["Storming of the Bastille", "1789"]),
                                             ("Terror", ["Robespierre's Committee of Public Safety"])])
        self.assertEqual(slide_lines("--- Slide 1 ---\nDates\nThe Bastille falls\n1789\n--- Slide 2 ---\nTerror\nThe Committee forms"),
                         [("Dates", ["The Bastille falls", "1789"]), ("Terror", ["The Committee forms"])])

    def test_references_after_a_year_are_still_stripped(self):
        text = ("Overview\nThe Treaty of Westphalia ended the Thirty Years' War in Europe.\n1648\nReferences\n"
                "Smith, J. (2001). Peace of Westphalia. Oxford.")
        self.assertEqual(clean_text(text).split("\n"),
                         ["Overview", "The Treaty of Westphalia ended the Thirty Years' War in Europe.", "1648"])

    def test_unlabelled_values_are_kept(self):
        self.assertEqual(clean_text("Apgar score at 1 minute\n7\nindicates mild distress").split("\n"),
                         ["Apgar score at 1 minute", "7", "indicates mild distress"])
        self.assertEqual(clean_text("Lines in a Shakespearean sonnet\n14\nthree quatrains and a couplet").split("\n"),
                         ["Lines in a Shakespearean sonnet", "14", "three quatrains and a couplet"])

    def test_the_facts_table_survives_clean_text_and_slideshow_extraction(self):
        for label, (text, kept) in FACTS.items():
            with self.subTest(fact=label):
                cleaned = clean_text(text)
                slides = extract_slideshow_content("--- Slide 1 ---\nFacts\n" + text)
                content = "\n" + "\n".join(line for slide in slides for line in [slide["title"], *slide["content"]]) + "\n"
                for fact in kept:
                    self.assertIn(fact, cleaned, f"clean_text: {cleaned!r}")
                    self.assertIn(fact, content, f"slides: {content!r}")

    def test_labelled_markers_and_navigation_are_still_dropped(self):
        self.assertEqual(clean_text("Mitosis\nProphase begins\nNext\n- 4 -\n\u2022"), "Mitosis\nProphase begins")


# --- High 2: one verb list for "As <verb> in <source>" --------------------------------------------------

VERBS = ["stated", "described", "shown", "explained", "noted", "defined", "outlined", "discussed", "listed", "seen",
         "mentioned", "presented", "covered", "taught", "introduced", "reviewed", "highlighted", "illustrated",
         "summarized", "summarised", "emphasized", "identified", "addressed", "examined", "explored", "learned",
         "studied", "depicted", "featured"]
VERB_SOURCES = ["the lecture", "Lecture 3", "the reading", "this module", "the slides"]  # narrow round: "Chapter 3" is asked as written
VERB_SUBJECTS = {"nursing": "what is the antidote for heparin?", "art history": "who painted Las Meninas?",
                 "business law": "what is promissory estoppel?", "literature": "who narrates Beloved?",
                 "computer science": "what is a hash collision?"}


class VerbMatrixTests(unittest.TestCase):
    def test_every_coverage_verb_frames_an_attribution_leading_and_trailing(self):
        wrong = []
        for verb in VERBS:
            for source in VERB_SOURCES:
                for subject, rest in VERB_SUBJECTS.items():
                    expected = rest[0].upper() + rest[1:]
                    for asked in (f"As {verb} in {source}, {rest}", f"{expected[:-1]}, as {verb} in {source}?"):
                        got = standalone_question(asked)
                        if got != expected:
                            wrong.append((asked, got))
        self.assertEqual(wrong, [])

    def test_one_verb_list(self):
        self.assertIn(tp._COVERAGE_VERB, tp._FRAMING)


# --- Medium 8 and 9, and the reviewer's fresh cases ----------------------------------------------------

FRESH = [
    # nursing
    ("As reviewed in the lecture, what is the antidote for heparin?", "What is the antidote for heparin?"),
    ("In anaphylaxis, which drug is given first?", "KEEP"),
    ("Per the module, what is the first-line treatment for hypoglycemia in a conscious client?",
     "What is the first-line treatment for hypoglycemia in a conscious client?"),
    ("The nurse reviews the client's chart. Which lab value is listed first as abnormal?", "KEEP"),
    ("Which medication on the client's medication list should the nurse question?", "KEEP"),
    ("What does the instructor recommend for preventing falls?", None),
    # art history
    ("According to the slides, who painted Las Meninas?", "Who painted Las Meninas?"),
    ("Which painting is shown on this slide?", None),
    ("What does the figure in the foreground of Las Meninas represent?", "KEEP"),
    ("In the image of the Parthenon, which order are the columns?", "KEEP"),
    # business law
    ("In the Bill of Rights, which freedom is listed first?", "KEEP"),
    ("Under the UCC, what is the perfect tender rule?", "KEEP"),
    ("As defined in the reading, what is a fiduciary duty?", "What is a fiduciary duty?"),
    ("Based on the graph, what is the equilibrium price?", "What is the equilibrium price?"),
    ("What does the table of contents of the Restatement cover?", "KEEP"),
    ("In Maslow's hierarchy, which need is listed first?", "KEEP"),
    # literature
    ("What does the speaker of the poem compare love to?", "KEEP"),
    ("In the excerpt, what does Gatsby's smile reveal?", "What does Gatsby's smile reveal?"),
    ("Which line of the sonnet contains the volta?", "KEEP"),
    ("As discussed in class, what is free indirect discourse?", "What is free indirect discourse?"),
    # computer science
    ("What is the time complexity of inserting into a hash table?", "KEEP"),
    ("In the periodic table, which element is listed first?", "KEEP"),
    ("Which element of the list is returned by pop()?", "KEEP"),
    ("What does the professor's example of recursion compute?", None),
    ("As shown in the diagram, what is the root of the tree?", "What is the root of the tree?"),
    ("What is the page table entry used for?", "KEEP"),
    # source-only once the attribution is gone
    # narrow round: trimmed to a generic noun, so asked as written
    ("According to the lecture, what are the four steps?", "KEEP"),
    ("Per the slides, what is the third example?", "KEEP"),
    ("What is the key takeaway, as stated in the module?", "KEEP"),
]

# The owner's rule: a picture, chart or table in an opening is trimmed like any other opening that
# only names the source, or the question is asked as written; it is never hidden for it. Only a
# question about the picture's own layout (a label, a point on it) or contents is hidden.
VISUAL = {
    "Based on the graph, what is the equilibrium price?": "What is the equilibrium price?",
    "As shown in the diagram, what is the root of the tree?": "What is the root of the tree?",
    "According to Figure 2, which chamber pumps blood to the lungs?": "Which chamber pumps blood to the lungs?",
    "According to Table 3, what is the normal serum sodium range?": "What is the normal serum sodium range?",
    "Based on the map, which river formed the border?": "Which river formed the border?",
    "As depicted in the image, which order are the columns?": "Which order are the columns?",
    "What is the equilibrium price, based on the chart above?": "What is the equilibrium price?",
    "In the image of the Parthenon, which order are the columns?": "KEEP",
    # the question itself is about the picture: hidden for what it asks, never for its opening
    "In this photo, which architectural style is shown?": None,
    "In the diagram of the heart, which valve is labelled B?": None,
}
# Not a picture: subject terms and a patient's chart.
NOT_VISUAL = [
    "According to the chart, what was the client's last blood pressure?",
    "In the graph of y = x^2, where is the vertex?",
    "What is the figure of speech in 'the wind whispered'?",
    "In the periodic table, which element is listed first?",
    "What does a Gantt chart show?",
]


class SecondReviewQuestionTests(unittest.TestCase):
    def test_the_reviewers_fresh_cases(self):
        for question, want in FRESH:
            with self.subTest(question=question):
                got = standalone_question(question)
                self.assertEqual(got, question if want == "KEEP" else want)

    def test_listed_first_in_a_named_subject_is_asked_as_written(self):
        for question in ("In the Bill of Rights, which freedom is listed first?", "In Maslow's hierarchy, which need is listed first?",
                         "In the periodic table, which element is listed first?", "Under the UCC, which remedy is listed first?"):
            self.assertEqual(standalone_question(question), question)
        for question in ("Which drug is listed first?", "In the lecture, which drug is listed first?",
                         "Which artist is named first, according to the slides?"):
            self.assertIsNone(standalone_question(question), question)

    def test_a_visual_opening_is_trimmed_or_kept_never_hidden(self):
        for question, want in VISUAL.items():
            self.assertEqual(standalone_question(question), question if want == "KEEP" else want, question)
        for question in NOT_VISUAL:
            self.assertEqual(standalone_question(question), question)

    def test_every_case_is_stable(self):
        for question, _ in FRESH:
            once = standalone_question(question)
            if once is not None:
                self.assertEqual(standalone_question(once), once, question)


# --- High 3: every route that returns quiz_questions sends shown / hidden ----------------------------

RAW_QUIZ = [
    {"question": "Which artists are listed for Chapter 1?", "options": ["Giotto, Cimabue", "B b", "C c", "D d"], "correct_index": 0},
    {"question": "According to Slide 5, what is the normal serum potassium range?",
     "options": ["3.5-5.0 mEq/L", "2.0-3.0 mEq/L", "5.5-7.0 mEq/L", "1.0-2.5 mEq/L"], "correct_index": 0},
    {"question": "Who painted the Mona Lisa?", "options": ["Leonardo da Vinci", "Raphael", "Titian", "Giotto"], "correct_index": 0},
]


def assert_shown(test, questions, where):
    test.assertEqual([q["question"] for q in questions], [q["question"] for q in RAW_QUIZ], f"{where}: saved text kept")
    test.assertTrue(questions[0].get("hidden"), f"{where}: about the source")
    test.assertEqual(questions[1].get("shown"), "What is the normal serum potassium range?", where)
    test.assertNotIn("hidden", questions[2], where)
    test.assertNotIn("shown", questions[2], where)


def quiz_lists(value, found):
    """Every quiz_questions list anywhere in a JSON response."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "quiz_questions" and isinstance(item, list):
                found.append(item)
            else:
                quiz_lists(item, found)
    elif isinstance(value, list):
        for item in value:
            quiz_lists(item, found)
    return found


class EveryRouteShowsTests(unittest.TestCase):
    USER = "00000000-0000-4000-8000-000000000001"
    GUIDE = "10000000-0000-4000-8000-000000000001"
    JOB = "30000000-0000-4000-8000-000000000001"

    def setUp(self):
        from fastapi.testclient import TestClient
        import main
        from fake_supabase import FakeDB, route_patches
        os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
        self.db = FakeDB()
        self.db.rows("study_guides").append({
            "id": self.GUIDE, "user_id": self.USER, "title": "Electrolytes", "folder_id": None, "notes": "",
            "study_guide": GUIDE_TEXT, "flashcards": [], "flashcard_progress": {}, "quiz_questions": [dict(q) for q in RAW_QUIZ],
            "created_at": "2026-11-01T00:00:00Z", "is_bookmarked": False, "print_items": None})
        self.db.rows("generation_jobs").append({"id": self.JOB, "user_id": self.USER, "status": "done", "study_set_id": self.GUIDE})
        self.patches = route_patches(["guides", "jobs", "quiz"], lambda header: self.USER, self.db)
        for item in self.patches:
            item.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)

    def tearDown(self):
        for item in self.patches:
            item.stop()

    def test_the_guide_routes_send_the_quiz_as_shown(self):
        calls = {
            "GET /guides": lambda: self.client.get("/guides", headers={"Authorization": "Bearer t"}),
            "GET /guides/{id}": lambda: self.client.get(f"/guides/{self.GUIDE}", headers={"Authorization": "Bearer t"}),
            "PATCH /guides/{id}": lambda: self.client.patch(f"/guides/{self.GUIDE}", json={"title": "Electrolytes"},
                                                            headers={"Authorization": "Bearer t"}),
            "GET /study-set-jobs/{id}": lambda: self.client.get(f"/study-set-jobs/{self.JOB}", headers={"Authorization": "Bearer t"}),
        }
        for route, call in calls.items():
            with self.subTest(route=route):
                response = call()
                self.assertEqual(response.status_code, 200, response.text)
                found = quiz_lists(response.json(), [])
                self.assertEqual(len(found), 1, f"{route} returns the quiz once")
                assert_shown(self, found[0], route)
        self.assertEqual(self.db.rows("study_guides")[0]["quiz_questions"], RAW_QUIZ, "the saved quiz is never rewritten")

    def test_no_route_returns_a_guide_row_without_the_serializer(self):
        """A route that reads quiz_questions (or a whole study_guides row) either shows it with
        shown_guide / shown_questions or is listed here as never returning it."""
        import ast
        internal = {
            ("guides.py", "_follow_ideas"), ("guide_sharing.py", "copy_guide"), ("guide_sharing.py", "ask_guide"),
            ("quiz.py", "_load_quiz"), ("quiz.py", "_saved_questions"), ("quiz.py", "_save_quiz"), ("stats.py", "_student_results"),
            ("study.py", "quiz_questions"),
        }
        routers = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend", "routers")
        unshown = []
        for name in sorted(os.listdir(routers)):
            if not name.endswith(".py"):
                continue
            with open(os.path.join(routers, name)) as handle:
                source = handle.read()
            for node in ast.walk(ast.parse(source)):
                if not isinstance(node, ast.FunctionDef):
                    continue
                body = ast.get_source_segment(source, node) or ""
                reads = "quiz_questions" in body or re.search(r'study_guides"\)\s*\\?\s*\.select\("\*"\)', body)
                if reads and "shown_" not in body and (name, node.name) not in internal:
                    unshown.append(f"{name}:{node.name}")
        self.assertEqual(unshown, [])


# --- High 4 (the owner's must-fix) is in web/tests/question-display.test.mjs; Medium 5: print ---------

PRINT_GUIDE = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a) in enumerate([
    ("Which artists are listed for Chapter 1?", "Giotto, Cimabue and Duccio"),
    ("What is chiaroscuro?", "Chiaroscuro is the strong contrast between light and dark used to model form in painting."),
    ("According to the slides, what is impasto?", "Impasto is paint laid on so thickly that brush or knife marks stay visible on the surface."),
    ("Why did Renaissance painters adopt linear perspective?",
     "It let them build a convincing illusion of depth on a flat surface using a single vanishing point and orthogonals."),
    ("Who painted the Mona Lisa?", "Leonardo da Vinci"),
], 1))


class PrintSourcesTests(unittest.TestCase):
    def printed(self, fill=False, cached=None, generated=None, guide=PRINT_GUIDE):
        pairs = quiz._parse_qa_pairs(guide)
        saved = [{"question": p["question"], "options": [p["answer"], "x1 y1 z1", "x2 y2 z2", "x3 y3 z3"], "correct_index": 0,
                  "choices_v": 2} for p in pairs]
        row = {"title": "t", "folder_id": None, "study_guide": guide, "print_items": cached}
        chat = MagicMock(return_value=reply(json.dumps({"items": generated or []})))
        require, record = MagicMock(), MagicMock()
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_guide_columns", return_value=row), patch.object(quiz, "_load_quiz", return_value=(saved, True)), \
                patch.object(quiz, "remaining", return_value=5), patch.object(quiz, "require", require), \
                patch.object(quiz, "record", record), patch.object(quiz, "chat", chat), \
                patch.object(quiz, "get_openai_client", return_value=None):
            out = quiz.printable_items(GUIDE_ID, SimpleNamespace(fill=fill), authorization="Bearer t")
        return out, pairs, chat, record

    def test_every_type_uses_the_saved_pair_index(self):
        out, pairs, _, _ = self.printed()
        for kind in ("mc", "matching", "short"):
            for item in out[kind]:
                text = item.get("question") or item.get("term")
                pair = pairs[item["source"]]["question"]
                self.assertIn(normalize_words(text), normalize_words(standalone_question(pair) or ""), f"{kind}: {item}")
        sources = [item["source"] for kind in ("mc", "matching", "short") for item in out[kind]]
        self.assertNotIn(0, sources, "a question about the source is not printed")
        self.assertIn(2, [item["source"] for item in out["matching"]], "impasto is matched at its own index")
        self.assertEqual([item["question"] for item in out["mc"] if item["source"] == 2], ["What is impasto?"])

    def test_fill_in_is_built_and_cached_without_hidden_pairs(self):
        generated = [{"id": n, "sentence": s} for n, s in enumerate([
            "[[Giotto]] painted for Chapter 1.", "[[Chiaroscuro]] is the strong contrast between light and dark.",
            "[[Impasto]] is paint laid on thickly.", "Painters used a single [[vanishing point]].", "[[Leonardo da Vinci]] painted it."])]
        out, pairs, chat, record = self.printed(fill=True, generated=generated)
        prompt = chat.call_args.kwargs["messages"][1]["content"]
        self.assertNotIn("Chapter 1", prompt)
        self.assertNotIn("According to the slides", prompt)
        self.assertTrue(all(item["source"] != 0 for item in out["fill"]))
        record.assert_called_once()
        # A cache written before the source question was hidden is filtered as it is served.
        cache = {"v": 1, "source": __import__("services.print_items", fromlist=["x"]).source_hash(pairs),
                 "fill": [{"id": "f0", "source": 0, "parts": [{"blank": "Giotto"}], "blanks": ["Giotto"], "points": 1}]}
        out, _, chat, record = self.printed(fill=True, cached=cache)
        self.assertEqual(out["fill"], [])
        chat.assert_not_called()
        record.assert_not_called()

    def test_nothing_is_charged_when_only_hidden_pairs_could_be_filled(self):
        long = "It let painters build a convincing illusion of depth on a flat surface, with every line of the floor, the walls " \
               "and the ceiling running to one vanishing point placed at the eye level of a viewer standing in front of it."
        guide = (f"Q1: Which artists are listed for Chapter 1?\nA1: Giotto\nQ2: Why did painters adopt linear perspective?\nA2: {long}\n"
                 f"Q3: How did linear perspective change altarpieces?\nA3: {long}")
        out, _, chat, record = self.printed(fill=True, guide=guide)
        self.assertEqual(out["fill"], [])
        self.assertEqual(out["fill_possible"], 0)
        chat.assert_not_called()
        record.assert_not_called()


def normalize_words(text):
    return " ".join(re.findall(r"[a-z0-9]+", str(text).lower()))


# --- Low 13: refreshing choices is not charged for hidden questions ----------------------------------

class RefreshHiddenTests(unittest.TestCase):
    def test_hidden_only_flags_cost_nothing(self):
        questions = [
            # Its wrong choice is another question's answer, but the question is never asked.
            {"question": "Which artists are listed for Chapter 1?", "options": ["Giotto", "Leonardo da Vinci", "C c", "D d"], "correct_index": 0},
            {"question": "Who painted the Mona Lisa?", "options": ["Leonardo da Vinci", "Raphael", "Titian", "Michelangelo"], "correct_index": 0},
        ]
        require, record, top_up = MagicMock(), MagicMock(), MagicMock(return_value=[])
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_saved_questions", return_value=questions), patch.object(quiz, "require", require), \
                patch.object(quiz, "record", record), patch.object(quiz, "_top_up", top_up):
            out = quiz.refresh_choices(GUIDE_ID, authorization="Bearer t")
        self.assertEqual(out["changed"], 0)
        require.assert_not_called()
        record.assert_not_called()
        top_up.assert_not_called()
        self.assertTrue(out["questions"][0].get("hidden"))


# --- Low 14: AI prompts ask the question as it is shown ----------------------------------------------

class PromptWordingTests(unittest.TestCase):
    QUESTIONS = [dict(RAW_QUIZ[1])]

    def run_route(self, route, body, target):
        fake = MagicMock(return_value={"credit": 1, "explanation": "ok", "hook": "h", "why": "w"})
        guide = MagicMock()
        guide.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = SimpleNamespace(
            data=[{"study_guide": "Q1: " + RAW_QUIZ[1]["question"] + "\nA1: 3.5-5.0 mEq/L"}])
        with patch.object(quiz, "get_supabase", return_value=guide), patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_saved_questions", return_value=self.QUESTIONS), \
                patch.object(quiz, "_questions_for", return_value=(self.QUESTIONS, False)), \
                patch.object(quiz, "_memory_preferences", return_value=(["link"], [])), \
                patch.object(quiz, "require", MagicMock()), patch.object(quiz, "record", MagicMock()), \
                patch.object(quiz, target, fake), \
                patch("services.memory_context.related_material", return_value=None), \
                patch("services.adult_content.crude_allowed", return_value=False):
            getattr(quiz, route)(GUIDE_ID, body, authorization="Bearer t")
        return fake.call_args.args[0]

    def test_grade_why_and_remember_ask_the_shown_wording(self):
        shown = "What is the normal serum potassium range?"
        self.assertEqual(self.run_route("grade_written", quiz.WrittenAnswer(concept=0, answer="3.5 to 5"), "grade_written_answer"), shown)
        self.assertEqual(self.run_route("explain_miss", quiz.MissRequest(concept=0, chosen="2.0-3.0 mEq/L"), "explain_miss_briefly"), shown)
        self.assertEqual(self.run_route("help_me_remember", quiz.RememberRequest(concept=0), "memory_hook"), shown)

    def test_the_tutor_explains_the_shown_wording(self):
        from routers import chat as chat_router
        from schemas import ChatRequest
        body = ChatRequest(question="Why?", content="", guide_id=GUIDE_ID, retain_context={
            "question": RAW_QUIZ[1]["question"], "options": RAW_QUIZ[1]["options"],
            "selected_answer": "2.0-3.0 mEq/L", "correct_answer": "3.5-5.0 mEq/L"})
        material = SimpleNamespace(content="Q1: " + RAW_QUIZ[1]["question"] + "\nA1: 3.5-5.0 mEq/L", source=None)
        explain = MagicMock(return_value="Because.")
        with patch.object(chat_router, "require", MagicMock()), patch.object(chat_router, "record", MagicMock()), \
                patch.object(chat_router, "learning_guidance", return_value=""), patch.object(chat_router, "style_instruction", return_value=""), \
                patch.object(chat_router, "explain_retain_answer", explain):
            chat_router._tutor_reply(body, "u1", "Why?", material, "retain", None)
        self.assertEqual(explain.call_args.kwargs["question"], "What is the normal serum potassium range?")


class NothingLeftToAskTests(unittest.TestCase):
    def test_a_quiz_is_never_left_with_nothing_to_ask(self):
        rows = [dict(RAW_QUIZ[0]), {"question": "What is x?", "options": [], "correct_index": 0}, None]
        shown = shown_questions(rows)
        self.assertFalse(any(isinstance(q, dict) and q.get("hidden") for q in shown))
        body = SimpleNamespace(types=["mc"], count=None, learn=False)
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_load_quiz", return_value=(rows, True)), patch.object(quiz, "plan_for", return_value="free"), \
                patch.object(quiz, "subscription_row", return_value=None):
            result = quiz.start_session(GUIDE_ID, body, authorization="Bearer t")
        self.assertEqual([i for card in result["cards"] for i in card["concepts"]], [0], "a malformed row is skipped, not a crash")


# --- Low 11: a part's words may sit apart within one clause ------------------------------------------

class PartsInProseTests(unittest.TestCase):
    CHAMBERS = "Left atrium, left ventricle, right atrium, and right ventricle"

    def test_words_of_a_part_within_one_clause_count(self):
        prose = ("On the right side, the atrium collects blood and the ventricle pumps it to the lungs; "
                 "on the left side, the atrium and ventricle send it to the body.")
        self.assertEqual(retain.missing_parts(prose, self.CHAMBERS), [])

    def test_a_shared_hyphen_names_both_parts(self):
        self.assertEqual(retain.missing_parts("First- and second-degree murder differ by premeditation; voluntary manslaughter "
                                              "is heat of passion.", "First-degree murder, second-degree murder, and voluntary manslaughter"), [])

    def test_words_split_across_clauses_do_not(self):
        self.assertEqual(retain.missing_parts("Picture LEFT side: atrium then ventricle; the right ventricle pumps to lungs.",
                                              self.CHAMBERS), ["right atrium"])


# --- Medium 7: the connected-app route that says how each question is shown --------------------------

class ConnectorWordingTests(unittest.TestCase):
    def test_the_wording_route_marks_each_quiz_like_shown_questions(self):
        from routers import mcp
        body = mcp.WordingRequest(quizzes=[
            [{"question": q["question"]} for q in RAW_QUIZ],
            [{"question": "Which works are shown on Slide 4?"}],
            [{"question": "Which works are shown on Slide 4?"}, {"question": "What is x?", "answered": False}],
        ])
        with patch.object(mcp, "_student", return_value=("u1", MagicMock())):
            out = mcp._question_wording("Bearer t", body)
        self.assertEqual(out["quizzes"][0], [{"hidden": True}, {"shown": "What is the normal serum potassium range?"}, {}])
        self.assertEqual(out["quizzes"][1], [{}], "a quiz all about the source is shown as it is")
        self.assertEqual(out["quizzes"][2], [{}, {}], "nor is one left with nothing to ask")
        # The final round's caps are per request (tests/test_question_quality_final.py has the CPU bound)
        mcp.WordingRequest(quizzes=[[{"question": "x"}] * 201])
        with self.assertRaises(Exception):
            mcp.WordingRequest(quizzes=[[{"question": "x"}] * 2001])


if __name__ == "__main__":
    unittest.main()
