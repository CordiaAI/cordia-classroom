import sys
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from schemas import GenerateRequest
from services.llm import study_guide_is_complete, study_guide_to_flashcards
from services.text_processing import build_review_sections
from main import app


class UniversalCaptureContractTests(unittest.TestCase):
    client = TestClient(app)

    def test_generate_request_carries_reviewed_content_without_server_state(self):
        request = GenerateRequest(content="Cells divide through mitosis.")
        self.assertEqual(request.content, "Cells divide through mitosis.")

    def test_review_sections_preserve_large_source_without_an_ai_gate(self):
        source = ("Mitosis and chromosome replication. " * 500).strip()
        sections = build_review_sections(source, max_length=1000)
        self.assertGreater(len(sections), 1)
        self.assertEqual(sections[0]["id"], "section-1")
        self.assertEqual(" ".join(section["text"] for section in sections).replace("  ", " "), source)

    def test_capture_generation_does_not_depend_on_process_memory(self):
        source = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        worker = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
        create = (ROOT / "web" / "pages" / "create.js").read_text(encoding="utf-8")
        self.assertNotIn("InMemoryStorage", source)
        self.assertNotIn("content_id: message.contentId", worker)
        self.assertIn("content: message.content", worker)
        self.assertIn("content: source", create)
        self.assertNotIn("apiFetch('/ingest'", create)

    def test_image_only_ingest_uses_vision_before_building_review_sections(self):
        source = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        ingest = source[source.index("def ingest("):source.index("@app.post(\"/generate\"")]
        self.assertIn("analyze_images_for_slides(images_data", ingest)
        self.assertLess(ingest.index("analyze_images_for_slides(images_data"), ingest.index("build_review_sections(content)"))

    def test_screenshot_vision_output_is_not_reanalyzed_during_generation(self):
        source = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
        ingest = source[source.index("def ingest("):source.index("@app.post(\"/generate\"")]
        self.assertIn("images_data = []", ingest)

    @patch("main.get_user_id", return_value="student-1")
    def test_ingest_returns_reviewable_text_without_a_temporary_id(self, _auth):
        response = self.client.post(
            "/ingest",
            headers={"Authorization": "Bearer test"},
            json={"content": "Cells divide through mitosis."},
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("content_id", response.json())
        self.assertEqual(response.json()["sections"][0]["text"], "Cells divide through mitosis.")

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_study_guide", return_value="Q1: What is mitosis?\nA1: Cell division.")
    @patch("main.generate_notes_ai", return_value=["Study note"])
    @patch("main.get_user_id", return_value="student-1")
    def test_generate_accepts_reviewed_text_directly(self, _auth, _notes, _guide, _usage, _record, _guidance):
        response = self.client.post(
            "/generate",
            headers={"Authorization": "Bearer test"},
            json={"content": "Cells divide through mitosis.", "flashcards": False},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["notes"], "- Study note")
        self.assertEqual(response.json()["study_guide"], "Q1: What is mitosis?\nA1: Cell division.")

    def test_canonical_parser_drops_duplicate_and_incomplete_pairs(self):
        guide = (
            "Q1: What is mitosis?\nA1: Cell division.\n\n"
            "Q2: What is mitosis?\nA2: Cell division.\n\n"
            "Q3: This question has no answer"
        )
        self.assertEqual(
            study_guide_to_flashcards(guide),
            [{"front": "What is mitosis?", "back": "Cell division."}],
        )
        self.assertFalse(study_guide_is_complete(guide))

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_study_guide", return_value="Q1: What is mitosis?\nA1: Cell division.\nQ2: What follows?")
    @patch("main.generate_notes_ai", return_value=[])
    @patch("main.get_user_id", return_value="student-1")
    def test_malformed_generation_is_rejected(self, _auth, _notes, _guide, _usage, record, _guidance):
        response = self.client.post(
            "/generate",
            headers={"Authorization": "Bearer test"},
            json={"content": "Cells divide through mitosis.", "notes": False, "flashcards": False},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "CordiaClassroom received an incomplete guide. Please try again.")
        record.assert_not_called()

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_study_guide", return_value="[Error generating study guide]")
    @patch("main.generate_notes_ai", return_value=[])
    @patch("main.get_user_id", return_value="student-1")
    def test_failed_generation_is_not_returned_as_a_guide(self, _auth, _notes, _guide, _usage, record, _guidance):
        response = self.client.post(
            "/generate",
            headers={"Authorization": "Bearer test"},
            json={"content": "Create a deployment diagram and an ER diagram.", "notes": False, "flashcards": False},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "CordiaClassroom could not build a guide from this material.")
        record.assert_not_called()

    @patch("main._learning_guidance", return_value="")
    @patch("main.record_usage")
    @patch("main.check_usage", return_value={"used": 0})
    @patch("main.generate_study_guide", return_value="Q1: What is required?\nA1: A deployment diagram.")
    @patch("main.generate_notes_ai", return_value=[])
    @patch("main.get_user_id", return_value="student-1")
    def test_empty_notes_are_not_saved_as_an_error_message(self, _auth, _notes, _guide, _usage, _record, _guidance):
        response = self.client.post(
            "/generate",
            headers={"Authorization": "Bearer test"},
            json={"content": "Submit a deployment diagram.", "flashcards": False},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["notes"])

if __name__ == "__main__":
    unittest.main()
