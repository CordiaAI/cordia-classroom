"""Learn question quality (feedback ed2eb2e2, b67047f0), on captured text from five subjects:

1. No question about the source's structure ("listed for Chapter 1", "Slide 5"): slide and page
   markers never reach the guide prompt, and a question that still points at the source is
   rewritten (a leading or trailing "according to Slide 5") or dropped.
2. Every multiple-choice question has exactly 4 choices of the same kind (a list for a list, a value
   for a value) and similar length; the guide's other answers are only borrowed when they answer
   the same kind of question (never a company for a person).
3. "Help me remember" covers every part of a multi-part answer, retrying once when it doesn't.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz  # noqa: E402
from services import llm, retain  # noqa: E402
from services.choice_shapes import fits, is_value  # noqa: E402
from services.text_processing import (  # noqa: E402
    chunk_text, extract_slideshow_content, format_slideshow_text, refers_to_source, shown_questions, standalone_question,
    strip_structure_markers,
)

GUIDE_ID = "00000000-0000-0000-0000-000000000001"

# Captured text as each source sends it: PPTX/extension slides, OCR'd PDF pages, a web page.
SOURCES = {
    "nursing_slides": "--- Slide 1 ---\nFluid and Electrolytes\n--- Slide 5 ---\nPotassium\n"
                      "Normal serum potassium is 3.5-5.0 mEq/L.\nHyperkalemia causes peaked T waves.\n"
                      "--- Slide 6 ---\nSlide 6: Sodium\nNormal serum sodium is 135-145 mEq/L.",
    "art_history_pdf": "--- Page 1 ---\nChapter 1: The Renaissance\nPage 1 of 12\nLeonardo da Vinci painted the Mona Lisa "
                       "using sfumato, a soft blending of tones.\n--- Page 2 ---\nPage 2 of 12\nChiaroscuro is the "
                       "strong contrast between light and dark.\n2",
    "business_law_web": "Business Law - Week 3\nChapter 11 bankruptcy lets a business reorganize its debts while it "
                        "keeps operating.\nSection 2 of the Sherman Act prohibits monopolization.\nPage 3",
    "literature_pdf": "--- Page 12 ---\nIn Chapter 9 of The Great Gatsby, only Nick and Owl Eyes attend Gatsby's "
                      "funeral.\np. 12\nThe green light symbolizes Gatsby's hope for the future.",
    "cs_slides": "--- Slide 3 ---\nVirtual Memory\nA page fault occurs when a program touches a page that is not in "
                 "memory.\n--- Slide 4 ---\nBinary search runs in O(log n) time.\nSlide 4 of 20",
}

# What a model wrote from those sources: subject questions mixed with questions about the source.
MODEL_OUTPUT = {
    "nursing": [
        ("What is the normal serum potassium range, according to Slide 5?", "3.5-5.0 mEq/L", "What is the normal serum potassium range?"),
        ("What topics are covered in this lecture?", "Potassium and sodium", None),
        ("What is shown on slide 7?", "An ECG strip", None),
        ("What ECG change does hyperkalemia cause?", "Peaked T waves", "same"),
        ("What is the typical presentation of hyperkalemia?", "Muscle weakness and peaked T waves", "same"),
        ("What is a C-section?", "Surgical delivery of a baby through the abdomen", "same"),
    ],
    "art_history": [
        ("Which artists are listed for Chapter 1?", "Leonardo da Vinci, Michelangelo, Raphael and Donatello", None),
        ("On page 3, what technique is described?", "Sfumato", None),
        ("According to the reading, what is chiaroscuro?", "The strong contrast between light and dark", "What is chiaroscuro?"),
        ("Who painted the Mona Lisa?", "Leonardo da Vinci", "same"),
        ("What does Figure 2 show?", "The Last Supper", None),
        ("What is a cross-section drawing?", "A view of an object cut through", "same"),
    ],
    "business_law": [
        ("What does Chapter 11 bankruptcy allow a business to do?", "Reorganize its debts while operating", "same"),
        ("Under Section 2 of the Sherman Act, what conduct is prohibited?", "Monopolization", "same"),
        ("What are the key terms for Chapter 3?", "Tort, contract and agency", None),
        ("What is discussed in Section 4.2?", "Agency law", None),
        ("Which companies are listed on the New York Stock Exchange?", "Publicly traded companies that meet its rules", "same"),
        ("What is a listed company?", "A company whose shares trade on an exchange", "same"),
        ("What are the requirements for filing for Chapter 7?", "Passing the means test", "same"),
    ],
    "literature": [
        ("What happens in Chapter 9 of The Great Gatsby?", "Only Nick and Owl Eyes attend Gatsby's funeral", "same"),
        ("What themes are introduced in this chapter?", "Hope and loss", None),
        ("What does the passage on page 12 reveal about Nick?", "His loyalty", None),
        ("What does the green light symbolize in The Great Gatsby?", "Gatsby's hope for the future", "same"),
        ("Which characters are listed in the document?", "Nick, Gatsby, Daisy and Tom", None),
    ],
    "computer_science": [
        ("What causes a page fault?", "A program touching a page that is not in memory", "same"),
        ("What is a page table?", "A map from virtual pages to physical frames", "same"),
        ("In Lecture 4, what is the time complexity of binary search?", "O(log n)", "What is the time complexity of binary search?"),
        ("Which algorithms are listed in the table above?", "Binary search and merge sort", None),
        ("What does this class inherit from in Java?", "Object", "same"),
        ("What are the notes of a C major triad?", "C, E and G", "same"),
    ],
}


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class StructureMarkerTests(unittest.TestCase):
    """Problem 1, earliest point: markers in the captured text that invite "Slide 5" questions."""

    def test_slide_chunks_carry_titles_but_no_slide_numbers(self):
        slides = extract_slideshow_content(SOURCES["nursing_slides"])
        for text in [format_slideshow_text(slides), *chunk_text("", slides=slides)]:
            self.assertNotIn("<NUMBER>", text)
            self.assertNotIn("Untitled Slide", text)
            self.assertIn("<SLIDE>", text)
        untitled = format_slideshow_text([{"title": "", "content": ["Mitosis splits a cell."]}])
        self.assertNotIn("Slide", untitled.replace("<SLIDE>", "").replace("</SLIDE>", ""))

    def test_page_and_slide_markers_are_stripped_from_every_source(self):
        for name, text in SOURCES.items():
            cleaned = strip_structure_markers(text)
            for marker in ("--- Slide", "--- Page", "Page 1 of 12", "Page 2 of 12", "Slide 4 of 20", "Slide 6:", "p. 12"):
                self.assertNotIn(marker, cleaned, f"{name}: {marker}")
            self.assertNotRegex(cleaned, r"(?im)^\s*(?:page|slide)\s*\d+\s*$", name)
            # A line that is only a number stays: it is as often the fact itself ("1789", "4000").
        cleaned = strip_structure_markers(SOURCES["nursing_slides"])
        self.assertIn("Sodium\nNormal serum sodium is 135-145 mEq/L.", cleaned)
        law = strip_structure_markers(SOURCES["business_law_web"])
        self.assertIn("Chapter 11 bankruptcy", law)
        self.assertIn("Section 2 of the Sherman Act", law)

    def test_a_line_mentioning_a_slide_is_still_content(self):
        self.assertEqual(strip_structure_markers("Slide 3 covers torts"), "Slide 3 covers torts")

    def test_the_guide_prompt_never_sees_a_marker(self):
        chat = MagicMock(return_value=reply("Q1: What is chiaroscuro?\nA1: Strong contrast between light and dark."))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            for text in SOURCES.values():
                llm.generate_study_guide(chunk_text(text))
        for call in chat.call_args_list:
            prompt = call.kwargs["messages"][1]["content"]
            for marker in ("--- Slide", "--- Page", "of 12", "Slide 4 of 20", "<NUMBER>"):
                self.assertNotIn(marker, prompt)

    def test_the_stand_alone_rule_applies_to_every_question(self):
        prompt = llm._build_study_guide_prompt("text")
        rule = next(line for line in prompt.splitlines() if "stand alone" in line)
        self.assertTrue(rule.startswith("• Every question must stand alone"), rule)
        self.assertEqual(prompt.count("stand alone"), 1, "one rule, not a second copy")


class StructureQuestionTests(unittest.TestCase):
    """Problem 1, deterministic backstop after generation."""

    def test_five_subjects(self):
        for subject, rows in MODEL_OUTPUT.items():
            for question, _answer, expected in rows:
                kept = standalone_question(question)
                if expected is None:
                    self.assertIsNone(kept, f"{subject}: kept {question!r} as {kept!r}")
                else:
                    self.assertEqual(kept, question if expected == "same" else expected, subject)
                    self.assertFalse(refers_to_source(kept), f"{subject}: {kept}")

    def test_postprocessed_guides_hold_no_structure_question(self):
        for subject, rows in MODEL_OUTPUT.items():
            raw = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a, _) in enumerate(rows, 1))
            guide, next_index = llm._postprocess_study_guide(raw)
            questions = [line.split(": ", 1)[1] for line in guide.splitlines() if line.startswith("Q")]
            expected = [q if e == "same" else e for q, _, e in rows if e is not None]
            self.assertEqual(questions, expected, subject)
            self.assertEqual(next_index, len(expected) + 1, "numbering stays continuous")
            self.assertTrue(llm.study_guide_is_complete(guide))

    def test_answers_lose_a_leading_source_clause(self):
        guide, _ = llm._postprocess_study_guide("Q1: What is sfumato?\nA1: According to the slides, a soft blending of tones.")
        self.assertIn("A1: A soft blending of tones.", guide)

    SUBJECT_TERMS = {
        "computer_science": [
            "What does the List interface guarantee about element order?",
            "Which method of the List interface is defined in the Collection interface?",
            "What is the document object model?",
            "How is an HTML page described in the document object model?",
            "What does a page fault trigger in an operating system?",
            "What is the difference between a linked list and an array?",
            "Which structure is explained by the page table?",
            "Which behaviour is defined in the List interface?",
            "Which operations are described in the document object model?",
        ],
        "nursing": [
            "Which document must a nurse complete after giving a controlled substance?",
            "What does the document for informed consent record?",
            "What is a medication list reconciliation?",
        ],
        "business_law": [
            "What is a document of title under the UCC?",
            "What does Section 230 of the Communications Decency Act protect?",
            "Which section 8 housing voucher rule applies to the tenant?",
            "What is the Chapter 7 bankruptcy process?",
        ],
        "art_history": [
            "What is a page layout in an illuminated manuscript?",
            "Which painter designed the Sistine Chapel section known as the ceiling?",
            "What does the string section do in a symphony?",
        ],
        "literature": [
            "Which characters are named in the list poem Catalogue of Ships?",
            "What is a table of contents in a novel's front matter?",
            "What does the text editor in a printing press change?",
        ],
    }
    SOURCE_REFERENCES = [
        "What is listed in the document?",
        "What does the following list show?",
        "What is described in this section?",
        "Which terms are discussed in the page above?",
        "What topics are covered in the section on torts?",
        "Which key terms are listed for the chapter?",
        "What does this table show?",
        "What does the document say about torts?",
        "Which concepts are introduced in this lecture?",
    ]

    def test_subject_terms_with_source_words_are_kept_in_five_subjects(self):
        for subject, questions in self.SUBJECT_TERMS.items():
            for question in questions:
                self.assertFalse(refers_to_source(question), f"{subject}: {question}")
                self.assertEqual(standalone_question(question), question, f"{subject}: {question}")

    def test_questions_about_the_source_are_still_removed(self):
        for question in self.SOURCE_REFERENCES:
            self.assertTrue(refers_to_source(question), question)
            self.assertIsNone(standalone_question(question), question)

    def test_saved_quizzes_keep_subject_term_questions(self):
        saved = [{"question": q, "options": ["a b", "c d", "e f", "g h"], "correct_index": 0, "choices_v": 2}
                 for q in ("What does the List interface guarantee about element order?", "What is the document object model?")]
        db = FakeDb({"quiz_questions": saved})
        questions, _ = quiz._load_quiz(db, GUIDE_ID, "u1")
        self.assertEqual([q["question"] for q in questions], [q["question"] for q in saved])
        self.assertEqual(db.updates, [], "nothing was about the source, so nothing is written")

    def test_quizzes_built_from_older_guides_show_only_subject_questions(self):
        # Parsed as written (ids and positions hang on the saved wording); shown without the source.
        text = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a, _) in enumerate(MODEL_OUTPUT["art_history"], 1))
        pairs = quiz._parse_qa_pairs(text)
        self.assertEqual([pair["question"] for pair in pairs], [q for q, _, _ in MODEL_OUTPUT["art_history"]])
        shown = shown_questions([{"question": p["question"], "options": [p["answer"]], "correct_index": 0} for p in pairs])
        asked = [q.get("shown", q["question"]) for q in shown if not q.get("hidden")]
        self.assertEqual(asked, ["What is chiaroscuro?", "Who painted the Mona Lisa?", "What is a cross-section drawing?"])

    def test_saved_quizzes_hide_them_where_shown_and_are_never_rewritten(self):
        saved = [
            {"question": "Which artists are listed for Chapter 1?", "options": ["a b", "c d", "e f", "g h"], "correct_index": 0},
            {"question": "Who painted the Mona Lisa?", "options": ["Leonardo da Vinci", "Raphael", "Titian", "Giotto"], "correct_index": 0, "choices_v": 2},
        ]
        db = FakeDb({"quiz_questions": [dict(q) for q in saved]})
        questions, saved_flag = quiz._load_quiz(db, GUIDE_ID, "u1")
        self.assertTrue(saved_flag)
        self.assertEqual(db.updates, [], "progress keys stay: the saved quiz is left as it is")
        shown = shown_questions(questions)
        self.assertEqual([q["question"] for q in shown], [q["question"] for q in saved])
        self.assertEqual([bool(q.get("hidden")) for q in shown], [True, False])


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


# Q&A from five subjects for the choice checks (term, name, list, value and description answers).
GUIDES = {
    "nursing": [
        ("What is the normal adult serum potassium range?", "3.5-5.0 mEq/L"),
        ("What ECG change is an early sign of hyperkalemia?", "Peaked T waves"),
        ("What electrolyte imbalance causes U waves?", "Hypokalemia"),
        ("What are the classic signs of hypocalcemia?", "Tetany, Chvostek's sign, Trousseau's sign, and seizures"),
        ("Who founded modern nursing?", "Florence Nightingale"),
        ("What is the normal serum sodium range?", "135-145 mEq/L"),
    ],
    "art_history": [
        ("Who painted the Mona Lisa?", "Leonardo da Vinci"),
        ("Who sculpted David in 1504?", "Michelangelo"),
        ("Who painted The School of Athens?", "Raphael"),
        ("Who painted The Birth of Venus?", "Sandro Botticelli"),
        ("What is chiaroscuro?", "The strong contrast between light and dark in a painting"),
        ("What is sfumato?", "A soft blending of tones without hard outlines"),
        ("In what year was the Sistine Chapel ceiling finished?", "1512"),
    ],
    "business_law": [
        ("Who pioneered the moving assembly line?", "Henry Ford"),
        ("Which automaker entered the US market in 1986?", "Hyundai"),
        ("Who proposed scientific management?", "Frederick Taylor"),
        ("Who described a hierarchy of needs?", "Abraham Maslow"),
        ("Who wrote the fourteen principles of management?", "Henri Fayol"),
        ("What are the elements of a valid contract?", "Offer, acceptance, consideration, capacity, and legality"),
        ("What does Chapter 11 bankruptcy allow?", "A business to reorganize its debts while it keeps operating"),
    ],
    "literature": [
        ("Who narrates The Great Gatsby?", "Nick Carraway"),
        ("Who wrote Beloved?", "Toni Morrison"),
        ("Who wrote Things Fall Apart?", "Chinua Achebe"),
        ("Who wrote Mrs Dalloway?", "Virginia Woolf"),
        ("What does the green light symbolize?", "Gatsby's hope for a future with Daisy"),
        ("What are the stages of Freytag's pyramid?", "Exposition, rising action, climax, falling action, and resolution"),
    ],
    "computer_science": [
        ("What is the time complexity of binary search?", "O(log n)"),
        ("What causes a page fault?", "A program touching a page that is not in memory"),
        ("What does a hash table map?", "Keys to values through a hash function"),
        ("Who proposed the stored-program computer design?", "John von Neumann"),
        ("Who invented the World Wide Web?", "Tim Berners-Lee"),
        ("Who wrote the first published algorithm for a machine?", "Ada Lovelace"),
        ("What are the four pillars of object-oriented programming?", "Encapsulation, abstraction, inheritance, and polymorphism"),
    ],
}

LENGTH_RATIO = 0.5  # the shortest choice is at least half the longest (or within 6 characters)


def visible(text):
    return quiz.choice_text(text)


def length_ok(answer, value):
    a, b = len(visible(answer)), len(visible(value))
    return min(a, b) >= LENGTH_RATIO * max(a, b) or abs(a - b) <= 6


class ChoiceTests(unittest.TestCase):
    """Problem 2."""

    def assert_good(self, question, label, four=True):
        options = question["options"]
        if four:
            self.assertEqual(len(options), 4, f"{label}: {question['question']} -> {options}")
        else:
            self.assertGreaterEqual(len(options), 1, label)  # fewer than 3: asked typed, never left out
        answer = options[question["correct_index"]]
        for option in options:
            self.assertTrue(length_ok(answer, option), f"{label}: {answer!r} vs {option!r}")
            self.assertTrue(option == answer or fits(answer, option), f"{label}: {answer!r} vs {option!r}")
        self.assertEqual(len(retain.answer_parts(answer)) > 1, all(len(retain.answer_parts(o)) > 1 for o in options), label)

    def test_wrong_choices_of_another_kind_or_length_are_refused(self):
        self.assertFalse(fits("Sigmund Freud, Carl Jung, and Alfred Adler", "Hyundai"))
        self.assertTrue(fits("Sigmund Freud, Carl Jung, and Alfred Adler", "B. F. Skinner, John Watson, and Ivan Pavlov"))
        self.assertFalse(fits("Just-in-time inventory management", "Kanban"))
        self.assertTrue(fits("Just-in-time inventory management", "Economic order quantity model"))
        self.assertFalse(fits("1512", "The High Renaissance"))
        self.assertFalse(fits("Peaked T waves", "Tetany, Chvostek's sign, Trousseau's sign, and seizures"))
        self.assertTrue(fits("O(log n)", "O(n)"))

    def test_model_choices_are_kept_only_when_they_fit(self):
        out = quiz._balanced_distractors("Sigmund Freud, Carl Jung, and Alfred Adler",
                                         ["Hyundai", "B. F. Skinner, John Watson, and Ivan Pavlov",
                                          "Carl Rogers, Abraham Maslow, and Rollo May", "Behaviorism",
                                          "Wilhelm Wundt, William James, and Edward Titchener"], [])
        self.assertEqual(out, ["B. F. Skinner, John Watson, and Ivan Pavlov", "Carl Rogers, Abraham Maslow, and Rollo May",
                               "Wilhelm Wundt, William James, and Edward Titchener"])
        out = quiz._balanced_distractors("Just-in-time inventory management", ["Kanban", "Hyundai", "Total quality management"], [])
        self.assertEqual(out, ["Total quality management"])

    def test_free_choices_never_borrow_an_unrelated_answer(self):
        # Guide-derived choices (shared guides, merges, edited questions, a model outage) keep every idea,
        # with only related choices, so they may have fewer than four (even none: then it is asked
        # typed), but never an unrelated one; a value always gets four.
        for subject, pairs in GUIDES.items():
            qa = [{"question": q, "answer": a} for q, a in pairs]
            questions = quiz._standard_questions(qa)
            self.assertTrue(questions, subject)
            for question in questions:
                answer = question["options"][question["correct_index"]]
                self.assert_good(question, subject, four=is_value(answer))
        qa = [{"question": q, "answer": a} for q, a in GUIDES["business_law"]]
        ford = next(q for q in quiz._standard_questions(qa) if q["question"].startswith("Who pioneered"))
        self.assertNotIn("Hyundai", ford["options"])

    def test_ai_quizzes_have_exactly_four_choices_or_ask_the_question_typed(self):
        for subject, pairs in GUIDES.items():
            text = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a) in enumerate(pairs, 1))
            # The model's choices: one in three wrong-sized or another kind, the replacement call fails.
            items = [{"distractors": [a + " and more besides", "Hyundai", "X"]} if i % 3 == 0 else
                     {"distractors": [f"{a} ({k})" for k in ("i", "ii", "iii")]} for i, (_, a) in enumerate(pairs)]
            chat = MagicMock(side_effect=[reply(json.dumps({"items": items})), RuntimeError("down")])
            db = FakeDb({"quiz_questions": None, "study_guide": text})
            with patch.multiple(quiz, chat=chat, get_openai_client=MagicMock(return_value=None),
                                remaining=MagicMock(return_value=1), record=MagicMock()):
                questions, _ = quiz._load_quiz(db, GUIDE_ID, "u1")
            self.assertEqual(len(questions), len(pairs), f"{subject}: every idea stays")
            typed = [question for question in questions if len(question["options"]) != 4]
            for question in questions:
                if question not in typed:
                    self.assert_good(question, subject)
            self.assertTrue(typed, f"{subject}: questions short of choices are asked typed")
            for question in typed:
                self.assertEqual(len(question["options"]), 1, f"{subject}: only the answer, so never multiple choice")
                self.assertFalse(retain.can_choose(question))

    def test_nclex_multiple_choice_has_four_options(self):
        good = {"type": "mcq", "stem": "A client has a potassium of 6.2 mEq/L. Which ECG finding is expected?",
                "options": ["Peaked T waves", "U waves", "ST depression", "Prolonged QT"], "correct_indices": [0], "rationale": "r"}
        short = {**good, "options": ["Peaked T waves", "U waves", "ST depression"]}
        slide = {**good, "stem": "According to slide 5, which ECG finding is expected?"}
        chat = MagicMock(return_value=reply(json.dumps([good, short, slide])))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            out = llm.generate_nclex_questions("Q1: x\nA1: y")
        self.assertEqual([len(q["options"]) for q in out], [4, 4])
        self.assertEqual(out[1]["stem"], "Which ECG finding is expected?")


class AnswerPartsTests(unittest.TestCase):
    def test_lists_split_into_parts_and_prose_does_not(self):
        cases = {
            "Sigmund Freud, Carl Jung, and Alfred Adler": ["Sigmund Freud", "Carl Jung", "Alfred Adler"],
            "Tetany, Chvostek's sign, Trousseau's sign, and seizures": ["Tetany", "Chvostek's sign", "Trousseau's sign", "seizures"],
            "Offer; acceptance; consideration": ["Offer", "acceptance", "consideration"],
            "Exposition, rising action, climax, falling action, and resolution": ["Exposition", "rising action", "climax", "falling action", "resolution"],
            "Encapsulation, abstraction, inheritance, and polymorphism": ["Encapsulation", "abstraction", "inheritance", "polymorphism"],
        }
        for answer, parts in cases.items():
            self.assertEqual(retain.answer_parts(answer), parts, answer)
        for prose in ("Romeo and Juliet", "Hyperkalemia, a high potassium level, causes peaked T waves",
                      "In 1863, Lincoln issued it", "3.5-5.0 mEq/L", "A business to reorganize its debts while it keeps operating"):
            self.assertEqual(retain.answer_parts(prose), [prose], prose)


class SharedWordPartsTests(unittest.TestCase):
    """A trick that leaves out one of several items sharing a word is still incomplete."""

    CASES = [
        ("Type 1 diabetes, Type 2 diabetes, and gestational diabetes",
         "When you see sugar, think Type 1 diabetes and gestational diabetes.", ["Type 2 diabetes"]),
        ("First Amendment, Fifth Amendment, and Sixth Amendment",
         "Remember the First Amendment and the Sixth Amendment together.", ["Fifth Amendment"]),
        ("Impressionism, Post-Impressionism, and Expressionism",
         "Think of Impressionism and Expressionism as a pair.", ["Post-Impressionism"]),
        ("Primary succession, secondary succession, and tertiary succession",
         "Picture primary succession and tertiary succession in a field.", ["secondary succession"]),
        ("Binary search tree, binary heap, and binary tree",
         "A binary heap sits beside a binary tree.", ["Binary search tree"]),
        ("Romantic poetry, Romantic prose, and Gothic fiction",
         "Gothic fiction and Romantic poetry share a moor.", ["Romantic prose"]),
    ]

    def test_the_omitted_item_is_reported(self):
        for answer, trick, missing in self.CASES:
            self.assertEqual(retain.missing_parts(trick, answer), missing, answer)

    def test_a_complete_trick_passes_with_plurals_and_possessives(self):
        for answer, _trick, _missing in self.CASES:
            parts = retain.answer_parts(answer)
            self.assertEqual(retain.missing_parts("Think of " + ", then ".join(parts) + ".", answer), [], answer)
        self.assertEqual(retain.missing_parts("Type 1 diabetes, Type 2 diabetes' gestational cousins.",
                                              "Type 1 diabetes, Type 2 diabetes, and gestational diabetes"), [])

    def test_an_item_with_nothing_of_its_own_is_matched_on_all_its_words(self):
        answer = "Heart, heart failure, and heart block"
        self.assertEqual(retain.missing_parts("Think of a heart.", answer), ["heart failure", "heart block"])
        self.assertEqual(retain.missing_parts("A heart with failure and a block.", answer), [])

    def test_the_trick_is_retried_for_an_omitted_item_that_shares_a_word(self):
        answer = "Type 1 diabetes, Type 2 diabetes, and gestational diabetes"
        partial = "Picture a sugar bowl: Type 1 diabetes and gestational diabetes stand guard."
        whole = "Picture a sugar bowl: Type 1 diabetes, Type 2 diabetes and gestational diabetes stand guard."
        chat = MagicMock(side_effect=[reply(json.dumps({"hook": partial})), reply(json.dumps({"hook": whole}))])
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            result = llm.memory_hook("Which types of diabetes are there?", answer)
        self.assertEqual(result, {"hook": whole})
        self.assertEqual(chat.call_count, 2, "the first trick left out Type 2 diabetes, so it was retried")
        self.assertIn("Type 2 diabetes", chat.call_args.kwargs["messages"][1]["content"])


class FewChoicesTests(unittest.TestCase):
    """A question with fewer than 3 choices is never multiple choice (owner's rule): Learn asks it by
    typing (Type it) or as a flashcard when the answer is long; Quiz asks it Fill in or Written."""

    LONG = "Hyperkalemia changes the resting membrane potential of cardiac cells, which slows conduction and produces peaked T waves."

    @staticmethod
    def question(text, answer, wrong):
        return {"question": text, "options": [answer, *wrong], "correct_index": 0}

    def questions(self):
        return [
            self.question("What is the powerhouse of the cell?", "Mitochondria", ["Ribosome"]),                                 # 2: term
            self.question("What does hyperkalemia do to the heart?", self.LONG, ["It speeds conduction and flattens T waves entirely."]),  # 2: long
            self.question("Who painted the Mona Lisa?", "Leonardo da Vinci", ["Raphael", "Titian"]),                             # 3
            self.question("Which structure holds a class's data?", "Fields", ["Methods", "Packages", "Imports"]),                # 4
            self.question("What is consideration?", "Something of value", []),                                                  # 1
        ]

    def kinds(self, selected):
        cards = retain.plan_session(self.questions(), selected)
        return {index: card["type"] for card in cards for index in card["concepts"]}

    def test_two_choices_are_never_multiple_choice(self):
        for selected in (["mc"], ["mc", "written"], ["mc", "fill"], ["mc", "written", "fill"], [], ["mc", "matching"]):
            kinds = self.kinds(selected)
            for index in (0, 1, 4):
                self.assertNotEqual(kinds[index], "mc", f"{selected}: question {index} has fewer than 3 choices")

    def test_short_answers_are_typed_when_fill_is_on_and_written_otherwise(self):
        self.assertEqual(self.kinds(["mc", "fill"])[0], "fill")
        self.assertEqual(self.kinds(["mc"])[0], "written", "Fill in is a Pro type: it is never switched on for the student")
        self.assertEqual(self.kinds(["mc", "written"])[0], "written")

    def test_long_answers_are_written(self):
        for selected in (["mc"], ["mc", "fill"], ["mc", "written"]):
            self.assertEqual(self.kinds(selected)[1], "written")

    def test_three_and_four_choices_stay_multiple_choice(self):
        for selected in (["mc"], ["mc", "written"]):
            kinds = self.kinds(selected)
            self.assertEqual(kinds[2], "mc")
            self.assertEqual(kinds[3], "mc")

    def test_a_matching_leftover_with_two_choices_is_not_multiple_choice(self):
        questions = [self.question(f"Define term {n}?", f"Term {n}", ["Other"]) for n in range(3)]
        cards = retain.plan_session(questions, ["mc", "matching"])  # three terms: too few for a matching set
        self.assertTrue(all(card["type"] != "mc" for card in cards), cards)
        self.assertFalse(any(card["type"] == "matching" for card in cards))

    def test_a_quiz_of_a_chosen_size_follows_the_same_rule(self):
        cards = retain.plan_session(self.questions(), ["mc"], indices=[0, 2])
        self.assertEqual({card["concepts"][0]: card["type"] for card in cards}, {0: "written", 2: "mc"})

    def test_session_endpoint_serves_no_two_choice_multiple_choice(self):
        body = SimpleNamespace(types=["mc"], count=None, learn=False)
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), \
                patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_load_quiz", return_value=(self.questions(), True)), \
                patch.object(quiz, "plan_for", return_value="free"), patch.object(quiz, "subscription_row", return_value=None):
            result = quiz.start_session(GUIDE_ID, body, authorization="Bearer t")
        by_concept = {card["concepts"][0]: card["type"] for card in result["cards"]}
        self.assertEqual(by_concept[2], "mc")
        self.assertTrue(all(by_concept[i] != "mc" for i in (0, 1, 4)))
        self.assertEqual(result["questions"], self.questions(), "the questions keep their shape")
        self.assertEqual(sorted(result), ["cards", "pro", "questions", "types"])

    def test_can_choose_counts_choices_not_the_shape(self):
        self.assertFalse(retain.can_choose({"options": ["a", "b"]}))
        self.assertTrue(retain.can_choose({"options": ["a", "b", "c"]}))
        self.assertTrue(retain.can_choose({"options": ["a", "b", "c", "d"]}))
        self.assertFalse(retain.can_choose({}))
        self.assertFalse(retain.can_choose(None))


class MemoryHookCoverageTests(unittest.TestCase):
    """Problem 3."""

    ANSWER = "Leonardo da Vinci, Michelangelo, Raphael, Donatello, Botticelli, Titian, Giotto, and Brunelleschi"
    QUESTION = "Which artists defined the Italian Renaissance?"
    TOPIC_ONLY = ("When you see Renaissance, picture the Ninja Turtles: Leonardo da Vinci, Michelangelo, Raphael "
                  "and Donatello paint a pizza.")
    EVERY_PART = ("When you see Renaissance, picture the Ninja Turtles Leonardo da Vinci, Michelangelo, Raphael and "
                  "Donatello, then Botticelli's bottle, Titian's titan, Giotto's grotto and Brunelleschi's brunch.")

    def call(self, *texts, question=QUESTION, answer=ANSWER):
        chat = MagicMock(side_effect=[reply(json.dumps({"hook": text})) if isinstance(text, str) else text for text in texts])
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            return llm.memory_hook(question, answer), chat

    def test_half_a_list_passed_the_old_check(self):
        self.assertTrue(retain.mentions_answer(self.TOPIC_ONLY, self.ANSWER), "the gap this fixes")
        self.assertEqual(retain.missing_parts(self.TOPIC_ONLY, self.ANSWER), ["Botticelli", "Titian", "Giotto", "Brunelleschi"])
        self.assertEqual(retain.missing_parts(self.EVERY_PART, self.ANSWER), [])

    def test_a_trick_missing_parts_is_retried_once_with_them_named(self):
        result, chat = self.call(self.TOPIC_ONLY, self.EVERY_PART)
        self.assertEqual(result, {"hook": self.EVERY_PART})
        self.assertEqual(chat.call_count, 2)
        retry = chat.call_args.kwargs["messages"][1]["content"]
        for name in ("Botticelli", "Titian", "Giotto", "Brunelleschi"):
            self.assertIn(name, retry)

    def test_still_missing_after_the_retry_gives_nothing(self):
        result, chat = self.call(self.TOPIC_ONLY, self.TOPIC_ONLY)
        self.assertEqual(result, {})
        self.assertEqual(chat.call_count, 2)
        result, chat = self.call(self.TOPIC_ONLY, RuntimeError("down"))
        self.assertEqual(result, {}, "a failed retry is no trick, not an error")

    def test_one_part_answers_make_one_call(self):
        result, chat = self.call("When you see the smile, think of Leonardo da Vinci.", question="Who painted the Mona Lisa?",
                                 answer="Leonardo da Vinci")
        self.assertEqual(chat.call_count, 1)
        self.assertTrue(result)

    def test_five_subjects_lists(self):
        for answer in ("Tetany, Chvostek's sign, Trousseau's sign, and seizures",
                       "Offer, acceptance, consideration, capacity, and legality",
                       "Exposition, rising action, climax, falling action, and resolution",
                       "Encapsulation, abstraction, inheritance, and polymorphism"):
            parts = retain.answer_parts(answer)
            partial = "When you see this, think " + ", ".join(parts[:2]) + "."
            self.assertTrue(retain.missing_parts(partial, answer), answer)
            whole = "When you see this, think " + " then ".join(parts) + "."
            self.assertEqual(retain.missing_parts(whole, answer), [], answer)

    def test_the_prompt_asks_for_a_hook_per_part(self):
        _, chat = self.call(self.EVERY_PART)
        system = chat.call_args.kwargs["messages"][0]["content"]
        self.assertIn("every part", system)


if __name__ == "__main__":
    unittest.main()
