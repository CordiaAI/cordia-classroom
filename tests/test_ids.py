import os
import sys
import unittest

from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from ids import is_uuid, require_uuid  # noqa: E402

ID = "3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c"


class IdTests(unittest.TestCase):
    def test_accepts_supabase_ids_in_either_case(self):
        self.assertTrue(is_uuid(ID))
        self.assertTrue(is_uuid(ID.upper()))

    def test_rejects_anything_else(self):
        for value in (None, "", "guide-1", ID + "x", " " + ID, ID.replace("-", ""), 42):
            with self.subTest(value=value):
                self.assertFalse(is_uuid(value))

    def test_require_names_the_bad_field(self):
        self.assertEqual(require_uuid(ID, "guide ID"), ID)
        with self.assertRaises(HTTPException) as caught:
            require_uuid("nope", "guide ID")
        self.assertEqual((caught.exception.status_code, caught.exception.detail), (400, "Invalid guide ID"))


if __name__ == "__main__":
    unittest.main()
