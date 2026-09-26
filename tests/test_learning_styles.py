import os
import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import main
from main import app
from services import learning_styles
from services.learning_styles import (
    find_item,
    guide_items,
    item_key,
    public_aid,
    tutor_style_instruction,
    validate_read_write,
    validate_visual,
)

GUIDE_ID = "11111111-2222-4333-8444-555555555555"
GUIDE = (
    "Q1: What is osmosis?\nA1: Osmosis is the movement of water across a semipermeable membrane "
    "toward the side with more solute.\n"
    "Q2: What is a semipermeable membrane?\nA2: A membrane that lets some molecules pass but not others.\n"
)
AUTH = {"Authorization": "Bearer token"}


def supabase_with(guide_rows, cached_rows=None, preference_rows=None):
    """A Supabase stub whose tables return fixed rows for any query chain."""
    tables = {}

    def table(name):
        rows = {"study_guides": guide_rows, "study_aids": cached_rows or [], "learning_preferences": preference_rows or []}[name]
        query = tables.setdefault(name, MagicMock())
        for method in ("select", "eq", "limit", "upsert"):
            getattr(query, method).return_value = query
        query.execute.return_value = MagicMock(data=rows)
        return query

    client = MagicMock()
    client.table.side_effect = table
    client.tables = tables
    return client


class StylePresentationTests(unittest.TestCase):
    def test_guide_items_mirror_the_guide_page_numbering(self):
        items = guide_items(GUIDE)
        self.assertEqual([item["number"] for item in items], [1, 2])
        item, related = find_item(GUIDE, 1)
        self.assertEqual(item["question"], "What is osmosis?")
        self.assertEqual([entry["number"] for entry in related], [2])
        self.assertEqual(find_item(GUIDE, 9), (None, []))

    def test_visual_aid_builds_safe_mermaid_with_numbered_blanks(self):
        aid = validate_visual({
            "direction": "LR",
            "nodes": [
                {"id": "n1", "label": "Water", "key": False},
                {"id": "n2", "label": 'Membrane"]; click n1 call alert(1) %%', "key": True},
                {"id": "bad id", "label": "ignored"},
            ],
            "edges": [{"from": "n1", "to": "n2", "label": "crosses"}, {"from": "n1", "to": "zz"}],
            "caption": "Water crosses a membrane.",
        })
        self.assertTrue(aid["mermaid"].startswith("flowchart LR"))
        for forbidden in ('"]', "(", ";", "ignored", "zz"):
            self.assertNotIn(forbidden, aid["mermaid"].replace('["', "").replace('"]\n', "\n"))
        self.assertIn("? 1", aid["practice_mermaid"])
        self.assertNotIn("Membrane", aid["practice_mermaid"])
        self.assertEqual(aid["blanks"][0]["number"], 1)
        self.assertIsNone(validate_visual({"nodes": [{"id": "n1", "label": "Only"}], "edges": []}))

    def test_read_write_blanks_only_use_words_in_the_summary(self):
        aid = validate_read_write({
            "notes": ["Water moves toward more solute."],
            "summary": "Osmosis moves water across a semipermeable membrane.",
            "blank_words": ["semipermeable", "not in summary"],
        })
        self.assertEqual(aid["blanks"], [{"number": 1, "answer": "semipermeable"}])
        self.assertIn("____ (1)", aid["practice_summary"])

    def test_checked_task_answer_never_reaches_the_browser(self):
        visible = public_aid("kinesthetic", {"example": "e", "task": "t", "task_answer": "secret"})
        self.assertNotIn("task_answer", visible)
        self.assertEqual(visible["mode"], "kinesthetic")

    def test_no_style_means_no_tutor_change(self):
        self.assertEqual(tutor_style_instruction(None), "")
        for style in learning_styles.STYLES:
            instruction = tutor_style_instruction(style)
            self.assertTrue(instruction)
            self.assertNotIn("learner", instruction.lower())

    def test_off_switch_disables_the_chosen_style(self):
        client = supabase_with([], preference_rows=[{"style": "visual", "prompted_at": "2026-09-26"}])
        self.assertEqual(learning_styles.active_style(client, "student-1"), "visual")
        with patch.dict(os.environ, {"LEARNING_STYLES_ENABLED": "false"}):
            self.assertIsNone(learning_styles.active_style(client, "student-1"))

    def test_missing_preference_storage_falls_back_to_standard_behavior(self):
        client = MagicMock()
        client.table.side_effect = RuntimeError("relation does not exist")
        self.assertIsNone(learning_styles.active_style(client, "student-1"))


class StyleRouteTests(unittest.TestCase):
    client = TestClient(app)

    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_style_routes_report_disabled_and_refuse_aids_when_off(self, _user):
        with patch.dict(os.environ, {"LEARNING_STYLES_ENABLED": "off"}):
            response = self.client.get("/learning-style", headers=AUTH)
            self.assertEqual(response.json()["enabled"], False)
            aid = self.client.post("/study-aids", headers=AUTH, json={"guide_id": GUIDE_ID, "number": 1, "mode": "visual"})
            self.assertEqual(aid.status_code, 404)

    @patch("routers.learning.generate_study_aid")
    @patch("routers.learning.check_usage")
    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_cached_aid_is_returned_without_charging_or_generating(self, _user, usage, generate):
        stub = supabase_with([{"id": GUIDE_ID, "study_guide": GUIDE}], cached_rows=[{"content": {"script": "Hi", "task": "Explain"}}])
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.post("/study-aids", headers=AUTH, json={"guide_id": GUIDE_ID, "number": 1, "mode": "aural"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["script"], "Hi")
        usage.assert_not_called()
        generate.assert_not_called()

    @patch("routers.learning.record_usage")
    @patch("routers.learning.check_usage", return_value={"used": 0})
    @patch("routers.learning.generate_study_aid", return_value={"example": "e", "task": "t", "task_answer": "hidden"})
    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_new_aid_is_generated_from_the_owned_item_and_cached(self, _user, generate, _usage, record):
        stub = supabase_with([{"id": GUIDE_ID, "study_guide": GUIDE}])
        with patch("routers.learning.get_supabase", return_value=stub):
            response = self.client.post("/study-aids", headers=AUTH, json={"guide_id": GUIDE_ID, "number": 1, "mode": "kinesthetic"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("task_answer", response.json())
        item = generate.call_args.args[1]
        self.assertEqual(item["question"], "What is osmosis?")
        cached = stub.tables["study_aids"].upsert.call_args.args[0]
        self.assertEqual(cached["item_key"], item_key(item))
        self.assertEqual(cached["content"]["task_answer"], "hidden")
        record.assert_called_once()

    @patch("routers.learning.get_user_id", return_value="student-1")
    def test_aids_require_a_guide_the_student_owns(self, _user):
        with patch("routers.learning.get_supabase", return_value=supabase_with([])):
            response = self.client.post("/study-aids", headers=AUTH, json={"guide_id": GUIDE_ID, "number": 1, "mode": "visual"})
        self.assertEqual(response.status_code, 404)


class TutorStyleTests(unittest.TestCase):
    @patch("main.get_supabase", return_value=MagicMock())
    def test_tutor_guidance_includes_only_the_chosen_style(self, _supabase):
        with patch("services.learning_styles.active_style", return_value="aural"):
            self.assertIn("talking things through", main._style_instruction("student-1"))
        with patch("services.learning_styles.active_style", return_value=None):
            self.assertEqual(main._style_instruction("student-1"), "")


if __name__ == "__main__":
    unittest.main()
