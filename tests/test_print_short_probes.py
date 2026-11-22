"""Regression test for the written short-answer checker: the reviewer's probe set plus our own.

No invented probe may ever pass. Good probes may be dropped (an invented question is worse than a
missing one), but fewer than GOOD_KEPT_AT_LEAST kept means the checker has turned too strict.
"""

import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
sys.path.insert(0, HERE)

from services import print_items as P
from short_probes import GOOD_KEPT_AT_LEAST, PROBES, SOURCES


class ShortAnswerProbeTests(unittest.TestCase):
    def test_no_invented_question_passes(self):
        kept = [(name, text) for name, text, invented in PROBES
                if invented and P.check_short(text, *SOURCES[name]) is not None]
        self.assertEqual(kept, [])

    def test_most_good_questions_are_kept(self):
        good = [(name, text) for name, text, invented in PROBES if not invented]
        kept = [text for name, text in good if P.check_short(text, *SOURCES[name]) == text]
        self.assertGreaterEqual(len(kept), GOOD_KEPT_AT_LEAST, f"{len(kept)} of {len(good)} good probes kept")

    def test_the_review_probes_named_in_the_fix_list(self):
        nursing = SOURCES["nursing"]
        self.assertIsNone(P.check_short("Explain how heparin causes deep vein thrombosis after surgery.", *nursing))
        self.assertIsNone(P.check_short("Explain why heparin is contraindicated after hip surgery.", *nursing))
        self.assertIsNone(P.check_short("Explain how influenza affects clotting after surgery.", *nursing))
        self.assertIsNone(P.check_short("Explain why Baroque painting used light and shadow before 1600.", *SOURCES["art"]))
        self.assertIsNone(P.check_short("Explain how import contracts can be cancelled under duress.", *SOURCES["law"]))
        self.assertIsNone(P.check_short("Explain why Gatsby can reach the future with Daisy.", *SOURCES["lit"]))
        self.assertIsNotNone(P.check_short("How does heparin prevent deep vein thrombosis?", *nursing))
        self.assertIsNotNone(P.check_short("Explain why heparin is given after hip surgery.", *nursing))


if __name__ == "__main__":
    unittest.main()
