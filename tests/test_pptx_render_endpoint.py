from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import main as main_module  # noqa: E402
from services.pptx_rendering import PptxRenderError, PptxRenderTimeout  # noqa: E402


class PptxRenderEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main_module.app)
        self.auth_patch = patch.object(main_module, "get_user_id", return_value="user-1")
        self.auth_patch.start()
        self.addCleanup(self.auth_patch.stop)

    def post_file(self, name="lecture.pptx", content=b"PK\x03\x04 presentation"):
        return self.client.post(
            "/render-pptx",
            files={"file": (name, content, "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
            headers={"Authorization": "Bearer test"},
        )

    def test_returns_inline_pdf(self):
        pdf = b"%PDF-1.7 rendered"
        with patch.object(main_module, "render_pptx_to_pdf", return_value=pdf, create=True):
            response = self.post_file()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, pdf)
        self.assertTrue(response.headers["content-type"].startswith("application/pdf"))
        self.assertEqual(response.headers["content-disposition"], "inline")

    def test_rejects_non_pptx_filename(self):
        self.assertEqual(self.post_file(name="lecture.txt").status_code, 400)

    def test_rejects_file_larger_than_fifty_megabytes(self):
        content = b"x" * (50 * 1024 * 1024 + 1)
        self.assertEqual(self.post_file(content=content).status_code, 400)

    def test_maps_render_error_to_unprocessable_entity(self):
        with patch.object(main_module, "render_pptx_to_pdf", side_effect=PptxRenderError("failed"), create=True):
            response = self.post_file()
        self.assertEqual(response.status_code, 422)

    def test_maps_timeout_to_gateway_timeout(self):
        with patch.object(main_module, "render_pptx_to_pdf", side_effect=PptxRenderTimeout("timed out"), create=True):
            response = self.post_file()
        self.assertEqual(response.status_code, 504)


if __name__ == "__main__":
    unittest.main()
