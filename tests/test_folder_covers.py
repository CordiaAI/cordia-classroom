import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from routers import folders

FOLDER = "11111111-1111-4111-8111-111111111111"


def database_returning(data):
    query = MagicMock()
    query.update.return_value = query
    query.eq.return_value = query
    query.execute.return_value = MagicMock(data=data)
    database = MagicMock()
    database.table.return_value = query
    return database, query


class FolderCoverTests(unittest.TestCase):
    def test_saves_a_designed_cover_on_the_students_own_class(self):
        database, query = database_returning([{"id": FOLDER, "cover": {}}])
        with patch.object(folders, "get_user_id", return_value="user-1"), patch.object(folders, "get_supabase", return_value=database):
            folders.set_folder_cover(FOLDER, folders.FolderCoverRequest(color=3, icons=["Music", "Piano", "Music"]), "Bearer t")
        self.assertEqual(query.update.call_args.args[0]["cover"], {"kind": "design", "color": 3, "icons": ["Music", "Piano"]})
        self.assertEqual([call.args for call in query.eq.call_args_list], [("id", FOLDER), ("user_id", "user-1")])

    def test_only_icon_names_and_a_known_colour(self):
        from pydantic import ValidationError
        for bad in ({"color": 9, "icons": ["Music"]}, {"icons": []}, {"icons": ["<svg onload=x>"]}, {"icons": ["a", "b", "c", "d"]}, {"kind": "image", "icons": ["Music"]}):
            with self.assertRaises(ValidationError):
                folders.FolderCoverRequest(**bad)

    def test_another_students_class_is_not_found(self):
        database, _ = database_returning([])
        with patch.object(folders, "get_user_id", return_value="user-2"), patch.object(folders, "get_supabase", return_value=database):
            with self.assertRaises(HTTPException) as caught:
                folders.remove_folder_cover(FOLDER, "Bearer t")
        self.assertEqual(caught.exception.status_code, 404)

    def test_missing_column_says_the_database_needs_updating(self):
        database, query = database_returning([])
        query.execute.side_effect = Exception("column folders.cover does not exist")
        with patch.object(folders, "get_user_id", return_value="user-1"), patch.object(folders, "get_supabase", return_value=database):
            with self.assertRaises(HTTPException) as caught:
                folders.remove_folder_cover(FOLDER, "Bearer t")
        self.assertEqual(caught.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
