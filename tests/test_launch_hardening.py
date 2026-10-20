"""Launch hardening: real client IP behind Fly, body size cap, folder ownership, retain key."""
import os
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

import rate_limit  # noqa: E402
from main import app  # noqa: E402
from routers import guides  # noqa: E402
from services import retain  # noqa: E402


class LaunchHardeningTests(unittest.TestCase):
    def test_rate_limits_key_on_the_fly_client_ip(self):
        request = MagicMock()
        request.headers = {"fly-client-ip": "203.0.113.9"}
        request.client.host = "172.16.0.2"
        self.assertEqual(rate_limit.client_ip(request), "203.0.113.9")
        request.headers = {}
        self.assertEqual(rate_limit.client_ip(request), "172.16.0.2")

    def test_oversized_json_body_is_refused_before_reading(self):
        response = TestClient(app).post("/guides", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": str(9 * 1024 * 1024)})
        self.assertEqual(response.status_code, 413)

    def test_guides_can_only_be_filed_in_your_own_class(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        with self.assertRaises(HTTPException) as caught:
            guides.require_own_folder(db, "u1", "a0000000-0000-4000-8000-000000000001")
        self.assertEqual(caught.exception.status_code, 404)
        guides.require_own_folder(db, "u1", None)  # no class: nothing to check

    def test_retain_signing_refuses_an_empty_key(self):
        keys = ("RETAIN_SIGNING_KEY", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY")
        with patch.dict(os.environ, {k: "" for k in keys}):
            with self.assertRaises(RuntimeError):
                retain.sign_grade("u1", "g1", 0, 1.0)
        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "service"}):
            self.assertEqual(len(retain.sign_grade("u1", "g1", 0, 1.0)), 64)


if __name__ == "__main__":
    unittest.main()
