import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services.text_processing import html_to_text


class HtmlToTextTests(unittest.TestCase):
    def test_blocks_become_line_breaks_and_entities_are_decoded(self):
        self.assertEqual(
            html_to_text("<h2>Cell cycle</h2><p>Interphase &amp; mitosis<br/>G1 &lt; S</p>"),
            "\nCell cycle\n\nInterphase & mitosis\nG1 < S\n",
        )

    def test_text_without_tags_is_returned_unchanged(self):
        self.assertEqual(html_to_text("a < b and c > d"), "a < b and c > d")
        self.assertEqual(html_to_text(""), "")

    def test_cost_grows_linearly_with_hostile_input(self):
        # The old regex took ~18s on 200k '<'; a linear pass takes well under a second.
        started = time.monotonic()
        html_to_text("<" * 200_000)
        html_to_text("<p" * 100_000)
        self.assertLess(time.monotonic() - started, 2)


if __name__ == "__main__":
    unittest.main()
