from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def read(*parts):
    return WEB.joinpath(*parts).read_text(encoding="utf-8")


class WalkthroughContractTests(unittest.TestCase):
    def test_spotlight_renders_at_the_document_root_and_dims_to_40_percent(self):
        source = read("components", "Spotlight.js")
        self.assertIn("createPortal(", source)
        self.assertIn("document.body", source)
        self.assertIn("var(--spot-dim)", source)
        self.assertIn("--spot-dim: rgba(23, 27, 24, 0.4)", read("styles", "tokens.css"))
        self.assertIn(">Skip</button>", source)
        self.assertIn("prefers-reduced-motion", source)

    def test_first_run_has_four_screens_and_saves_progress_on_the_server(self):
        walkthrough = read("lib", "walkthrough.js")
        day_one = walkthrough.split("export const DAY_ONE = [")[1].split("\n];")[0]
        self.assertEqual(day_one.count("\n  ["), 4)
        for step in ("id: 'new'", "screen: 'about'", "id: 'quiz-start'", "screen: 'first-review'"):
            self.assertIn(step, day_one)
        progress = read("lib", "progress.js")
        self.assertIn("/auth/v1/user", progress)
        self.assertIn("data: { cordia: state }", progress)
        controller = read("components", "Walkthrough.js")
        self.assertIn("saveOnboardingStep('done')", controller)

    def test_about_you_moves_school_details_out_of_sign_up(self):
        about = read("components", "AboutYou.js")
        auth = read("components", "AuthCard.js")
        self.assertIn("apiFetch('/auth/profile'", about)
        for field in ("education_level", "university", "major"):
            self.assertIn(field, about)
            self.assertNotIn(field, auth)

    def test_one_time_tips_are_the_three_agreed(self):
        tips = read("lib", "tips.js")
        for text in ("'Ask why'", "'Add deadlines'", "'Your weak spots'"):
            self.assertIn(text, tips)
        # "Take a break" was removed everywhere (tip, 25-minute trigger, Focus card).
        self.assertNotIn("Take a break", tips)
        self.assertNotIn("requestTip('break')", read("pages", "dashboard.js"))
        self.assertNotIn("'Quiz yourself'", tips)


if __name__ == "__main__":
    unittest.main()
