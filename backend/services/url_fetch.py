"""Reading a link for a study set on the server (connected apps' create_study_set), safely.

- http and https only, on the standard ports, with no user name or password in the link.
- LMS links (Canvas, Blackboard, Moodle, Brightspace, Schoology, Sakai) are refused: the student
  uses the Cordia extension for those, and connected apps never reach an LMS (MCP hard rule 1).
- The host is resolved first and every address must be public: private, loopback, link-local
  (including cloud metadata at 169.254.169.254), shared, multicast and reserved ranges are refused.
  The request then goes to the address that was checked (the TLS certificate is still checked
  against the host name), so a second DNS answer can't point it somewhere else.
- At most 4 redirects, each checked the same way; 15 seconds per request; 5 MB at most.
"""

import ipaddress
import re
import socket
from typing import Callable, Optional
from urllib.parse import urljoin, urlsplit

import certifi
import urllib3

MAX_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 4
TIMEOUT_SECONDS = 15
USER_AGENT = "CordiaClassroom/1.0 (+https://classroom.cordiacode.com)"
PORTS = {"http": 80, "https": 443}

LMS_MESSAGE = ("Cordia can't read Canvas, Blackboard, Moodle or other LMS pages from here. "
               "Open the page in your browser and use the Cordia extension to add it.")
# Hosts run by LMS vendors, and the usual names schools give a self-hosted LMS.
_LMS_DOMAINS = ("instructure.com", "canvaslms.com", "blackboard.com", "blackboardopen.com", "moodlecloud.com", "moodle.com",
                "brightspace.com", "desire2learn.com", "d2l.com", "schoology.com", "sakaiproject.org")
_LMS_LABELS = {"canvas", "blackboard", "bb", "moodle", "brightspace", "d2l", "schoology", "sakai", "elearning", "lms"}
_CANVAS_PATH = re.compile(r"^/(courses|api/v1)/\d+", re.I)


class UnsafeUrl(ValueError):
    """A link Cordia won't fetch; the message is safe to show the student."""


def is_lms_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().rstrip(".")
    if any(host == domain or host.endswith("." + domain) for domain in _LMS_DOMAINS):
        return True
    labels = host.split(".")
    if labels and labels[0] in _LMS_LABELS:
        return True
    # A Canvas course page on a school's own domain (canvas.school.edu is caught above).
    return bool(_CANVAS_PATH.match(parts.path or "")) and ("canvas" in host or host.endswith(".edu"))


def check_url(url: str) -> tuple:
    """(scheme, host, port, url) for a link that may be fetched; raises UnsafeUrl otherwise."""
    if not isinstance(url, str) or len(url) > 2048:
        raise UnsafeUrl("Send a link of at most 2,048 characters.")
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in PORTS:
        raise UnsafeUrl("Only http and https links can be read.")
    if parts.username or parts.password:
        raise UnsafeUrl("Links with a user name or password can't be read.")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host:
        raise UnsafeUrl("That link has no host.")
    try:
        port = parts.port or PORTS[scheme]
    except ValueError:
        raise UnsafeUrl("That link's port isn't valid.")
    if port != PORTS[scheme]:
        raise UnsafeUrl("Only links on the standard web ports can be read.")
    if is_lms_url(url):
        raise UnsafeUrl(LMS_MESSAGE)
    return scheme, host, port, url.strip()


def _public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not (ip.is_multicast or ip.is_reserved or ip.is_loopback or ip.is_link_local or ip.is_private)


def public_addresses(host: str, resolve: Callable = socket.getaddrinfo) -> list:
    """Every address the host resolves to; raises UnsafeUrl unless all of them are public."""
    try:
        infos = resolve(host, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, OSError):
        raise UnsafeUrl("That link's site couldn't be found.")
    addresses = list(dict.fromkeys(info[4][0] for info in infos))
    if not addresses:
        raise UnsafeUrl("That link's site couldn't be found.")
    if not all(_public(address) for address in addresses):
        raise UnsafeUrl("That link points to a private or internal address, which Cordia can't read.")
    return addresses


def _request(scheme: str, host: str, port: int, address: str, target: str):
    """One GET to the checked address, with the host name for the Host header and the certificate."""
    timeout = urllib3.Timeout(connect=TIMEOUT_SECONDS, read=TIMEOUT_SECONDS)
    if scheme == "https":
        pool = urllib3.HTTPSConnectionPool(address, port=port, server_hostname=host, assert_hostname=host,
                                           cert_reqs="CERT_REQUIRED", ca_certs=certifi.where(), timeout=timeout, retries=False)
    else:
        pool = urllib3.HTTPConnectionPool(address, port=port, timeout=timeout, retries=False)
    headers = {"Host": host, "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,text/plain,application/pdf,*/*;q=0.5"}
    return pool.urlopen("GET", target, headers=headers, redirect=False, preload_content=False, decode_content=True)


def fetch(url: str, *, resolve: Callable = socket.getaddrinfo, request: Optional[Callable] = None) -> dict:
    """{"url": final link, "content_type": ..., "body": bytes}; raises UnsafeUrl."""
    send = request or _request
    for _ in range(MAX_REDIRECTS + 1):
        scheme, host, port, url = check_url(url)
        address = public_addresses(host, resolve)[0]
        parts = urlsplit(url)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        try:
            response = send(scheme, host, port, address, target)
        except UnsafeUrl:
            raise
        except Exception:
            raise UnsafeUrl("That link couldn't be reached. Check it opens in a browser, or paste the text instead.")
        try:
            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not location:
                    raise UnsafeUrl("That link redirects nowhere.")
                url = urljoin(url, location)
                continue
            if response.status >= 400:
                raise UnsafeUrl(f"That link answered with an error ({response.status}). Check it opens in a browser.")
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit() and int(declared) > MAX_BYTES:
                raise UnsafeUrl("That page is too large to read (5 MB at most).")
            body = b""
            for chunk in response.stream(64 * 1024):
                body += chunk
                if len(body) > MAX_BYTES:
                    raise UnsafeUrl("That page is too large to read (5 MB at most).")
            return {"url": url, "content_type": (response.headers.get("Content-Type") or "").lower(), "body": body}
        finally:
            response.release_conn()
    raise UnsafeUrl("That link redirects too many times.")
