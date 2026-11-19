"""Hostile input must not tie up the backend (security review, PR 275).

1. A long, whitespace-heavy question or answer, saved in a guide, goes through the source-reference
   checks in text_processing.py (refers_to_source, standalone_question, strip_source_attribution,
   strip_structure_markers) in well under 50 ms.
2. A very long semicolon or comma list answer goes through answer_parts / missing_parts and the
   "Help me remember" path (llm.memory_hook) in well under 50 ms.

Each case runs in a child process with a hard timeout, so a regex that backtracks for minutes (or
quadratic code) fails this test instead of freezing the suite. Only the call is timed (after the
imports, which can take seconds for services.llm on a busy machine), and in CPU time of the child
(time.process_time), so a busy machine slows the suite but never turns it red; the hard timeout
covers the imports too, so it is generous and only there to stop a runaway.

Sizes are the API maxima: a captured page is at most 500,000 characters (schemas.py), a saved
question is checked at most at 20,000 characters (routers/mcp.py WordingQuestion), a memory trick
is at most 600 characters but is checked here at 15,000.
"""

import json
import os
import subprocess
import sys
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")
LIMIT_MS = 50
HARD_TIMEOUT_S = float(os.environ.get("SOURCE_CHECK_TIMEOUT", "90"))  # imports included; the limit is LIMIT_MS
N = 20_000

# Each input is a Python expression, evaluated in the child.
TEXTS = {
    "word then 20k spaces": f'"slide" + " " * {N} + "x?"',
    "attribution then 20k spaces": f'"In this lecture" + " " * {N} + "what is x?"',
    "according to then 20k spaces": f'"According to Slide 5" + " " * {N} + "x"',
    "source noun, spaces, number, spaces": f'"What is on page" + " " * {N} + "3" + " " * {N} + "x"',
    "key terms, spaces, the lecture": f'"key terms for" + " " * {N} + "the lecture" + " " * {N}',
    "repeated attribution": f'("in the section" + " " * 40) * {N // 55}',
    "repeated the slide": f'"What is " + "the slide " * {N // 10} + "x"',
    "tabs and newlines": f'"x" + " \\t\\n" * {N // 3}',
    "leading spaces": f'" " * {N} + "Slide 5: x"',
    "marker line, spaces": f'"page 3" + " " * {N} + "x"',
    "commas and spaces": f'"in the lecture, " * {N // 16}',
    # F5 review: the source acting, "of" + a name, a generic remainder, stacked attributions
    "source acting chain": f'"What does the lecturer " * {N // 24} + "say?"',
    "of a name chain": f'"What is Problem 4 of the " * {N // 25} + "x?"',
    "ordinal chain": f'"What is the " + "first " * {N // 6} + "step, according to the slides?"',
    "trailing attributions": f'"What is x" + ", according to the text" * {N // 23} + "?"',
    "leading attributions": f'"According to the slides, " * {N // 26} + "what is x?"',
    "number lines": f'"\\n".join(["Dose (mg):", "4000"] * {N // 16})',
    "year lines": f'"\\n".join(["1789", "Storming"] * {N // 14})',
    # Second review: the reviewer's worst cases (timing.py), and the new visual and "in class" rules
    "comma per chain": f'"What is x" + ", per the slides" * {N // 16} + "?"',
    "framed trailing chain": f'"What is x" + " as discussed in the lecture" * {N // 28} + "?"',
    "mixed lead and trail": '"According to the text, " * 43 + "what is x" + ", according to the text" * 43 + "?"',
    "picture of a name": f'"In the image of " + "the Parthenon " * {N // 14} + ", x?"',
    "in class chain": f'"What is x" + ", as discussed in class" * {N // 22} + "?"',
    "one digit line": f'"1" + "9" * {N}',
    # The first review's adversarial inputs (rook-f5/adv.py)
    "slide digits": f'"What is on slide " + "1" * {N} + "x"',
    "slide dotted": f'"slide " + "1." * ({N} // 2) + "x"',
    "slide x many": f'"slide 1 " * ({N} // 8)',
    "covered in the": f'"covered in the " * ({N} // 15)',
    "is listed spaces": f'"is listed" + " ." * ({N} // 2)',
    "listed q": f'("listed " * ({N} // 7)) + "?"',
    "this these": f'"this these " * ({N} // 11)',
    "paren lead": f'"In Slide 5 (" + "a" * {N} + ", what is x?"',
    "paren lead2": f'"In Slide 5 " + "(" * {N} + ", what is x?"',
    "hash digits": f'"Slide " + "# " * ({N} // 2) + "5"',
    "dash line": f'"-" * {N} + "x"',
    "num spaces line": f'"1" + " " * {N} + "x"',
    "of slash": f'"page 1" + " of" * ({N} // 3) + " x"',
    "markers many lines": f'"\\n".join(["--- Slide %d ---" % i for i in range({N} // 5)])',
    "mixed bracket line": f'"[(" * ({N} // 2) + "5" + ")]" * ({N} // 2) + "x"',
    "unicode dashes": f'"\u2014" * {N} + "page 5" + "\u2013" * {N} + "z"',
    "newline flood": f'"\\n" * {N} + "x"',
    "tabs and slide": f'"slide\\t" * ({N} // 6)',
    "slash runs": f'"5" + " /" * ({N} // 2) + " 20x"',
    "decorated runs": f'"-" * 30 + " " * {N} + "3" + " -" * {N}',
}

CHECKS = ("refers_to_source", "standalone_question", "strip_source_attribution", "strip_structure_markers",
          "shown_questions", "clean_text", "_cue")
# shown_questions on three different questions (a remembered answer would hide the cost).
CALLS = {"shown_questions": "tp.shown_questions([{{'question': text + mark, 'options': ['a'], 'correct_index': 0}} for mark in ('', ' ', '  ')])",
         "_cue": "quiz._cue(text)"}
SETUP = "from services import text_processing as tp\nfrom routers import quiz\ntext = "

CHILD = """\
import json, sys, time
sys.path.insert(0, {backend!r})
{setup}
best = None
for _ in range(3):
    start = time.process_time()
    {run}
    took = (time.process_time() - start) * 1000
    best = took if best is None else min(best, took)
print(json.dumps({{"ms": best}}))
"""


def timed(setup: str, run: str) -> float:
    """Best of three runs, in milliseconds, measured inside a child process."""
    env = dict(os.environ, RETAIN_SIGNING_KEY=os.environ.get("RETAIN_SIGNING_KEY", "test-only-key"))
    code = CHILD.format(backend=BACKEND, setup=textwrap.dedent(setup), run=run)
    try:
        done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                              timeout=HARD_TIMEOUT_S, env=env, cwd=ROOT)
    except subprocess.TimeoutExpired:
        return float("inf")
    if done.returncode != 0:
        raise AssertionError(done.stderr[-2000:])
    return json.loads(done.stdout.strip().splitlines()[-1])["ms"]


def took(ms: float) -> str:
    return f"over {HARD_TIMEOUT_S:g} s" if ms == float("inf") else f"{ms:.1f} ms"


class SourceCheckTimingTests(unittest.TestCase):
    def test_every_source_check_is_fast_on_a_20000_character_whitespace_heavy_question(self):
        for label, expression in TEXTS.items():
            for check in CHECKS:
                with self.subTest(text=label, check=check):
                    ms = timed(SETUP + expression, CALLS.get(check, "tp.{check}(text)").format(check=check))
                    self.assertLess(ms, LIMIT_MS, f"{check}({label}): {took(ms)}")

    def test_marker_removal_is_fast_on_the_largest_capture(self):
        """A captured page is at most 500,000 characters (schemas.py): every shape of it, through
        strip_structure_markers (every guide batch) in under LIMIT_MS."""
        captures = {
            "short lines": '"\\n".join(["Slide 5", "1789", "Storming of the Bastille", "- 3 -", "Page 3 of 12"] * 20000)[:500000]',
            "newlines only": '"\\n" * 500000',
            "one long line": '"Slide " + "5 " * 249990',
            "spaces between lines": '("  " * 30 + "\\n") * 8000',
            "decoration lines": '("-" * 40 + " Page 3 " + "-" * 40 + "\\n") * 5000',
        }
        for label, expression in captures.items():
            with self.subTest(capture=label):
                ms = timed("from services import text_processing as tp\ntext = " + expression, "tp.strip_structure_markers(text)")
                self.assertLess(ms, LIMIT_MS, f"strip_structure_markers({label}): {took(ms)}")

    def test_parsing_a_whole_guide_is_fast(self):
        setup = """from routers import quiz
guide = "\\n".join(f"Q{i}: According to Slide {i}, what is term {i}?\\nA{i}: answer {i}" for i in range(5000))"""
        ms = timed(setup, "quiz._parse_qa_pairs(guide)")
        self.assertLess(ms, LIMIT_MS, f"_parse_qa_pairs on 5000 pairs: {took(ms)}")

    def test_a_long_question_with_a_source_reference_is_still_handled(self):
        """Capping what is checked must not stop the ends of a long question being read."""
        sys.path.insert(0, BACKEND)
        from services.text_processing import refers_to_source, standalone_question
        filler = "A patient presents with several findings and a long history. " * 60
        self.assertTrue(refers_to_source(f"{filler}Which artists are listed for Chapter 1?"))
        self.assertTrue(refers_to_source(f"What is shown on Slide 5? {filler}"))
        self.assertTrue(standalone_question(f"According to Slide 5, what is X? {filler}").startswith("What is X?"))
        self.assertTrue(standalone_question(f"{filler}What is X, according to the lecture?").endswith("What is X?"))


    def test_a_whole_quiz_of_worst_case_questions_stays_under_the_limit_per_question(self):
        """The API's largest quiz (50 questions), each a different 2000-character stack of
        attributions, nothing remembered between them: under LIMIT_MS a question."""
        setup = """from services import text_processing as tp
quiz = [{'question': "According to the text, " * 43 + f"what is x{i}" + ", according to the text" * 43 + "?",
         'options': ['a'], 'correct_index': 0} for i in range(50)]"""
        ms = timed(setup, "tp._standalone_cached.cache_clear(); tp.shown_questions(quiz)")
        self.assertLess(ms / 50, LIMIT_MS, f"shown_questions on 50 worst-case questions: {took(ms)}")


class ListAnswerTimingTests(unittest.TestCase):
    ANSWERS = {
        "5000 semicolon items": '"; ".join(f"item{i}" for i in range(5000))',
        "5000 comma items": '", ".join(f"item{i}" for i in range(5000)) + ", and last"',
        "5000 items, 4 words each": '"; ".join(f"alpha beta gamma delta{i}" for i in range(5000))',
        "one 20000 character item": f'"; ".join(["word" * {N // 4}, "b", "c"])',
        "20000 spaces": f'"a;" + " " * {N} + ";b;c"',
    }

    # The first review's list inputs (rook-f5/adv.py and ma.py), against a 15,000 character trick.
    MENTIONS = {
        "commas 12 long words": '", ".join(["supercalifragilistic" * 2] * 11) + ", and end"',
        "semis 13": '"; ".join(["a b c d e f"] * 13)',
        "999 chars commas": '",".join(["x"] * 499)',
        "and chain": '" and ".join(["x"] * 300)',
        "pair regex": '"a, " + "b " * 495 + "and c"',
        "999 distinct words": '" ".join(f"w{i:03d}abcdefgh" for i in range(70))[:999]',
        "999 chars 40-char words": '" ".join(["abcdefghijklmnopqrstuvwxyzabcdefghijklmn"] * 24)[:999]',
        "near-miss long words": '" ".join("abcdefghijklmnopqrstuvwxyzabcd" + f"{chr(97 + i % 26)}{chr(97 + i // 26 % 26)}xyzqwertyu"[:10] for i in range(25))',
    }
    TRICKS = {
        "15000 chars, one word": '"word " * 3000',
        "15000 chars, near misses": '" ".join("abcdefghijklmnopqrstuvwxyzabcd" + f"{chr(97 + i % 26)}{chr(98 + i // 26 % 24)}qwertyuiop" for i in range(400))',
        "480 chars": '("When you see this cue picture alphabetical abcdefghij klmnopqrst " * 8)[:480]',
    }

    def test_the_memory_trick_checks_are_fast_on_hostile_answers(self):
        for label, expression in self.MENTIONS.items():
            for trick, hook in self.TRICKS.items():
                for call in ("retain.mentions_answer(hook, answer)", "retain.missing_parts(hook, answer)",
                             "retain.answer_parts(answer)", "fits(answer, answer[::-1])"):
                    with self.subTest(answer=label, trick=trick, call=call.split("(")[0]):
                        ms = timed("from services import retain\nfrom services.choice_shapes import fits\n"
                                   f"answer = {expression}\nhook = {hook}", call)
                        self.assertLess(ms, LIMIT_MS, f"{call} on {label} / {trick}: {took(ms)}")

    def test_answer_parts_and_missing_parts_are_fast_on_a_huge_list(self):
        for label, expression in self.ANSWERS.items():
            for call in ("retain.answer_parts(answer)",
                         "retain.missing_parts('A hook that names item1 and item2.', answer)"):
                with self.subTest(answer=label, call=call.split("(")[0]):
                    ms = timed("from services import retain\nanswer = " + expression, call)
                    self.assertLess(ms, LIMIT_MS, f"{call} on {label}: {took(ms)}")

    def test_a_huge_list_answer_through_help_me_remember_is_fast(self):
        setup = textwrap.dedent("""
            import json
            from types import SimpleNamespace
            from unittest.mock import patch
            from services import llm
            answer = "; ".join(f"item{i}" for i in range(5000))
            hook = "When you see lists, picture item1, item2 and item3."
            reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"hook": hook})))])
            def call():
                with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", return_value=reply):
                    return llm.memory_hook("Which items are there?", answer)
        """)
        ms = timed(setup, "call()")
        self.assertLess(ms, LIMIT_MS, f"memory_hook on a 5000-item list: {took(ms)}")

    def test_a_list_of_twelve_parts_is_still_a_list_and_thirteen_is_not(self):
        sys.path.insert(0, BACKEND)
        os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")
        from services import retain
        twelve = "; ".join(f"part {chr(97 + i)}" for i in range(12))
        self.assertEqual(len(retain.answer_parts(twelve)), 12)
        self.assertEqual(retain.missing_parts("part a", twelve)[0], "part b")
        thirteen = twelve + "; part m"
        self.assertEqual(retain.answer_parts(thirteen), [thirteen])
        self.assertEqual(retain.missing_parts("nothing relevant", thirteen), [])


if __name__ == "__main__":
    unittest.main()
