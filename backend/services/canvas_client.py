"""The only code that may decrypt a Canvas token or call Canvas.

Rules enforced here (not in the UI):
  * Tokens are AES-256-GCM encrypted with CANVAS_TOKEN_KEY (base64, 32 bytes), a fresh
    12-byte IV per token, and the user id as associated data. The key never touches the DB.
  * Only GET, and only to the read-only allowlist below. Anything else raises.
  * Host check: https, no port, no credentials, no IP literal or localhost, the host is
    *.instructure.com (directly or as a DNS alias of one, like a school's own Canvas address) or
    listed in canvas_school_policy, and it resolves to public addresses.
    Each client then connects only to an address that passed that check (TLS and Host still use
    the Canvas name), so DNS can't be switched to a private address afterwards. Redirects are
    never followed to another host.
  * X-Rate-Limit-Remaining is respected with backoff.
  * Every call is written to canvas_activity (endpoint name and status only).
  * A 401 raises CanvasUnauthorized so the caller disconnects.
"""
from __future__ import annotations

import base64
import binascii
import ipaddress
import logging
import os
import re
import socket
import time
from dataclasses import dataclass
from typing import Callable, Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse

import requests
from requests.adapters import HTTPAdapter
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from services.log_scrub import register_secret

logger = logging.getLogger(__name__)

TIMEOUT = 15
MAX_PAGES = 20
LOW_REMAINING = 100.0
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
# Canvas serves file bytes from a separate file host through a pre-signed link. Only these
# hosts are followed, without the token, at a checked public address.
FILE_HOST_SUFFIXES = (".inscloudgate.net", ".instructure-uploads.com", ".canvas-user-content.com", ".instructure.com", ".amazonaws.com")


class CanvasError(Exception):
    """A Canvas request failed. Messages never contain the token."""


class CanvasForbiddenRequest(CanvasError):
    """The request is not on the read-only allowlist, or the host is not allowed."""


class CanvasUnauthorized(CanvasError):
    """Canvas rejected the token (401). The connection must be removed."""


# ---------------------------------------------------------------------------
# Encryption
# ---------------------------------------------------------------------------
def _key() -> bytes:
    raw = os.getenv("CANVAS_TOKEN_KEY", "")
    try:
        key = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        key = b""
    if len(key) != 32:
        raise CanvasError("Canvas connections are not configured.")
    return key


def encrypt_token(token: str, user_id: str) -> tuple[bytes, bytes]:
    """Return (ciphertext, iv). The plaintext is never stored."""
    iv = os.urandom(12)
    ciphertext = AESGCM(_key()).encrypt(iv, token.encode("utf-8"), user_id.encode("utf-8"))
    return ciphertext, iv


def _decrypt_token(ciphertext: bytes, iv: bytes, user_id: str) -> str:
    token = AESGCM(_key()).decrypt(iv, ciphertext, user_id.encode("utf-8")).decode("utf-8")
    register_secret(token)
    return token


def to_bytea(value: bytes) -> str:
    """PostgREST takes bytea as a \\x-prefixed hex string."""
    return "\\x" + value.hex()


def from_bytea(value) -> bytes:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    text = str(value or "")
    return bytes.fromhex(text[2:]) if text.startswith("\\x") else base64.b64decode(text)


# ---------------------------------------------------------------------------
# Host check (SSRF)
# ---------------------------------------------------------------------------
def normalize_domain(value: str) -> str:
    """Accept "school.instructure.com" or a full https URL; return the bare lowercase host."""
    value = (value or "").strip()
    if not value:
        raise CanvasForbiddenRequest("Enter your school's Canvas address.")
    if "://" not in value:
        value = "https://" + value
    parsed = urlparse(value)
    if parsed.scheme != "https":
        raise CanvasForbiddenRequest("Canvas must use https.")
    if parsed.username or parsed.password or parsed.port is not None:
        raise CanvasForbiddenRequest("Use the plain Canvas address, like school.instructure.com.")
    host = (parsed.hostname or "").rstrip(".").lower()
    labels = host.split(".")
    # One DNS label at a time, with bounded patterns, so a crafted host can't make the check slow.
    if not host or len(host) > 253 or len(labels) < 2 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels):
        raise CanvasForbiddenRequest("That is not a Canvas address.")
    try:
        ipaddress.ip_address(host)
        raise CanvasForbiddenRequest("Use your school's Canvas address, not an IP address.")
    except ValueError:
        pass
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        raise CanvasForbiddenRequest("That is not a Canvas address.")
    return host


def host_allowed(host: str, policy_domains: Iterable[str]) -> bool:
    if host.endswith(".instructure.com") and host.count(".") >= 2:
        return True
    return host in {d.lower() for d in policy_domains}


def _public_addresses(host: str) -> list[str]:
    """The host's addresses, or [] unless every one of them is public."""
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return []
    addresses = sorted({info[4][0].split("%")[0] for info in infos})
    return addresses if addresses and all(ipaddress.ip_address(a).is_global for a in addresses) else []


def _resolves_public(host: str) -> bool:
    return bool(_public_addresses(host))


class _PinnedAdapter(HTTPAdapter):
    """Connects to one checked address for `host`; TLS (SNI and certificate) and Host stay `host`."""

    def __init__(self, host: str, address: str, **kwargs):
        self._host = host
        self._address = address
        super().__init__(**kwargs)

    def build_connection_pool_key_attributes(self, request, verify, cert=None):
        host_params, pool_kwargs = super().build_connection_pool_key_attributes(request, verify, cert)
        if host_params.get("host") != self._host:
            raise CanvasForbiddenRequest("Canvas requests stay on the checked host.")
        return {**host_params, "host": self._address}, {**pool_kwargs, "server_hostname": self._host, "assert_hostname": self._host}

    def send(self, request, *args, **kwargs):
        request.headers["Host"] = self._host
        return super().send(request, *args, **kwargs)


def _fetch_file_host(url: str, hops: int = 2) -> requests.Response:
    """GET a pre-signed Canvas file link: an allowlisted file host, https only, a checked
    public address, no Authorization header, and at most `hops` more redirects."""
    target = urlparse(url)
    host = (target.hostname or "").lower()
    if target.scheme != "https" or target.port is not None or not host.endswith(FILE_HOST_SUFFIXES):
        raise CanvasForbiddenRequest("Canvas served this file from another host.")
    try:
        response = pinned_session(host).get(url, timeout=TIMEOUT, allow_redirects=False, stream=True)
    except requests.RequestException:
        raise CanvasError("Canvas could not send this file.") from None
    if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
        if hops <= 0:
            raise CanvasError("Canvas could not send this file.")
        return _fetch_file_host(urljoin(url, response.headers.get("location", "")), hops - 1)
    if not response.ok:
        raise CanvasError(f"Canvas returned {response.status_code} for the file.")
    return response


def pinned_session(host: str) -> requests.Session:
    """A session that can only reach `host`, at an address checked to be public."""
    addresses = _public_addresses(host)
    if not addresses:
        raise CanvasForbiddenRequest("That Canvas address could not be reached.")
    session = requests.Session()
    session.mount(f"https://{host}/", _PinnedAdapter(host, addresses[0]))
    return session


def _canonical_name(host: str) -> str:
    """The name DNS resolves `host` to through its CNAMEs ('' if it doesn't resolve)."""
    try:
        return socket.gethostbyname_ex(host)[0].rstrip(".").lower()
    except (socket.gaierror, socket.herror, UnicodeError):
        return ""


def check_host(domain: str, policy_domains: Iterable[str], resolve: Optional[Callable[[str], bool]] = None,
               canonical: Optional[Callable[[str], str]] = None) -> str:
    resolve = resolve or _resolves_public
    canonical = canonical or _canonical_name
    host = normalize_domain(domain)
    # A school's own Canvas address (e.g. usaonline.southalabama.edu) is a DNS alias of its
    # *.instructure.com instance; that counts as Instructure-hosted Canvas too.
    if not host_allowed(host, policy_domains) and not host_allowed(canonical(host), []):
        raise CanvasForbiddenRequest("Cordia doesn't recognize that Canvas address.")
    if not resolve(host):
        raise CanvasForbiddenRequest("That Canvas address could not be reached.")
    return host


# ---------------------------------------------------------------------------
# Read-only allowlist
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Endpoint:
    name: str
    pattern: re.Pattern
    params: frozenset           # allowed plain params
    multi: dict                 # allowed values for list params like include[]
    required: dict              # params that must be present with this value


def _ep(name, path, params=(), multi=None, required=None):
    return Endpoint(name, re.compile("^" + path + "$"), frozenset(params) | {"page", "per_page"}, multi or {}, required or {})


ALLOWLIST = (
    _ep("users.self", r"/api/v1/users/self"),
    _ep("courses.list", r"/api/v1/courses", params=("enrollment_state",), multi={"include[]": {"term"}}, required={"enrollment_state": "active"}),
    _ep("courses.get", r"/api/v1/courses/\d+", multi={"include[]": {"syllabus_body", "term"}}),
    _ep("assignments.list", r"/api/v1/courses/\d+/assignments", params=("order_by",), multi={"include[]": {"submission"}}),
    _ep("assignment_groups.list", r"/api/v1/courses/\d+/assignment_groups", multi={"include[]": {"assignments", "submission"}}),
    _ep("enrollments.self", r"/api/v1/courses/\d+/enrollments", params=("user_id",), required={"user_id": "self"}),
    _ep("modules.list", r"/api/v1/courses/\d+/modules", multi={"include[]": {"items"}}),
    _ep("calendar_events.list", r"/api/v1/calendar_events", params=("type", "start_date", "end_date", "all_events"), multi={"context_codes[]": None}),
    _ep("files.list", r"/api/v1/courses/\d+/files", params=("search_term", "sort", "order")),
    _ep("files.get", r"/api/v1/courses/\d+/files/\d+"),
    _ep("files.download", r"/files/\d+/download", params=("download_frd", "verifier")),
)


def check_request(method: str, path: str, query: list[tuple[str, str]]) -> Endpoint:
    """Raise CanvasForbiddenRequest unless (method, path, query) is on the allowlist."""
    if method.upper() != "GET":
        raise CanvasForbiddenRequest(f"Canvas {method.upper()} requests are not allowed.")
    for endpoint in ALLOWLIST:
        if not endpoint.pattern.match(path):
            continue
        seen = {}
        for key, value in query:
            if key in endpoint.multi:
                allowed = endpoint.multi[key]
                if allowed is not None and value not in allowed:
                    raise CanvasForbiddenRequest(f"Canvas parameter {key}={value} is not allowed.")
                if key == "context_codes[]" and not re.fullmatch(r"(course|user)_\d+", value):
                    raise CanvasForbiddenRequest("Canvas context is not allowed.")
            elif key not in endpoint.params:
                raise CanvasForbiddenRequest(f"Canvas parameter {key} is not allowed.")
            seen[key] = value
        for key, value in endpoint.required.items():
            if seen.get(key) != value:
                raise CanvasForbiddenRequest(f"Canvas {endpoint.name} requires {key}={value}.")
        return endpoint
    raise CanvasForbiddenRequest("That Canvas endpoint is not allowed.")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------
class CanvasClient:
    """Read-only Canvas access for one user. Construct with from_store()."""

    def __init__(self, host: str, token: str, *, policy_domains: Iterable[str] = (), log: Optional[Callable[[str, int], None]] = None,
                 http: Optional[requests.Session] = None, sleep: Callable[[float], None] = time.sleep,
                 resolve: Optional[Callable[[str], bool]] = None):
        self._policy = list(policy_domains)
        self._resolve = resolve
        self.host = check_host(host, self._policy, resolve)
        self.__token = token
        register_secret(token)
        self._log = log or (lambda name, status: None)
        self._http = http or pinned_session(self.host)
        self._sleep = sleep

    def __repr__(self) -> str:  # never show the token
        return f"CanvasClient(host={self.host!r})"

    @classmethod
    def from_store(cls, user_id: str, token_row: dict, host: str, **kwargs) -> "CanvasClient":
        token = _decrypt_token(from_bytea(token_row["ciphertext"]), from_bytea(token_row["iv"]), user_id)
        return cls(host, token, **kwargs)

    # The only network method. Everything goes through the allowlist and host check.
    def _get(self, path: str, query: Optional[list[tuple[str, str]]] = None, *, stream: bool = False, file_download: bool = False) -> requests.Response:
        query = list(query or [])
        endpoint = check_request("GET", path, query)
        url = f"https://{self.host}{path}" + (("?" + urlencode(query)) if query else "")
        for attempt in range(4):
            try:
                response = self._http.request("GET", url, headers={"Authorization": f"Bearer {self.__token}", "Accept": "application/json"},
                                              timeout=TIMEOUT, allow_redirects=False, stream=stream)
            except requests.RequestException:
                self._log(endpoint.name, 0)
                raise CanvasError("Canvas could not be reached.") from None
            self._log(endpoint.name, response.status_code)
            if response.status_code == 401:
                raise CanvasUnauthorized("Canvas rejected the token.")
            if response.status_code == 403 and "rate limit" in (response.text or "").lower() and attempt < 3:
                self._sleep(2 ** attempt)
                continue
            self._throttle(response)
            if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location", "")
                target = urlparse(urljoin(url, location))
                if target.scheme != "https" or target.port is not None:
                    raise CanvasForbiddenRequest("Canvas redirected to another host.")
                if (target.hostname or "").lower() != self.host:
                    if file_download:
                        return _fetch_file_host(target.geturl())
                    raise CanvasForbiddenRequest("Canvas redirected to another host.")
                return self._get(target.path, parse_qsl(target.query, keep_blank_values=True), stream=stream, file_download=file_download)
            if not response.ok:
                raise CanvasError(f"Canvas returned {response.status_code} for {endpoint.name}.")
            return response
        raise CanvasError("Canvas is busy. Try again soon.")

    def _throttle(self, response: requests.Response) -> None:
        try:
            remaining = float(response.headers.get("X-Rate-Limit-Remaining", ""))
        except ValueError:
            return
        if remaining < LOW_REMAINING:
            self._sleep(min(8.0, (LOW_REMAINING - remaining) / 25 + 0.5))

    def _pages(self, path: str, query: list[tuple[str, str]]) -> list:
        items = []
        query = query + [("per_page", "100")]
        for _ in range(MAX_PAGES):
            response = self._get(path, query)
            data = response.json()
            if isinstance(data, list):
                items.extend(data)
            nxt = response.links.get("next", {}).get("url") if hasattr(response, "links") else None
            if not nxt:
                break
            target = urlparse(nxt)
            if (target.hostname or "").lower() != self.host:
                raise CanvasForbiddenRequest("Canvas pagination pointed to another host.")
            path, query = target.path, parse_qsl(target.query, keep_blank_values=True)
        return items

    # --- allowed reads -------------------------------------------------------
    def me(self) -> dict:
        return self._get("/api/v1/users/self").json()

    def courses(self) -> list:
        return self._pages("/api/v1/courses", [("enrollment_state", "active"), ("include[]", "term")])

    def course(self, course_id: int) -> dict:
        return self._get(f"/api/v1/courses/{int(course_id)}", [("include[]", "syllabus_body"), ("include[]", "term")]).json()

    def assignments(self, course_id: int) -> list:
        return self._pages(f"/api/v1/courses/{int(course_id)}/assignments", [("include[]", "submission")])

    def assignment_groups(self, course_id: int) -> list:
        """Weights, assignments and this student's own submissions, for the grade view."""
        return self._pages(f"/api/v1/courses/{int(course_id)}/assignment_groups", [("include[]", "assignments"), ("include[]", "submission")])

    def my_enrollments(self, course_id: int) -> list:
        """Only the caller's own enrollment (user_id=self), which carries their current grade."""
        return self._pages(f"/api/v1/courses/{int(course_id)}/enrollments", [("user_id", "self")])

    def modules(self, course_id: int) -> list:
        return self._pages(f"/api/v1/courses/{int(course_id)}/modules", [("include[]", "items")])

    def calendar_events(self, course_ids: Iterable[int], start_date: str, end_date: str) -> list:
        query = [("type", "assignment"), ("start_date", start_date), ("end_date", end_date)]
        query += [("context_codes[]", f"course_{int(c)}") for c in course_ids]
        return self._pages("/api/v1/calendar_events", query)

    def files(self, course_id: int) -> list:
        return self._pages(f"/api/v1/courses/{int(course_id)}/files", [])

    def download_file(self, course_id: int, file_id: int) -> tuple[str, bytes]:
        """One file the user picked. Returns (filename, bytes)."""
        meta = self._get(f"/api/v1/courses/{int(course_id)}/files/{int(file_id)}").json()
        if int(meta.get("size") or 0) > MAX_DOWNLOAD_BYTES:
            raise CanvasError("Too large (50 MB max)")
        response = self._get(f"/files/{int(file_id)}/download", [("download_frd", "1")], stream=True, file_download=True)
        body = bytearray()
        for chunk in response.iter_content(64 * 1024):
            body.extend(chunk)
            if len(body) > MAX_DOWNLOAD_BYTES:
                raise CanvasError("Too large (50 MB max)")
        return str(meta.get("display_name") or meta.get("filename") or "canvas-file"), bytes(body)
