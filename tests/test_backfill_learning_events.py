"""Backfilling learning_events from saved quiz results (personalization plan step 0.5)."""
from pathlib import Path
import os
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "scripts"))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-key")

import backfill_learning_events as b  # noqa: E402

USER = "11111111-1111-4111-8111-111111111111"
GUIDE = "22222222-2222-4222-8222-222222222222"
QUESTIONS = [{"question": "What organelle makes ATP?"}, {"question": "Name the powerhouse of the cell"}]


def attempt(answers, completed="2026-10-01T15:00:00+00:00", guide=GUIDE):
    return {"user_id": USER, "guide_id": guide, "completed_at": completed, "answers": answers}


class BackfillTests(unittest.TestCase):
    def test_typed_answers_become_events_with_the_real_fingerprint(self):
        rows, skipped = b.backfill_rows([attempt([
            {"question_index": 0, "type": "fill", "credit": 1.0, "is_correct": True},
            {"question_index": 1, "type": "written", "credit": 0.5, "is_correct": False},
        ])], {GUIDE: QUESTIONS})
        self.assertEqual([(r["format"], r["outcome"]) for r in rows], [("typed", "right"), ("written", "partly")])
        self.assertEqual(rows[0]["item_id"], f"{GUIDE}:what organelle makes atp")
        self.assertEqual({r["mode"] for r in rows}, {"backfill"})
        self.assertEqual((rows[0]["confidence"], rows[0]["submit_ms"], rows[0]["rapid_guess"]), (None, None, False))
        self.assertNotIn("n_options", rows[0])
        self.assertEqual(sum(skipped.values()), 0)

    def test_answers_saved_before_types_were_multiple_choice(self):
        rows, _ = b.backfill_rows([attempt([{"question_index": 0, "selected_index": 2, "is_correct": False}])], {GUIDE: QUESTIONS})
        self.assertEqual((rows[0]["format"], rows[0]["outcome"]), ("choice", "wrong"))

    def test_nothing_is_invented(self):
        rows, skipped = b.backfill_rows([
            attempt([{"question_index": 0, "selected_indices": [1], "is_correct": True}]),  # NCLEX
            attempt([{"question_index": 5, "type": "mc", "credit": 1.0}]),                   # question gone
            attempt([{"question_index": 0, "type": "mc", "credit": 1.0}], guide="33333333-3333-4333-8333-333333333333"),
            attempt([{"question_index": 0}], completed=None),
        ], {GUIDE: QUESTIONS})
        self.assertEqual(rows, [])
        self.assertEqual(skipped, {"nclex": 1, "no_questions": 1, "question_gone": 1, "bad_row": 1})

    def test_a_second_quiz_the_same_day_is_marked_same_day(self):
        rows, _ = b.backfill_rows([
            attempt([{"question_index": 0, "type": "mc", "credit": 1.0}], completed="2026-10-01T15:00:00+00:00"),
            attempt([{"question_index": 0, "type": "mc", "credit": 0.0}], completed="2026-10-01T18:00:00+00:00"),
            attempt([{"question_index": 0, "type": "mc", "credit": 1.0}], completed="2026-10-02T15:00:00+00:00"),
        ], {GUIDE: QUESTIONS})
        self.assertEqual([r["same_day"] for r in rows], [False, True, False])


if __name__ == "__main__":
    unittest.main()
