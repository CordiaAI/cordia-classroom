"""
Supabase database client for CordiaClassroom.
Handles connection to Supabase for user data, folders, and study guides.
"""

import os
import logging
import httpx
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

logger = logging.getLogger(__name__)

_supabase_client = None

# A pooled connection to Supabase that went stale while idle fails with "Server
# disconnected"; the same request succeeds on a fresh connection. Retry once, but
# only when it can't duplicate a write: connection never opened (any request), or
# the connection dropped mid-request on a read or an idempotent change.
_RETRY_ANY = (httpx.ConnectError, httpx.ConnectTimeout)
_RETRY_IDEMPOTENT = (httpx.RemoteProtocolError, httpx.ReadError, httpx.WriteError)
_IDEMPOTENT_METHODS = {"GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"}


class RetryOnceTransport(httpx.BaseTransport):
    def __init__(self, inner: httpx.BaseTransport):
        self.inner = inner

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            return self.inner.handle_request(request)
        except _RETRY_ANY as exc:
            logger.warning(f"Supabase connection failed ({exc}); retrying {request.method} once")
        except _RETRY_IDEMPOTENT as exc:
            if request.method not in _IDEMPOTENT_METHODS:
                raise
            logger.warning(f"Supabase connection dropped ({exc}); retrying {request.method} once")
        return self.inner.handle_request(request)

    def close(self) -> None:
        self.inner.close()


def _add_retry(session: httpx.Client) -> None:
    if not isinstance(session._transport, RetryOnceTransport):
        session._transport = RetryOnceTransport(session._transport)
    for pattern, transport in list(session._mounts.items()):
        if transport is not None and not isinstance(transport, RetryOnceTransport):
            session._mounts[pattern] = RetryOnceTransport(transport)


def get_supabase() -> Client:
    """Get or create Supabase DB client singleton (service_role — never used for auth operations)."""
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            logger.error("SUPABASE_URL or Supabase service-role key not set")
            raise ValueError("Supabase credentials not configured")
        _supabase_client = create_client(url, key)
        _add_retry(_supabase_client.postgrest.session)
        logger.info("Supabase DB client initialized")
    return _supabase_client


def get_auth_supabase() -> Client:
    """Create one stateless Supabase Auth client for one server operation.

    Supabase clients persist and auto-refresh sessions by default. Reusing one
    process-wide client therefore lets unrelated login, validation, and refresh
    requests overwrite each other's in-memory session. Server auth calls always
    receive their token explicitly, so persistence and automatic refresh belong
    in the browser, not in this shared API process.
    """
    url = os.getenv("SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
    )
    if not url or not key:
        raise ValueError("Supabase credentials not configured")
    # OAuth starts on the API but finishes in the browser callback. Use the
    # implicit flow so Supabase returns the access and refresh tokens in the URL
    # fragment; a server-only PKCE verifier would be lost between requests.
    # SyncClientOptions is required here: the base ClientOptions type does not
    # provide the synchronous storage field expected by supabase-py 2.31.
    return create_client(
        url,
        key,
        options=SyncClientOptions(
            auto_refresh_token=False,
            persist_session=False,
            flow_type="implicit",
        ),
    )
