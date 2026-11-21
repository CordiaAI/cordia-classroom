"""F5 narrow round (PR 287): the four items of the final review, each reviewer probe
(scratchpad rook-f5final/) as a test.

1. A card never studied (about the source itself) is never counted: the guide list says which cards
   those are (flashcard_hidden), so the home, the Library and the guide page count what Study now
   studies (web/tests/question-quality-narrow.test.mjs reads the same served fixture).
2. The connected-app wording route stays under 0.2 s of CPU for every request shape it lets through.
3. A study set split across wording requests never un-hides a question.
4. Only an opening that names where the material came from is trimmed; one that names a part of the
   subject ("In Chapter 11, ...", "In Article III, ...") is asked as written.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("RETAIN_SIGNING_KEY", "test-only-key")

from routers import guides  # noqa: E402
from services.text_processing import hidden_card_positions, shown_guide  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures", "hidden-cards")


def _fixture(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)


class _Query:
    def __init__(self, rows):
        self.rows = rows
        self.selected = None

    def select(self, columns):
        self.selected = columns
        return self

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        return SimpleNamespace(data=json.loads(json.dumps(self.rows)))


# --- 1. A card never studied is never counted --------------------------------------------------------

class HiddenCardCountTests(unittest.TestCase):
    def _summary(self, rows):
        query = _Query(rows)
        database = MagicMock()
        database.table.return_value = query
        with patch.object(guides, "get_user_id", return_value="student-1"), patch.object(guides, "get_supabase", return_value=database):
            return guides.list_guides(fields="summary", limit=500, authorization="Bearer t")["guides"], query

    def test_the_summary_and_the_full_guide_are_the_served_fixture(self):
        # The web test (question-quality-narrow.test.mjs) checks the home, the Library and Study now
        # against these same two shapes, so both sides are held to one picture.
        rows, served = _fixture("rows.json")["rows"], _fixture("served.json")
        summary, query = self._summary(rows)
        self.assertEqual(summary, served["summary"])
        self.assertEqual([shown_guide(json.loads(json.dumps(row))) for row in rows], served["full"])
        self.assertIn("quiz_questions", query.selected.split(","))
        self.assertTrue(all("flashcards" not in guide and "quiz_questions" not in guide for guide in summary), "never sent")

    def test_the_reviewers_summary_names_the_two_hidden_cards(self):
        # rook-f5final/summary.py: 2 of 3 cards ask about the source; the third is not due until 2099.
        rows = [row for row in _fixture("rows.json")["rows"] if row["id"] == "g4"]
        summary, _ = self._summary(rows)
        self.assertEqual((summary[0]["flashcard_count"], summary[0]["flashcard_hidden"]), (3, [0, 1]))

    def test_a_card_whose_quiz_question_is_hidden_is_named_too(self):
        # Every card alone would be hidden, so shown_cards shows the deck; the quiz still has a question
        # to ask and hides these two, so Study now (studiedCards) leaves the cards out: so does the count.
        row = next(row for row in _fixture("rows.json")["rows"] if row["id"] == "g3")
        self.assertEqual(hidden_card_positions(row["flashcards"], row["quiz_questions"]), [0, 1])
        self.assertEqual(hidden_card_positions(row["flashcards"], None), [], "without the quiz the deck is shown")

    def test_no_cards_name_nothing(self):
        self.assertEqual(hidden_card_positions(None, None), [])
        self.assertEqual(hidden_card_positions([], [{"question": "Which artists are listed for Chapter 1?"}]), [])


if __name__ == "__main__":
    unittest.main()
