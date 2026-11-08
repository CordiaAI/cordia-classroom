"""
Authentication router for CordiaClassroom.
Handles login and session management via Supabase Auth. New accounts are created only through Google OAuth.
"""

import time
import logging
from collections import defaultdict
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel, Field
from supabase_auth.errors import AuthApiError, AuthInvalidJwtError
from database import get_supabase, get_auth_supabase
from auth_utils import get_user_id, reject_oauth_client_token
from rate_limit import ai_rate_limit, client_ip
from services import minors

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory brute force protection — separate counters for auth vs refresh
# so that automatic token refresh calls don't eat into the login quota.
_auth_attempts = defaultdict(list)    # login: IP -> [timestamps]
_refresh_attempts = defaultdict(list) # token refresh: IP -> [timestamps]
MAX_REFRESH_ATTEMPTS = 30
WINDOW_SECONDS = 300  # 5 minutes
MAX_TRACKED_IPS = 10_000


def _check_rate_limit(request: Request, store: defaultdict, max_attempts: int):
    """Block IPs that exceed max_attempts within WINDOW_SECONDS."""
    ip = client_ip(request)
    now = time.time()

    # Evict stale IPs if tracker is too large
    if len(store) > MAX_TRACKED_IPS:
        stale_ips = [k for k, v in store.items() if not v or now - v[-1] > WINDOW_SECONDS]
        for k in stale_ips:
            del store[k]
        if len(store) > MAX_TRACKED_IPS:
            sorted_ips = sorted(store.keys(), key=lambda k: store[k][-1] if store[k] else 0)
            for k in sorted_ips[:len(sorted_ips) // 2]:
                del store[k]

    store[ip] = [t for t in store[ip] if now - t < WINDOW_SECONDS]
    if len(store[ip]) >= max_attempts:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    store[ip].append(now)


class AuthResponse(BaseModel):
    user_id: str
    email: str
    access_token: str
    refresh_token: str = ""
    name: str = ""


def _display_name(user) -> str:
    metadata = user.user_metadata or {}
    combined_name = " ".join(
        part for part in (metadata.get("given_name"), metadata.get("family_name")) if part
    ).strip()
    name = metadata.get("full_name") or metadata.get("name") or combined_name
    if name:
        return str(name).strip()
    try:
        profiles = (
            get_supabase().table("user_profiles")
            .select("name")
            .eq("id", user.id)
            .limit(1)
            .execute()
        )
        return (profiles.data[0].get("name") or "") if profiles.data else ""
    except Exception as error:
        logger.warning("Could not load display name for %s: %s", user.id, type(error).__name__)
        return ""


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=AuthResponse)
def refresh_token(request: RefreshRequest, req: Request):
    """Refresh an expired access token. Rate limited."""
    _check_rate_limit(req, _refresh_attempts, MAX_REFRESH_ATTEMPTS)
    try:
        result = get_auth_supabase().auth.refresh_session(request.refresh_token)

        if not result.user or not result.session:
            raise HTTPException(status_code=401, detail="Invalid refresh token")

        return AuthResponse(
            user_id=result.user.id,
            email=result.user.email,
            access_token=result.session.access_token,
            refresh_token=result.session.refresh_token,
            name=_display_name(result.user),
        )

    except AuthApiError as e:
        logger.info("Refresh rejected: %s", e)
        raise HTTPException(status_code=401, detail="Failed to refresh token")


@router.get("/me")
def get_current_user(authorization: str = Header(default="")):
    """Get current user info from access token."""
    try:
        if not authorization:
            raise HTTPException(status_code=401, detail="No token provided")

        # Validate format before extracting token
        if not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Invalid authorization format")

        token = authorization[7:].strip()
        if not token or len(token) > 4096:
            raise HTTPException(status_code=401, detail="Invalid token")
        reject_oauth_client_token(token)

        result = get_auth_supabase().auth.get_user(token)

        if not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        return {
            "user_id": result.user.id,
            "email": result.user.email,
            "name": _display_name(result.user),
            "age_needed": _age_needed(result.user),
        }

    except (AuthApiError, AuthInvalidJwtError) as e:
        logger.info("Auth check rejected: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


class ProfileRequest(BaseModel):
    name: str = Field(default="", max_length=200)
    education_level: str = Field(default="", pattern=r"^(university|high_school)?$")
    university: str = Field(default="", max_length=200)
    major: str = Field(default="", max_length=200)


@router.patch("/profile")
def update_profile(request: ProfileRequest, authorization: str = Header(default="")):
    """Save school details collected at sign-up, filling only fields that are still empty."""
    user_id = get_user_id(authorization)
    supabase = get_supabase()
    current = supabase.table("user_profiles").select("name, education_level, university, major").eq("id", user_id).limit(1).execute()
    existing = current.data[0] if current.data else {}
    updates = {
        field: value.strip()
        for field, value in request.model_dump().items()
        if value.strip() and not existing.get(field)
    }
    if updates:
        supabase.table("user_profiles").update(updates).eq("id", user_id).execute()
    return {"updated": sorted(updates)}


def _remove_lecture_audio(supabase, user_id: str) -> None:
    """Recordings are stored as lecture-audio/<user>/<recording>/<chunk>."""
    bucket = supabase.storage.from_("lecture-audio")
    try:
        paths = []
        for folder in bucket.list(user_id) or []:
            prefix = f"{user_id}/{folder['name']}"
            if folder.get("id"):  # a file directly under the user's folder
                paths.append(prefix)
                continue
            paths.extend(f"{prefix}/{item['name']}" for item in bucket.list(prefix) or [])
        for start in range(0, len(paths), 100):
            bucket.remove(paths[start:start + 100])
    except Exception as exc:  # no bucket yet (lectures not set up): nothing stored to remove
        logger.warning("Lecture audio cleanup skipped: %s", exc)


def _remove_card_images(supabase, user_id: str) -> None:
    """Photos on flashcards are stored as card-images/<user>/<photo>."""
    bucket = supabase.storage.from_("card-images")
    try:
        for _ in range(100):  # 100 at a time, up to 10,000 photos
            names = [item["name"] for item in bucket.list(user_id, {"limit": 100}) or [] if item.get("id")]
            if not names:
                break
            bucket.remove([f"{user_id}/{name}" for name in names])
    except Exception as exc:  # no bucket yet (photos not set up): nothing stored to remove
        logger.warning("Card photo cleanup skipped: %s", exc)


def _remove_visuals(supabase, user_id: str) -> None:
    """Diagrams and note covers the student made live in the public 'visuals' bucket."""
    marker = "/storage/v1/object/public/visuals/"
    try:
        cached = supabase.table("visual_cache").select("files").eq("user_id", user_id).execute().data or []
        covers = supabase.table("note_covers").select("url").eq("user_id", user_id).execute().data or []
        urls = [item.get("url", "") for row in cached for item in (row.get("files") or []) if isinstance(item, dict)]
        urls += [row.get("url", "") for row in covers]
        paths = sorted({url.split(marker, 1)[1] for url in urls if marker in url})
        for start in range(0, len(paths), 100):
            supabase.storage.from_("visuals").remove(paths[start:start + 100])
        supabase.table("visual_cache").delete().eq("user_id", user_id).execute()
    except Exception as exc:  # visuals not set up: nothing stored to remove
        logger.warning("Visual cleanup skipped: %s", exc)


class DeleteAccountRequest(BaseModel):
    confirm: str = Field(..., max_length=20)


# Tables keyed by user_id that are not removed by the auth.users cascade (created before
# migrations, or without a foreign key). Everything else cascades when the user is deleted.
_USER_TABLES = ("study_guides", "smart_notes", "folders", "quiz_attempts", "study_sessions", "user_streaks", "usage_events")


@router.delete("/account")
def delete_account(request: DeleteAccountRequest, authorization: str = Header(default="")):
    """Self-serve account deletion: cancels a paid plan, removes the student's data and the login."""
    if request.confirm != "DELETE":
        raise HTTPException(status_code=400, detail='Type DELETE to confirm')
    _erase_account(get_user_id(authorization))
    return {"deleted": True}


def _erase_account(user_id: str) -> None:
    supabase = get_supabase()
    from routers.billing import cancel_subscription_for_deletion
    cancel_subscription_for_deletion(user_id)
    for table in _USER_TABLES:
        supabase.table(table).delete().eq("user_id", user_id).execute()
    supabase.table("user_profiles").delete().eq("id", user_id).execute()
    _remove_lecture_audio(supabase, user_id)
    _remove_visuals(supabase, user_id)
    _remove_card_images(supabase, user_id)
    supabase.auth.admin.delete_user(user_id)
    logger.info("Account deleted: %s", user_id)


# Age (social plan, Stage 9) ------------------------------------------------------------------------
def _age_needed(user) -> bool:
    """A new account (made on or after minors.AGE_CHECK_FROM) that hasn't told us its birth month,
    so the web asks once. False before migration 20261126120000 (nowhere to keep the answer)."""
    try:
        rows = get_supabase().table("user_profiles").select("birth_month").eq("id", user.id).limit(1).execute().data or []
    except Exception:
        return False
    created = getattr(user, "created_at", None)
    created = created.isoformat() if hasattr(created, "isoformat") else str(created or "")
    return minors.age_needed({"birth_month": (rows[0] if rows else {}).get("birth_month"), "created_at": created})


class AgeRequest(BaseModel):
    year: int = Field(..., ge=1900, le=2100)
    month: int = Field(..., ge=1, le=12)


@router.post("/age", dependencies=[Depends(ai_rate_limit(5, 60))])
def set_age(body: AgeRequest, authorization: str = Header(default="")):
    """The birth month and year from sign-up (only those are kept; once only). Under 13 there's no
    account: it's deleted at once and this answers 403 under_13 (there's no parental consent flow).
    13 to 17 counts as a minor (services/minors.py)."""
    user_id = get_user_id(authorization)
    today = datetime.now(timezone.utc).date()
    born = date(body.year, body.month, 1)
    if born > today:
        raise HTTPException(status_code=400, detail="Check the month and year.")
    supabase = get_supabase()
    try:
        rows = supabase.table("user_profiles").select("id,birth_month").eq("id", user_id).limit(1).execute().data or []
    except Exception:  # before migration 20261126120000
        rows = None
    if rows and rows[0].get("birth_month"):
        raise HTTPException(status_code=409, detail="Your age is already saved.")
    if minors.age_on(born, today) < minors.MIN_AGE:
        _erase_account(user_id)
        logger.info("Account under 13 removed at sign-up")
        raise HTTPException(status_code=403, detail="under_13")
    if rows is None:
        raise HTTPException(status_code=503, detail="Saving your age isn't available yet.")
    if rows:
        supabase.table("user_profiles").update({"birth_month": born.isoformat()}).eq("id", user_id).execute()
    else:
        supabase.table("user_profiles").insert({"id": user_id, "birth_month": born.isoformat()}).execute()
    return {"saved": True, "minor": minors.age_on(born, today) < minors.ADULT_AGE}
