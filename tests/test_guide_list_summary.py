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


if __name__ == "__main__":
    unittest.main()
