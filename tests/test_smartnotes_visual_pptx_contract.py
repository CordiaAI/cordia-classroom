from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SMARTNOTES = ROOT / "web" / "pages" / "smartnotes.js"
GLOBALS = ROOT / "web" / "styles" / "globals.css"


class SmartNotesVisualPptxContractTests(unittest.TestCase):
    def test_pptx_uses_visual_render_endpoint_and_pdf_blob(self):
        source = SMARTNOTES.read_text(encoding="utf-8")
        self.assertIn("authorizedFetch('/render-pptx'", source)
        self.assertIn("renderResponse.blob()", source)
        self.assertIn("URL.revokeObjectURL", source)

    def test_visual_failure_has_readable_scrolling_slide_fallback(self):
        source = SMARTNOTES.read_text(encoding="utf-8")
        css = GLOBALS.read_text(encoding="utf-8")
        self.assertIn("sn-slide-fallback-notice", source)
        self.assertIn(".sn-slide-list", css)
        self.assertIn(".sn-slide-card", css)
        self.assertIn("overflow-y: auto", css)


if __name__ == "__main__":
    unittest.main()
