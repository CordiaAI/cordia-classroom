from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WIZARD = ROOT / "web" / "components" / "SetupWizard.js"
TOUR = ROOT / "web" / "components" / "GuidedTour.js"
TOURS = ROOT / "web" / "lib" / "tours.js"
CSS = ROOT / "web" / "styles" / "globals.css"


class SetupWizardContractTests(unittest.TestCase):
    def test_wizard_renders_at_the_document_root_with_a_real_blur(self):
        source = WIZARD.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("createPortal(", source)
        self.assertIn("document.body", source)
        # The minifier drops an unprefixed backdrop-filter written next to its -webkit- twin.
        backdrop = next(line for line in css.splitlines() if line.startswith(".setup-wizard-backdrop {"))
        self.assertIn("backdrop-filter: blur(", backdrop)
        self.assertNotIn("-webkit-backdrop-filter", backdrop)

    def test_edu_install_warning_and_exact_redirects(self):
        source = WIZARD.read_text(encoding="utf-8")
        self.assertIn("Some .edu email accounts won&apos;t allow extension installs", source)
        for path in ("'/install-extension'", "'/create'"):
            self.assertIn(path, source)

    def test_tours_explain_each_feature_and_advance_on_any_click(self):
        tours = TOURS.read_text(encoding="utf-8")
        tour = TOUR.read_text(encoding="utf-8")
        for target in (".sn-paper-wrap", ".sn-viewer-wrap", ".sn-diagram-wrap", ".practice-board", ".practice-source-panel"):
            self.assertIn(target, tours)
        self.assertIn("This is where you can view the slideshows/files of the lecture to follow along with ease!", tours)
        self.assertIn("double-click a section to reveal it", tours)
        # The Practice tour runs on the real workspace, never the hub.
        onboarding = (ROOT / "web" / "lib" / "onboarding.js").read_text(encoding="utf-8")
        self.assertIn("/practice/${encodeURIComponent(id)}?tour=1", onboarding)
        self.assertIn("'/practice/tour'", onboarding)
        self.assertNotIn("GuidedTour", (ROOT / "web" / "pages" / "practice" / "index.js").read_text(encoding="utf-8"))
        self.assertIn('onClick={next}', tour)
        self.assertIn("overlaps(box, outline)", tour)


if __name__ == "__main__":
    unittest.main()
