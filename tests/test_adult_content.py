import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from fastapi import HTTPException
from routers import learning
from services import adult_content, llm


def database(profile=None, crude=False, fail=False):
    tables = {}

    def table(name):
        query = tables.setdefault(name, MagicMock())
        for method in ("select", "eq", "limit", "update", "upsert"):
            getattr(query, method).return_value = query
        if fail:
            query.execute.side_effect = Exception("column does not exist")
        elif name == "user_profiles":
            query.execute.return_value = SimpleNamespace(data=[profile] if profile is not None else [])
        else:
            query.execute.return_value = SimpleNamespace(data=[{"crude_humor": crude}])
        return query

    db = MagicMock()
    db.table.side_effect = table
    return db, tables


ADULT = {"is_minor": False, "education_level": "university", "adult_confirmed_at": "2026-11-07T10:00:00Z"}


class AdultContentTests(unittest.TestCase):
    def test_crude_humor_needs_a_confirmed_adult_who_turned_it_on(self):
        self.assertTrue(adult_content.crude_allowed(database(ADULT, crude=True)[0], "u1"))
        self.assertFalse(adult_content.crude_allowed(database(ADULT, crude=False)[0], "u1"))
        self.assertFalse(adult_content.crude_allowed(database({**ADULT, "adult_confirmed_at": None}, crude=True)[0], "u1"))

    def test_minors_and_high_school_accounts_are_never_offered_it(self):
        for profile in ({**ADULT, "is_minor": True}, {**ADULT, "education_level": "high_school"}):
            state = adult_content.status(database(profile, crude=True)[0], "u1")
            self.assertEqual(state, {"can_confirm": False, "adult_confirmed": False, "crude_humor": False})

    def test_unreadable_profiles_count_as_not_allowed(self):
        self.assertEqual(adult_content.status(database(fail=True)[0], "u1"), {"can_confirm": False, "adult_confirmed": False, "crude_humor": False})

    def test_routes_refuse_what_the_account_may_not_do(self):
        db, _ = database({**ADULT, "education_level": "high_school"})
        with patch.object(learning, "get_user_id", return_value="u1"), patch.object(learning, "get_supabase", return_value=db):
            with self.assertRaises(HTTPException) as caught:
                learning.confirm_age(learning.AgeConfirmation(adult=True), "Bearer t")
            self.assertEqual(caught.exception.status_code, 403)
        db, _ = database({**ADULT, "adult_confirmed_at": None})
        with patch.object(learning, "get_user_id", return_value="u1"), patch.object(learning, "get_supabase", return_value=db):
            with self.assertRaises(HTTPException):
                learning.set_memory_trick_settings(learning.MemoryTrickSettings(crude_humor=True), "Bearer t")

    def test_taking_back_the_confirmation_turns_crude_humor_off(self):
        db, tables = database(ADULT, crude=True)
        with patch.object(learning, "get_user_id", return_value="u1"), patch.object(learning, "get_supabase", return_value=db):
            learning.confirm_age(learning.AgeConfirmation(adult=False), "Bearer t")
        self.assertEqual(tables["user_profiles"].update.call_args[0][0], {"adult_confirmed_at": None})
        self.assertIs(tables["learning_preferences"].upsert.call_args[0][0]["crude_humor"], False)

    def test_the_crude_rule_reaches_the_prompt_only_when_allowed(self):
        sent = {}

        def fake_chat(client, feature, messages, **kwargs):
            sent[feature] = messages[0]["content"]
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"hook": "You CUMberland it: 1867."}'))])

        with patch.object(llm, "chat", side_effect=fake_chat), patch.object(llm, "get_openai_client"):
            llm.memory_hook("When was the Cumberland Road finished?", "1867", crude=True)
            self.assertIn(llm.CRUDE_HUMOR_RULE, sent["retain_remember"])
            llm.memory_hook("When was the Cumberland Road finished?", "1867")
            self.assertNotIn(llm.CRUDE_HUMOR_RULE, sent["retain_remember"])
            self.assertIn("never mocking, crude", sent["retain_remember"])


if __name__ == "__main__":
    unittest.main()
