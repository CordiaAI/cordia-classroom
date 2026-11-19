"""Per-student request limits for routes that spend AI tokens.

Used as a FastAPI dependency so route functions stay plain (and directly callable in
tests). Counts live in this process; each Fly machine keeps its own window.
"""
import hashlib
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from slowapi import Limiter


def client_ip(request: Request) -> str:
    """The student's address. On Fly every request arrives from Fly's proxy, so the socket
    address is the same for everyone; Fly puts the real one in Fly-Client-IP (and replaces
    any value a client sends)."""
    return request.headers.get("fly-client-ip") or (request.client.host if request.client else "unknown")


_lock = threading.Lock()
_hits = defaultdict(deque)
_user_hits = defaultdict(deque)


class _Limiter(Limiter):
    def reset(self) -> None:
        """Forget every count: the per-IP windows, and the per-student ones below (for tests)."""
        super().reset()
        with _lock:
            _hits.clear()
            _user_hits.clear()


# Per-IP limits declared with @limiter.limit on a route; main.py attaches it to the app.
limiter = _Limiter(key_func=client_ip)


def user_allowance(user_id: str, name: str, limit: int, window_seconds: float, cost: int = 1) -> bool:
    """Count `cost` against a student's own allowance called `name` (so a school sharing one address
    doesn't share it): True while they are within `limit` in the last `window_seconds`, False (and
    nothing counted) when they would go over. Windows live in this process; each Fly machine keeps its own."""
    now = time.monotonic()
    with _lock:
        hits = _user_hits[(name, user_id)]
        while hits and now - hits[0] > window_seconds:
            hits.popleft()
        if len(hits) + cost > limit:
            return False
        hits.extend([now] * cost)
        if len(_user_hits) > 50_000:
            _user_hits.clear()
    return True


def user_rate_limit(user_id: str, name: str, limit: int, window_seconds: float = 60) -> None:
    """Raise a 429 when the student has made `limit` calls to `name` in the window."""
    if not user_allowance(user_id, name, limit, window_seconds):
        raise HTTPException(status_code=429, detail="Too many requests. Wait a moment and try again.")


def _caller_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth:
        return "user:" + hashlib.sha256(auth.encode()).hexdigest()[:24]
    return "ip:" + client_ip(request)


def ai_rate_limit(max_calls: int = 10, window_seconds: int = 60):
    def dependency(request: Request):
        route = request.scope.get("route")
        key = f"{getattr(route, 'path', request.url.path)}:{_caller_key(request)}"
        now = time.monotonic()
        with _lock:
            hits = _hits[key]
            while hits and now - hits[0] > window_seconds:
                hits.popleft()
            if len(hits) >= max_calls:
                raise HTTPException(status_code=429, detail="Too many requests. Wait a moment and try again.")
            hits.append(now)
            if len(_hits) > 50_000:
                _hits.clear()
    return dependency
