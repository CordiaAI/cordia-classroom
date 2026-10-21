"""Keeps Canvas tokens (and any bearer credential) out of every log line.

Installed on the root handlers at startup. Canvas access tokens look like
"<digits>~<64 letters/digits>"; tokens seen at runtime are also registered so an
unusual format is still redacted.
"""
import logging
import re
import threading

REDACTED = "[redacted]"
_PATTERNS = [
    re.compile(r"\b\d{1,8}~[A-Za-z0-9]{16,}\b"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"(?i)(access_token=)[^&\s]+"),
]
_known = set()
_lock = threading.Lock()


def register_secret(value: str) -> None:
    if value and len(value) >= 8:
        with _lock:
            if len(_known) > 10_000:
                _known.clear()
            _known.add(value)


def forget_secret(value: str) -> None:
    with _lock:
        _known.discard(value)


def scrub(text: str) -> str:
    if not text:
        return text
    with _lock:
        known = list(_known)
    for secret in known:
        if secret in text:
            text = text.replace(secret, REDACTED)
    for pattern in _PATTERNS:
        text = pattern.sub(lambda m: (m.group(1) if m.lastindex else "") + REDACTED, text)
    return text


class ScrubFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        cleaned = scrub(message)
        if cleaned != message:
            pieces = record.args if isinstance(record.args, tuple) else None
            if record.name == "uvicorn.access" and pieces:
                # uvicorn's access formatter unpacks record.args itself; keep their shape.
                record.args = tuple(scrub(arg) if isinstance(arg, str) else arg for arg in pieces)
            else:
                record.msg, record.args = cleaned, None
        if record.exc_info and record.exc_info[1] is not None:
            record.exc_text = scrub(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        return True


def install() -> None:
    """Attach the filter to every existing handler (root and uvicorn)."""
    scrubber = ScrubFilter()
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        logger = logging.getLogger(name)
        for handler in logger.handlers:
            if not any(isinstance(f, ScrubFilter) for f in handler.filters):
                handler.addFilter(scrubber)
        if not any(isinstance(f, ScrubFilter) for f in logger.filters):
            logger.addFilter(scrubber)
