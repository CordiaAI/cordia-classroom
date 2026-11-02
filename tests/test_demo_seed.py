"""The reviewer demo seed (backend/scripts/seed_demo_account.py): writes nothing without --apply,
fills the demo account, can run again without duplicating, refuses a real student's account, and its
content holds together (quotes really are in the transcripts, quiz answers point at an option)."""
import os
import re
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from fake_supabase import FakeDB  # noqa: E402
import demo_content  # noqa: E402
import seed_demo_account as seed  # noqa: E402

EMAIL = "reviewer+demo@example.test"
USER = "dddddddd-0000-4000-8000-000000000001"


class SeedTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.auth = SimpleNamespace(admin=SimpleNamespace(list_users=lambda page=1, per_page=200: [SimpleNamespace(id=USER, email=EMAIL)] if page == 1 else []))
        self.patches = [patch.object(seed, "get_supabase", return_value=self.db), patch.dict(os.environ, {"DEMO_EMAIL": EMAIL})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def run_seed(self, *args):
        with patch.object(sys, "argv", ["seed", *args]):
            seed.main()

    def counts(self):
        return {name: len(self.db.rows(name)) for name in ("folders", "study_guides", "lectures", "lecture_todos", "study_sessions", "quiz_attempts", "study_days", "retain_misses", "user_streaks")}

    def test_dry_run_writes_nothing(self):
        self.run_seed()
        self.assertEqual(sum(self.counts().values()), 0)

    def test_apply_fills_the_account_and_a_second_run_does_not_duplicate(self):
        self.run_seed("--apply")
        first = self.counts()
        self.assertEqual(first, {"folders": 3, "study_guides": 6, "lectures": 2, "lecture_todos": 3, "study_sessions": 12, "quiz_attempts": 5,
                                 "study_days": 12, "retain_misses": 1, "user_streaks": 1})
        guides = self.db.rows("study_guides")
        self.assertTrue(all(g["user_id"] == USER and g["external_source_id"].startswith("demo:") for g in guides))
        today = seed.datetime.now(seed.timezone.utc).date().isoformat()
        due = sum(1 for g in guides for i in range(len(g["flashcards"])) if g["flashcard_progress"]["schedule"].get(str(i), {"due": ""})["due"] <= today)
        self.assertGreaterEqual(due, 12, "a real due queue for Study now")
        self.assertEqual(self.db.rows("retain_misses")[0]["items"][0]["sure"], True)
        self.run_seed("--apply")
        second = self.counts()
        self.assertEqual(second["study_guides"], 6)
        self.assertEqual(second["folders"], 3)
        self.assertEqual(second["quiz_attempts"], 5)

    def test_an_account_with_other_study_sets_is_refused(self):
        self.db.table("study_guides").insert({"user_id": USER, "title": "Someone's real notes"}).execute()
        with self.assertRaises(SystemExit) as ctx:
            self.run_seed("--apply")
        self.assertIn("didn't make", str(ctx.exception))
        self.assertEqual(len(self.db.rows("study_guides")), 1)

    def test_no_account_and_no_password_stops(self):
        self.db.auth = SimpleNamespace(admin=SimpleNamespace(list_users=lambda page=1, per_page=200: []))
        with patch.dict(os.environ, {"DEMO_PASSWORD": ""}), self.assertRaises(SystemExit):
            self.run_seed("--apply")


class ContentTests(unittest.TestCase):
    def test_lecture_quotes_are_the_speakers_words(self):
        for lecture in demo_content.LECTURES:
            transcript = " ".join(text for _, text in lecture["segments"])
            starts = {start for start, _ in lecture["segments"]}
            for item in lecture["analysis"]["watch_for"] + lecture["todos"]:
                self.assertIn(item["quote"], transcript, lecture["slug"])
                self.assertIn(item["at_ms"], starts, item["quote"])

    def test_study_sets_are_complete(self):
        self.assertEqual({item["course"] for item in demo_content.STUDY_SETS}, set(demo_content.COURSES))
        for item in demo_content.STUDY_SETS:
            self.assertGreaterEqual(len(item["pairs"]), 6, item["slug"])
            for question, options, correct in item["quiz"]:
                self.assertTrue(0 <= correct < len(options) == len(set(options)), question)
            text = seed.outline_text(item["outline"])
            self.assertTrue(text.startswith("> ") and "## Key points" in text and re.search(r"^- ", text, re.M), item["slug"])

    def test_no_secrets_or_real_people(self):
        source = (ROOT / "backend" / "scripts" / "seed_demo_account.py").read_text() + (ROOT / "backend" / "scripts" / "demo_content.py").read_text()
        self.assertNotRegex(source, r"[\w.+-]+@(?!example)[\w-]+\.(com|edu|org)")
        self.assertNotIn("password=", source.lower().replace("password = os.getenv", ""))


if __name__ == "__main__":
    unittest.main()
