"""Username rules (social plan, Stage 1).

A username is 3-24 characters of a-z, 0-9, "_" and ".", stored lowercase (the column is citext, so
uniqueness ignores case). Some names are reserved: app routes (/u/<name> must never shadow a page)
and names that would pass for staff. A username can change at most once every 30 days after the
first change; the released name points at its owner's new name for 90 days and nobody else can take
it in that time (username_history).
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

PATTERN = re.compile(r"^[a-z0-9_.]{3,24}$")
COOLDOWN = timedelta(days=30)
HOLD = timedelta(days=90)

# The plan's list, every top-level web route (web/pages and next.config.js rewrites/redirects), and
# names that read as official.
RESERVED = frozenset({
    "admin", "support", "cordia", "settings", "api", "u", "sets", "classrooms", "join", "search", "friends",
    "about", "account", "assistant", "auth", "billing", "calendar", "canvas", "class", "classes", "connect",
    "copyright", "create", "dashboard", "discover", "feedback", "feedback-review", "flashcards", "folder",
    "folders", "games", "guide", "guides", "help", "honor-code", "install-extension", "instructors", "learn",
    "lecture", "lectures", "library", "login", "logout", "mcp", "me", "mission", "moderator", "mod", "nclex",
    "notifications", "oauth", "official", "play", "practice", "pricing", "privacy", "profile", "profiles",
    "progress", "quiz", "reset-password", "root", "security", "session", "signup", "smartnotes", "staff",
    "system", "team", "terms", "tutor", "week", "www", "null", "undefined", "anonymous",
})
# Names that could pass for the company or its staff: anything containing "cordia", or a word (split
# on ".", "_" and digits) like "admin" or "support" ("badminton" is fine, "admin_jo" isn't).
_STAFF_WORDS = frozenset({"admin", "administrator", "moderator", "mod", "staff", "support", "official", "team"})


def normalize(raw: str) -> str:
    """What the student typed, as it would be stored: trimmed, lowercase, no leading @."""
    return str(raw or "").strip().lstrip("@").strip().lower()


def format_problem(name: str) -> Optional[str]:
    """Why this (normalized) name can't be a username, ignoring who has it; None when it can."""
    if not name:
        return "Pick a username."
    if len(name) < 3:
        return "Use at least 3 characters."
    if len(name) > 24:
        return "Use 24 characters or fewer."
    if not PATTERN.match(name):
        return "Use only letters, numbers, _ and ."
    if name in RESERVED or "cordia" in name or _STAFF_WORDS & set(re.split(r"[._0-9]+", name)):
        return "That username is reserved."
    return None


def _parse(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def held_by(db, name: str, now: datetime) -> Optional[str]:
    """The user a recently released name still belongs to (within 90 days), or None."""
    rows = db.table("username_history").select("user_id,released_at").eq("old_username", name).limit(1).execute().data or []
    if not rows:
        return None
    released = _parse(rows[0].get("released_at"))
    return rows[0]["user_id"] if released and now - released < HOLD else None


def taken_by(db, name: str) -> Optional[str]:
    rows = db.table("user_profiles").select("id").eq("username", name).limit(1).execute().data or []
    return rows[0]["id"] if rows else None


def availability(db, name: str, user_id: str, now: Optional[datetime] = None) -> Optional[str]:
    """Why `user_id` can't have this name right now; None when they can."""
    now = now or datetime.now(timezone.utc)
    problem = format_problem(name)
    if problem:
        return problem
    owner = taken_by(db, name)
    if owner and owner != user_id:
        return "That username is taken."
    holder = held_by(db, name, now)
    if holder and holder != user_id:
        return "That username is taken."
    return None


def next_change_at(profile: dict) -> Optional[datetime]:
    """When this student may change their username again; None when they can now.
    Claiming the first username doesn't count; each later change starts a 30-day wait."""
    changed = _parse(profile.get("username_changed_at"))
    return changed + COOLDOWN if changed else None


def _base(text: str) -> str:
    base = re.sub(r"[^a-z0-9_.]+", "", re.sub(r"\s+", ".", normalize(text)))
    return re.sub(r"\.{2,}", ".", base).strip("._")[:20]


def suggestions(db, user_id: str, *sources: str, limit: int = 3) -> list[str]:
    """A few free usernames built from the display name, real name or email."""
    out: list[str] = []
    seen = set()
    now = datetime.now(timezone.utc)
    bases = [b for b in (_base(s) for s in sources if s) if len(b) >= 3] or ["student"]
    candidates = []
    for base in bases:
        candidates += [base, base.replace(".", "_"), f"{base}{len(base) % 10}{len(user_id) % 10}"]
    candidates += [f"{bases[0]}{n}" for n in (1, 7, 21, 42, 99, 123)]
    for name in candidates:
        name = name[:24]
        if name in seen:
            continue
        seen.add(name)
        if availability(db, name, user_id, now) is None:
            out.append(name)
        if len(out) >= limit:
            break
    return out
