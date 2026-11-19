"""F5 rebuild (feedback ed2eb2e2, b67047f0): the owner's binding rules, and every reviewer probe
from the two reviews of the first version (scratchpad rook-f5/ and rook-f5b/) as a test.

Marker removal: only a line that is exactly a known marker goes ("Slide 5", "5 / 20", "Page 3",
"Page 3 of 12", "- 3 -", "p. 12", "Untitled Slide 4", and the "--- Slide 5 ---" / "--- Page 2 ---"
lines PPTX and PDF text arrive with). No other line is joined, moved, changed or removed, so a lone
year or dose stays exactly where it was, in every content type.

The other modules: tests/test_learn_question_quality.py, tests/test_question_quality_followup.py,
tests/test_source_check_timing.py and web/tests/{question-display,few-choices,written-self-check}.
"""

import json
import os
import random
import re
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")

from routers import quiz  # noqa: E402
from services import guide_versions, llm, retain  # noqa: E402
from services import text_processing as tp  # noqa: E402
from services.choice_shapes import fits, is_value  # noqa: E402
from services.text_processing import (  # noqa: E402
    chunk_text, clean_text, extract_slideshow_content, format_slideshow_text, shown_pairs, shown_questions,
    standalone_question, strip_structure_markers,
)

GUIDE_ID = "00000000-0000-0000-0000-000000000001"


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


# === 1. Marker removal: exact marker lines only =====================================================

MARKER_LINES = [
    "Slide 5", "slide 12", "SLIDE 3", "--- Slide 5 ---", "Slide 4 of 20", "Slide 4/20", "5 / 20", "12 / 40",
    "Page 3", "page 3", "Page 3 of 12", "Page 3/12", "--- Page 2 ---", "- 3 -", "— 7 —", "– 12 –", "p. 12", "pg. 4",
    "Untitled Slide 3", "  Page 3  ", "[Page 3]",
]

# Lines that look a little like markers but are content: each stays exactly as written.
NOT_MARKERS = [
    "1789", "4000", "3/4", "7/10", "5/20", "135-145", "98.6", "12,000", "(2)", "12", "3 of 12", "-5",
    "Slide 6: Sodium balance", "Page 3 - Introduction to Contracts", "Slide 3 covers torts",
    "Chapter 11", "Chapter 11 bankruptcy", "Section 2: Monopolization", "Section 2", "Page Rank sorts results",
    "A page fault occurs when a page is not in memory.", "p. 12 of the novel describes the funeral",
    "Slide rule", "The slide holds the specimen.", "Page", "Slides", "Step 5", "Problem 4", "Figure 2",
    "Untitled", "1 in 5 adults", "5 / 20 mg", "Week 3", "Lecture 4", "Untitled Slide show notes",
]


class ExactMarkerLinesTests(unittest.TestCase):
    def test_each_known_marker_line_is_removed_and_nothing_else_changes(self):
        for marker in MARKER_LINES:
            with self.subTest(marker=marker):
                self.assertEqual(strip_structure_markers(f"Before\n{marker}\nAfter"), "Before\nAfter")
                self.assertEqual(strip_structure_markers(f"{marker}\nAfter"), "After")
                self.assertEqual(strip_structure_markers(f"Before\n{marker}"), "Before")

    def test_every_other_line_stays_byte_for_byte(self):
        for line in NOT_MARKERS:
            with self.subTest(line=line):
                text = f"Before\n{line}\nAfter"
                self.assertEqual(strip_structure_markers(text), text)
        text = "\n".join(NOT_MARKERS)
        self.assertEqual(strip_structure_markers(text), text)

    def test_spacing_and_blank_lines_are_left_as_they_are(self):
        text = "  Indented line\n\n\n\nAfter three blank lines\t\nTrailing tab above\n"
        self.assertEqual(strip_structure_markers(text), text)
        self.assertEqual(strip_structure_markers("A\n\nPage 3\n\nB"), "A\n\n\nB")

    def test_a_random_mix_loses_only_its_marker_lines(self):
        rng = random.Random(5)
        for _ in range(200):
            lines = [rng.choice(MARKER_LINES + NOT_MARKERS + ["", "Mitosis splits a cell."]) for _ in range(rng.randint(1, 30))]
            kept = [line for line in lines if line not in MARKER_LINES]
            self.assertEqual(strip_structure_markers("\n".join(lines)).split("\n") if kept else [""], kept or [""])

    def test_a_slide_whose_title_is_only_a_marker_has_no_title_in_the_prompt(self):
        for title in ("Slide 5", "Untitled Slide 3", "--- Slide 2 ---"):
            block = format_slideshow_text([{"title": title, "content": ["Mitosis splits a cell."]}])
            self.assertNotIn("<TITLE>", block, title)
        self.assertIn("<TITLE>Slide 6: Sodium</TITLE>", format_slideshow_text([{"title": "Slide 6: Sodium", "content": ["Na"]}]))

    def test_no_line_joining_helper_exists(self):
        self.assertFalse(hasattr(tp, "attach_values"))

    def test_the_first_reviews_marker_cases(self):
        # rook-f5/markers.py, each with the owner's expectation
        cases = {
            "Timeline of the Revolution\n1789\nStorming of the Bastille\n1793\nReign of Terror begins": None,
            "Maximum daily acetaminophen dose (mg):\n4000\nfor healthy adults": None,
            "Common time signature:\n3/4\nWaltz meter": None,
            "Apgar score at 1 minute\n7\nindicates mild distress": None,
            "Number of chambers in the heart:\n4": None,
            "--- Slide 5 ---\nSodium\nNormal 135-145": "Sodium\nNormal 135-145",
            "Page 3 of 12\nTorts": "Torts",
            "Step\n(2)\nApply the rule": None,
            "Chapter 11\nReorganization lets a debtor keep operating": None,
            "Slide 6: Sodium balance": None,
            "Page 3 - Introduction to Contracts": None,
            "Section 2: Monopolization": None,
        }
        for text, expected in cases.items():
            self.assertEqual(strip_structure_markers(text), text if expected is None else expected, text)


# Every subject, both orders (entry then year, year then entry).
TIMELINES = {
    "nursing": ["Nightingale Training School opens", "1860", "Maximum daily acetaminophen dose (mg):", "4000"],
    "art history": ["The Starry Night", "1889", "Cafe Terrace at Night", "1888", "Sunflowers", "1887"],
    "business law": ["Marbury v. Madison", "1803", "Statute of limitations for written contracts (years):", "6"],
    "literature": ["The Bluest Eye", "1970", "Sula", "1973", "Beloved", "1987"],
    "computer science": ["ARPANET sends its first message", "1969", "Number of bits in a byte:", "8"],
}


def year_first(lines):
    out = []
    for at in range(0, len(lines), 2):
        out += [lines[at + 1], lines[at]]
    return out


def content_types(lines):
    """The same facts as each content type delivers them to generate_study_guide's chunks."""
    body = "\n".join(lines)
    slideshow = "--- Slide 1 ---\nKey facts\n" + body + "\n--- Slide 2 ---\nMore\nSee the notes"
    slides = extract_slideshow_content(slideshow)
    return {
        # Canvas slideshow capture (extension "--- Slide N ---"), as /generate formats it
        "slideshow": chunk_text(format_slideshow_text(slides), slides=slides),
        # a text PDF, pages marked and a running footer
        "pdf": chunk_text(clean_text("--- Page 1 ---\nKey facts\n" + body + "\nPage 1 of 2\n--- Page 2 ---\nMore")),
        # a scanned PDF (llm.transcribe pages: "--- Page N ---" before each transcription)
        "scanned pdf": chunk_text("--- Page 1 ---\nKey facts\n" + body + "\n\n--- Page 2 ---\nMore"),
        # PPTX (file_extraction.pptx_slides)
        "pptx": chunk_text(clean_text("--- Slide 1 ---\nKey facts\n" + body + "\n\n--- Slide 2 ---\nMore")),
        # a web page with a decorated page number
        "web": chunk_text(clean_text("Key facts\n" + body + "\n- 2 -\nMore")),
    }


class ValuesStayInPlaceTests(unittest.TestCase):
    def prompts(self, chunks):
        chat = MagicMock(return_value=reply("Q1: What is x?\nA1: y"))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            llm.generate_study_guide(chunks)
        return "\n".join(call.kwargs["messages"][1]["content"] for call in chat.call_args_list)

    def test_every_value_reaches_the_prompt_in_its_place_for_every_subject_and_content_type(self):
        for subject, lines in TIMELINES.items():
            for order, ordered in (("entry then value", lines), ("value then entry", year_first(lines))):
                for kind, chunks in content_types(ordered).items():
                    with self.subTest(subject=subject, order=order, kind=kind):
                        prompt = self.prompts(chunks)
                        self.assertIn("\n".join(ordered), prompt, "the lines arrive as written, in order, unjoined")
                        for marker in ("--- Slide", "--- Page", "Page 1 of 2", "- 2 -", "<NUMBER>", "Untitled Slide"):
                            self.assertNotIn(marker, prompt)

    def test_the_second_reviews_captures(self):
        # rook-f5b/attach.py: no year moves to another entry, nothing merges, References still go
        self.assertEqual(clean_text("--- Page 3 ---\nContraindications:\n14\nSevere hepatic impairment and known hypersensitivity").split("\n"),
                         ["--- Page 3 ---", "Contraindications:", "14", "Severe hepatic impairment and known hypersensitivity"])
        self.assertEqual(
            [(s["title"], s["content"]) for s in extract_slideshow_content(
                "--- Slide 3 ---\nPost-Impressionism\nThe Starry Night\n1889\nCafe Terrace at Night\n1888\nSunflowers\n1887")],
            [("Post-Impressionism", ["The Starry Night", "1889", "Cafe Terrace at Night", "1888", "Sunflowers", "1887"])])
        self.assertEqual(clean_text("Key dates\nDeclaration of Independence\n1776\nConstitution signed\n1787\nBill of Rights ratified\n1791").split("\n"),
                         ["Key dates", "Declaration of Independence", "1776", "Constitution signed", "1787", "Bill of Rights ratified", "1791"])
        self.assertEqual(clean_text("--- Slide 2 ---\nMorrison's novels\nThe Bluest Eye\n1970\nSula\n1973\nBeloved\n1987").split("\n"),
                         ["--- Slide 2 ---", "Morrison's novels", "The Bluest Eye", "1970", "Sula", "1973", "Beloved", "1987"])
        self.assertEqual(clean_text("Steps:\n1.\nInitialize the array\n2.\nSort it").split("\n"),
                         ["Steps:", "1.", "Initialize the array", "2.", "Sort it"])
        self.assertEqual(
            [(s["title"], s["content"]) for s in extract_slideshow_content(
                "Slide 1\nRevolution\nStorming of the Bastille\n1789\nSlide 2\nTerror\nRobespierre's Committee of Public Safety")],
            [("Revolution", ["Storming of the Bastille", "1789"]), ("Terror", ["Robespierre's Committee of Public Safety"])])
        self.assertEqual(clean_text("Overview\nThe Treaty of Westphalia ended the Thirty Years' War in Europe.\n1648\nReferences\n"
                                    "Smith, J. (2001). Peace of Westphalia. Oxford.").split("\n"),
                         ["Overview", "The Treaty of Westphalia ended the Thirty Years' War in Europe.", "1648"])


# === 2. Questions about the subject, standing alone ==================================================

# rook-f5/fresh.py, every case: None = never asked, "SAME" = asked as written, else the rewrite.
FRESH_FIRST = {
    "Which medications are listed for Chapter 4?": None,
    "What three nursing diagnoses are covered in this module?": None,
    "Which paintings are shown on Slide 12?": None,
    "What does Figure 3 depict?": None,
    "Which cases are discussed in Lecture 7?": None,
    "Which novels are on the reading list for this week?": None,
    "What are the key terms for Chapter 2?": None,
    "Which sorting algorithms are presented in the slides?": None,
    "What does the table above show about tort damages?": None,
    "Name the poets mentioned in the passage.": None,
    "What is the main idea of this reading?": None,
    "Which artists are featured in the presentation?": None,
    "What does the instructor say on slide 3 about Baroque?": None,
    "Which characters does the excerpt introduce?": None,
    "What is the first item in the list?": None,
    "Which steps are outlined in the handout?": None,
    "What topic does the lecture cover?": None,
    "According to the video, which data structure is fastest?": "Which data structure is fastest?",
    "According to Slide 5, what is the normal serum potassium range?": "What is the normal serum potassium range?",
    "In this lecture, what is the doctrine of promissory estoppel?": "What is the doctrine of promissory estoppel?",
    "What is chiaroscuro, according to the textbook?": "What is chiaroscuro?",
    "Based on the reading, what is a binary search tree?": "What is a binary search tree?",
    "As described in the passage, who is the narrator of Beloved?": "Who is the narrator of Beloved?",
    "From the notes: what is consideration?": "What is consideration?",
    "Per the syllabus, what is the late policy?": "What is the late policy?",
}
SUBJECT_TERMS = [
    "What does the Java List interface guarantee about element order?", "What is the document object model?",
    "What causes a page fault?", "What is Chapter 11 bankruptcy?", "What does Section 2 of the Sherman Act prohibit?",
    "What is a page table used for?", "What is the purpose of a Section 8 voucher?", "What is a listed company?",
    "What is a linked list?", "What is the table of elements used for?", "What does a periodic table group share?",
    "What is a slide rule?", "What does a microscope slide hold?", "What happens in Chapter 7 bankruptcy?",
    "What does Section 230 of the Communications Decency Act provide?", "What is the Book of Kells?",
    "Which document did the Continental Congress adopt in 1776?", "What is the text of the Fourth Amendment?",
    "In Hamlet, who kills Polonius?", "In The Great Gatsby, what does the green light symbolize?",
    "What did Article 1 of the Constitution establish?", "What is a figure of speech?",
    "Which week of pregnancy does the neural tube close?", "What is a lesson plan?",
    "What does the Section 504 plan provide students?", "What is a page in virtual memory?",
    "What is the TABLE statement in SQL?", "What is the chart of accounts?", "What does a Gantt chart show?",
    "What does Title VII of the Civil Rights Act prohibit?", "Who wrote Chapter 1 of the Book of Genesis?",
    "What is figure-ground perception?", "In week 20 of pregnancy, what is the anatomy scan for?",
    "Which texts did the Council of Trent declare canonical?", "What is the section modulus of a beam?",
    "What is a lecture hall?", "What does UCC Article 2 govern?",
    "What does Rule 11 of the Federal Rules of Civil Procedure require?", "What is a document-term matrix?",
    "What is a graph traversal?", "What does the image of the albatross symbolize in the Rime of the Ancient Mariner?",
    "What is the subject of Rembrandt's painting The Anatomy Lesson of Dr. Nicolaes Tulp?",
    "What is the function of the table in a hash map?", "What is the text-to-speech feature?",
    "What do the notes in a C major chord include?", "What is a promissory note?",
    "Which page replacement algorithm evicts the least recently used page?",
    "What does a diagram of the heart show the left ventricle pumping into?",
    "What does the Chapter 13 plan require the debtor to pay?", "What is Problem 4 of Hilbert's problems?",
    "What is Exhibit A in a contract?",
    # rook-f5/fresh2.py: the source verbs used about the subject
    "What are the learning objectives?", "Which topics will be on the exam?", "What is covered under Medicare Part B?",
    "What is covered by the Fourth Amendment?", "Which rights are listed in the First Amendment?",
    "Which elements are listed in Group 1 of the periodic table?", "What is described in Genesis 1?",
    "What is discussed in Federalist No. 10?", "Which items are shown in the balance sheet?",
    "Which fields are included in the TCP header?", "What is presented in the Gettysburg Address?",
    "What is defined in Article 2 of the UCC?",
    # the owner's example
    "In the Bill of Rights, which freedom is listed first?",
]
# rook-f5/fresh2.py: the rest
FRESH_SECOND = {
    "As discussed in the lecture, what is the mechanism of action of furosemide?": "What is the mechanism of action of furosemide?",
    "As explained in Chapter 3, what is the parol evidence rule?": "What is the parol evidence rule?",
    "As shown on Slide 4, what is the time complexity of quicksort?": "What is the time complexity of quicksort?",
    "As noted in the reading, what is impasto?": "What is impasto?",
    "As mentioned in the textbook, what is an unreliable narrator?": "What is an unreliable narrator?",
    "What is the author's main argument, according to the passage?": None,
    "What is the main idea, according to the reading?": None,
    "What are the three examples, according to the slides?": None,
    "What does the first bullet say, according to Slide 2?": None,
    "What is the second step in the list?": None,
    "What is the last term in the table?": None,
    "What does the passage suggest about Gatsby's past?": None,
    "Which poems does the reading include?": None,
    "Which works does the module highlight?": None,
    "What does this excerpt reveal about Hester Prynne?": None,
    "Which three theorists does the chapter compare?": None,
    "What example does the lecturer give for negligence?": None,
    "What does the professor say about heparin?": None,
    "Which painting appears first in the presentation?": None,
    "Which drug is listed first?": None,
    "Which artists are listed?": None,
    "What is on the reading list for Week 3?": None,
    "Which sources are cited at the end of the article?": None,
    "What does the article argue about minimum wage?": None,
}

# The owner's must-have: the "As reviewed in the lecture" family, at least ten phrasings, trimmed.
REVIEWED_FAMILY = {
    "As reviewed in the lecture, what is the antidote for heparin?": "What is the antidote for heparin?",
    "As discussed in class, what is free indirect discourse?": "What is free indirect discourse?",
    "As covered in Chapter 3, what is promissory estoppel?": "What is promissory estoppel?",
    "As highlighted in the slides, who painted Las Meninas?": "Who painted Las Meninas?",
    "As summarized in the reading, what is a fiduciary duty?": "What is a fiduciary duty?",
    "As emphasized in this module, what is a hash collision?": "What is a hash collision?",
    "As taught in the lecture, what is the first sign of hypoxia?": "What is the first sign of hypoxia?",
    "As noted in the handout, who narrates Beloved?": "Who narrates Beloved?",
    "As presented in the lesson, what is chiaroscuro?": "What is chiaroscuro?",
    "As explained in the textbook, what is Big O notation?": "What is Big O notation?",
    "As outlined in the syllabus, what is consideration?": "What is consideration?",
    "As introduced in the video, what is an unreliable narrator?": "What is an unreliable narrator?",
    "What is the antidote for heparin, as reviewed in the lecture?": "What is the antidote for heparin?",
    "Who painted Las Meninas, as highlighted in the slides?": "Who painted Las Meninas?",
    "What is impasto, as discussed in class?": "What is impasto?",
}


class SubjectQuestionTests(unittest.TestCase):
    def check(self, cases):
        for question, want in cases.items():
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question if want == "SAME" else want)

    def test_the_first_reviews_cases(self):
        self.check(FRESH_FIRST)
        self.check(FRESH_SECOND)

    def test_subject_terms_are_asked_as_written(self):
        self.check({question: "SAME" for question in SUBJECT_TERMS})

    def test_the_as_reviewed_in_the_lecture_family_is_trimmed(self):
        self.assertGreaterEqual(len(REVIEWED_FAMILY), 10)
        self.check(REVIEWED_FAMILY)

    def test_one_verb_list_frames_attributions_and_names_coverage(self):
        self.assertIn(tp._COVERAGE_VERB, tp._FRAMING)
        verbs = re.findall(r"[a-z]+", tp._COVERAGE_VERB.replace("summari[sz]ed", "summarized").replace("emphasi[sz]ed", "emphasized"))
        self.assertGreaterEqual(len(verbs), 25)
        for verb in verbs:
            self.assertEqual(standalone_question(f"As {verb} in the lecture, what is a tort?"), "What is a tort?", verb)

    def test_a_visual_opening_is_trimmed_never_hidden(self):
        # The owner's rule: no question is hidden for its opening, a picture's included.
        for question, want in (("Based on the graph, what is the equilibrium price?", "What is the equilibrium price?"),
                               ("As shown in the diagram, what is the root of the tree?", "What is the root of the tree?"),
                               ("According to Figure 2, which chamber pumps blood to the lungs?", "Which chamber pumps blood to the lungs?"),
                               ("Based on the map, which river formed the border?", "Which river formed the border?")):
            self.assertEqual(standalone_question(question), want, question)

    def test_every_case_is_stable_and_shown_twice_is_shown_once(self):
        # rook-f5/idem.py and rook-f5b/idem.py
        cases = [*FRESH_FIRST, *FRESH_SECOND, *SUBJECT_TERMS, *REVIEWED_FAMILY,
                 "According to Slide 5, according to the lecture, what is X?", "In the lecture, in Chapter 3, what is X?",
                 "From the reading: per the notes, what is a tort?", "What is X, according to the text, according to the slides?",
                 "Based on the passage (p. 4), what is irony?", "  according to the text,   what is mitosis  ?  "]
        for question in cases:
            once = standalone_question(question)
            if once is not None:
                self.assertEqual(standalone_question(once), once, question)
        rows = shown_questions([{"question": q, "options": ["a"], "correct_index": 0} for q in cases])
        self.assertEqual(shown_questions(rows), rows)

    def test_odd_saved_rows_never_break_the_quiz(self):
        # rook-f5b/edges.py
        odd = [None, "x", 3, {"question": None}, {"question": 5, "options": "abc"},
               {"question": "Which artists are listed for Chapter 1?", "options": ["a"], "correct_index": 0},
               {"question": "What is shown on Slide 7?", "options": ["b"], "correct_index": 0, "hidden": False, "shown": 9}]
        shown = shown_questions(odd)
        self.assertEqual(len(shown), len(odd))
        self.assertEqual(shown[:5], odd[:5])
        self.assertNotIn("shown", shown[6], "a stale mark from the client is never trusted")
        pairs = shown_pairs([{"question": "What is shown on Slide 7?", "answer": "a"}, {"question": "Which artists are listed for Chapter 1?", "answer": "b"}])
        self.assertFalse(any(pair.get("hidden") for pair in pairs), "a list all about the source is shown as it is")
        for label, saved, asked in (("odd rows", odd, 2), ("all hidden", odd[5:], 2),
                                    ("hidden plus no answer", [odd[5], {"question": "What is x?", "options": [], "correct_index": 0}], 1)):
            body = SimpleNamespace(types=["mc"], count=None, learn=False)
            with patch.object(quiz, "get_supabase", return_value=MagicMock()), patch.object(quiz, "get_user_id", return_value="u1"), \
                    patch.object(quiz, "_load_quiz", return_value=(saved, True)), patch.object(quiz, "plan_for", return_value="free"), \
                    patch.object(quiz, "subscription_row", return_value=None):
                result = quiz.start_session(GUIDE_ID, body, authorization="Bearer t")
            self.assertEqual(len(result["cards"]), asked, label)

    def test_new_guides_never_save_a_question_about_the_source(self):
        raw = ("Q1: What is shown on Slide 7?\nA1: An ECG strip\n"
               "Q2: According to Slide 5, what is the normal serum potassium range?\nA2: 3.5-5.0 mEq/L\n"
               "Q3: Who painted the Mona Lisa?\nA3: Leonardo da Vinci")
        canonical = llm._canonical_qa(raw)
        self.assertNotIn("Slide", canonical)
        self.assertIn("What is the normal serum potassium range?", canonical)
        self.assertIn("Who painted the Mona Lisa?", canonical)


# === 3. Choices: like for like; fewer than 3 is never multiple choice; nothing dropped =============

# rook-f5/guides_data.py plus the fresh pairs of drops.py
DROP_GUIDES = {
    "nursing": [
        ("What is the normal adult serum potassium range?", "3.5-5.0 mEq/L"), ("What ECG change is an early sign of hyperkalemia?", "Peaked T waves"),
        ("What electrolyte imbalance causes U waves?", "Hypokalemia"),
        ("What are the classic signs of hypocalcemia?", "Tetany, Chvostek's sign, Trousseau's sign, and seizures"),
        ("Who founded modern nursing?", "Florence Nightingale"), ("What is the normal serum sodium range?", "135-145 mEq/L"),
    ],
    "art_history": [
        ("Who painted the Mona Lisa?", "Leonardo da Vinci"), ("Who sculpted David in 1504?", "Michelangelo"),
        ("Who painted The School of Athens?", "Raphael"), ("Who painted The Birth of Venus?", "Sandro Botticelli"),
        ("What is chiaroscuro?", "The strong contrast between light and dark in a painting"),
        ("What is sfumato?", "A soft blending of tones without hard outlines"), ("In what year was the Sistine Chapel ceiling finished?", "1512"),
    ],
    "business_law": [
        ("Who pioneered the moving assembly line?", "Henry Ford"), ("Which automaker entered the US market in 1986?", "Hyundai"),
        ("Who proposed scientific management?", "Frederick Taylor"), ("Who described a hierarchy of needs?", "Abraham Maslow"),
        ("Who wrote the fourteen principles of management?", "Henri Fayol"),
        ("What are the elements of a valid contract?", "Offer, acceptance, consideration, capacity, and legality"),
        ("What does Chapter 11 bankruptcy allow?", "A business to reorganize its debts while it keeps operating"),
    ],
    "literature": [
        ("Who narrates The Great Gatsby?", "Nick Carraway"), ("Who wrote Beloved?", "Toni Morrison"),
        ("Who wrote Things Fall Apart?", "Chinua Achebe"), ("Who wrote Mrs Dalloway?", "Virginia Woolf"),
        ("What does the green light symbolize?", "Gatsby's hope for a future with Daisy"),
        ("What are the stages of Freytag's pyramid?", "Exposition, rising action, climax, falling action, and resolution"),
    ],
    "computer_science": [
        ("What is the time complexity of binary search?", "O(log n)"), ("What causes a page fault?", "A program touching a page that is not in memory"),
        ("What does a hash table map?", "Keys to values through a hash function"),
        ("Who proposed the stored-program computer design?", "John von Neumann"), ("Who invented the World Wide Web?", "Tim Berners-Lee"),
        ("Who wrote the first published algorithm for a machine?", "Ada Lovelace"),
        ("What are the four pillars of object-oriented programming?", "Encapsulation, abstraction, inheritance, and polymorphism"),
    ],
    "nursing_fresh": [
        ("What is the normal serum sodium range?", "135 to 145 mEq/L"), ("What is the antidote for heparin?", "Protamine sulfate"),
        ("What is the antidote for warfarin?", "Vitamin K"), ("What does a positive Homans sign suggest?", "Deep vein thrombosis"),
        ("What position helps a patient in respiratory distress?", "High Fowler's position"),
        ("What is the first sign of hypoxia?", "Restlessness"), ("What are the signs of hypoglycemia?", "Shakiness, sweating, confusion, and tachycardia"),
    ],
    "art_fresh": [
        ("What is chiaroscuro?", "The strong contrast of light and dark to model form"), ("What is impasto?", "Paint laid on thickly so brushstrokes show"),
        ("What is sfumato?", "Soft blending of tones without hard outlines"), ("Who painted The Night Watch?", "Rembrandt van Rijn"),
        ("Who sculpted the Ecstasy of Saint Teresa?", "Gian Lorenzo Bernini"), ("What movement did Monet lead?", "Impressionism"),
    ],
}


class ChoiceTests(unittest.TestCase):
    def test_no_idea_is_lost_and_every_wrong_choice_is_like_the_answer(self):
        for subject, pairs in DROP_GUIDES.items():
            questions = quiz._standard_questions([{"question": q, "answer": a} for q, a in pairs], random.Random(1))
            self.assertEqual([q["question"] for q in questions], [q for q, _ in pairs], f"{subject}: 0 ideas lost")
            for question, (text, answer) in zip(questions, pairs):
                self.assertLessEqual(len(question["options"]), 4)
                wrong = [o for i, o in enumerate(question["options"]) if i != question["correct_index"]]
                for option in wrong:
                    self.assertTrue(fits(answer, option), f"{subject}: {option!r} for {answer!r}")
                    source = [q for q, a in pairs if a.strip().casefold() == str(option).strip().casefold()]
                    if not source:
                        self.assertTrue(is_value(answer), f"{subject}: {option!r} comes from nowhere")  # a made value ("1508")
                        continue
                    self.assertIn(quiz._cue(text), {quiz._cue(q) for q in source},
                                  f"{subject}: {option!r} answers another kind of question")
                if text.startswith("Who"):
                    self.assertNotIn("Hyundai", question["options"])

    def test_a_question_with_fewer_than_three_choices_is_never_multiple_choice(self):
        for subject, pairs in DROP_GUIDES.items():
            questions = quiz._standard_questions([{"question": q, "answer": a} for q, a in pairs], random.Random(1))
            for selected in (["mc"], ["mc", "fill"], ["mc", "written"], ["mc", "fill", "written", "matching"]):
                cards = retain.plan_session(questions, selected)
                kinds = {index: card["type"] for card in cards for index in card["concepts"]}
                self.assertEqual(sorted(kinds), list(range(len(pairs))), subject)
                for index, question in enumerate(questions):
                    if len(question["options"]) < 3:
                        self.assertIn(kinds[index], ("fill", "written"), f"{subject}: {question['question']}")

    def test_the_first_reviews_fit_cases(self):
        # rook-f5/fits.py
        fitting = [("Potassium", "Sodium"), ("Leonardo da Vinci", "Michelangelo Buonarroti"),
                   ("Offer, acceptance, and consideration", "Duress, undue influence, and mistake"), ("O(log n)", "O(n)"),
                   ("O(log n)", "O(n log n)"), ("1925", "1922"), ("Stack", "Queue"), ("Nick Carraway", "Jay Gatsby"),
                   ("Hyperkalemia", "Hypokalemia"), ("Strict liability", "Negligence"), ("Baroque", "Renaissance"), ("TCP", "UDP"),
                   ("A, B, C, D, E", "F, G, H, I"), ("Freud, Jung, and Adler", "Skinner, Pavlov, and Watson")]
        unfitting = [("Potassium", "The kidneys excrete excess potassium through the distal tubule"),
                     ("Offer, acceptance, and consideration", "Consideration"),
                     ("Sigmund Freud, Carl Jung, and Alfred Adler", "id, ego, and superego"), ("1925", "the Jazz Age"),
                     ("$4,000", "4000 mg"), ("Stack", "A last-in first-out data structure used for recursion"),
                     ("TCP", "Transmission Control Protocol over IP"), ("A, B, C, D", "E, F, G"),
                     ("Freud, Jung, and Adler", "operant, classical, and social learning")]
        for answer, other in fitting:
            self.assertTrue(fits(answer, other), (answer, other))
        for answer, other in unfitting:
            self.assertFalse(fits(answer, other), (answer, other))
        cues = {"Who painted the Mona Lisa?": "person", "Which company makes the Model T?": "which:compa",
                "What year did WWII end?": "time", "In what year was Gatsby published?": "time"}
        for question, cue in cues.items():
            self.assertEqual(quiz._cue(question), cue, question)
        self.assertNotEqual(quiz._cue("Which automaker entered the US market in 1986?"), quiz._cue("Who painted the Mona Lisa?"))

    def test_another_students_free_quiz_keeps_every_pair_in_its_place(self):
        # rook-f5b/viewerpos.py and viewerpos2.py
        sets = [
            [("What is the normal adult serum potassium range?", "3.5-5.0 mEq/L"), ("Who founded modern nursing?", "Florence Nightingale"),
             ("What are the classic signs of hypocalcemia?", "Tetany, Chvostek's sign, Trousseau's sign, and seizures")],
            [("Who painted the Mona Lisa?", "Leonardo da Vinci"), ("In what year was the Sistine Chapel ceiling finished?", "1512"),
             ("What movement did Monet lead?", "Impressionism")],
            [("When was the society founded?", "1863"), ("What makes ATP?", "The mitochondria in each cell"), ("What carries oxygen?", "Hemoglobin"),
             ("Who wrote the charter?", "Henry Dunant"), ("What share of members voted?", "45%"), ("When was the treaty signed?", "August 22, 1864")],
        ]
        for pairs in sets:
            text = "\n".join(f"Q{i}: {q}\nA{i}: {a}" for i, (q, a) in enumerate(pairs, 1))
            content = guide_versions.live_content({"study_guide": text, "quiz_questions": None, "version": 3})
            questions = guide_versions.questions_for(content, "00000000-0000-0000-0000-000000000009")
            self.assertEqual([q["question"] for q in questions], [q for q, _ in pairs])


# === 4. Help me remember: every part of a list, the whole trick kept ================================

HOOKS = {
    "cranial nerves (first review)": (
        "What are the twelve cranial nerves in order?",
        "Olfactory, optic, oculomotor, trochlear, trigeminal, abducens, facial, vestibulocochlear, glossopharyngeal, vagus, accessory, and hypoglossal",
        "When you see cranial nerves, think 'Oh Oh Oh To Touch And Feel Very Good Velvet, Ah Heaven': Olfactory (nose), optic (eye), "
        "oculomotor (eye mover), trochlear (pulley), trigeminal (three-part face), abducens (abducts eye), facial (smile), "
        "vestibulocochlear (ear), glossopharyngeal (tongue-throat), vagus (wanders), accessory (shrug), and hypoglossal (tongue)."),
    "Freytag's pyramid": (
        "What are the stages of Freytag's pyramid?", "Exposition, rising action, climax, falling action, and resolution",
        "When you see Freytag's pyramid, climb a mountain: Exposition is the base camp map, rising action is the steep climb, "
        "climax is the summit selfie, falling action is the slippery slide down, and resolution is the hot cocoa back at the lodge."),
    "cranial nerves, 70 words (second review)": (
        "What are the twelve cranial nerves in order?",
        "Olfactory, optic, oculomotor, trochlear, trigeminal, abducens, facial, vestibulocochlear, glossopharyngeal, vagus, accessory, and hypoglossal",
        "Picture a twelve-floor hospital elevator ride: Olfactory smells lobby coffee, optic sees signs, oculomotor moves eyes upward, "
        "trochlear pulleys gently, trigeminal feels three facial zones, abducens abducts sideways, facial smiles broadly, "
        "vestibulocochlear balances and hears announcements, glossopharyngeal swallows nervously, vagus wanders through organs, "
        "accessory shrugs shoulders, and hypoglossal finally moves your tongue to say: Oh Oh Oh To Touch And Feel Very Good Velvet, "
        "Ah Heaven, remember forever."),
    "business law, 10 parts": (
        "What are the elements of a valid contract under common law?",
        "Offer, acceptance, consideration, capacity, legality, mutual assent, intention to create legal relations, certainty of terms, "
        "writing where required, and genuine consent",
        "Think of OACCL MICWG as a contract checklist: Offer starts it, acceptance mirrors it, consideration pays for it, capacity "
        "qualifies the parties, legality keeps it lawful, mutual assent shows agreement, intention to create legal relations makes it "
        "serious, certainty of terms keeps it clear, writing where required satisfies the statute, and genuine consent means no fraud "
        "or duress spoiled it."),
}


class HelpMeRememberTests(unittest.TestCase):
    def test_a_whole_list_trick_is_kept_in_one_call(self):
        for label, (question, answer, hook) in HOOKS.items():
            chat = MagicMock(side_effect=[reply(json.dumps({"hook": hook, "linked": None}))] * 2)
            with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
                self.assertEqual(llm.memory_hook(question, answer), {"hook": hook}, label)
            self.assertEqual(chat.call_count, 1, label)

    def test_the_prompt_asks_for_a_hook_per_part(self):
        chat = MagicMock(return_value=reply(json.dumps({"hook": HOOKS["Freytag's pyramid"][2]})))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            llm.memory_hook(*HOOKS["Freytag's pyramid"][:2])
        system = chat.call_args.kwargs["messages"][0]["content"]
        self.assertIn("every part its own hook", system)

    def test_a_trick_that_skips_a_part_is_asked_for_again_naming_it(self):
        question, answer, _ = HOOKS["Freytag's pyramid"]
        short = "When you see Freytag's pyramid: exposition, rising action, climax, then resolution."
        whole = HOOKS["Freytag's pyramid"][2]
        chat = MagicMock(side_effect=[reply(json.dumps({"hook": short})), reply(json.dumps({"hook": whole}))])
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            self.assertEqual(llm.memory_hook(question, answer), {"hook": whole})
        self.assertIn("falling action", chat.call_args_list[1].kwargs["messages"][1]["content"])

    def test_the_reviewers_part_cases(self):
        # rook-f5/parts.py and rook-f5b/parts.py: (answer, trick, missing)
        cases = [
            ("Left atrium, left ventricle, right atrium, and right ventricle", "Picture LEFT side: atrium then ventricle; the right ventricle pumps to lungs.", ["right atrium"]),
            ("Left atrium, left ventricle, right atrium, and right ventricle", "Left atrium, left ventricle, right atrium, right ventricle: L-L-R-R.", []),
            ("Left atrium, left ventricle, right atrium, and right ventricle",
             "On the right side, the atrium collects blood and the ventricle pumps it to the lungs; on the left side, the atrium and ventricle send it to the body.", []),
            ("Type 1 diabetes, Type 2 diabetes, and gestational diabetes", "Type 1 and gestational diabetes are the ones you remember.", ["Type 2 diabetes"]),
            ("Primary prevention, secondary prevention, and tertiary prevention", "Primary prevention stops it, tertiary prevention limits damage.", ["secondary prevention"]),
            ("Romanesque, Gothic, Renaissance, and Baroque", "Remember RGRB: Romanesque, Gothic, Renaissance, Baroque.", []),
            ("Romanesque, Gothic, Renaissance, and Baroque", "RGRB: Really Good Rich Bread.", ["Romanesque", "Gothic", "Renaissance", "Baroque"]),
            ("Offer, acceptance, and consideration", "An offer met by acceptance with consideration seals it.", []),
            ("Stack, queue, and deque", "A stack and a deque.", ["queue"]),
            ("Exposition, rising action, climax, falling action, and resolution", "Exposition, rising action, climax, then resolution.", ["falling action"]),
            ("Freud; Jung; Adler", "Freud and Jung", ["Adler"]),
            ("TCP, UDP, and ICMP", "TCP and ICMP hold hands", ["UDP"]),
            ("Section 1, Section 2, and Section 7 of the Sherman Act", "Section 1 and Section 2", ["Section 7 of the Sherman Act"]),
            ("Type I error, Type II error", "Type I and Type II errors: false positive then false negative.", []),
            ("Primary sources, secondary sources, and tertiary sources", "Primary, secondary and tertiary sources: first-hand, commentary, encyclopedias.", []),
            ("First-degree murder, second-degree murder, and voluntary manslaughter",
             "First- and second-degree murder differ by premeditation; voluntary manslaughter is heat of passion.", []),
            ("Short-term memory, long-term memory, and sensory memory", "Sensory memory flashes, short-term memory juggles, long-term memory stores.", []),
            ("Stack overflow, heap overflow", "Overflow the stack or the heap.", []),
            ("Pride and Prejudice", "Pride.", []),
        ]
        for answer, trick, missing in cases:
            self.assertEqual(retain.missing_parts(trick, answer), missing, trick)


# === 5. Print: one index range, hidden left out, shown wording =====================================

PRINT_GUIDE = """Q1: Which artists are listed for Chapter 1?
A1: Giotto, Cimabue and Duccio
Q2: What is chiaroscuro?
A2: Chiaroscuro is the strong contrast between light and dark used to model form in painting.
Q3: What is impasto?
A3: Impasto is paint laid on so thickly that brush or knife marks stay visible on the surface.
Q4: Why did Renaissance painters adopt linear perspective?
A4: It let them build a convincing illusion of depth on a flat surface using a single vanishing point and orthogonals.
Q5: Who painted the Mona Lisa?
A5: Leonardo da Vinci"""


class PrintTests(unittest.TestCase):
    def test_every_type_shares_the_saved_pair_index(self):
        # rook-f5b/printsrc.py
        pairs = quiz._parse_qa_pairs(PRINT_GUIDE)
        saved = [{"question": p["question"], "options": [p["answer"], "x1 y1 z1", "x2 y2 z2", "x3 y3 z3"], "correct_index": 0, "choices_v": 2}
                 for p in pairs]
        row = {"title": "t", "folder_id": None, "study_guide": PRINT_GUIDE, "print_items": None}
        with patch.object(quiz, "get_supabase", return_value=MagicMock()), patch.object(quiz, "get_user_id", return_value="u1"), \
                patch.object(quiz, "_guide_columns", return_value=row), patch.object(quiz, "_load_quiz", return_value=(saved, True)), \
                patch.object(quiz, "remaining", return_value=0):
            out = quiz.printable_items(GUIDE_ID, SimpleNamespace(fill=False), authorization="Bearer t")
        by_source = {}
        for kind in ("mc", "matching", "short"):
            for item in out[kind]:
                by_source.setdefault(item["source"], set()).add(kind)
        self.assertNotIn(0, by_source, "the question about the source is printed by no type")
        self.assertTrue(all(isinstance(source, int) for source in by_source), by_source)
        self.assertEqual(by_source[1], {"mc", "matching"})
        self.assertEqual(by_source[2], {"mc", "matching"})
        self.assertEqual(by_source[3], {"mc", "short"})


if __name__ == "__main__":
    unittest.main()
