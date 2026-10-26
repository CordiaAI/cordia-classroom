"""Guide titles: a source's name is cleaned, and named from the material when it doesn't say what it covers."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
from services.text_processing import clean_title, weak_title  # noqa: E402
from services import llm  # noqa: E402

USER = "11111111-2222-4333-8444-555555555555"
NOTES = "## Glycolysis\n- Glucose splits into two pyruvate molecules in the cytoplasm.\n## Krebs cycle\n- Acetyl-CoA is oxidized in the mitochondria."


class CleanTitleTest(unittest.TestCase):
    def test_file_and_site_leftovers_come_off(self):
        self.assertEqual(clean_title("Visual+Analysis.docx"), "Visual Analysis")
        self.assertEqual(clean_title("Nickels_UB2024_PPT_Ch01"), "Nickels UB2024 Ch01")
        self.assertEqual(clean_title("Chapter 6 Counting - CS 201 - Canvas"), "Chapter 6 Counting - CS 201")
        self.assertEqual(clean_title("Lecture Note 5 — Study Guide"), "Lecture Note 5")
        self.assertEqual(clean_title("Week 2 Pledge Test Flashcards"), "Week 2 Pledge Test")
        self.assertEqual(clean_title("Quantum Mechanics Wikipedia"), "Quantum Mechanics")
        self.assertEqual(clean_title("EH 225 Fa26 Midterm Review"), "EH 225 Midterm Review")
        self.assertEqual(clean_title("Exam 2 Chapter Notes"), "Exam 2 Chapter Notes")

    def test_several_files_keep_the_first_name(self):
        self.assertEqual(clean_title("Ch 7 Accruals + Ch 8 Inventory"), "Ch 7 Accruals")

    def test_weak_titles(self):
        for title in ("Chapter 7 PDF", "Exam 2 MC", "Homework", "Nickels_UB2024_PPT_Ch01", "learner-model-spec",
                      "ems medical", "Music Day 12", "Ch 7 Accruals + Ch 8 Inventory", "Untitled notes"):
            self.assertTrue(weak_title(title), title)
        # Names that already say what the material is about, in any subject.
        for title in ("Romantic Era: Lieder, Piano, Berlioz", "Contract Law: Offer and Acceptance", "5.1 Mathematical Induction",
                      "Class 8 Aristotle on Eudaimonia", "Cell Biology Basics", "The French Revolution"):
            self.assertFalse(weak_title(title), title)


class GuideTitleTest(unittest.TestCase):
    def test_typed_title_is_kept(self):
        with patch.object(llm, "name_guide") as name:
            self.assertEqual(llm.guide_title("ems medical", NOTES, keep=True), "ems medical")
            name.assert_not_called()

    def test_good_title_is_only_cleaned(self):
        with patch.object(llm, "name_guide", return_value="") as name:
            self.assertEqual(llm.guide_title("Cellular Respiration Overview.pdf", NOTES), "Cellular Respiration Overview")
            name.assert_called_once()  # a file name is weak: named from the material, else cleaned
        with patch.object(llm, "name_guide") as name:
            self.assertEqual(llm.guide_title("Cellular Respiration Overview", NOTES), "Cellular Respiration Overview")
            name.assert_not_called()

    def test_weak_title_is_named_from_the_material(self):
        with patch.object(llm, "name_guide", return_value="Chapter 7: Glycolysis and the Krebs Cycle") as name:
            self.assertEqual(llm.guide_title("Chapter 7 PDF", NOTES), "Chapter 7: Glycolysis and the Krebs Cycle")
            name.assert_called_once_with("Chapter 7", NOTES)

    def test_falls_back_to_the_cleaned_name(self):
        with patch.object(llm, "name_guide", return_value=""):
            self.assertEqual(llm.guide_title("Chapter_7.pdf", NOTES), "Chapter 7")

    def test_name_guide_needs_material(self):
        self.assertEqual(llm.name_guide("Chapter 7", "too short"), "")


class SaveGuideTitleTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.patches = [patch("routers.guides.get_supabase", return_value=self.db), patch("routers.guides.get_user_id", return_value=USER)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def save(self, **body):
        from routers.guides import SaveGuideRequest, save_guide
        return save_guide(SaveGuideRequest(**body), authorization="Bearer x")["guide"]

    def test_saved_under_a_better_name(self):
        with patch.object(llm, "name_guide", return_value="Cellular Respiration: Glycolysis, Krebs Cycle"):
            guide = self.save(title="Ch06 Student PowerPoint Underlined", notes=NOTES)
        self.assertEqual(guide["title"], "Cellular Respiration: Glycolysis, Krebs Cycle")
        self.assertNotIn("keep_title", guide)

    def test_typed_name_saved_as_typed(self):
        with patch.object(llm, "name_guide") as name:
            guide = self.save(title="my bio stuff", notes=NOTES, keep_title=True)
        self.assertEqual(guide["title"], "my bio stuff")
        name.assert_not_called()

    def test_update_never_renames(self):
        from routers.guides import SaveGuideRequest, update_guide
        self.db.rows("study_guides").append({"id": "a0000000-0000-4000-8000-000000000009", "user_id": USER, "title": "Chapter 7"})
        with patch.object(llm, "name_guide") as name:
            out = update_guide("a0000000-0000-4000-8000-000000000009", SaveGuideRequest(title="Chapter 7", keep_title=True), authorization="Bearer x")
        name.assert_not_called()
        self.assertEqual(out["guide"]["title"], "Chapter 7")
        self.assertNotIn("keep_title", out["guide"])


if __name__ == "__main__":
    unittest.main()
