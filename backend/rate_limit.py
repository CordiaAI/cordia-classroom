"""Per-student request limits for routes that spend AI tokens.

Used as a FastAPI dependency so route functions stay plain (and directly callable in
tests). Counts live in this process; each Fly machine keeps its own window.
"""
import hashlib
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_lock = threading.Lock()
_hits = defaultdict(deque)


def _caller_key(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth:
        return "user:" + hashlib.sha256(auth.encode()).hexdigest()[:24]
    return "ip:" + (request.client.host if request.client else "unknown")


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
