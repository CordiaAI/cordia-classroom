import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services.distractor_check import conflict, keep_valid, subject_of
from routers import quiz

GUIDE = [
    ("What is program music?", "Instrumental music with a literary or pictorial association"),
    ("What is absolute music?", "Music lacking any literary or pictorial association"),
    ("What was Grieg’s nationality?", "Norwegian"),
    ("What is ‘La donna è mobile’?", "A famous aria from Verdi’s Rigoletto"),
    ("Where was Chopin born?", "Poland"),
]


class SubjectTests(unittest.TestCase):
    def test_subjects(self):
        self.assertEqual(subject_of("What is absolute music?"), "absolute music")
        self.assertEqual(subject_of("What was Grieg’s nationality?"), "grieg")
        self.assertEqual(subject_of("What does tempo rubato mean, and which composer is associated with it?"), "tempo rubato")
        self.assertIsNone(subject_of("What did Wagner call his operas?"))


class DistractorCheckTests(unittest.TestCase):
    def test_rejects_a_choice_describing_another_questions_subject(self):
        question, answer = GUIDE[0]
        self.assertIsNotNone(conflict("Absolute music is music without any program", question, answer, GUIDE))

    def test_rejects_another_questions_answer_and_near_copies(self):
        question, answer = GUIDE[0]
        self.assertIsNotNone(conflict("Music lacking any literary or pictorial association", question, answer, GUIDE))
        self.assertIsNotNone(conflict("Music lacking literary or pictorial associations", question, answer, GUIDE))

    def test_rejects_a_choice_that_answers_a_different_question(self):
        question, answer = GUIDE[3]
        self.assertIsNotNone(conflict("Grieg was from Norway", question, answer, GUIDE))

    def test_keeps_fair_wrong_choices(self):
        question, answer = GUIDE[0]
        self.assertIsNone(conflict("Vocal music set to a sacred Latin text", question, answer, GUIDE))
        # Names, terms and values reused from other answers stay fair wrong choices.
        self.assertIsNone(conflict("Norwegian", "What was Chopin’s nationality?", "Polish", GUIDE))
        self.assertIsNone(conflict("Chopin", "Who wrote the Erlking?", "Schubert", GUIDE))

    def test_keep_valid_splits_in_order(self):
        question, answer = GUIDE[0]
        kept, rejected = keep_valid(["Vocal music set to a sacred Latin text", "Absolute music is plain", "Dance music for the court"], question, answer, GUIDE)
        self.assertEqual(kept, ["Vocal music set to a sacred Latin text", "Dance music for the court"])
        self.assertEqual(rejected, ["Absolute music is plain"])


class TopUpTests(unittest.TestCase):
    PAIRS = [(q, a) for q, a in GUIDE]

    def test_rejected_replacements_are_checked_again_and_short_questions_topped_up(self):
        built = [{"question": GUIDE[0][0], "options": [GUIDE[0][1], "Vocal music set to a sacred Latin text"], "correct_index": 0}]
        fresh = {GUIDE[0][0]: ["Absolute music is plain", "Dance music for the court", "Music for silent films"]}
        with patch.object(quiz, "_replacement_distractors", return_value=fresh):
            out = quiz._top_up(None, built, self.PAIRS, targets={GUIDE[0][0]})
        options = out[0]["options"]
        self.assertEqual(options[out[0]["correct_index"]], GUIDE[0][1])
        self.assertNotIn("Absolute music is plain", options)
        self.assertEqual(set(options) - {GUIDE[0][1]}, {"Vocal music set to a sacred Latin text", "Dance music for the court", "Music for silent films"})

    def test_a_failed_regeneration_keeps_what_there_is(self):
        built = [{"question": GUIDE[0][0], "options": [GUIDE[0][1], "Vocal music set to a sacred Latin text"], "correct_index": 0}]
        with patch.object(quiz, "_replacement_distractors", return_value={}):
            out = quiz._top_up(None, built, self.PAIRS, targets={GUIDE[0][0]})
        self.assertEqual(out, built)


class RefreshChoicesTests(unittest.TestCase):
    def _run(self, saved, fresh):
        query = MagicMock()
        query.select.return_value = query
        query.eq.return_value = query
        query.update.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"quiz_questions": saved}])
        database = MagicMock()
        database.table.return_value = query
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "get_openai_client", return_value=None), \
             patch.object(quiz, "require"), patch.object(quiz, "record") as record, \
             patch.object(quiz, "_replacement_distractors", return_value=fresh) as regenerate:
            result = quiz.refresh_choices("00000000-0000-0000-0000-000000000001", "Bearer t")
        return result, query, record, regenerate

    def test_only_bad_choices_are_replaced_and_saved(self):
        saved = [
            {"question": GUIDE[0][0], "options": ["Absolute music is plain", GUIDE[0][1], "Dance music for the court", "Music for silent films"], "correct_index": 1},
            {"question": GUIDE[1][0], "options": [GUIDE[1][1], "Music for dancing", "Music sung in church", "Folk songs for children"], "correct_index": 0},
        ]
        result, query, record, _ = self._run(saved, {GUIDE[0][0]: ["Vocal music set to a sacred Latin text"]})
        self.assertEqual(result["changed"], 1)
        first = result["questions"][0]
        self.assertEqual(first["options"][first["correct_index"]], GUIDE[0][1])
        self.assertNotIn("Absolute music is plain", first["options"])
        self.assertEqual(result["questions"][1], saved[1])
        query.update.assert_called_once()
        record.assert_called_once()

    def test_nothing_to_fix_changes_nothing(self):
        saved = [{"question": GUIDE[1][0], "options": [GUIDE[1][1], "Music for dancing", "Music sung in church"], "correct_index": 0}]
        result, query, record, regenerate = self._run(saved, {})
        self.assertEqual(result["changed"], 0)
        query.update.assert_not_called()
        regenerate.assert_not_called()
        record.assert_not_called()




class FreeQuizKeepsQuestionsTests(unittest.TestCase):
    def test_a_guide_of_descriptions_still_gets_free_questions(self):
        """Every wrong choice in a free quiz is another question's answer; when all answers are
        descriptions the check would reject them all, so rejected ones top up to three."""
        pairs = [
            {"question": "What is lead time?", "answer": "The wait between placing an order and receiving it"},
            {"question": "What is safety stock?", "answer": "Extra inventory kept to cover uncertain demand"},
            {"question": "What is a bullwhip effect?", "answer": "Small demand changes growing larger up the supply chain"},
            {"question": "What is a reorder point?", "answer": "The stock level that triggers a new order"},
        ]
        questions = quiz._standard_questions(pairs)
        self.assertEqual(len(questions), 4)
        self.assertTrue(all(len(q["options"]) >= 3 for q in questions))


if __name__ == "__main__":
    unittest.main()
