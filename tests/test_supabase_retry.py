import os
import sys
import unittest

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

import database
from database import RetryOnceTransport


class FlakyTransport(httpx.BaseTransport):
    def __init__(self, error):
        self.error = error
        self.calls = 0

    def handle_request(self, request):
        self.calls += 1
        if self.calls == 1:
            raise self.error("Server disconnected", request=request)
        return httpx.Response(200, json={"ok": True}, request=request)


def client_with(error):
    inner = FlakyTransport(error)
    return httpx.Client(transport=RetryOnceTransport(inner), base_url="https://db.example"), inner


class SupabaseRetryTests(unittest.TestCase):
    def test_read_retries_after_stale_connection(self):
        client, inner = client_with(httpx.RemoteProtocolError)
        self.assertEqual(client.get("/rest/v1/study_guides").json(), {"ok": True})
        self.assertEqual(inner.calls, 2)

    def test_insert_is_not_repeated_after_mid_request_drop(self):
        client, inner = client_with(httpx.RemoteProtocolError)
        with self.assertRaises(httpx.RemoteProtocolError):
            client.post("/rest/v1/study_sessions", json={"x": 1})
        self.assertEqual(inner.calls, 1)

    def test_insert_retries_when_connection_never_opened(self):
        client, inner = client_with(httpx.ConnectError)
        self.assertEqual(client.post("/rest/v1/study_sessions", json={"x": 1}).status_code, 200)
        self.assertEqual(inner.calls, 2)

    def test_real_client_gets_the_retry_transport(self):
        original = database._supabase_client
        os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
        os.environ.setdefault("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x")
        try:
            database._supabase_client = None
            session = database.get_supabase().postgrest.session
            self.assertIsInstance(session._transport, RetryOnceTransport)
            self.assertTrue(all(t is None or isinstance(t, RetryOnceTransport) for t in session._mounts.values()))
        finally:
            database._supabase_client = original


if __name__ == "__main__":
    unittest.main()
