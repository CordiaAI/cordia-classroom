"""F5 final round (PR 287): the owner's simpler rule, and every probe of the third review
(scratchpad rook-f5v2/) as a test.

The rule: no question is ever hidden or dropped because of its opening. Only a question that asks
how the source is organised or what it holds ("Which artists are listed for Chapter 1?", "What does
Slide 5 cover?") is removed. An opening that only names the source is trimmed ("As reviewed in the
lecture, what is a tort?" asks "What is a tort?"); any other opening is asked as written. Everything
that passed before still passes (the other F5 modules are unchanged apart from the cases this rule
flips: a picture in an opening is trimmed, never hidden).

Values: a value with a slash or a unit survives cleaning exactly, in every content type ("120 / 80",
"4000 mg", "5 mg/kg", "0.9% NaCl", "98.6 °F", and a unit on the line after its value). A bare
"N / M" line is a slide counter only when N is at most M.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")

from services import llm  # noqa: E402
from services.text_processing import (  # noqa: E402
    chunk_text, clean_text, extract_slideshow_content, format_slideshow_text, is_slideshow_content, refers_to_source,
    shown_questions, standalone_question, strip_source_attribution, strip_structure_markers,
)

# rook-f5v2/attrib2.py: 27 lead-ins, each before five questions from five subjects.
LEADS = [
    "As reviewed in the lecture slides", "As discussed in the lecture on cardiac output", "As taught by the instructor",
    "As shown in class", "As discussed throughout the course", "As reviewed in lectures 3 and 4", "As discussed in today's class",
    "As we discussed in the lecture", "As reviewed in the previous lecture", "As discussed in Lecture 4 (Renal)",
    "As reviewed during the lecture", "As discussed during class", "As reviewed in the lecture notes", "As discussed by the professor",
    "As covered in the course readings", "As reviewed in the study guide", "As mentioned earlier in the lecture",
    "As reviewed in the lecture and the textbook", "As explained in the assigned reading", "As noted on the slides",
    "In today's lecture", "In the lecture", "During the lecture", "As reviewed in the lecture,", "As reviewed in the lecture video",
    "As covered in Module 3", "As reviewed in the review session",
]
TAILS = ["what is a tort?", "what is the antidote for warfarin?", "who wrote Paradise Lost?", "what is a hash collision?",
         "what is price elasticity of demand?"]
# The one lead-in above that names more than the source: asked as written (its topic may matter).
NAMES_MORE = {"As discussed in the lecture on cardiac output"}

# rook-f5v2/attrib.py: the attribution family, each trimmed to the question.
FAMILY = {
    "As reviewed in the lecture, what is the first-line treatment for anaphylaxis?": "What is the first-line treatment for anaphylaxis?",
    "As discussed in class, what is consideration in contract law?": "What is consideration in contract law?",
    "As covered in today's lecture, who painted Las Meninas?": "Who painted Las Meninas?",
    "As presented in the slides, what is the time complexity of heapsort?": "What is the time complexity of heapsort?",
    "As explained in Chapter 4, what is a sonnet's volta?": "What is a sonnet's volta?",
    "As noted in the reading, what triggers the release of ADH?": "What triggers the release of ADH?",
    "As emphasized in the lecture, what does the Commerce Clause allow Congress to regulate?":
        "What does the Commerce Clause allow Congress to regulate?",
    "As outlined in the module, what are the three branches of government?": "What are the three branches of government?",
    "As described in the textbook, what is opportunity cost?": "What is opportunity cost?",
    "As mentioned in the video, what is Big-O notation?": "What is Big-O notation?",
    "As stated in the handout, what is the antidote for heparin?": "What is the antidote for heparin?",
    "As highlighted in the presentation, what movement did Frida Kahlo influence?": "What movement did Frida Kahlo influence?",
    "As we saw in lecture, what is the normal range for serum sodium?": "What is the normal range for serum sodium?",
    "As reviewed during the lecture, what is a tort?": "What is a tort?",
    "As reviewed in lecture 3, what is mitosis?": "What is mitosis?",
    "What is a tort, as reviewed in the lecture?": "What is a tort?",
    "Per the lecture, what is the half-life of digoxin?": "What is the half-life of digoxin?",
    "From the lecture, what is the role of the hippocampus?": "What is the role of the hippocampus?",
    "As the lecture reviewed, what is stare decisis?": "What is stare decisis?",
    "As reviewed in the lecture notes, what is iambic pentameter?": "What is iambic pentameter?",
    "As discussed by the professor, what is marginal utility?": "What is marginal utility?",
    "As the professor explained, what does TCP guarantee?": "What does TCP guarantee?",
    # more places an opening sits: between commas, in brackets, after the question with no comma
    "What, according to the lecture, is a tort?": "What is a tort?",
    "What is the normal potassium range (Slide 5)?": "What is the normal potassium range?",
    "What is the antidote for heparin according to the lecture?": "What is the antidote for heparin?",
    "What is free indirect discourse as discussed in class?": "What is free indirect discourse?",
    "What is the dose per kg according to the lecture?": "What is the dose per kg?",
    "What is mitosis in Chapter 3?": "What is mitosis?",
    "What is the time complexity of quicksort on Slide 4?": "What is the time complexity of quicksort?",
    "In the lecture what is a tort?": "What is a tort?",
    "Slide 5: what is the normal potassium range?": "What is the normal potassium range?",
}

# Openings that name more than the source, wherever they sit: asked as written, never hidden, even
# when the opening holds a source word the checks would otherwise read.
NAMES_MORE_CASES = [
    "During the lecture on cardiac output what is a tort?",
    "What is a tort, as discussed in the lecture on negligence?",
    "What is a tort as discussed in the lecture on negligence?",
    "What is a tort in the lecture on negligence?",
    "What, according to the lecture on torts, is negligence?",
    "What is the first-line drug (as covered in the lecture on heart failure)?",
    "In the image of the Parthenon, which order are the columns?",
    "In the lecture hall experiment by Milgram, what were participants told?",
    "In week 20 of pregnancy, what is assessed on the anatomy scan?",
    "In the context of heart failure, what is the first step?",
    "In the Bill of Rights, which freedom is listed first?",
    "Under the UCC, which remedy is listed first?",
    "According to the chart, what was the client's last blood pressure?",
]

# rook-f5v2/visual.py and attrib.py: a picture in an opening is trimmed (never hidden); a question
# about the picture's own labels or contents is hidden for what it asks.
VISUAL = {
    "Based on the graph, what is the equilibrium price?": "What is the equilibrium price?",
    "According to the diagram, which chamber pumps blood to the lungs?": "Which chamber pumps blood to the lungs?",
    "Looking at the map, which river borders Gaul?": "Which river borders Gaul?",
    "Using the table above, what is the dose for a 20 kg child?": "What is the dose for a 20 kg child?",
    "According to Figure 3, what is the peak velocity?": "What is the peak velocity?",
    "In the photo, what technique did the artist use?": "What technique did the artist use?",
    "In the diagram, which valve closes first?": "Which valve closes first?",
    "As shown in the diagram, which chamber has the thickest wall?": "Which chamber has the thickest wall?",
    "As shown in the graph, what happens to price when supply rises?": "What happens to price when supply rises?",
    "In the picture, what is the patient's position?": "What is the patient's position?",
    "Using the graph, what is the marginal cost at 10 units?": "What is the marginal cost at 10 units?",
    "Based on the illustration, what organ is shaded?": "What organ is shaded?",
    "In the table, which drug has the longest half-life?": "Which drug has the longest half-life?",
    "On the map, where is Carthage?": "Where is Carthage?",
    "What is the equilibrium price, based on the chart above?": "What is the equilibrium price?",
    "Refer to the image: who painted this work?": "Who painted this work?",
    # asked as written: no opening to trim, and nothing it asks needs the picture's layout
    "Look at the painting above. Who painted it?": "KEEP",
    "Which artist painted the image shown?": "KEEP",
    "What does the diagram show about the Krebs cycle?": "KEEP",
    "From the chart, which year had the highest inflation?": "KEEP",
    "According to the chart, what is the patient's heart rate?": "KEEP",
    "A car travels from point A to point B at 60 km/h. How long does 120 km take?": "KEEP",
    # only about the picture: its labels, its points, what it shows
    "What is shown in Figure 3?": None,
    "Which structure is labeled B in the figure?": None,
    "Which structure is labeled A?": None,
    "In the diagram of the heart, which valve is labelled B?": None,
    "What is the price at point E on the graph?": None,
    "On the graph, what is the price at point E?": None,
    "What is depicted in the photograph?": None,
    "Which painting is pictured?": None,
}

# Structure questions: what the source lists, covers or shows, wherever an opening sits.
STRUCTURE = [
    "Which artists are listed for Chapter 1?", "What does Slide 5 cover?", "What is shown on Slide 7?",
    "What topics are covered in this lecture?", "Which drug is listed first?", "What does the professor say about heparin?",
    "Which characters does the excerpt introduce?", "What is the second step?", "What topics are covered?",
    "What is the first item in the list?", "Which novels are on the reading list for this week?",
    # an opening never saves one, and never makes one
    "As reviewed in the lecture, which artists are listed for Chapter 1?", "According to the slides, what is the second step?",
    "In the lecture, which drug is listed first?", "As discussed in the lecture on cardiac output, which drugs are listed for Chapter 1?",
    "What is the author's main argument, according to the passage?",
]

# rook-f5v2/falsepos.py: subject questions with source words, each asked exactly as written.
SUBJECT = """What is the role of the text editor in early computing?
Which section of the Constitution establishes the Senate?
What does the Fourth Amendment say about searches?
What is the difference between a list and a tuple in Python?
What does a page table map in virtual memory?
What is a linked list?
Which chapter of Genesis describes the flood?
What does the Supremacy Clause state?
What is the main idea of the Gettysburg Address?
Which document established the Articles of Confederation?
What does the term 'mise-en-scène' describe in film?
What did the Declaration of Independence list as grievances?
What does the nurse document in the chart after administering insulin?
What is the purpose of a table of contents in a legal brief?
Which painting depicts the Battle of San Romano?
What are the notes of a C major scale?
What does the phrase 'Section 8 housing' refer to?
What does Article I, Section 8 give Congress?
What is the lecture method in pedagogy?
Who presented the theory of evolution by natural selection?
What is an example of a monopoly under the Sherman Act?
What problem does the Byzantine Generals problem describe?
What is shown by an elevated troponin level?
What is described by Newton's first law?
Which characters are introduced in the first act of Macbeth?
What is the first stage of labor?
What does the slide rule compute?
What is the passage of a bill through Congress called?
In Romeo and Juliet, which character is introduced first?
What is listed on a patient's MAR?
Which symptoms are listed as early signs of sepsis in the SIRS criteria?
What does the image of the green light symbolize in The Great Gatsby?
What does the map of Middle-earth show about Tolkien's world-building?
Which theme does the excerpt from Leaves of Grass illustrate?
What does the graph of y = x^2 look like?
What does Chapter 7 bankruptcy do?
Which figure of speech compares two things using like or as?
What is a figure-ground relationship in Gestalt psychology?
Which video codec uses inter-frame compression?
What does the lesson of the parable of the prodigal son teach?
How is a transcript of a deposition used at trial?
What is the purpose of the syllabus of a Supreme Court opinion?
What does the professor in Dead Poets Society urge his students to do?
What are the readings of a sphygmomanometer called?
What does the narrator of the passage in Moby-Dick call himself?
What is presented in a statement of cash flows?
What items are included in current assets?
What is identified as the tragic flaw of Oedipus?
In the Bill of Rights, which amendment is listed tenth?
Which planet is listed first by distance from the Sun?
What is the first step of the nursing process?
What are the steps of the scientific method?
Which elements are listed in Group 1 of the periodic table?""".splitlines() + [
    # rook-f5v2/attrib.py: must stay as written
    "In the Bill of Rights, which freedom is listed first?", "In Maslow's hierarchy, which need is listed first?",
    "What is a page fault?", "What does Chapter 11 bankruptcy allow?", "What does Section 2 of the Sherman Act prohibit?",
    "What vital signs are recorded in the chart before giving digoxin?", "Which company is listed on the NYSE as a blue chip?",
    "What is the List interface in Java?", "In week 20 of pregnancy, what is assessed on the anatomy scan?",
    "What happens in Act 3 of Hamlet?", "What is the main theme of the passage in Ecclesiastes 3?",
    "What does a slide (microscope) need before staining?",
    "In the lecture hall experiment by Milgram, what were participants told?",
    "What is stored in the table?", "What does the nurse document in the chart?", "What happens in Chapter 3?",
    "For a 20 kg child, what is the dose of amoxicillin?", "Per capita, which country has the highest GDP?",
]


class TheOwnersRuleTests(unittest.TestCase):
    def test_no_lead_in_ever_hides_or_drops_a_question(self):
        hidden, asked = [], 0
        for lead in LEADS:
            for tail in TAILS:
                question = f"{lead.rstrip(',')}, {tail}"
                got = standalone_question(question)
                asked += 1
                if got is None:
                    hidden.append(question)
                    continue
                want = question if lead in NAMES_MORE else tail[:1].upper() + tail[1:]
                self.assertEqual(got, want, question)
        self.assertEqual(asked, 135)
        self.assertEqual(hidden, [])

    def test_the_attribution_family_is_trimmed_to_the_question(self):
        for question, want in FAMILY.items():
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), want)

    def test_an_opening_that_names_more_is_asked_as_written(self):
        for question in NAMES_MORE_CASES:
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question)
                self.assertFalse(refers_to_source(question))

    def test_a_picture_in_an_opening_is_trimmed_and_only_a_question_about_the_picture_is_hidden(self):
        for question, want in VISUAL.items():
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question if want == "KEEP" else want)

    def test_structure_questions_are_still_removed(self):
        for question in STRUCTURE:
            with self.subTest(question=question):
                self.assertIsNone(standalone_question(question))

    def test_subject_questions_with_source_words_are_asked_as_written(self):
        self.assertGreaterEqual(len(SUBJECT), 53)
        for question in SUBJECT:
            with self.subTest(question=question):
                self.assertEqual(standalone_question(question), question)

    def test_running_it_again_changes_nothing(self):
        cases = [f"{lead.rstrip(',')}, {tail}" for lead in LEADS for tail in TAILS] + [*FAMILY, *NAMES_MORE_CASES, *VISUAL, *SUBJECT]
        for question in cases:
            once = standalone_question(question)
            if once is not None:
                self.assertEqual(standalone_question(once), once, question)

    def test_the_guide_keeps_every_idea_whatever_its_opening(self):
        # _canonical_qa drops only a structure question; an idea is never deleted for its opening
        questions = [f"{lead.rstrip(',')}, {tail}" for lead in LEADS for tail in TAILS[:2]] + NAMES_MORE_CASES + list(VISUAL)
        kept = [q for q in questions if standalone_question(q) is not None]
        raw = "\n".join(f"Q{n}: {q}\nA{n}: Answer {n}" for n, q in enumerate(questions, 1))
        canonical = llm._canonical_qa(raw)
        self.assertEqual(canonical.count("\nA0: ") + canonical.startswith("A0: "), len(kept))
        for q in kept:
            self.assertIn(f"Q0: {standalone_question(q)}\n", canonical + "\n")
        self.assertEqual(len(questions) - len(kept), sum(1 for want in VISUAL.values() if want is None))

    def test_a_quiz_shows_the_trimmed_wording_and_hides_only_structure(self):
        rows = [{"question": q, "options": ["a", "b", "c"], "correct_index": 0} for q in
                ("As discussed in the lecture on cardiac output, what is a tort?", "As reviewed in the lecture, what is a tort?",
                 "Which artists are listed for Chapter 1?", "Who painted the Mona Lisa?")]
        shown = shown_questions(rows)
        self.assertEqual([row.get("shown") for row in shown], [None, "What is a tort?", None, None])
        self.assertEqual([bool(row.get("hidden")) for row in shown], [False, False, True, False])
        self.assertEqual([row["question"] for row in shown], [row["question"] for row in rows], "the saved text never changes")

    def test_an_answer_loses_only_an_opening_that_names_the_source(self):
        self.assertEqual(strip_source_attribution("According to the lecture, furosemide is a loop diuretic."),
                         "Furosemide is a loop diuretic.")
        self.assertEqual(strip_source_attribution("Furosemide is a loop diuretic, as covered in Module 3."),
                         "Furosemide is a loop diuretic.")
        for answer in ("In 1066, William won at Hastings.", "Per capita income rose.", "3.5-5.0 mEq/L",
                       "In the Bill of Rights, the First Amendment comes first."):
            self.assertEqual(strip_source_attribution(answer), answer)


# --- Values with slashes and units ------------------------------------------------------------------

VALUES = ["120 / 80", "4000 mg", "5 mg/kg", "0.9% NaCl", "98.6 °F", "4000\nmg", "0.125\nmg", "98.6\n°F", "80\nunits/kg IV",
          "3.5-5.0\nmEq/L", "15 / 2", "20 / 5"]


def pipeline(raw):
    """The text the guide prompt gets, as generate_study_guide receives it from /generate."""
    slides = extract_slideshow_content(raw) if is_slideshow_content(raw)[0] else None
    text = format_slideshow_text(slides) if slides else clean_text(raw)
    return "\n".join(strip_structure_markers(chunk) for chunk in chunk_text(text, slides=slides))


def content_types(value):
    body = f"Blood pressure target\n{value}\nThe next fact on the page"
    return {
        "slideshow": f"--- Slide 1 ---\nVital signs\n{body}\n--- Slide 2 ---\nMore\nAnother fact here",
        "text pdf": f"--- Page 1 ---\nVital signs\n{body}\nPage 1 of 2\n--- Page 2 ---\nMore facts here",
        "pptx": f"--- Slide 1 ---\nVital signs\n{body}\n\n--- Slide 2 ---\nMore facts here",
        "web": f"Vital signs\n{body}\n- 2 -\nMore facts here",
        "scanned pdf": f"--- Page 1 ---\nVital signs\n{body}\n\n--- Page 2 ---\nMore facts here",
    }


class ValuesSurviveExactlyTests(unittest.TestCase):
    def test_each_value_survives_clean_text_and_slide_extraction(self):
        for value in VALUES:
            with self.subTest(value=value):
                text = f"Blood pressure target\n{value}\nThe next fact on the page"
                self.assertIn(value, clean_text(text))
                slides = extract_slideshow_content("--- Slide 1 ---\nVital signs\n" + text)
                self.assertIn(value, "\n".join(slides[0]["content"]))
                self.assertIn(value, strip_structure_markers(text))

    def test_each_value_reaches_the_prompt_in_every_content_type(self):
        for value in VALUES:
            for kind, raw in content_types(value).items():
                with self.subTest(value=value, kind=kind):
                    self.assertIn(f"Blood pressure target\n{value}\nThe next fact on the page", pipeline(raw))

    def test_n_over_m_is_a_counter_only_when_n_is_at_most_m_and_alone(self):
        for counter in ("5 / 20", "1 / 10", "12 / 40", "20 / 20"):
            self.assertEqual(strip_structure_markers(f"A\n{counter}\nB"), "A\nB", counter)
        for value in ("120 / 80", "15 / 2", "21 / 20", "5 / 20 mg", "Ratio 5 / 20", "5/20"):
            self.assertEqual(strip_structure_markers(f"A\n{value}\nB"), f"A\n{value}\nB", value)

    def test_a_navigation_word_beside_a_number_still_goes(self):
        self.assertEqual(clean_text("The first fact here\n5\nNext\nThe second fact here").split("\n"),
                         ["The first fact here", "5", "The second fact here"])

    def test_the_reviewers_nursing_slideshow(self):
        # rook-f5v2/markers.py: every value and unit stays; only the counter and page lines go
        raw = ("--- Slide 1 ---\nHeparin Therapy\nInitial bolus\n80\nunits/kg IV\nMaximum acetaminophen per day\n4000\nmg\n"
               "--- Slide 2 ---\nPotassium\nNormal range\n3.5-5.0\nmEq/L\nPage 2 of 14\nBlood pressure target\n120 / 80\n"
               "CPR compressions to breaths (two rescuers, infant)\n15 / 2\nInsulin sliding scale step\n(2)\n"
               "--- Slide 3 ---\nSlide 3\nDigoxin dose\n0.125\nmg\n5 / 20\n")
        out = pipeline(raw)
        for kept in ("80\nunits/kg IV", "4000\nmg", "3.5-5.0\nmEq/L", "120 / 80", "15 / 2", "(2)", "0.125\nmg"):
            self.assertIn(kept, out)
        for gone in ("Page 2 of 14", "5 / 20", "Slide 3"):
            self.assertNotIn(gone, out)



# --- Must-fix 1: the connected app's wording route --------------------------------------------------

def hostile(shape, size, salt):
    """Question text shaped to make the checks work hardest (rook-f5v2/mcpload.py, timing.py)."""
    if shape == "attributions":
        text = "In the lecture, as reviewed in Chapter 1.1.1, the slides on " * (size // 60 + 1)
    elif shape == "slide":
        text = "According to Slide 5, " * (size // 22 + 1)
    elif shape == "commas":
        text = "In the lecture, " + ", in the lecture" * (size // 16)
    else:
        words = ["slide", "page", "the", "lecture", "according to", "in", "chapter", "listed", "shown", "of", "this", ",", "?",
                 "as discussed in", "Figure", "1", "(see p. 4)", "labeled B", "point E", "on the graph"]
        rng = __import__("random").Random(salt)
        text = " ".join(rng.choice(words) for _ in range(size // 3))
    return (text[:size - 10] + f" {salt:08d}?")[:size]


class ConnectorWordingTests(unittest.TestCase):
    CPU_BOUND = 0.200  # seconds of CPU for the worst request the route lets through

    def test_each_request_is_capped_in_texts_characters_and_text_length(self):
        from routers import mcp
        mcp.WordingRequest(quizzes=[[{"question": "x" * 2001}]], cards=[["y" * 2001]])
        for body in ({"quizzes": [[{"question": "x" * 2002}]]},
                     {"quizzes": [[{"question": "x"}]], "cards": [["y" * 2002]]},
                     {"quizzes": [[{"question": "x"}] * 1500], "cards": [["y"] * 501]},
                     {"quizzes": [[{"question": "x" * 2000}] * 101]},
                     {"quizzes": [[{"question": "x"}]] * 101}):
            with self.assertRaises(Exception):
                mcp.WordingRequest(**body)

    def test_the_worst_allowed_request_stays_under_the_cpu_bound(self):
        import time
        from routers import mcp
        from services import text_processing as tp
        worst = 0.0
        for shape in ("attributions", "slide", "commas", "soup"):
            for size in (2001, 1000, 100):
                count = min(mcp.WORDING_MAX_TEXTS, mcp.WORDING_MAX_CHARS // size)
                texts = [hostile(shape, size, n) for n in range(count)]
                half = count // 2
                body = mcp.WordingRequest(quizzes=[[{"question": t} for t in texts[:half]]], cards=[texts[half:]])
                self.assertLessEqual(sum(len(t) for t in texts), mcp.WORDING_MAX_CHARS)
                best = None
                for _ in range(3):
                    tp._standalone_cached.cache_clear()
                    tp._marks_remembered.cache_clear()
                    start = time.process_time()
                    mcp.question_wording_marks(body)
                    spent = time.process_time() - start
                    best = spent if best is None else min(best, spent)
                worst = max(worst, best)
        self.assertLess(worst, self.CPU_BOUND, f"worst request took {worst * 1000:.0f} ms of CPU")

    def test_the_limit_is_per_connection_not_per_address(self):
        from fastapi import HTTPException
        from starlette.requests import Request
        from routers import mcp
        import rate_limit
        route = next(r for r in mcp.router.routes if getattr(r, "path", "").endswith("/question-wording"))
        limit = route.dependencies[0].dependency
        rate_limit._hits.clear()

        def request(token, address):
            return Request({"type": "http", "path": "/mcp/question-wording", "route": route, "client": (address, 1), "headers": [
                (b"authorization", f"Bearer {token}".encode()), (b"fly-client-ip", address.encode())]})
        for n in range(60):
            limit(request("one", f"10.0.0.{n}"))  # a new address every time: still one connection
        with self.assertRaises(HTTPException) as caught:
            limit(request("one", "10.0.1.1"))
        self.assertEqual(caught.exception.status_code, 429)
        limit(request("two", "10.0.0.1"))  # another connection on a used address is not limited
        rate_limit._hits.clear()

    def test_flashcard_fronts_are_marked_like_questions(self):
        from routers import mcp
        body = mcp.WordingRequest(quizzes=[[]], cards=[["Which artists are listed for Chapter 1?", "According to Slide 5, what is X?",
                                                         "Who painted the Mona Lisa?"]])
        self.assertEqual(mcp.question_wording_marks(body)["cards"], [[{"hidden": True}, {"shown": "What is X?"}, {}]])


# --- Must-fix 3: a hidden question's flashcard is never studied -------------------------------------

class HiddenCardTests(unittest.TestCase):
    def test_every_route_marks_flashcards_and_a_save_never_keeps_the_marks(self):
        from services.text_processing import shown_cards, shown_guide, unmarked
        cards = [{"front": "Which artists are listed for Chapter 1?", "back": "Giotto"},
                 {"front": "According to Slide 5, what is the normal potassium range?", "back": "3.5-5.0 mEq/L"},
                 {"front": "Who painted the Mona Lisa?", "back": "Leonardo", "hidden": True, "shown": "stale"}]
        marked = shown_cards(cards)
        self.assertEqual([card.get("hidden") for card in marked], [True, None, None], "a stale mark is never trusted")
        self.assertEqual(marked[1]["shown"], "What is the normal potassium range?")
        self.assertEqual([card["front"] for card in marked], [card["front"] for card in cards])
        self.assertEqual(shown_guide({"flashcards": cards})["flashcards"], marked)
        self.assertEqual(unmarked(marked), [{k: v for k, v in card.items() if k not in ("shown", "hidden")} for card in cards])

    def test_the_guide_update_route_saves_cards_without_marks(self):
        from routers import guides
        from services.text_processing import shown_cards
        saved = {}

        class Table:
            def update(self, data):
                saved.update(data)
                return self

            def __getattr__(self, name):
                return lambda *a, **k: self

            def execute(self):
                return MagicMock(data=[{"id": "g", **saved}])
        db = MagicMock()
        db.table.return_value = Table()
        cards = shown_cards([{"front": "Which artists are listed for Chapter 1?", "back": "Giotto"},
                             {"front": "Who painted the Mona Lisa?", "back": "Leonardo"}])
        self.assertTrue(cards[0]["hidden"])
        with patch.object(guides, "get_supabase", return_value=db), patch.object(guides, "get_user_id", return_value="u1"), \
                patch.object(guides, "_follow_ideas", return_value={}), patch.object(guides, "on_guide_changed"), \
                patch.object(guides, "_new_version", return_value={}):
            out = guides.update_guide("00000000-0000-0000-0000-000000000001", guides.SaveGuideRequest(title="Art", flashcards=cards), authorization="Bearer t")
        self.assertEqual(saved["flashcards"], [{"front": "Which artists are listed for Chapter 1?", "back": "Giotto"},
                                               {"front": "Who painted the Mona Lisa?", "back": "Leonardo"}])
        self.assertTrue(out["guide"]["flashcards"][0]["hidden"], "the reply is marked again")


# --- Mediums -----------------------------------------------------------------------------------------

class ClassroomTests(unittest.TestCase):
    IDEAS = [{"idea_id": "a", "question": "Which artists are listed for Chapter 1?", "answer": "Giotto"},
             {"idea_id": "b", "question": "According to Slide 5, what is the normal potassium range?", "answer": "3.5-5.0"},
             {"idea_id": "c", "question": "Who painted the Mona Lisa?", "answer": "Leonardo"}]

    def test_readiness_counts_only_ideas_that_are_asked_in_their_asked_wording(self):
        from services import classroom_study as cstudy
        ideas = cstudy.asked_ideas(self.IDEAS)
        self.assertEqual([idea["idea_id"] for idea in ideas], ["b", "c"])
        self.assertEqual(ideas[0]["question"], "What is the normal potassium range?")
        progress = {"a": {"l": 3, "at": "2026-11-18"}, "b": {"l": 1}, "c": {"l": 3, "at": "2026-11-18"}}
        tally = cstudy.tally(ideas, progress, "2026-11-19")
        self.assertEqual((tally["total"], tally["mastered"], tally["learning"]), (2, 1, 1))
        with patch.object(cstudy.versions, "live_content", return_value={"cards": []}), \
                patch.object(cstudy.versions, "owner_questions", return_value=[]), \
                patch.object(cstudy.versions, "content_ideas", return_value=self.IDEAS):
            self.assertEqual([idea["idea_id"] for idea in cstudy.guide_ideas({"id": "g"})[2]], ["b", "c"])

    def test_due_counts_skip_hidden_cards_and_questions(self):
        from services import classroom_study as cstudy
        content = {"cards": [{"idea_id": "a", "front": "Which artists are listed for Chapter 1?", "back": "Giotto"},
                             {"idea_id": "c", "front": "Who painted the Mona Lisa?", "back": "Leonardo"}]}
        questions = [{"idea_id": "a", "question": "Which artists are listed for Chapter 1?", "options": ["Giotto"], "correct_index": 0},
                     {"idea_id": "c", "question": "Who painted the Mona Lisa?", "options": ["Leonardo"], "correct_index": 0}]
        progress = {"a": {"l": 1}, "c": {"l": 1}}
        self.assertEqual(cstudy.due_count({}, progress, content, questions, "2026-11-19"), 2, "one card and one idea, not four")

    def test_a_guides_list_is_remembered_per_quiz(self):
        # rook-f5v2/listcost.py: /guides?limit=100 of 50 questions each, read twice
        from services import text_processing as tp
        guides = [{"quiz_questions": [{"question": f"Explain how item {g}-{n} is listed on a balance sheet.", "options": ["a", "b", "c"],
                                       "correct_index": 0} for n in range(50)]} for g in range(100)]
        tp._marks_remembered.cache_clear()
        first = [tp.shown_guide(guide) for guide in guides]
        hits = tp._marks_remembered.cache_info().hits
        second = [tp.shown_guide(guide) for guide in guides]
        self.assertEqual(first, second)
        self.assertEqual(tp._marks_remembered.cache_info().hits - hits, 100, "every quiz of the second read is remembered")
        self.assertGreaterEqual(tp._marks_remembered.cache_info().maxsize, 100)

    def test_cached_nclex_stems_are_asked_as_the_app_asks(self):
        from routers import nclex
        cached = [{"type": "mcq", "stem": "A client is prescribed furosemide. According to the lecture, which finding is the priority?",
                   "options": ["a", "b", "c", "d"], "correct_indices": [0], "rationale": "r"},
                  {"type": "mcq", "stem": "Which drugs are listed for Chapter 1?", "options": ["a", "b", "c", "d"], "correct_indices": [0],
                   "rationale": "r"}]
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"notes": "n", "study_guide": "s", "nclex_questions": cached}])
        with patch.object(nclex, "get_supabase", return_value=db), patch.object(nclex, "get_user_id", return_value="u1"):
            out = nclex.generate_nclex("00000000-0000-0000-0000-000000000001", authorization="Bearer t")
        self.assertEqual([q["stem"] for q in out["questions"]],
                         ["A client is prescribed furosemide. Which finding is the priority?", "Which drugs are listed for Chapter 1?"],
                         "reworded in place; none dropped, since answers are checked by position")

    def test_a_scenario_stems_opening_is_trimmed_never_hidden(self):
        self.assertEqual(standalone_question("A client with heart failure is prescribed furosemide. As discussed in the lecture on "
                                             "diuretics, which assessment is the priority?"),
                         "A client with heart failure is prescribed furosemide. As discussed in the lecture on diuretics, which "
                         "assessment is the priority?")


# --- Must-fix 4: print keeps every index and reads one list ------------------------------------------

class PrintTests(unittest.TestCase):
    def test_every_type_and_the_writer_read_one_open_index_list(self):
        from services import print_items
        from services.text_processing import shown_pairs
        pairs = shown_pairs([
            {"question": "Which artists are listed for Chapter 1?", "answer": "Giotto, Cimabue and Duccio"},
            {"question": "What is chiaroscuro?", "answer": "Chiaroscuro is the strong contrast between light and dark used to model form."},
            {"question": "Why did Renaissance painters adopt linear perspective?",
             "answer": "It let them build a convincing illusion of depth on a flat surface using one vanishing point."},
            {"question": "As reviewed in the lecture, what is impasto?", "answer": "Impasto is paint laid on thickly enough to show marks."},
        ])
        self.assertEqual(len(pairs), 4, "a hidden pair keeps its place")
        self.assertEqual(print_items.open_indexes(pairs), [1, 2, 3])
        self.assertEqual(pairs[3]["question"], "What is impasto?")
        used = {item["source"] for item in print_items.matching(pairs) + print_items.short_answer(pairs)}
        self.assertNotIn(0, used | set(print_items.fill_candidates(pairs)))
        written = print_items.fill_items(pairs, [0, 1], [{"id": 0, "sentence": "The artists were [[Giotto]]."},
                                                          {"id": 1, "sentence": "[[Chiaroscuro]] is the strong contrast between light and dark."}])
        self.assertEqual([item["source"] for item in written], [1], "the writer never prints a hidden pair, whatever it was sent")


if __name__ == "__main__":
    unittest.main()
