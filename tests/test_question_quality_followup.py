"""Learn question quality, follow-up to F5 (review of PR 275; feedback ed2eb2e2, b67047f0).

1. Facts kept: a line that is only a number ("1789", "4000", "3/4") is subject matter; only labelled
   ("Slide 5", "Page 3", "p. 12") or decorated ("- 3 -", "3 of 12") markers are layout.
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
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
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

MARKERS = {
    "--- Slide 5 ---\nSodium\nNormal 135-145": "Sodium\nNormal 135-145",
    "Page 3 of 12\nTorts": "Torts",
    "Slide 6: Sodium balance": "Sodium balance",
    "Page 3 - Introduction to Contracts": "Introduction to Contracts",
    "Torts\n- 3 -\nNegligence": "Torts\n\nNegligence",
    "Torts\n— 7 —\nNegligence": "Torts\n\nNegligence",
    "Torts\n3 of 12\nNegligence": "Torts\n\nNegligence",
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
    "As explained in Chapter 3, what is the parol evidence rule?": "What is the parol evidence rule?",
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
    "In the lecture, in Chapter 3, what is a tort?": "What is a tort?",
    "According to Slide 5, according to the lecture, what is mitosis?": "What is mitosis?",
    "From the reading: per the notes, what is a tort?": "What is a tort?",
    "What is sfumato, according to the text, according to the slides?": "What is sfumato?",
}

# Still need the file once the attribution is gone, or the source is the one acting.
SOURCE_QUESTIONS = [
    "What does the first bullet say, according to Slide 2?",
    "What are the three examples, according to the slides?",
    "What is the second step in the list?",
    "What is the last term in the table?",
    "What is the main idea, according to the reading?",
    "What is the author's main argument, according to the passage?",
    "Which painting appears first in the presentation?",
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
        for question in SUBJECT_QUESTIONS:
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


if __name__ == "__main__":
    unittest.main()
