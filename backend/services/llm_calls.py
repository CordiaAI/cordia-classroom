"""One wrapper for every chat completion: picks model/max_tokens from services.models and logs usage."""

import logging
import threading
from typing import Optional

from services import models

logger = logging.getLogger(__name__)


def _insert_usage(row: dict) -> None:
    try:
        from database import get_supabase
        get_supabase().table("usage_events").insert(row).execute()
    except Exception as e:
        logger.warning(f"usage_events insert failed: {e}")


def log_usage(response, feature: str, model: str, user_id: Optional[str] = None) -> None:
    """Record token usage for one call. Never raises and never blocks the request."""
    try:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        details = getattr(usage, "prompt_tokens_details", None)
        row = {
            "user_id": user_id or models.current_user_id.get(),
            "feature": feature,
            "model": model,
            "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
            "cached_tokens": int(getattr(details, "cached_tokens", 0) or 0),
        }
        logger.info("usage feature=%s model=%s prompt=%d completion=%d cached=%d",
                    feature, model, row["prompt_tokens"], row["completion_tokens"], row["cached_tokens"])
        threading.Thread(target=_insert_usage, args=(row,), daemon=True).start()
    except Exception as e:
        logger.warning(f"usage logging failed: {e}")


def chat(client, feature: str, *, model: Optional[str] = None, max_tokens: Optional[int] = None, **kwargs):
    """client.chat.completions.create with the feature's configured model and max_tokens."""
    model = model or models.model_for(feature)
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens or models.FEATURES[feature].max_tokens,
        **kwargs,
    )
    log_usage(response, feature, model)
    return response
