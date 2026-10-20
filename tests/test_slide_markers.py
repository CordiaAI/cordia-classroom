import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services.text_processing import extract_slideshow_content


class SlideMarkerTests(unittest.TestCase):
    def test_extension_and_plain_markers_start_slides(self):
        slides = extract_slideshow_content("--- Slide 1 ---\nMitosis\nProphase\nSlide 2\nMeiosis\nCrossing over")
        self.assertEqual([s["title"] for s in slides], ["Mitosis", "Meiosis"])

    def test_line_mentioning_a_slide_is_content(self):
        slides = extract_slideshow_content("--- Slide 1 ---\nReview\nSlide 3 covers torts")
        self.assertEqual(slides[0]["content"], ["Slide 3 covers torts"])

    def test_cost_grows_linearly_with_hostile_input(self):
        # The old pattern took ~1s on 20k spaces and grew quadratically.
        started = time.monotonic()
        extract_slideshow_content("slide9" + " " * 200_000 + "x")
        self.assertLess(time.monotonic() - started, 1)


if __name__ == "__main__":
    unittest.main()
