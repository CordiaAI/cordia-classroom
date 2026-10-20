"""Token rules: allowlist, host check, encryption, and no token in logs."""
import base64
import io
import logging
import os
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["CANVAS_TOKEN_KEY"] = base64.b64encode(b"k" * 32).decode()

from services import canvas_client as cc  # noqa: E402
from services import log_scrub  # noqa: E402

TOKEN = "7~" + "Ab3" * 21 + "x"


class AllowlistTests(unittest.TestCase):
    ALLOWED = [
        ("/api/v1/users/self", []),
        ("/api/v1/courses", [("enrollment_state", "active"), ("include[]", "term"), ("per_page", "100")]),
        ("/api/v1/courses/12", [("include[]", "syllabus_body"), ("include[]", "term")]),
        ("/api/v1/courses/12/assignments", [("per_page", "100"), ("page", "2")]),
        ("/api/v1/courses/12/modules", [("include[]", "items")]),
        ("/api/v1/calendar_events", [("type", "assignment"), ("context_codes[]", "course_12"), ("start_date", "2026-01-01")]),
        ("/api/v1/courses/12/files", []),
        ("/api/v1/courses/12/files/99", []),
        ("/files/99/download", [("download_frd", "1")]),
    ]

    def test_every_allowed_read_passes(self):
        for path, query in self.ALLOWED:
            cc.check_request("GET", path, query)

    def test_every_write_method_is_rejected_even_on_allowed_paths(self):
        for method in ("POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            for path, query in self.ALLOWED:
                with self.assertRaises(cc.CanvasForbiddenRequest, msg=f"{method} {path}"):
                    cc.check_request(method, path, query)

    def test_forbidden_paths_are_rejected(self):
        for path in [
            "/api/v1/courses/12/assignments/5/submissions", "/api/v1/courses/12/students/submissions",
            "/api/v1/conversations", "/api/v1/conversations/1", "/api/v1/courses/12/enrollments", "/api/v1/users/self/enrollments",
            "/api/v1/courses/12/users", "/api/v1/courses/12/students", "/api/v1/courses/12/sections/1/users",
            "/api/v1/courses/12/discussion_topics", "/api/v1/courses/12/gradebook_history/days", "/api/v1/accounts/1/users",
            "/api/v1/users/5", "/api/v1/users/self/profile", "/api/v1/courses/12/analytics/student_summaries",
            "/api/v1/courses/12/quizzes", "/api/v1/courses/12/pages", "/api/v1/courses/12/files/99/../../users",
            "/api/v1/courses/abc", "/api/v1/courses/12/assignments/5", "/login/oauth2/token", "/",
        ]:
            with self.assertRaises(cc.CanvasForbiddenRequest, msg=path):
                cc.check_request("GET", path, [])

    def test_forbidden_parameters_are_rejected(self):
        bad = [
            ("/api/v1/courses", []),  # enrollment_state=active is required
            ("/api/v1/courses", [("enrollment_state", "completed")]),
            ("/api/v1/courses", [("enrollment_state", "active"), ("include[]", "total_scores")]),
            ("/api/v1/courses/12", [("include[]", "students")]),
            ("/api/v1/courses/12/assignments", [("include[]", "submission")]),
            ("/api/v1/courses/12/modules", [("include[]", "content_details")]),
            ("/api/v1/calendar_events", [("context_codes[]", "group_3")]),
            ("/api/v1/users/self", [("as_user_id", "5")]),
        ]
        for path, query in bad:
            with self.assertRaises(cc.CanvasForbiddenRequest, msg=f"{path} {query}"):
                cc.check_request("GET", path, query)


class HostTests(unittest.TestCase):
    def test_bad_hosts_are_rejected(self):
        for value in [
            "http://school.instructure.com", "https://127.0.0.1", "https://10.0.0.5", "https://[::1]", "https://169.254.169.254",
            "2130706433", "localhost", "https://localhost", "https://canvas.localhost", "https://school.instructure.com:8443",
            "https://user:pass@school.instructure.com", "https://instructure.com", "https://evil.com",
            "https://school.instructure.com.evil.com", "https://evilinstructure.com", "ftp://school.instructure.com", "",
            "https://metadata.google.internal",
        ]:
            with self.assertRaises(cc.CanvasForbiddenRequest, msg=value):
                cc.check_host(value, [], resolve=lambda _h: True)

    def test_allowed_hosts(self):
        self.assertEqual(cc.check_host("School.Instructure.com", [], resolve=lambda _h: True), "school.instructure.com")
        self.assertEqual(cc.check_host("https://canvas.example.edu/", ["canvas.example.edu"], resolve=lambda _h: True), "canvas.example.edu")

    def test_school_domain_that_aliases_instructure_is_allowed(self):
        alias = {"usaonline.southalabama.edu": "southalabama-vanity.instructure.com"}.get
        self.assertEqual(cc.check_host("usaonline.southalabama.edu", [], resolve=lambda _h: True, canonical=lambda h: alias(h, "")), "usaonline.southalabama.edu")
        for name in ("evil.example.edu", "instructure.com.evil.example", ""):
            with self.assertRaises(cc.CanvasForbiddenRequest, msg=name):
                cc.check_host("canvas.example.edu", [], resolve=lambda _h: True, canonical=lambda _h, n=name: n)
        with self.assertRaises(cc.CanvasForbiddenRequest):  # an alias still has to resolve to public addresses
            cc.check_host("usaonline.southalabama.edu", [], resolve=lambda _h: False, canonical=lambda h: alias(h, ""))

    def test_private_dns_answer_is_rejected(self):
        with self.assertRaises(cc.CanvasForbiddenRequest):
            cc.check_host("school.instructure.com", [], resolve=lambda _h: False)

    def test_redirect_to_another_host_is_refused(self):
        response = MagicMock(status_code=302, is_redirect=True, ok=False, headers={"location": "https://evil.com/steal"}, text="")
        http = MagicMock()
        http.request.return_value = response
        client = cc.CanvasClient("school.instructure.com", TOKEN, http=http, resolve=lambda _h: True)
        with self.assertRaises(cc.CanvasForbiddenRequest):
            client.me()

    def test_client_cannot_be_used_for_writes(self):
        http = MagicMock()
        client = cc.CanvasClient("school.instructure.com", TOKEN, http=http, resolve=lambda _h: True)
        with self.assertRaises(cc.CanvasForbiddenRequest):
            client._get("/api/v1/conversations")
        http.request.assert_not_called()
        self.assertFalse(any(hasattr(client, name) for name in ("post", "put", "delete", "patch")))

    def test_rate_limit_header_backs_off(self):
        response = MagicMock(status_code=200, is_redirect=False, ok=True, headers={"X-Rate-Limit-Remaining": "20"}, text="")
        response.json.return_value = {"id": 1}
        http = MagicMock()
        http.request.return_value = response
        slept = []
        cc.CanvasClient("school.instructure.com", TOKEN, http=http, sleep=slept.append, resolve=lambda _h: True).me()
        self.assertTrue(slept and slept[0] > 0)


class PinnedConnectionTests(unittest.TestCase):
    """The client connects only to an address that passed the public check (no DNS rebinding)."""

    def _request(self, url):
        import requests
        return requests.Request("GET", url).prepare()

    def test_connects_to_the_checked_address_with_tls_on_the_name(self):
        adapter = cc._PinnedAdapter("school.instructure.com", "203.0.113.10")
        host_params, pool_kwargs = adapter.build_connection_pool_key_attributes(self._request("https://school.instructure.com/api/v1/users/self"), True)
        self.assertEqual(host_params["host"], "203.0.113.10")
        self.assertEqual(pool_kwargs["server_hostname"], "school.instructure.com")
        self.assertEqual(pool_kwargs["assert_hostname"], "school.instructure.com")

    def test_other_hosts_are_refused(self):
        adapter = cc._PinnedAdapter("school.instructure.com", "203.0.113.10")
        with self.assertRaises(cc.CanvasForbiddenRequest):
            adapter.build_connection_pool_key_attributes(self._request("https://evil.example/x"), True)

    def test_host_header_is_the_canvas_name(self):
        adapter = cc._PinnedAdapter("school.instructure.com", "203.0.113.10")
        request = self._request("https://school.instructure.com/api/v1/users/self")
        with patch.object(cc.HTTPAdapter, "send", return_value="sent") as sent:
            self.assertEqual(adapter.send(request), "sent")
        self.assertEqual(sent.call_args[0][0].headers["Host"], "school.instructure.com")

    def test_private_or_mixed_addresses_are_never_pinned(self):
        def infos(*addresses):
            return [(None, None, None, "", (a, 443)) for a in addresses]
        with patch.object(cc.socket, "getaddrinfo", return_value=infos("10.0.0.5")):
            self.assertEqual(cc._public_addresses("school.instructure.com"), [])
            with self.assertRaises(cc.CanvasForbiddenRequest):
                cc.pinned_session("school.instructure.com")
        with patch.object(cc.socket, "getaddrinfo", return_value=infos("93.184.215.14", "127.0.0.1")):
            self.assertEqual(cc._public_addresses("school.instructure.com"), [])
        with patch.object(cc.socket, "getaddrinfo", return_value=infos("93.184.215.14")):
            session = cc.pinned_session("school.instructure.com")
            adapter = session.get_adapter("https://school.instructure.com/api/v1/users/self")
            self.assertIsInstance(adapter, cc._PinnedAdapter)
            self.assertEqual(adapter._address, "93.184.215.14")


class CryptoTests(unittest.TestCase):
    def test_round_trip_unique_iv_and_binding(self):
        c1, iv1 = cc.encrypt_token(TOKEN, "user-1")
        c2, iv2 = cc.encrypt_token(TOKEN, "user-1")
        self.assertNotEqual(iv1, iv2)
        self.assertEqual(len(iv1), 12)
        self.assertNotIn(TOKEN.encode(), c1)
        row = {"ciphertext": cc.to_bytea(c1), "iv": cc.to_bytea(iv1)}
        client = cc.CanvasClient.from_store("user-1", row, "school.instructure.com", http=MagicMock(), resolve=lambda _h: True)
        self.assertEqual(client._CanvasClient__token, TOKEN)
        with self.assertRaises(Exception):  # bound to the user id
            cc._decrypt_token(c1, iv1, "user-2")
        with self.assertRaises(Exception):  # tampering is detected
            cc._decrypt_token(bytes([c1[0] ^ 1]) + c1[1:], iv1, "user-1")

    def test_missing_key_refuses(self):
        saved = os.environ.pop("CANVAS_TOKEN_KEY")
        try:
            with self.assertRaises(cc.CanvasError):
                cc.encrypt_token(TOKEN, "u")
        finally:
            os.environ["CANVAS_TOKEN_KEY"] = saved

    def test_only_canvas_client_decrypts(self):
        offenders = []
        for path in (ROOT / "backend").rglob("*.py"):
            if path.name == "canvas_client.py":
                continue
            text = path.read_text()
            if "_decrypt_token" in text or "AESGCM" in text or "CANVAS_TOKEN_KEY" in text:
                offenders.append(str(path))
        self.assertEqual(offenders, [])

    def test_repr_hides_token(self):
        client = cc.CanvasClient("school.instructure.com", TOKEN, http=MagicMock(), resolve=lambda _h: True)
        self.assertNotIn(TOKEN, repr(client))
        self.assertNotIn(TOKEN, str(vars(client).get("_log")))


class LogScrubTests(unittest.TestCase):
    def test_no_token_in_logs(self):
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        handler.addFilter(log_scrub.ScrubFilter())
        log = logging.getLogger("scrub-test")
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        try:
            log.info("connect with %s", TOKEN)
            log.info(f"Authorization: Bearer {TOKEN}")
            log.warning("url https://x.instructure.com/api/v1/users/self?access_token=%s", TOKEN)
            odd = "weird-token-format-0123456789"
            log_scrub.register_secret(odd)
            log.error("failed for %s", odd)
            try:
                raise ValueError(f"boom {TOKEN}")
            except ValueError:
                log.exception("sync failed")
        finally:
            log.removeHandler(handler)
        output = stream.getvalue()
        self.assertNotIn(TOKEN, output)
        self.assertNotIn("weird-token-format-0123456789", output)
        self.assertIn("[redacted]", output)


if __name__ == "__main__":
    unittest.main()
