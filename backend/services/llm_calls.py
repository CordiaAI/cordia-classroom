"""One wrapper for every chat completion: picks model/max_tokens from services.models and logs usage."""

import logging
import threading
from types import SimpleNamespace
from typing import Optional

from services import models

logger = logging.getLogger(__name__)


def _insert_usage(row: dict) -> None:
    try:
        from database import get_supabase
        get_supabase().table("usage_events").insert(row).execute()
    except Exception:
        logger.warning("usage_events insert failed", exc_info=True)


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
    except Exception:
        logger.warning("usage logging failed", exc_info=True)


# Groq's models reason before answering, and the reasoning counts against max_tokens. Keep it
# short and out of the answer, and add headroom so a feature's answer budget is still all answer.
REASONING_HEADROOM = 2048


def _reasoning_options(model: str) -> dict:
    if not models.GROQ:
        return {}
    if model.startswith("openai/gpt-oss"):
        return {"reasoning_effort": "low"}
    if model.startswith("qwen/"):
        return {"reasoning_format": "hidden"}
    return {}


def chat(client, feature: str, *, model: Optional[str] = None, max_tokens: Optional[int] = None, **kwargs):
    """client.chat.completions.create with the feature's configured model and max_tokens.
    With Anthropic the same call goes to Claude and comes back in the same shape."""
    model = model or models.model_for(feature)
    limit = max_tokens or models.FEATURES[feature].max_tokens
    if models.ANTHROPIC:
        return _claude(client, feature, model, limit, **kwargs)
    extra = _reasoning_options(model)
    if extra:
        limit += REASONING_HEADROOM
        kwargs["extra_body"] = {**extra, **(kwargs.get("extra_body") or {})}
    response = client.chat.completions.create(
        model=model,
        max_tokens=limit,
        **kwargs,
    )
    log_usage(response, feature, model)
    return response


# ---- Claude ----
# Callers speak OpenAI chat format (system/user/assistant messages, image_url parts,
# response_format, temperature). These turn that into one Messages API request and the
# answer back into .choices[0].message.content, so no caller changes.

# Claude thinks before it answers, and the thinking counts against max_tokens.
CLAUDE_HEADROOM = {models.BUILD: 16000, models.LIGHT: 4000, models.VISION: 8000}
JSON_ONLY = "Respond with only the JSON object: no code fences and no other text."


def _claude_part(part) -> Optional[dict]:
    if isinstance(part, str):
        return {"type": "text", "text": part}
    if part.get("type") == "text":
        return {"type": "text", "text": part.get("text") or ""}
    if part.get("type") == "image_url":
        url = (part.get("image_url") or {}).get("url") or ""
        if url.startswith("data:") and ";base64," in url:
            media, data = url[5:].split(";base64,", 1)
            return {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}
        return {"type": "image", "source": {"type": "url", "url": url}}
    return None


def claude_request(messages: list, json_mode: bool) -> tuple[str, list]:
    """OpenAI-style messages -> (system, Messages API messages)."""
    system, turns = [], []
    for message in messages:
        role, content = message.get("role"), message.get("content")
        if role == "system":
            system.append(content if isinstance(content, str) else " ".join(p.get("text", "") for p in content or []))
            continue
        parts = [content] if isinstance(content, str) else list(content or [])
        blocks = [block for block in (_claude_part(part) for part in parts) if block and (block["type"] != "text" or block["text"])]
        if blocks:
            turns.append({"role": "assistant" if role == "assistant" else "user", "content": blocks})
    if turns and turns[0]["role"] == "assistant":
        turns.insert(0, {"role": "user", "content": [{"type": "text", "text": "(Earlier in this conversation:)"}]})
    if json_mode:
        system.append(JSON_ONLY)
    return "\n\n".join(part for part in system if part), turns


def _claude(client, feature: str, model: str, limit: int, *, messages: list, response_format=None,
            temperature=None, extra_body=None, timeout=None, **_ignored):
    role = models.FEATURES[feature].role if feature in models.FEATURES else models.LIGHT
    json_mode = (response_format or {}).get("type") == "json_object"
    system, turns = claude_request(messages, json_mode)
    # Streamed, so long guides never hit the request timeout; get_final_message() collects it.
    # No server-side `fallbacks`: its targets are Opus models only, which Classroom never uses.
    with client.beta.messages.stream(
        model=model,
        max_tokens=limit + CLAUDE_HEADROOM.get(role, 4000),
        output_config={"effort": models.CLAUDE_EFFORT.get(role, "medium")},
        # As text blocks: the API answered a plain-string system prompt with
        # "system: Input should be a valid array". With no system prompt, none is sent.
        **({"system": [{"type": "text", "text": system}]} if system else {}),
        messages=turns,
        **({"timeout": timeout} if timeout else {}),
    ) as stream:
        message = stream.get_final_message()
    text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text").strip()
    if json_mode:
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    finish = {"end_turn": "stop", "max_tokens": "length", "refusal": "content_filter"}.get(message.stop_reason, "stop")
    if message.stop_reason == "refusal":
        logger.warning("claude refused feature=%s", feature)
        text = ""
    usage = message.usage
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text), finish_reason=finish)],
        usage=SimpleNamespace(
            prompt_tokens=(usage.input_tokens or 0) + (getattr(usage, "cache_read_input_tokens", 0) or 0),
            completion_tokens=usage.output_tokens or 0,
            prompt_tokens_details=SimpleNamespace(cached_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0),
        ),
    )
    log_usage(response, feature, model)
    return response
