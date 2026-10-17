import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from supabase_auth.errors import AuthApiError, AuthRetryableError

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

import auth_utils  # noqa: E402


class TokenCheckErrorTests(unittest.TestCase):
    """Only a token Supabase rejects is a 401; an outage must not sign students out."""

    def verify(self, error):
        client = MagicMock()
        client.auth.get_user.side_effect = error
        with patch.object(auth_utils, "_verify_locally", return_value=None), \
             patch.object(auth_utils, "get_auth_supabase", return_value=client):
            return auth_utils.get_user_id("Bearer legacy-token")

    def test_rejected_token_is_401(self):
        with self.assertRaises(HTTPException) as caught:
            self.verify(AuthApiError("invalid JWT", 403, "bad_jwt"))
        self.assertEqual(caught.exception.status_code, 401)

    def test_outage_is_not_reported_as_a_bad_token(self):
        with self.assertRaises(AuthRetryableError):
            self.verify(AuthRetryableError("connection refused", 0))


if __name__ == "__main__":
    unittest.main()
