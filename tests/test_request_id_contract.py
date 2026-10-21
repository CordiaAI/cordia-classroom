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

    def test_server_errors_reach_the_browser(self):
        @app.get("/__test_crash")
        def crash():
            raise RuntimeError("boom")

        origin = "https://classroom.cordiaai.io"
        response = TestClient(app, raise_server_exceptions=False).get("/__test_crash", headers={"Origin": origin})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        too_big = self.client.post("/generate", headers={"Origin": origin, "Content-Length": str(9 * 1024 * 1024)}, content=b"")
        self.assertEqual(too_big.status_code, 413)
        self.assertEqual(too_big.headers["access-control-allow-origin"], origin)

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
