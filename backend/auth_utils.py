"""
Shared auth utility for CordiaClassroom.
Verifies Supabase access tokens locally against the project's published signing
keys, and falls back to supabase.auth.get_user() when local verification can't run.
"""

import os
import logging
import jwt
from fastapi import HTTPException
from database import get_auth_supabase
from services.models import current_user_id

logger = logging.getLogger(__name__)

_ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
_jwks_client = None


def _get_jwks_client():
    """One cached client per process; signing keys are refetched at most hourly."""
    global _jwks_client
    if _jwks_client is None:
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if not url:
            return None
        _jwks_client = jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)
    return _jwks_client


def _verify_locally(token: str):
    """Return the user ID from a validly signed token, None if local checking isn't possible.

    Raises jwt.InvalidTokenError for a token that is expired, forged, or for another project.
    """
    if jwt.get_unverified_header(token).get("alg") not in _ASYMMETRIC_ALGORITHMS:
        return None
    client = _get_jwks_client()
    if client is None:
        return None
    try:
        signing_key = client.get_signing_key_from_jwt(token)
    except jwt.PyJWKClientError as e:
        logger.warning(f"Signing keys unavailable, verifying with Supabase: {e}")
        return None
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=_ASYMMETRIC_ALGORITHMS,
        audience="authenticated",
        issuer=f"{os.getenv('SUPABASE_URL', '').rstrip('/')}/auth/v1",
        options={"require": ["exp", "sub"]},
    )
    return claims["sub"]


def get_user_id(authorization: str) -> str:
    """
    Extract and verify user ID from a Supabase Bearer token.
    Checks the signature locally (no network call per request); asks Supabase only
    when the token uses a legacy algorithm or the signing keys can't be fetched.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization[7:].strip()
    if not token or len(token) > 4096:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        user_id = _verify_locally(token)
    except jwt.InvalidTokenError as e:
        logger.info(f"Rejected token: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if user_id:
        current_user_id.set(user_id)
        return user_id

    try:
        supabase = get_auth_supabase()
        result = supabase.auth.get_user(token)
        if not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        current_user_id.set(result.user.id)
        return result.user.id
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")
