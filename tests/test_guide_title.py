import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from services.llm import clean_guide_title  # noqa: E402


class GuideTitleTests(unittest.TestCase):
    def test_strips_extensions_dates_and_symbols(self):
        self.assertEqual(clean_guide_title('"Visual+Analysis.docx"'), "Visual Analysis")
        self.assertEqual(clean_guide_title("photosynthesis 10/05/2026"), "Photosynthesis")

    def test_title_case_and_six_word_limit(self):
        self.assertEqual(clean_guide_title("the opening scene of inglourious basterds and more words"), "The Opening Scene of Inglourious Basterds")
        self.assertEqual(clean_guide_title("DNA replication in cells"), "DNA Replication in Cells")


if __name__ == "__main__":
    unittest.main()
