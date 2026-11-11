"""First-touch attribution saved with sign-up (backend/services/acquisition.py, POST /auth/age)."""
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
sys.path.insert(0, os.path.dirname(__file__))

from services import acquisition  # noqa: E402
from test_safety_hardening import U, Base  # noqa: E402

TOUCH = {
    "landing_path": "/ai-quiz-generator", "referrer_host": "chatgpt.com", "utm_source": "chatgpt.com",
    "utm_medium": None, "utm_campaign": "fall", "ref": "campus-ambassador", "from": "ai-quiz-generator", "ai_engine": "chatgpt",
    "first_seen": "2026-11-09",
}


def adult():
    today = datetime.now(timezone.utc).date()
    return {"year": today.year - 20, "month": today.month}


class ParseTests(unittest.TestCase):
    def test_only_allowlisted_valid_fields_are_kept(self):
        parsed = acquisition.parse({**TOUCH, "email": "someone@example.com", "ip": "203.0.113.9", "landing_path": "https://evil.example/x"})
        stored = parsed.stored()
        self.assertNotIn("email", stored)
        self.assertNotIn("ip", stored)
        self.assertNotIn("landing_path", stored, "a full URL isn't a path")
        self.assertEqual(stored["from"], "ai-quiz-generator")
        self.assertEqual(stored["ref"], "campus-ambassador")
        self.assertEqual(stored["ai_engine"], "chatgpt")
        self.assertEqual(stored["first_seen"], "2026-11-09")
        self.assertNotIn("utm_medium", stored, "empty values aren't stored")

    def test_lengths_and_values_are_capped(self):
        self.assertIsNone(acquisition.parse({"utm_source": "x" * 101}))
        self.assertIsNone(acquisition.parse({"ai_engine": "someone-else"}))
        self.assertIsNone(acquisition.parse({"from": "Not A Slug!"}))
        self.assertIsNone(acquisition.parse({"referrer_host": "Bad Host"}))
        self.assertIsNone(acquisition.parse("not an object"))
        self.assertEqual(acquisition.parse({"utm_campaign": "fall\x00\x07sale"}).stored(), {"utm_campaign": "fallsale"})

    def test_off_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ACQUISITION_TRACKING", None)
            self.assertFalse(acquisition.enabled())
            db = MagicMock()
            self.assertFalse(acquisition.save(db, "u1", TOUCH))
            db.table.assert_not_called()

    def test_a_failed_write_never_raises(self):
        db = MagicMock()
        db.table.side_effect = Exception("column user_profiles.acquisition does not exist")
        with patch.dict(os.environ, {"ACQUISITION_TRACKING": "1"}):
            self.assertFalse(acquisition.save(db, "u1", TOUCH))


class SignupTests(Base):
    def test_flag_off_saves_the_age_and_not_the_first_touch(self):
        os.environ.pop("ACQUISITION_TRACKING", None)
        response = self.call("post", "lee", "/auth/age", json={**adult(), "acquisition": TOUCH})
        self.assertEqual(response.json(), {"saved": True, "minor": False})
        self.assertNotIn("acquisition", self.row("user_profiles", U["lee"]))

    def test_flag_on_keeps_the_first_touch_once(self):
        self.db.rows("user_profiles").append({"id": U["lee"], "acquisition": None})
        with patch.dict(os.environ, {"ACQUISITION_TRACKING": "1"}):
            self.assertEqual(self.call("post", "lee", "/auth/age", json={**adult(), "acquisition": TOUCH}).status_code, 200)
            kept = self.row("user_profiles", U["lee"])["acquisition"]
            self.assertEqual(kept["ai_engine"], "chatgpt")
            self.assertEqual(kept["landing_path"], "/ai-quiz-generator")
            # The age is once only, and a first touch is never overwritten.
            self.assertTrue(acquisition.save(self.db, U["lee"], TOUCH) is False)
            self.assertEqual(self.row("user_profiles", U["lee"])["acquisition"], kept)

    def test_bad_attribution_never_fails_sign_up(self):
        with patch.dict(os.environ, {"ACQUISITION_TRACKING": "1"}):
            response = self.call("post", "kim", "/auth/age", json={**adult(), "acquisition": {"from": 12, "landing_path": ["x"]}})
        self.assertEqual(response.json(), {"saved": True, "minor": False})
        self.assertIsNone(self.row("user_profiles", U["kim"]).get("acquisition"))


if __name__ == "__main__":
    unittest.main()
