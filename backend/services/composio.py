"""Composio connected accounts for Classroom's connectors (Settings > Connectors).

Classroom and Cordia Assistant use the same Composio project and the same user id (the student's
Classroom login), so an app connected in either one is connected in both. Composio is the record
of what is connected; Classroom stores nothing about it.
"""

import logging
import os
from urllib.parse import urlparse

import requests
from fastapi import HTTPException

API = "https://backend.composio.dev/api/v3"
log = logging.getLogger(__name__)

# Connector id (shared with Cordia Assistant) -> Composio toolkit.
TOOLKITS = {
    "gcal": "googlecalendar",
    "gtasks": "googletasks",
    "gdrive": "googledrive",
    "gdocs": "googledocs",
    "notion": "notion",
}
# The Assistant's optional overrides for an auth config on our own OAuth app; same names here.
AUTH_CONFIG_ENV = {
    "gcal": "COMPOSIO_AUTH_CONFIG_GCAL",
    "gtasks": "COMPOSIO_AUTH_CONFIG_GTASKS",
    "gdrive": "COMPOSIO_AUTH_CONFIG_GDRIVE",
    "gdocs": "COMPOSIO_AUTH_CONFIG_GDOCS",
    "notion": "COMPOSIO_AUTH_CONFIG_NOTION",
}
_auth_configs: dict[str, str] = {}


def configured() -> bool:
    return bool(os.getenv("COMPOSIO_API_KEY"))


def _headers() -> dict:
    key = os.getenv("COMPOSIO_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Connectors aren't set up yet.")
    return {"x-api-key": key, "content-type": "application/json"}


def _request(method: str, path: str, **kwargs):
    try:
        response = requests.request(method, API + path, headers=_headers(), timeout=20, **kwargs)
    except requests.RequestException as error:
        log.warning("composio %s %s failed: %s", method, path, error)
        raise HTTPException(status_code=502, detail="Couldn't reach the app. Try again in a minute.") from error
    return response


def _auth_config(connector: str) -> str:
    """The env override if set, else the project's Composio-managed config, created on first use."""
    override = os.getenv(AUTH_CONFIG_ENV[connector], "")
    if override:
        return override
    toolkit = TOOLKITS[connector]
    if toolkit in _auth_configs:
        return _auth_configs[toolkit]
    listed = _request("GET", "/auth_configs", params={"toolkit_slug": toolkit, "limit": 50})
    items = (listed.json() or {}).get("items", []) if listed.ok else []
    found = next((c.get("id") for c in items if (c.get("toolkit") or {}).get("slug") == toolkit
                  and c.get("status") == "ENABLED" and c.get("is_composio_managed")), None)
    if not found:
        created = _request("POST", "/auth_configs", json={
            "toolkit": {"slug": toolkit},
            "auth_config": {"type": "use_composio_managed_auth", "name": f"Cordia {toolkit}"},
        })
        if not created.ok:
            log.warning("composio auth config failed %s %s %s", toolkit, created.status_code, created.text[:300])
            raise HTTPException(status_code=503, detail="This connection isn't set up yet. Try again later.")
        body = created.json() or {}
        found = (body.get("auth_config") or {}).get("id") or body.get("id")
    if not found:
        raise HTTPException(status_code=503, detail="This connection isn't set up yet. Try again later.")
    _auth_configs[toolkit] = found
    return found


def active_accounts(user_id: str) -> dict[str, str]:
    """Connector id -> the student's active Composio account id."""
    if not configured():
        return {}
    response = _request("GET", "/connected_accounts", params={"user_ids": user_id, "statuses": "ACTIVE", "limit": 100})
    if not response.ok:
        log.warning("composio accounts failed %s %s", response.status_code, response.text[:300])
        return {}
    by_toolkit = {toolkit: connector for connector, toolkit in TOOLKITS.items()}
    found = {}
    for item in (response.json() or {}).get("items", []):
        # Checked here too: only this student's live accounts, whatever the filter did.
        if item.get("user_id") != user_id or item.get("status") != "ACTIVE":
            continue
        connector = by_toolkit.get((item.get("toolkit") or {}).get("slug"))
        if connector and connector not in found:
            found[connector] = item["id"]
    return found


def account_for(user_id: str, connector: str) -> str:
    account = active_accounts(user_id).get(connector)
    if not account:
        raise HTTPException(status_code=409, detail="Connect this app first.")
    return account


def start_link(user_id: str, connector: str, callback_url: str) -> str:
    """A Composio sign-in link; Composio sends the student back to callback_url afterwards."""
    response = _request("POST", "/connected_accounts/link", json={
        "auth_config_id": _auth_config(connector),
        "user_id": user_id,
        "callback_url": callback_url,
    })
    url = (response.json() or {}).get("redirect_url") if response.ok else None
    if not url:
        log.warning("composio link failed %s %s", response.status_code, response.text[:300])
        raise HTTPException(status_code=502, detail="Couldn't start the connection. Try again in a minute.")
    return url


def disconnect(user_id: str, connector: str) -> None:
    for name, account in active_accounts(user_id).items():
        if name == connector:
            _request("DELETE", f"/connected_accounts/{account}")


def run(account_id: str, user_id: str, slug: str, arguments: dict) -> dict:
    """Run one Composio tool for the student's account and return its data, or raise a 502."""
    response = _request("POST", f"/tools/execute/{slug}", json={
        "connected_account_id": account_id,
        "user_id": user_id,
        # Without a version Composio runs each tool's oldest release; argument shapes follow the latest.
        "version": "latest",
        "arguments": arguments,
    })
    body = response.json() if response.content else {}
    if not response.ok or body.get("successful") is False:
        log.warning("composio %s failed %s %s", slug, response.status_code, str(body.get("error"))[:300])
        raise HTTPException(status_code=502, detail="The app didn't respond. Try again in a minute.")
    return body.get("data") or {}


# Files Composio hands back for download live on its own storage.
DOWNLOAD_HOSTS = (".amazonaws.com", ".composio.dev")


def download(url: str, limit: int = 20 * 1024 * 1024) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(DOWNLOAD_HOSTS):
        raise HTTPException(status_code=502, detail="That file couldn't be downloaded.")
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        data = b""
        for chunk in response.iter_content(65536):
            data += chunk
            if len(data) > limit:
                raise HTTPException(status_code=413, detail="That file is over 20 MB.")
        return data
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail="That file couldn't be downloaded.") from error
