import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import guides


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.selected = None
        self.range_args = None

    def select(self, columns):
        self.selected = columns
        return self

    def eq(self, *_args):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self.range_args = (start, end)
        return self

    def execute(self):
        return SimpleNamespace(data=[dict(row) for row in self.rows])


class GuideListSummaryTests(unittest.TestCase):
    def _list(self, rows, **kwargs):
        query = FakeQuery(rows)
        database = MagicMock()
        database.table.return_value = query
        with patch.object(guides, "get_user_id", return_value="student-1"), \
             patch.object(guides, "get_supabase", return_value=database):
            return guides.list_guides(authorization="Bearer token", **kwargs), query

    def test_summary_leaves_out_guide_text_and_counts_flashcards(self):
        result, query = self._list(
            [{"id": "g1", "title": "Cells", "flashcards": [{"front": "a"}, {"front": "b"}]}, {"id": "g2", "title": "Atoms", "flashcards": None}],
            fields="summary", limit=500,
        )
        self.assertNotIn("study_guide", query.selected)
        self.assertNotIn("notes", query.selected)
        self.assertEqual(query.range_args, (0, 499))
        self.assertEqual([guide["flashcard_count"] for guide in result["guides"]], [2, 0])
        self.assertTrue(all("flashcards" not in guide for guide in result["guides"]))

    def test_full_list_is_unchanged_and_still_capped(self):
        result, query = self._list([{"id": "g1", "flashcards": [{"front": "a"}]}], limit=500)
        self.assertEqual(query.selected, "*")
        self.assertEqual(query.range_args, (0, 99))
        self.assertEqual(result["guides"][0]["flashcards"], [{"front": "a"}])

    def test_summary_includes_flashcard_progress_for_the_due_count(self):
        self.assertIn("flashcard_progress", guides.SUMMARY_COLUMNS.split(","))


class FlashcardScheduleTests(unittest.TestCase):
    def _save(self, saved_progress, **body):
        query = FakeQuery([{"flashcard_progress": saved_progress}])
        query.update = MagicMock(return_value=query)
        database = MagicMock()
        database.table.return_value = query
        with patch.object(guides, "get_user_id", return_value="student-1"), \
             patch.object(guides, "get_supabase", return_value=database):
            guides.update_flashcard_progress("a0000000-0000-4000-8000-000000000001", guides.FlashcardProgressRequest(**body), "Bearer t")
        return query.update.call_args.args[0]["flashcard_progress"]

    def test_schedule_is_saved(self):
        saved = self._save({}, known=[0], schedule={"0": {"box": 1, "due": "2026-10-24"}})
        self.assertEqual(saved["schedule"], {"0": {"box": 1, "due": "2026-10-24"}})

    def test_a_client_without_schedule_keeps_the_saved_one(self):
        before = {"known": [0], "schedule": {"0": {"box": 3, "due": "2026-11-01"}}}
        saved = self._save(before, known=[0, 1], unknown=[])
        self.assertEqual(saved["schedule"], before["schedule"])
        self.assertEqual(saved["known"], [0, 1])

    def test_bad_entries_are_refused(self):
        for bad in ({"x": {"box": 1, "due": "2026-10-24"}}, {"0": {"box": 9, "due": "2026-10-24"}}, {"0": {"box": 1, "due": "soon"}}):
            with self.assertRaises(ValueError):
                guides.FlashcardProgressRequest(schedule=bad)


if __name__ == "__main__":
    unittest.main()
