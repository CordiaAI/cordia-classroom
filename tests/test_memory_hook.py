"""'Help me remember': a memory hook after a missed question, shaped by the About-you answers."""

import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi import HTTPException
from routers import quiz
from services import llm, retain

GUIDE_ID = "00000000-0000-0000-0000-000000000001"
FOUNDER = {"question": "Who founded ATO?", "options": ["Otis Allan Glazebrook", "x", "y", "z"], "correct_index": 0}


class Rows:
    def __init__(self, rows, broken=False):
        self.rows, self.broken = rows, broken

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def execute(self):
        if self.broken:
            raise RuntimeError("down")
        return SimpleNamespace(data=self.rows)


def database(answers=(), broken=False):
    tables = {"study_guides": Rows([{"quiz_questions": [FOUNDER]}]), "onboarding_answers": Rows(list(answers), broken)}
    db = MagicMock()
    db.table.side_effect = lambda name: tables[name]
    return db


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class MentionsAnswerTests(unittest.TestCase):
    def test_the_hook_must_state_the_answer(self):
        self.assertTrue(retain.mentions_answer("Picture Otis Allan Glazebrook glazing a brook.", "Otis Allan Glazebrook"))
        self.assertTrue(retain.mentions_answer("Mitoses copy the cell.", "Mitosis"))
        self.assertFalse(retain.mentions_answer("Picture someone glazing a brook.", "Otis Allan Glazebrook"))
        self.assertFalse(retain.mentions_answer("It happened just before Christmas.", "December 24, 1776"))
        self.assertTrue(retain.mentions_answer("December 25, 1776: the same day as Christmas.", "December 25, 1776"))
        self.assertFalse(retain.mentions_answer("December 26, 1776", "December 25, 1776"))


class MemoryHookTests(unittest.TestCase):
    def call(self, text, **kwargs):
        chat = MagicMock(return_value=reply(text))
        with patch.object(llm, "get_openai_client", return_value=None), patch.object(llm, "chat", chat):
            result = llm.memory_hook("Who founded ATO?", "Otis Allan Glazebrook", **kwargs)
        return result, chat

    def test_a_good_hook_is_returned_with_the_style_and_interests_in_the_prompt(self):
        hook = "Otis Allan Glazebrook: picture you glazing a brook before kickoff."
        result, chat = self.call('{"hook": "%s"}' % hook, style="funny", interests=["sports"], previous="Old one")
        self.assertEqual(result, {"hook": hook})
        self.assertEqual(chat.call_args.args[1], "retain_remember")
        messages = chat.call_args.kwargs["messages"]
        self.assertIn("funny", messages[0]["content"])
        self.assertIn("INTERESTS: sports", messages[1]["content"])
        self.assertIn("Old one", messages[1]["content"])

    def test_hooks_without_the_answer_or_about_the_student_are_dropped(self):
        self.assertEqual(self.call('{"hook": "Picture someone glazing a brook."}')[0], {})
        self.assertEqual(self.call('{"hook": "The student should picture Otis Allan Glazebrook."}')[0], {})
        self.assertEqual(self.call("not json")[0], {})


class RememberRouteTests(unittest.TestCase):
    def run_route(self, db, hook=None, body=None):
        make = MagicMock(return_value={"hook": hook} if hook else {})
        require, record = MagicMock(), MagicMock()
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=db),
                            memory_hook=make, require=require, record=record):
            try:
                result = quiz.help_me_remember(GUIDE_ID, body or quiz.RememberRequest(concept=0), "Bearer t")
            except HTTPException as error:
                result = error
        return result, make, require, record

    def test_uses_the_newest_answers_and_charges_light(self):
        answers = [
            {"question_id": "interests", "answer": {"value": ["music", "food"]}},
            {"question_id": "memory_style", "answer": {"value": "rhyme"}},
            {"question_id": "memory_style", "answer": {"value": "funny"}},  # older
        ]
        result, make, require, record = self.run_route(database(answers), hook="Glazebrook", body=quiz.RememberRequest(concept=0, previous=" Last "))
        self.assertEqual(result, {"hook": "Glazebrook"})
        self.assertEqual(make.call_args.args, ("Who founded ATO?", "Otis Allan Glazebrook", "rhyme", ["music", "food"], "Last"))
        require.assert_called_once_with("u1", "light")
        record.assert_called_once_with("u1", "light")

    def test_defaults_when_unanswered_skipped_or_unreadable(self):
        for db in (database(), database([{"question_id": "memory_style", "answer": {"skipped": True}}]), database(broken=True)):
            _, make, _, _ = self.run_route(db, hook="Glazebrook")
            self.assertEqual(make.call_args.args[2:4], ("link", []))

    def test_no_hook_is_not_charged(self):
        result, _, require, record = self.run_route(database())
        self.assertIsInstance(result, HTTPException)
        self.assertEqual(result.status_code, 502)
        require.assert_called_once()
        record.assert_not_called()

    def test_unknown_question(self):
        result, make, _, _ = self.run_route(database(), hook="x", body=quiz.RememberRequest(concept=5))
        self.assertEqual(result.status_code, 400)
        make.assert_not_called()

    def test_over_the_cap(self):
        def over(*_):
            raise HTTPException(status_code=402, detail="limit")
        with patch.multiple(quiz, get_user_id=MagicMock(return_value="u1"), get_supabase=MagicMock(return_value=database()),
                            memory_hook=MagicMock(), require=over):
            with self.assertRaises(HTTPException) as caught:
                quiz.help_me_remember(GUIDE_ID, quiz.RememberRequest(concept=0), "Bearer t")
        self.assertEqual(caught.exception.status_code, 402)


if __name__ == "__main__":
    unittest.main()
