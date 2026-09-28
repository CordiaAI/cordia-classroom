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

    def test_every_page_renders_in_a_scrollable_viewer(self):
        source = SMARTNOTES.read_text(encoding="utf-8")
        viewer = (ROOT / "web" / "components" / "PdfPages.js").read_text(encoding="utf-8")
        self.assertIn("<PdfPages url={objectUrl}", source)
        self.assertIn("doc.numPages", viewer)
        self.assertIn("IntersectionObserver", viewer)

    def test_failed_save_is_reported_and_blocks_guide_generation(self):
        source = SMARTNOTES.read_text(encoding="utf-8")
        self.assertIn("if (!response.ok) message = saveErrorMessage(response.status);", source)
        self.assertIn("const saveProblem = await doSave();", source)
        self.assertIn("onPaste={onPaperPaste}", source)


if __name__ == "__main__":
    unittest.main()
