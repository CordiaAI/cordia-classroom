import os
import sys
import time
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import auth_utils

URL = "https://project.supabase.co"


class LocalJwtAuthTests(unittest.TestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        signing_key = MagicMock(key=self.key.public_key())
        jwks = MagicMock()
        jwks.get_signing_key_from_jwt.return_value = signing_key
        self.patches = [
            patch.dict(os.environ, {"SUPABASE_URL": URL}),
            patch.object(auth_utils, "_get_jwks_client", return_value=jwks),
            patch.object(auth_utils, "get_auth_supabase", side_effect=AssertionError("network call")),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def token(self, key=None, **claims):
        payload = {"sub": "student-1", "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 600}
        payload.update(claims)
        return jwt.encode(payload, key or self.key, algorithm="ES256")

    def test_valid_token_is_verified_without_calling_supabase(self):
        self.assertEqual(auth_utils.get_user_id("Bearer " + self.token()), "student-1")

    def test_expired_token_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            auth_utils.get_user_id("Bearer " + self.token(exp=int(time.time()) - 10))
        self.assertEqual(ctx.exception.status_code, 401)

    def test_token_signed_by_another_key_is_rejected(self):
        forged = self.token(key=ec.generate_private_key(ec.SECP256R1()))
        with self.assertRaises(HTTPException):
            auth_utils.get_user_id("Bearer " + forged)

    def test_token_from_another_project_is_rejected(self):
        with self.assertRaises(HTTPException):
            auth_utils.get_user_id("Bearer " + self.token(iss="https://other.supabase.co/auth/v1"))

    def test_legacy_hs256_token_falls_back_to_supabase(self):
        legacy = jwt.encode({"sub": "student-2"}, "secret-long-enough-for-hmac-sha256-keys", algorithm="HS256")
        client = MagicMock()
        client.auth.get_user.return_value = MagicMock(user=MagicMock(id="student-2"))
        with patch.object(auth_utils, "get_auth_supabase", return_value=client):
            self.assertEqual(auth_utils.get_user_id("Bearer " + legacy), "student-2")

    def test_unavailable_signing_keys_fall_back_to_supabase(self):
        jwks = MagicMock()
        jwks.get_signing_key_from_jwt.side_effect = jwt.PyJWKClientError("down")
        client = MagicMock()
        client.auth.get_user.return_value = MagicMock(user=MagicMock(id="student-1"))
        with patch.object(auth_utils, "_get_jwks_client", return_value=jwks), \
             patch.object(auth_utils, "get_auth_supabase", return_value=client):
            self.assertEqual(auth_utils.get_user_id("Bearer " + self.token()), "student-1")


if __name__ == "__main__":
    unittest.main()
