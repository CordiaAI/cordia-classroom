import os
import sys
import unittest
import asyncio
import json
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.requests import Request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

from main import add_security_headers, app


class RequestIdContractTests(unittest.TestCase):
    client = TestClient(app)

    def test_every_response_has_a_unique_support_reference(self):
        first = self.client.get("/")
        second = self.client.get("/")

        self.assertEqual(first.status_code, 200)
        self.assertRegex(first.headers["X-Request-ID"], r"^[0-9a-f]{12}$")
        self.assertNotEqual(first.headers["X-Request-ID"], second.headers["X-Request-ID"])

    def test_browser_can_read_support_reference(self):
        response = self.client.get("/", headers={"Origin": "https://classroom.cordiacode.com"})

        self.assertIn("X-Request-ID", response.headers["access-control-expose-headers"])

    def test_both_classroom_domains_pass_cors_preflight(self):
        for origin in ("https://classroom.cordiaai.io", "https://classroom.cordiacode.com"):
            with self.subTest(origin=origin):
                response = self.client.options("/", headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                })
                self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_unhandled_error_is_logged_without_exposing_internals(self):
        request = Request({"type": "http", "method": "GET", "path": "/private", "headers": []})

        async def fail(_request):
            raise RuntimeError("private database detail")

        with patch("main.logger.exception") as logged:
            response = asyncio.run(add_security_headers(request, fail))

        self.assertEqual(response.status_code, 500)
        self.assertEqual(json.loads(response.body), {"detail": "Unexpected server error"})
        self.assertEqual(logged.call_args.args[1], response.headers["X-Request-ID"])


if __name__ == "__main__":
    unittest.main()
