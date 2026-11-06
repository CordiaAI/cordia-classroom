import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from services.distractor_check import conflict, keep_valid, subject_of

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


if __name__ == "__main__":
    unittest.main()
