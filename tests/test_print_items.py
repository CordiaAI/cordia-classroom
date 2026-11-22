import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import quiz
from services import print_items as P
from services.entitlements import LimitReached

PAIRS = [
    {"question": "What is a Lied?", "answer": "A Lied is a German art song for solo voice and piano."},
    {"question": "What is program music?", "answer": "Program music is instrumental music with a literary or pictorial association."},
    {"question": "What did Wagner call his operas?", "answer": "Wagner called his operas music dramas."},
    {"question": "Where did Impressionism begin, and where did the term come from?", "answer": "It began as a movement in painting. The term came from a painting by Claude Monet."},
    {"question": "What characterizes Impressionist music?", "answer": "It features unresolved dissonances, blurred harmonies, and shimmering orchestral color, rather than a strong pull to the tonic."},
    {"question": "What is the idée fixe?", "answer": "It is Berlioz's recurring main theme, transformed in each movement. It represents the beloved."},
    {"question": "Who is the leading Impressionist composer?", "answer": "Debussy."},
]


class StemTests(unittest.TestCase):
    def test_repeated_subject_and_linking_verb_are_removed(self):
        options = ["A Lied is a Russian folk dance for solo violin and harp.", "A Lied is a German art song for solo voice and piano.",
                   "A Lied is a French art song for chorus and organ.", "A Lied is an Italian opera aria for tenor and full orchestra."]
        self.assertEqual(P.strip_stem("What is a Lied?", options)[1], "A German art song for solo voice and piano.")
        self.assertEqual(P.strip_stem("What is a Lied?", options)[3], "An Italian opera aria for tenor and full orchestra.")

    def test_a_restated_question_is_removed(self):
        options = ["Wagner called his operas music pageants", "Wagner called his operas music dramas"]
        self.assertEqual(P.strip_stem("What did Wagner call his operas?", options), ["Music pageants", "Music dramas"])
        options = ["It is associated with the fall of Vienna to Napoleon in 1805", "It is associated with the fall of Warsaw to Russia in 1831"]
        self.assertEqual(P.strip_stem("What historical event is associated with Chopin's Revolutionary étude?", options)[1],
                         "The fall of Warsaw to Russia in 1831")

    def test_never_strips_what_not_every_option_shares_or_the_subject_alone(self):
        options = ["Program music is opera overture music", "Absolute music is music lacking any association"]
        self.assertEqual(P.strip_stem("What is program music?", options), options)
        options = ["Brahms used French poetry instead of the Latin liturgy", "Brahms used German Bible texts instead of the Latin liturgy"]
        self.assertEqual(P.strip_stem("How did Brahms's Requiem text differ from the traditional one?", options), options)

    def test_capitalizes_after_an_opening_quote(self):
        options = ['Tempo rubato means "steady beat."', 'Tempo rubato means "robbed time."']
        self.assertEqual(P.strip_stem("What does tempo rubato mean?", options)[1], '"Robbed time."')


class MatchingAndShortTests(unittest.TestCase):
    def test_matching_uses_short_what_is_questions(self):
        items = {item["term"]: item["definition"] for item in P.matching(PAIRS)}
        self.assertEqual(items["Lied"], "A German art song for solo voice and piano")
        self.assertEqual(items["Idée fixe"], "Berlioz's recurring main theme, transformed in each movement")
        self.assertNotIn("Impressionism", " ".join(items))

    def test_short_answer_uses_the_guides_own_why_how_questions(self):
        items = P.short_answer(PAIRS)
        self.assertEqual([item["question"] for item in items], ["What characterizes Impressionist music?"])
        self.assertEqual(items[0]["key"], PAIRS[4]["answer"])
        self.assertEqual(items[0]["points"], 4)


class FillTests(unittest.TestCase):
    def test_blanks_must_be_words_from_the_stored_answer(self):
        ok = P.check_fill("The term Impressionism came from a painting by [[Claude Monet]].", PAIRS[3]["question"], PAIRS[3]["answer"])
        self.assertEqual(ok["blanks"], ["Claude Monet"])
        self.assertEqual(ok["points"], 1)
        self.assertEqual(ok["parts"], ["The term Impressionism came from a painting by ", {"blank": "Claude Monet"}, "."])
        self.assertIsNone(P.check_fill("The term came from a painting by [[Renoir]].", PAIRS[3]["question"], PAIRS[3]["answer"]))
        self.assertIsNone(P.check_fill("The term came from a painting by [[Monet's]].", PAIRS[3]["question"], PAIRS[3]["answer"]))

    def test_no_new_facts_no_give_away_and_one_or_two_blanks(self):
        q, a = PAIRS[3]["question"], PAIRS[3]["answer"]
        self.assertIsNone(P.check_fill("The term came from a famous 1872 painting by [[Claude Monet]].", q, a))
        self.assertIsNone(P.check_fill("Claude Monet: the term came from a painting by [[Claude Monet]].", q, a))
        self.assertIsNone(P.check_fill("It began as a movement in painting.", q, a))
        self.assertIsNone(P.check_fill("[[It]] [[began]] as a [[movement]] in painting.", q, a))
        two = P.check_fill("The term Impressionism came from a [[painting]] by [[Claude Monet]].", q, a)
        self.assertEqual(two["points"], 2)
        # A blank repeated in the rest of the sentence gives itself away.
        self.assertIsNone(P.check_fill("Impressionism began in [[painting]]; the term came from a painting by Claude Monet.", q, a))

    def test_fill_items_keeps_only_checked_sentences(self):
        indexes = [3, 6]
        items = P.fill_items(PAIRS, indexes, [
            {"id": 0, "sentence": "The term came from a painting by [[Claude Monet]]."},
            {"id": 1, "sentence": "The leading Impressionist composer is [[Ravel]]."},
            {"id": 9, "sentence": "Out of range [[x]]."},
        ])
        self.assertEqual([item["source"] for item in items], [3])


class WrittenItemTests(unittest.TestCase):
    def test_matching_written_from_the_guide_is_checked_like_fill(self):
        q, a = PAIRS[4]["question"], PAIRS[4]["answer"]
        ok = P.check_matching("Impressionist music", "Unresolved dissonances, blurred harmonies, and shimmering orchestral color.", q, a)
        self.assertEqual(ok, {"term": "Impressionist music", "definition": "Unresolved dissonances, blurred harmonies, and shimmering orchestral color"})
        # A fact the question and answer don't state, a definition that names its own term, a term that is too long.
        self.assertIsNone(P.check_matching("Impressionist music", "Dissonances first used by Debussy in 1894.", q, a))
        self.assertIsNone(P.check_matching("Impressionist music", "Impressionist music with blurred harmonies and color.", q, a))
        self.assertIsNone(P.check_matching("The unresolved dissonances of Impressionist music", "Blurred harmonies and shimmering color.", q, a))
        self.assertIsNone(P.check_matching("Impressionist music", "Blurred harmonies.", q, a))

    def test_matching_items_drop_repeats_and_bad_ids(self):
        indexes = P.matching_candidates(PAIRS)
        n = indexes.index(4)
        reply = [{"id": n, "term": "Impressionist music", "definition": "Unresolved dissonances, blurred harmonies, and shimmering orchestral color"},
                 {"id": n, "term": "Impressionist music", "definition": "Blurred harmonies and shimmering orchestral color"},
                 {"id": 99, "term": "x", "definition": "y z w"}, "nonsense", {"id": "a"}]
        items = P.matching_items(PAIRS, indexes, reply)
        self.assertEqual([(item["id"], item["source"], item["term"]) for item in items], [("am4", 4, "Impressionist music")])
        self.assertNotIn(0, [item["source"] for item in items])

    def test_matching_candidates_leave_out_ready_terms_and_one_word_answers(self):
        ready = {item["source"] for item in P.matching(PAIRS)}
        candidates = P.matching_candidates(PAIRS)
        self.assertFalse(ready & set(candidates))
        self.assertNotIn(6, candidates)  # "Debussy." has nothing to define

    def test_short_answer_written_keeps_the_stored_answer_as_its_key(self):
        indexes = P.short_candidates(PAIRS)
        self.assertNotIn(4, indexes)  # already a ready short-answer question
        n = indexes.index(3)
        items = P.short_items(PAIRS, indexes, [
            {"id": n, "question": "Why did Impressionism begin as a movement in painting?", "key": "The model's own answer"},
            {"id": indexes.index(0), "question": "Why did Liszt invent the Lied in 1814?"},
            {"id": indexes.index(1), "question": "What is program music?"},
        ])
        self.assertEqual([(item["id"], item["source"]) for item in items], [("as3", 3)])
        self.assertEqual(items[0]["key"], PAIRS[3]["answer"])
        self.assertEqual(items[0]["points"], 4)


DISCIPLINES = {
    "nursing": ("How does hand hygiene reduce hospital infections?",
                "Hand hygiene removes the microorganisms on a nurse's hands, so they cannot spread between patients and cause infections.",
                ["Explain how hand hygiene reduces the spread of infections between patients.",
                 "Describe the role hand hygiene plays in how microorganisms spread between patients.",
                 "Compare the effect of hand hygiene on microorganisms and on infections.",
                 "Discuss why hand hygiene is needed to reduce infections between patients.",
                 "In what ways does hand hygiene affect the spread of infections?",
                 "Why can microorganisms on a nurse's hands cause infections between patients?",
                 "How does hand hygiene reduce infections between patients?"]),
    "art history": ("Why did Impressionist painters work outdoors?",
                    "They wanted to capture changing light and atmosphere directly, so they painted outdoors in a single sitting rather than in a studio.",
                    ["Explain why Impressionist painters wanted to capture changing light.",
                     "Describe the role of changing light and atmosphere for painters who painted outdoors.",
                     "Compare painting outdoors in a single sitting with painting in a studio.",
                     "How did the need to capture light affect where painters worked?",
                     "In what ways did painting outdoors affect Impressionist painters?",
                     "Discuss why painters painted outdoors in a single sitting rather than in a studio.",
                     "Why did Impressionist painters paint outdoors?"]),
    "business law": ("What is consideration in a contract?",
                     "Consideration is something of value that each party exchanges, and without it a promise is generally not an enforceable contract.",
                     ["Why is consideration needed for a promise to be an enforceable contract?",
                      "Explain what each party exchanges as consideration in a contract.",
                      "Describe why a promise without consideration is not an enforceable contract.",
                      "Compare a promise with consideration to a promise without it in a contract.",
                      "Discuss how consideration affects whether a promise is enforceable.",
                      "In what ways does consideration give a promise value in a contract?",
                      "How does consideration make a promise an enforceable contract?"]),
    "literature": ("How does Orwell use Napoleon to show the corruption of power in Animal Farm?",
                   "Napoleon gradually adopts the habits of the farmers he drove out, which shows how absolute power corrupts those who hold it.",
                   ["Explain how Napoleon adopts the habits of the farmers in Animal Farm.",
                    "Describe how absolute power corrupts Napoleon in Animal Farm.",
                    "Compare Napoleon with the farmers he drove out.",
                    "Discuss why Napoleon's habits show how power corrupts.",
                    "Why does Orwell show power corrupting those who hold it?",
                    "In what ways does Napoleon affect the habits of the farm?",
                    "How does Orwell use Napoleon to show the corruption of power?"]),
    "computer science": ("What is recursion and why does it need a base case?",
                         "Recursion is when a function calls itself; it needs a base case so the calls eventually stop instead of continuing forever.",
                         ["Explain why a recursive function needs a base case.",
                          "Describe what happens when a function calls itself without a base case.",
                          "Compare a function that calls itself with a base case.",
                          "Discuss how the base case affects when the calls stop.",
                          "How does the base case stop the calls from continuing forever?",
                          "Why does recursion need a base case?",
                          "In what ways does a base case change when a function calls itself?"]),
}


class WrittenShortQuestionTests(unittest.TestCase):
    def test_every_opening_the_prompt_allows_passes_in_every_discipline(self):
        openings = ("Why", "How", "Explain", "Describe", "Compare", "Discuss", "In what ways")
        for name, (question, answer, written) in DISCIPLINES.items():
            seen = {next(word for word in openings if text.startswith(word)) for text in written}
            self.assertEqual(seen, set(openings), name)
            for text in written:
                self.assertEqual(P.check_short(text, question, answer), text, f"{name}: {text}")

    def test_plain_question_words_are_not_new_facts(self):
        q, a = DISCIPLINES["business law"][:2]
        self.assertIsNotNone(P.check_short("Why is consideration needed for a promise?", q, a))
        self.assertIsNotNone(P.check_short("In what ways does consideration affect a promise?", q, a))
        q, a = DISCIPLINES["art history"][:2]
        self.assertIsNotNone(P.check_short("Explain the role of changing light for painters.", q, a))

    def test_a_name_date_or_term_the_guide_never_gave_is_still_refused(self):
        refused = [
            ("literature", "Explain how Napoleon corrupted Snowball."),
            ("art history", "Why did Monet paint outdoors in 1872?"),
            ("business law", "Describe the role of the Statute of Frauds in a contract."),
            ("nursing", "Explain why hand hygiene stops MRSA."),
            ("computer science", "Discuss how recursion differs from a for loop."),
        ]
        for name, text in refused:
            question, answer, _ = DISCIPLINES[name]
            self.assertIsNone(P.check_short(text, question, answer), text)

    def test_a_question_that_does_not_open_with_an_explain_word_is_refused(self):
        q, a = DISCIPLINES["computer science"][:2]
        self.assertIsNone(P.check_short("What is recursion?", q, a))
        self.assertIsNone(P.check_short("Name the base case.", q, a))
        self.assertIsNone(P.check_short("Why " + "recursion needs a base case " * 12, q, a))


class RelatedWordFormTests(unittest.TestCase):
    def test_a_definition_using_another_form_of_its_term_is_refused(self):
        q, a = DISCIPLINES["computer science"][:2]
        self.assertIsNone(P.check_matching("Recursion", "A recursive function that calls itself until a base case.", q, a))
        self.assertIsNone(P.check_matching("Recursion", "When a function calls itself, recursing until the base case.", q, a))
        ok = P.check_matching("Recursion", "A function that calls itself so the calls eventually stop.", q, a)
        self.assertEqual(ok["term"], "Recursion")
        q, a = DISCIPLINES["business law"][:2]
        self.assertIsNone(P.check_matching("Enforceable contract", "A contract a court will enforce, with something of value exchanged.", q, a))

    def test_one_shared_word_of_a_longer_term_is_allowed(self):
        pairs = [{"question": "What is a binary search tree?", "answer": "A binary search tree is a structure where each node keeps smaller values to its left and larger values to its right."}]
        self.assertEqual(P.matching(pairs)[0]["term"], "Binary search tree")
        self.assertIsNotNone(P.check_matching("Binary search tree", "A structure where each node keeps smaller values to its left and larger to its right.", pairs[0]["question"], pairs[0]["answer"]))
        # Half or more of the term's own words, in any form, gives it away.
        self.assertIsNone(P.check_matching("Binary search tree", "A binary structure that searches values and keeps smaller ones left.", pairs[0]["question"], pairs[0]["answer"]))

    def test_ready_terms_use_the_same_rule(self):
        pairs = [{"question": "What is recursion?", "answer": "Recursion is a recursive process where a function calls itself with a smaller input."}]
        self.assertEqual(P.matching(pairs), [])


class LikelyTermTests(unittest.TestCase):
    def test_only_pairs_likely_to_give_a_term_are_candidates(self):
        pairs = [
            {"question": "Is consideration required for every contract?", "answer": "Yes, a promise is generally not enforceable without it."},
            {"question": "What is consideration?", "answer": "Something of value that each party exchanges in a contract."},
            {"question": "Why do courts require consideration, and what happens without it?", "answer": "Courts want proof of a bargained exchange, and without it the promise is generally not enforceable."},
            {"question": "Define the tort of negligence.", "answer": "Failure to take the care a reasonable person would take in the same situation."},
            {"question": "List the elements of a valid contract that a court checks when a party sues over a broken promise.", "answer": "Offer, acceptance, consideration, capacity and legality."},
            {"question": "What is estoppel?", "answer": "Yes."},
        ]
        self.assertEqual(P.matching_candidates(pairs), [3])  # index 1 is already a ready "What is X?" term

    def test_pairs_marked_hidden_keep_their_place_but_are_never_used(self):
        pairs = [dict(pair) for pair in PAIRS]
        pairs[0]["hidden"] = True
        pairs[4]["hidden"] = True
        self.assertNotIn("Lied", [item["term"] for item in P.matching(pairs)])
        self.assertNotIn(4, P.matching_candidates(pairs) + P.short_candidates(pairs) + P.fill_candidates(pairs))
        self.assertEqual(P.short_answer(pairs), [])
        self.assertIn(5, [item["source"] for item in P.matching(pairs)])  # later pairs keep the guide's own index


class PrintRouteTests(unittest.TestCase):
    GUIDE = "\n".join(f"Q{i + 1}: {p['question']}\nA{i + 1}: {p['answer']}" for i, p in enumerate(PAIRS))
    QUIZ = [{"question": "What did Wagner call his operas?", "options": ["Wagner called his operas music dramas.", "Wagner called his operas music pageants.", "Wagner called his operas lyric sketches."], "correct_index": 0}]
    PAIRS = quiz._parse_qa_pairs(GUIDE)

    def _run(self, fill=False, write=(), remaining_quizzes=3, cached=None, limit=False, guide_rows=None):
        query = MagicMock()
        for name in ("select", "eq", "update"):
            getattr(query, name).return_value = query
        rows = [{"title": "Music", "folder_id": None, "study_guide": self.GUIDE, "print_items": cached, "quiz_questions": self.QUIZ}] if guide_rows is None else guide_rows
        query.execute.return_value = SimpleNamespace(data=rows)
        database = MagicMock()
        database.table.return_value = query
        def fill_reply(client, pairs):
            indexes = P.fill_candidates(pairs)
            return P.fill_items(pairs, indexes, [{"id": indexes.index(3), "sentence": "The term came from a painting by [[Claude Monet]]."}])
        def matching_reply(client, pairs):
            indexes = P.matching_candidates(pairs)
            return P.matching_items(pairs, indexes, [{"id": indexes.index(4), "term": "Impressionist music", "definition": "Unresolved dissonances, blurred harmonies, and shimmering orchestral color"}])
        def short_reply(client, pairs):
            indexes = P.short_candidates(pairs)
            return P.short_items(pairs, indexes, [{"id": indexes.index(3), "question": "Why did Impressionism begin as a movement in painting?"}])
        refuse = LimitReached("ai_quiz", 1, 1, "free")
        with patch.object(quiz, "get_user_id", return_value="student-1"), \
             patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "remaining", return_value=remaining_quizzes), \
             patch.object(quiz, "require", side_effect=refuse if limit else None) as require, patch.object(quiz, "record") as record, \
             patch.object(quiz, "get_openai_client", return_value=None), \
             patch.object(quiz, "_print_fill", side_effect=fill_reply) as writer, \
             patch.object(quiz, "_print_matching", side_effect=matching_reply) as matching_writer, \
             patch.object(quiz, "_print_short", side_effect=short_reply) as short_writer:
            result = quiz.printable_items("00000000-0000-4000-8000-000000000001", quiz.PrintRequest(fill=fill, write=list(write)), "Bearer t")
        return SimpleNamespace(result=result, query=query, record=record, require=require, fill=writer, matching=matching_writer, short=short_writer)

    def test_free_types_cost_nothing_and_fill_counts_as_one_ai_quiz(self):
        run = self._run(fill=False)
        self.assertEqual(run.result["mc"][0]["options"][0], "Music dramas")
        self.assertIsNone(run.result["fill"])
        run.fill.assert_not_called()
        run.record.assert_not_called()
        run = self._run(fill=True)
        self.assertEqual(len(run.result["fill"]), 1)
        run.record.assert_called_once_with("student-1", "ai_quiz")
        saved = run.query.update.call_args[0][0]["print_items"]
        self.assertEqual(saved["source"], P.source_hash(self.PAIRS))

    def test_cached_fill_is_reused_for_free(self):
        pairs = self.PAIRS
        cached = {"v": P.VERSION, "source": P.source_hash(pairs), "matching": P.matching(pairs), "short": P.short_answer(pairs),
                  "fill": [{"id": "f3", "source": 3, "parts": [{"blank": "Claude Monet"}], "blanks": ["Claude Monet"], "points": 1}]}
        run = self._run(fill=True, cached=cached)
        self.assertEqual(run.result["fill"], cached["fill"])
        run.fill.assert_not_called()
        run.record.assert_not_called()
        run.query.update.assert_not_called()

    def test_ready_matching_and_short_are_free_and_report_what_the_guide_could_write(self):
        run = self._run()
        result = run.result
        self.assertEqual([item["term"] for item in result["matching"]], [item["term"] for item in P.matching(self.PAIRS)])
        self.assertEqual(len(result["short"]), 1)
        self.assertEqual(result["matching_possible"], len(P.matching_candidates(self.PAIRS)))
        self.assertEqual(result["short_possible"], len(P.short_candidates(self.PAIRS)))
        self.assertTrue(result["can_write"])
        run.matching.assert_not_called()
        run.short.assert_not_called()
        run.record.assert_not_called()

    def test_matching_the_guide_lacks_is_written_and_counts_as_one_ai_quiz(self):
        run = self._run(write=["matching"])
        terms = [item["term"] for item in run.result["matching"]]
        self.assertIn("Impressionist music", terms)
        self.assertEqual(len(terms), len(P.matching(self.PAIRS)) + 1)
        self.assertEqual(run.result["matching_possible"], 0)
        run.short.assert_not_called()
        run.record.assert_called_once_with("student-1", "ai_quiz")
        saved = run.query.update.call_args[0][0]["print_items"]
        self.assertEqual([item["id"] for item in saved["ai_matching"]], ["am4"])

    def test_short_answer_the_guide_lacks_is_written_and_counts_as_one_ai_quiz(self):
        run = self._run(write=["short"])
        questions = [item["question"] for item in run.result["short"]]
        self.assertIn("Why did Impressionism begin as a movement in painting?", questions)
        written = next(item for item in run.result["short"] if item["id"] == "as3")
        self.assertEqual(written["key"], self.PAIRS[3]["answer"])
        self.assertEqual(run.result["short_possible"], 0)
        run.matching.assert_not_called()
        run.record.assert_called_once_with("student-1", "ai_quiz")
        self.assertEqual([item["id"] for item in run.query.update.call_args[0][0]["print_items"]["ai_short"]], ["as3"])

    def test_everything_written_for_one_printout_is_still_one_ai_quiz(self):
        run = self._run(fill=True, write=["matching", "short"])
        self.assertTrue(run.result["fill"] and len(run.result["matching"]) > len(P.matching(self.PAIRS)) and len(run.result["short"]) > 1)
        run.require.assert_called_once_with("student-1", "ai_quiz")
        run.record.assert_called_once_with("student-1", "ai_quiz")

    def test_written_matching_and_short_are_cached_and_reused_for_free(self):
        pairs = self.PAIRS
        cached = {"v": P.VERSION, "source": P.source_hash(pairs), "matching": P.matching(pairs), "short": P.short_answer(pairs),
                  "ai_matching": [{"id": "am4", "source": 4, "term": "Impressionist music", "definition": "Blurred harmonies and shimmering color"}],
                  "ai_short": [{"id": "as3", "source": 3, "question": "Why did Impressionism begin as a movement in painting?", "key": pairs[3]["answer"], "points": 4}]}
        run = self._run(write=["matching", "short"], cached=cached)
        self.assertIn("Impressionist music", [item["term"] for item in run.result["matching"]])
        self.assertEqual(len(run.result["short"]), 2)
        run.matching.assert_not_called()
        run.short.assert_not_called()
        run.record.assert_not_called()
        run.require.assert_not_called()
        run.query.update.assert_not_called()

    def _refused(self, **kwargs):
        """The request is a 402 with the plan's limit details, and neither the model nor the usage count is touched."""
        with patch.object(quiz, "record") as record, patch.object(quiz, "chat") as model, self.assertRaises(LimitReached) as refused:
            self._run(remaining_quizzes=0, limit=True, **kwargs)
        model.assert_not_called()
        record.assert_not_called()
        self.assertEqual(refused.exception.status_code, 402)
        self.assertEqual(refused.exception.detail["code"], "limit_reached")
        self.assertEqual(refused.exception.detail["feature"], "ai_quiz")
        self.assertEqual(refused.exception.detail["upgrade_url"], "/settings?section=subscription")

    def test_no_ai_quizzes_left_refuses_fill_with_a_402_and_no_spend(self):
        self._refused(write=["fill"])
        self._refused(fill=True, write=["matching"])

    def test_old_clients_asking_only_for_fill_get_a_200_with_fill_locked(self):
        """The first printable-quiz clients send `fill` and no `write`: with none left they still get the free items."""
        with patch.object(quiz, "chat") as model:
            run = self._run(fill=True, remaining_quizzes=0)
        model.assert_not_called()
        self.assertTrue(run.result["fill_locked"])
        self.assertIsNone(run.result["fill"])
        self.assertTrue(run.result["mc"])
        self.assertFalse(run.result["can_write"])
        self.assertTrue(run.result["resets_at"])
        run.fill.assert_not_called()
        run.require.assert_not_called()
        run.record.assert_not_called()
        run = self._run(fill=True)
        self.assertFalse(run.result["fill_locked"])
        self.assertEqual(len(run.result["fill"]), 1)
        self.assertIsNone(run.result["resets_at"])

    def test_a_hiccup_reading_the_allowance_says_can_write_and_never_a_500(self):
        with patch.object(quiz, "remaining", side_effect=RuntimeError("supabase down")):
            self.assertTrue(quiz._can_write("student-1"))
        with patch.object(quiz, "remaining", return_value=0):
            self.assertFalse(quiz._can_write("student-1"))

    def test_no_ai_quizzes_left_refuses_matching_with_a_402_and_no_spend(self):
        self._refused(write=["matching"])

    def test_no_ai_quizzes_left_refuses_short_answer_with_a_402_and_no_spend(self):
        self._refused(write=["short"])

    def test_free_request_with_none_left_still_returns_the_ready_items_and_says_it_cannot_write(self):
        run = self._run(remaining_quizzes=0)
        self.assertFalse(run.result["can_write"])
        self.assertTrue(run.result["mc"])
        run.require.assert_not_called()

    def test_a_failed_write_is_not_charged_or_cached(self):
        with patch.object(quiz, "_print_short", return_value=None) as short_writer:
            query = MagicMock()
            for name in ("select", "eq", "update"):
                getattr(query, name).return_value = query
            query.execute.return_value = SimpleNamespace(data=[{"title": "Music", "folder_id": None, "study_guide": self.GUIDE, "print_items": None, "quiz_questions": self.QUIZ}])
            database = MagicMock()
            database.table.return_value = query
            with patch.object(quiz, "get_user_id", return_value="student-1"), patch.object(quiz, "get_supabase", return_value=database), \
                 patch.object(quiz, "remaining", return_value=3), patch.object(quiz, "require"), patch.object(quiz, "record") as record, \
                 patch.object(quiz, "get_openai_client", return_value=None):
                result = quiz.printable_items("00000000-0000-4000-8000-000000000001", quiz.PrintRequest(write=["short"]), "Bearer t")
            short_writer.assert_called_once()
        self.assertEqual(result["write_failed"], ["short"])
        self.assertEqual(len(result["short"]), 1)
        record.assert_not_called()
        self.assertNotIn("ai_short", query.update.call_args[0][0]["print_items"])

    def _run_with_writers(self, **writers):
        query = MagicMock()
        for name in ("select", "eq", "update"):
            getattr(query, name).return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"title": "Music", "folder_id": None, "study_guide": self.GUIDE, "print_items": None, "quiz_questions": self.QUIZ}])
        database = MagicMock()
        database.table.return_value = query
        with patch.object(quiz, "get_user_id", return_value="student-1"), patch.object(quiz, "get_supabase", return_value=database), \
             patch.object(quiz, "remaining", return_value=3), patch.object(quiz, "require"), patch.object(quiz, "record") as record, \
             patch.object(quiz, "get_openai_client", return_value=None), \
             patch.object(quiz, "_print_matching", return_value=writers.get("matching")), patch.object(quiz, "_print_short", return_value=writers.get("short")):
            result = quiz.printable_items("00000000-0000-4000-8000-000000000001", quiz.PrintRequest(write=["matching", "short"]), "Bearer t")
        return SimpleNamespace(result=result, query=query, record=record)

    def test_writing_that_produces_nothing_is_not_charged_or_saved(self):
        run = self._run_with_writers(matching=[], short=[])
        run.record.assert_not_called()
        self.assertEqual(run.result["write_failed"], ["matching", "short"])
        self.assertEqual(run.result["matching_possible"], len(P.matching_candidates(self.PAIRS)))  # it can be tried again
        if run.query.update.called:
            saved = run.query.update.call_args[0][0]["print_items"]
            self.assertNotIn("ai_matching", saved)
            self.assertNotIn("ai_short", saved)

    def test_one_type_that_returns_items_is_one_charge_and_the_empty_one_is_not_saved(self):
        item = {"id": "as3", "source": 3, "question": "Why did Impressionism begin as a movement in painting?", "key": "k", "points": 4}
        run = self._run_with_writers(matching=[], short=[item])
        run.record.assert_called_once_with("student-1", "ai_quiz")
        self.assertEqual(run.result["write_failed"], ["matching"])
        saved = run.query.update.call_args[0][0]["print_items"]
        self.assertEqual(saved["ai_short"], [item])
        self.assertNotIn("ai_matching", saved)

    def test_an_empty_list_cached_by_an_earlier_version_is_tried_again(self):
        pairs = self.PAIRS
        cached = {"v": P.VERSION, "source": P.source_hash(pairs), "matching": P.matching(pairs), "short": P.short_answer(pairs), "ai_matching": []}
        run = self._run(write=["matching"], cached=cached)
        run.matching.assert_called_once()
        run.record.assert_called_once_with("student-1", "ai_quiz")

    def test_a_guide_with_nothing_to_write_does_not_call_the_model_or_charge(self):
        guide = "Q1: Who?\nA1: Debussy.\nQ2: Where?\nA2: Paris."
        rows = [{"title": "Tiny", "folder_id": None, "study_guide": guide, "print_items": None, "quiz_questions": []}]
        with patch.object(quiz, "_load_quiz", return_value=([], True)):
            run = self._run(write=["matching", "short"], guide_rows=rows)
        run.matching.assert_not_called()
        run.short.assert_not_called()
        run.record.assert_not_called()
        run.require.assert_not_called()

    def test_only_the_callers_own_guide_is_read(self):
        with self.assertRaises(quiz.HTTPException) as missing:
            self._run(write=["matching"], guide_rows=[])
        self.assertEqual(missing.exception.status_code, 404)

    def test_unknown_write_types_are_a_validation_error_not_a_server_error(self):
        from pydantic import ValidationError
        with self.assertRaises(ValidationError):
            quiz.PrintRequest(write=["essay"])
        with self.assertRaises(ValidationError):
            quiz.PrintRequest(write=["fill", "matching", "short", "fill"])


if __name__ == "__main__":
    unittest.main()
