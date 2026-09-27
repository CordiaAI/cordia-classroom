"""
Authentication router for CordiaClassroom.
Handles login and session management via Supabase Auth. New accounts are created only through Google OAuth.
"""

import time
import logging
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, Field
from database import get_supabase, get_auth_supabase
from auth_utils import get_user_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory brute force protection — separate counters for auth vs refresh
# so that automatic token refresh calls don't eat into the login quota.
_auth_attempts = defaultdict(list)    # login: IP -> [timestamps]
_refresh_attempts = defaultdict(list) # token refresh: IP -> [timestamps]
MAX_AUTH_ATTEMPTS = 10
MAX_REFRESH_ATTEMPTS = 30
WINDOW_SECONDS = 300  # 5 minutes
MAX_TRACKED_IPS = 10_000


def _check_rate_limit(request: Request, store: defaultdict, max_attempts: int):
    """Block IPs that exceed max_attempts within WINDOW_SECONDS."""
    ip = request.client.host if request.client else "unknown"
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh error: {e}")
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

        result = get_auth_supabase().auth.get_user(token)

        if not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        return {
            "user_id": result.user.id,
            "email": result.user.email,
            "name": _display_name(result.user),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth check error: {e}")
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
