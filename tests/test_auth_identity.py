import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import auth


class AuthIdentityTests(unittest.TestCase):
    def test_me_returns_google_display_name(self):
        user = SimpleNamespace(
            id="user-1",
            email="student@example.com",
            user_metadata={"full_name": "Student Name"},
        )
        auth_client = MagicMock()
        auth_client.auth.get_user.return_value = SimpleNamespace(user=user)

        no_age_column = MagicMock(side_effect=Exception("column user_profiles.birth_month does not exist"))
        with patch.object(auth, "get_auth_supabase", return_value=auth_client), patch.object(auth, "get_supabase", no_age_column):
            identity = auth.get_current_user("Bearer valid-token")

        self.assertEqual(identity, {
            "user_id": "user-1",
            "email": "student@example.com",
            "name": "Student Name",
            "age_needed": False,  # before the Stage 9 migration there's nowhere to keep an age
        })

    def test_me_falls_back_to_saved_profile_name(self):
        user = SimpleNamespace(
            id="user-2",
            email="password@example.com",
            user_metadata={},
        )
        auth_client = MagicMock()
        auth_client.auth.get_user.return_value = SimpleNamespace(user=user)
        query = MagicMock()
        query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"name": "Password Student"}
        ]
        database = MagicMock()
        database.table.return_value = query

        with (
            patch.object(auth, "get_auth_supabase", return_value=auth_client),
            patch.object(auth, "get_supabase", return_value=database),
        ):
            identity = auth.get_current_user("Bearer valid-token")

        self.assertEqual(identity["name"], "Password Student")


if __name__ == "__main__":
    unittest.main()
