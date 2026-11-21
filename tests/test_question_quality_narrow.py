"""F5 narrow round (PR 287): the four items of the final review, each reviewer probe
(scratchpad rook-f5final/) as a test.

1. A card never studied (about the source itself) is never counted: the guide list says which cards
   those are (flashcard_hidden), so the home, the Library and the guide page count what Study now
   studies (web/tests/question-quality-narrow.test.mjs reads the same served fixture).
2. The connected-app wording route stays under 0.2 s of CPU for every request shape it lets through.
3. A study set split across wording requests never un-hides a question.
4. Only an opening that names where the material came from is trimmed; one that names a part of the
   subject ("In Chapter 11, ...", "In Article III, ...") is asked as written.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")

from routers import guides  # noqa: E402
from services import llm  # noqa: E402
from services.text_processing import (  # noqa: E402
    hidden_card_positions, shown_guide, shown_questions, standalone_question, strip_source_attribution,
)

FIXTURES = os.path.join(ROOT, "tests", "fixtures", "hidden-cards")


def _fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)


class _Query:
    def __init__(self, rows):
        self.rows = rows
        self.selected = None

    def select(self, columns):
        self.selected = columns
        return self

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return SimpleNamespace(data=json.loads(json.dumps(self.rows)))


# --- 1. A card never studied is never counted --------------------------------------------------------

class HiddenCardCountTests(unittest.TestCase):
    def _summary(self, rows):
        query = _Query(rows)
        database = MagicMock()
        database.table.return_value = query
        with patch.object(guides, "get_user_id", return_value="student-1"), patch.object(guides, "get_supabase", return_value=database):
            return guides.list_guides(fields="summary", limit=500, authorization="Bearer t")["guides"], query

    def test_the_summary_and_the_full_guide_are_the_served_fixture(self):
        # The web test (question-quality-narrow.test.mjs) checks the home, the Library and Study now
        # against these same two shapes, so both sides are held to one picture.
        rows, served = _fixture("rows.json")["rows"], _fixture("served.json")
        summary, query = self._summary(rows)
        self.assertEqual(summary, served["summary"])
        self.assertEqual([shown_guide(json.loads(json.dumps(row))) for row in rows], served["full"])
        self.assertIn("quiz_questions", query.selected.split(","))
        self.assertTrue(all("flashcards" not in guide and "quiz_questions" not in guide for guide in summary), "never sent")

    def test_the_reviewers_summary_names_the_two_hidden_cards(self):
        # rook-f5final/summary.py: 2 of 3 cards ask about the source; the third is not due until 2099.
        rows = [row for row in _fixture("rows.json")["rows"] if row["id"] == "g4"]
        summary, _ = self._summary(rows)
        self.assertEqual((summary[0]["flashcard_count"], summary[0]["flashcard_hidden"]), (3, [0, 1]))

    def test_a_card_whose_quiz_question_is_hidden_is_named_too(self):
        # Every card alone would be hidden, so shown_cards shows the deck; the quiz still has a question
        # to ask and hides these two, so Study now (studiedCards) leaves the cards out: so does the count.
        row = next(row for row in _fixture("rows.json")["rows"] if row["id"] == "g3")
        self.assertEqual(hidden_card_positions(row["flashcards"], row["quiz_questions"]), [0, 1])
        self.assertEqual(hidden_card_positions(row["flashcards"], None), [], "without the quiz the deck is shown")

    def test_no_cards_name_nothing(self):
        self.assertEqual(hidden_card_positions(None, None), [])
        self.assertEqual(hidden_card_positions([], [{"question": "Which artists are listed for Chapter 1?"}]), [])


# --- 2. The connected-app wording route stays under 0.2 s of CPU ------------------------------------
# The reviewer's slow shapes (rook-f5final/worst.py, timing3.py) are in
# test_question_quality_final.ConnectorWordingTests.test_the_worst_allowed_request_stays_under_the_cpu_bound
# (BARE_TRAILS). Here: the faster reading gives the same answers.

class BareTrailTests(unittest.TestCase):
    def test_an_attribution_at_the_end_is_still_read_the_same_way(self):
        cases = {
            # rook-f5final/worst.py's text: "un" names no source, so nothing comes off
            ("What is the dose" + " on unit" * 40)[:110] + " 00000000?": ("What is the dose" + " on unit" * 40)[:110] + " 00000000?",
            "What is the dose" + " on unit" * 12 + "?": "What is the dose?",
            "What is the antidote for heparin in the lecture?": "What is the antidote for heparin?",
            "What is the time complexity of quicksort on Slide 4?": "What is the time complexity of quicksort?",
            "What is a tort in the lecture on negligence?": "What is a tort in the lecture on negligence?",
            "Which novels are on the reading list?": None,
            "What happens in the lecture?": None,  # the lecture is what it asks about
            "What is the role of the hippocampus in the slides (Renal) for week 3?": "What is the role of the hippocampus?",
        }
        for question, want in cases.items():
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), want)


# --- 4. Only an opening that names where the material came from is trimmed --------------------------

# rook-f5final/edges.py and edges2.py: a numbered part may be the subject's own, so the opening stays.
PART_OF_THE_SUBJECT = [
    "In Chapter 11, what is the first step?", "Under Chapter 11, what is the first step?", "What is the first step in Chapter 11?",
    "What is the first step under Chapter 11?", "In Chapter 7, what are the main steps?", "In Section 1983, what are the key elements?",
    "What, in Chapter 11, is the first step?", "In Chapter 11, what happens to the debtor's management?",
    "In Chapter 11, who usually stays in control of the business?", "In Article III, who holds the judicial power?",
    "In Article I, which branch is created?", "In Part D, which drugs are covered?", "In Section 1983, what must a plaintiff prove?",
    "In Title IX, which programs are covered?", "In Title VII, which classes are protected?", "In Amendment 14, what does the Equal Protection Clause require?",
    "In Unit 731, what experiments were conducted?", "In Book 1, why does Achilles withdraw from battle?",
    "In Part 2, why does Raskolnikov confess?", "In Section 4.2, what is the CAP theorem?", "In Chapter 1, why does Nick move East?",
    "In Chapter 11, why does Gatsby insist he can repeat the past?", "What drugs are covered in Part D?", "What happens in Chapter 11?",
    "Which cities were attacked in week 1?", "At week 20, what is the main concern?",
    "During week 36, which items should the nurse teach first?", "A client is in labor. In week 38, what is the first step?",
    "As explained in Chapter 3, what is the parol evidence rule?", "What is mitosis in Chapter 3?",
]
# Trimming would leave only a generic noun: asked as written, never hidden.
GENERIC_LEFTOVERS = [
    "In week 20, what is the first step?", "Per the textbook, what are the key terms?", "In Lecture 4, what is the first step?",
    "According to the slides, what is the second step?", "What does the first bullet say, according to Slide 2?",
    "Which painting appears first in the presentation?", "According to the lecture, what are the four steps?",
]
# Where the material came from: trimmed.
WHERE_IT_CAME_FROM = {
    "In Module 3, what is the Nyquist rate?": "What is the Nyquist rate?",
    "What is the Nyquist rate in module 3?": "What is the Nyquist rate?",
    "In Lesson 2, what is a closure in JavaScript?": "What is a closure in JavaScript?",
    "Which electrolyte imbalance, per the week 3 handout, causes peaked T waves?": "Which electrolyte imbalance causes peaked T waves?",
    "Looking at the slides from week 5, what defines the contrapposto stance?": "What defines the contrapposto stance?",
    "Looking at the passage from Chapter 3, what does Elizabeth think of Darcy at the ball?": "What does Elizabeth think of Darcy at the ball?",
    "As discussed in Lecture 4 (Renal), what is the loop of Henle?": "What is the loop of Henle?",
    "In the lecture, in Chapter 3, what is a tort?": "In Chapter 3, what is a tort?",
    "As explained in the textbook, what is Big O notation?": "What is Big O notation?",
    "What is the normal potassium range (Slide 5)?": "What is the normal potassium range?",
}
# rook-f5final/leadins.py: 40 lead-ins across five subjects, none hidden or dropped.
LEADINS = [
    "As covered in the renal lecture, what is the first-line treatment for hyperkalemia with ECG changes?",
    "What lab value should be checked before giving digoxin, according to the pharmacology slides?",
    "Which electrolyte imbalance, per the week 3 handout, causes peaked T waves?",
    "(Lecture 7) What is the antidote for heparin overdose?",
    "A client on furosemide reports leg cramps. Based on today's lecture, which electrolyte should the nurse check first?",
    "In the module on burns, how is the Parkland formula calculated?",
    "What is the normal adult respiratory rate as reviewed in class?",
    "For a patient in Trendelenburg position, what complication should the nurse monitor for?",
    "According to Chapter 14 of Gardner's, who painted the Arnolfini Portrait?",
    "Who sculpted the Ecstasy of Saint Teresa, as discussed in the Baroque lecture?",
    "In the textbook, what technique did Caravaggio use to create dramatic contrast?",
    "What, according to Vasari, distinguished Giotto from his predecessors?",
    "[Slide 22] Which architect designed the dome of Florence Cathedral?",
    "As we saw in lecture, what movement did Monet's Impression, Sunrise name?",
    "In the reading on Byzantine art, why were icons controversial during iconoclasm?",
    "Looking at the slides from week 5, what defines the contrapposto stance?",
    "Under the UCC, what is the perfect tender rule?",
    "According to the casebook, what elements must be proven for promissory estoppel?",
    "What is the mailbox rule, per the syllabus readings?",
    "In Chapter 11 of the Bankruptcy Code, who typically remains in control of the business?",
    "As explained in the contracts lecture, when is a contract voidable for undue influence?",
    "Which doctrine, as noted in the textbook, allows courts to pierce the corporate veil?",
    "From the module 4 notes, what distinguishes a general partnership from an LLP?",
    "In Hadley v. Baxendale, what limit did the court place on consequential damages?",
    "As discussed in class, what does the green light symbolize in The Great Gatsby?",
    "What is the significance of the conch in Lord of the Flies, according to the reading?",
    "In Chapter 11, why does Gatsby insist he can repeat the past?",
    "Based on the excerpt from Beloved, what does Sethe mean by 'rememory'?",
    "In Hamlet, why does Hamlet delay killing Claudius?",
    "Who narrates Wuthering Heights (see the course outline)?",
    "Looking at the passage from Chapter 3, what does Elizabeth think of Darcy at the ball?",
    "What role does the chorus play in Greek tragedy, as presented in lecture 2?",
    "As shown in the lecture, what is the time complexity of binary search?",
    "What is the difference between a process and a thread, according to the OS slides?",
    "In the section on hashing, how does linear probing resolve collisions?",
    "Which sorting algorithm, per the textbook, is stable and runs in O(n log n) worst case?",
    "In Java, what does the final keyword do on a method?",
    "Based on the diagram of the TCP handshake, which flag does the server send in response to SYN?",
    "Referring to the week 6 lab, what does a page fault trigger in the operating system?",
    "During the recursion lecture, the professor asked: what is the base case of factorial?",
]


class OpeningTests(unittest.TestCase):
    def test_an_opening_naming_a_part_of_the_subject_is_asked_as_written(self):
        for question in PART_OF_THE_SUBJECT:
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question)
                self.assertEqual(strip_source_attribution(question), question)

    def test_a_generic_leftover_is_asked_as_written(self):
        for question in GENERIC_LEFTOVERS:
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question)
        for question in ("What is the first step?", "What are the key themes?", "Which topics are covered?"):
            self.assertIsNone(standalone_question(question), "generic with no opening: still never asked")

    def test_an_opening_naming_where_the_material_came_from_is_trimmed(self):
        for question, want in WHERE_IT_CAME_FROM.items():
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), want)
                self.assertEqual(standalone_question(want), want, "running it again changes nothing")

    def test_the_40_lead_ins_are_never_hidden_or_dropped(self):
        self.assertEqual(len(LEADINS), 40)
        self.assertEqual([q for q in LEADINS if standalone_question(q) is None], [])
        rows = shown_questions([{"question": q, "options": ["a", "b", "c", "d"], "correct_index": 0} for q in LEADINS])
        self.assertEqual(sum(1 for row in rows if row.get("hidden")), 0)
        raw = "\n".join(f"Q{n}: {q}\nA{n}: Answer {n}" for n, q in enumerate(LEADINS, 1))
        self.assertEqual(llm._canonical_qa(raw).count("Q0: "), 40, "the guide keeps every idea")


if __name__ == "__main__":
    unittest.main()
