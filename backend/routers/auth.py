"""
Authentication router for CordiaClassroom.
Handles login and session management via Supabase Auth. New accounts are created only through Google OAuth.
"""

import re
import os
import time
import logging
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel, EmailStr, field_validator
from database import get_supabase, get_auth_supabase

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


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if not v or len(v) > 128:
            raise ValueError("Invalid password")
        return v


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


@router.get("/oauth/google")
def google_oauth():
    """Start the hosted Supabase Google OAuth flow."""
    site_url = (os.getenv("SITE_URL") or os.getenv("FRONTEND_URL") or "https://classroom.cordiacode.com").rstrip("/")
    try:
        result = get_auth_supabase().auth.sign_in_with_oauth({
            "provider": "google",
            "options": {"redirect_to": f"{site_url}/auth/callback"},
        })
        if not result or not result.url:
            raise HTTPException(status_code=503, detail="Google sign-in is not available right now.")
        return {"url": result.url}
    except HTTPException:
        raise
    except Exception as error:
        logger.error("Google OAuth start failed: %s", type(error).__name__)
        raise HTTPException(status_code=503, detail="Google sign-in is not configured yet.")


@router.post("/login", response_model=AuthResponse)
def login(request: LoginRequest, req: Request):
    """Login with email and password. Rate limited."""
    _check_rate_limit(req, _auth_attempts, MAX_AUTH_ATTEMPTS)
    try:
        result = get_auth_supabase().auth.sign_in_with_password({
            "email": request.email,
            "password": request.password
        })

        if not result.user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

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
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def validate_email_length(cls, v):
        if len(v) > 254:
            raise ValueError("Email too long")
        return v


class ResetPasswordRequest(BaseModel):
    access_token: str
    new_password: str

    @field_validator("access_token")
    @classmethod
    def validate_token(cls, v):
        v = v.strip()
        if not v or len(v) > 4096:
            raise ValueError("Invalid token")
        return v

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if len(v) > 128:
            raise ValueError("Password too long")
        if not re.search(r'[A-Z]', v):
            raise ValueError("Password must contain an uppercase letter")
        if not re.search(r'[a-z]', v):
            raise ValueError("Password must contain a lowercase letter")
        if not re.search(r'[0-9]', v):
            raise ValueError("Password must contain a number")
        return v


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


@router.post("/forgot-password")
def forgot_password(request: ForgotPasswordRequest, req: Request):
    """Send a password reset email. Always returns 200 to prevent email enumeration."""
    _check_rate_limit(req, _auth_attempts, MAX_AUTH_ATTEMPTS)
    site_url = os.getenv("SITE_URL", "https://classroom.cordiacode.com")
    try:
        get_auth_supabase().auth.reset_password_for_email(
            request.email,
            {"redirect_to": f"{site_url}/reset-password"}
        )
    except Exception as e:
        logger.warning(f"Forgot password error (suppressed): {e}")
    return {"message": "If an account exists with that email, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(request: ResetPasswordRequest, req: Request):
    """Reset a user's password using a recovery access token from the email link."""
    _check_rate_limit(req, _auth_attempts, MAX_AUTH_ATTEMPTS)
    try:
        user_result = get_auth_supabase().auth.get_user(request.access_token)
        if not user_result.user:
            raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
        get_auth_supabase().auth.admin.update_user_by_id(
            user_result.user.id,
            {"password": request.new_password}
        )
        return {"message": "Password updated successfully."}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reset password error: {e}")
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
