"""Row IDs. Supabase keys are UUIDs; routes check one before it reaches a query."""
import re

from fastapi import HTTPException

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def is_uuid(value) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None


def require_uuid(value, name: str = "ID") -> str:
    """The value itself, or a 400 that names what was invalid."""
    if not is_uuid(value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value
