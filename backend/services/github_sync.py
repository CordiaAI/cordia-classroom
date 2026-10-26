"""GitHub for programming assignments, through Composio.

A student links a repo to a Canvas assignment (connector_links: connector "github", kind "file",
cordia_id "repo:<item key>", external_id "owner/name", container_id the default branch). Then:
- the assignment sheet shows commit activity against the due date;
- the Tutor reads the repo (README, file list and the main source files) next to the instructions
  and rubric;
- every 6 hours, a repo with no commits in two days and the deadline under five days away gets one
  Dashboard nudge (at most once a day), like a stalled Google Doc draft.
Read-only: Cordia never writes to GitHub.
"""

import base64
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException

from database import get_supabase
from services import composio, sync_state

log = logging.getLogger(__name__)
EVERY = timedelta(hours=6)
QUIET = timedelta(hours=48)
REPO = re.compile(r"^[\w.-]{1,39}/[\w.-]{1,100}$")
CODE = (".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift",
        ".kt", ".scala", ".m", ".r", ".sql", ".sh", ".html", ".css", ".ipynb", ".md")
SKIP = re.compile(r"(^|/)(node_modules|vendor|dist|build|\.git|__pycache__|venv|\.venv|target|out|bin|obj)/|(\.min\.js|\.lock|package-lock\.json)$", re.I)
MAX_FILES = 8
MAX_CHARS = 40_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _list(data: dict, *keys: str) -> list:
    for key in keys:
        value = data.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for inner in value.values():
                if isinstance(inner, list):
                    return inner
    return data.get("items") if isinstance(data.get("items"), list) else []


def _split(full_name: str) -> tuple[str, str]:
    if not REPO.match(full_name or ""):
        raise HTTPException(status_code=422, detail="That isn't a GitHub repository name.")
    owner, name = full_name.split("/", 1)
    return owner, name


def repos(user_id: str, query: str = "") -> list[dict]:
    """The student's repos, most recently pushed first, filtered by the words they typed."""
    acct = composio.account_for(user_id, "github")
    data = composio.run(acct, user_id, "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", {"sort": "pushed", "per_page": 100})
    words = query.lower().split()
    out = []
    for repo in _list(data, "repositories", "repos", "data"):
        name = str(repo.get("full_name") or "")
        if not REPO.match(name) or any(word not in name.lower() for word in words):
            continue
        out.append({"full_name": name, "private": bool(repo.get("private")), "pushed": str(repo.get("pushed_at") or "")[:10],
                    "url": repo.get("html_url"), "branch": repo.get("default_branch") or "main"})
    return out[:25]


def _link(user_id: str, item_key: str) -> Optional[dict]:
    rows = get_supabase().table("connector_links").select("external_id,container_id,updated_at").eq("user_id", user_id) \
        .eq("connector", "github").eq("kind", "file").eq("cordia_id", f"repo:{item_key}").limit(1).execute().data or []
    return rows[0] if rows else None


def link_repo(user_id: str, item_key: str, full_name: str, branch: str = "main") -> dict:
    _split(full_name)
    composio.account_for(user_id, "github")
    get_supabase().table("connector_links").upsert({
        "user_id": user_id, "connector": "github", "kind": "file", "cordia_id": f"repo:{item_key}"[:300],
        "external_id": full_name, "container_id": (branch or "main")[:100], "removed_by_student": False, "updated_at": _now().isoformat(),
    }, on_conflict="user_id,connector,kind,cordia_id").execute()
    sync_state.update_stats(user_id, "github", {"linked": True})
    return repo_for(user_id, item_key) or {}


def unlink_repo(user_id: str, item_key: str) -> None:
    get_supabase().table("connector_links").delete().eq("user_id", user_id).eq("connector", "github").eq("kind", "file") \
        .eq("cordia_id", f"repo:{item_key}").execute()


def activity(user_id: str, full_name: str, now: Optional[datetime] = None, days: int = 14) -> dict:
    """Commits over the last `days` days: per-day counts (oldest first), the total and the latest."""
    now = now or _now()
    owner, name = _split(full_name)
    acct = composio.account_for(user_id, "github")
    since = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = composio.run(acct, user_id, "GITHUB_LIST_COMMITS", {"owner": owner, "repo": name, "since": since, "per_page": 100})
    per_day = [0] * days
    latest = None
    for commit in _list(data, "commits", "data"):
        info = commit.get("commit") or {}
        when = str((info.get("author") or {}).get("date") or (info.get("committer") or {}).get("date") or "")
        try:
            at = datetime.fromisoformat(when.replace("Z", "+00:00"))
        except ValueError:
            continue
        back = (now.date() - at.date()).days
        if 0 <= back < days:
            per_day[days - 1 - back] += 1
        if latest is None or at > latest["at"]:
            latest = {"at": at, "message": str(info.get("message") or "").split("\n")[0][:140], "url": commit.get("html_url")}
    return {"per_day": per_day, "total": sum(per_day),
            "last": {"at": latest["at"].isoformat(), "message": latest["message"], "url": latest["url"]} if latest else None}


def repo_for(user_id: str, item_key: str, with_activity: bool = True) -> Optional[dict]:
    link = _link(user_id, item_key)
    if not link:
        return None
    out = {"full_name": link["external_id"], "branch": link.get("container_id") or "main", "url": f"https://github.com/{link['external_id']}"}
    if with_activity:
        try:
            out["activity"] = activity(user_id, link["external_id"])
        except HTTPException:
            out["activity"] = None  # GitHub unreachable: the link still shows.
    return out


def _file(acct: str, user_id: str, owner: str, name: str, path: str, branch: str) -> str:
    data = composio.run(acct, user_id, "GITHUB_GET_REPOSITORY_CONTENT", {"owner": owner, "repo": name, "path": path, "ref": branch})
    item = data.get("content") if isinstance(data.get("content"), dict) else data
    encoded = item.get("content") if isinstance(item.get("content"), str) else ""
    if not encoded:
        return ""
    try:
        return base64.b64decode(encoded).decode("utf-8", "replace")
    except ValueError:
        return ""


def repo_text(user_id: str, item_key: str) -> str:
    """The repo as the Tutor reads it: its file list, README and main source files, within MAX_CHARS."""
    link = _link(user_id, item_key)
    acct = composio.active_accounts(user_id).get("github") if link else None
    if not acct:
        return ""
    owner, name = _split(link["external_id"])
    branch = link.get("container_id") or "main"
    tree = composio.run(acct, user_id, "GITHUB_GET_A_TREE", {"owner": owner, "repo": name, "tree_sha": branch, "recursive": "true"})
    blobs = [t for t in _list(tree, "tree") if t.get("type") == "blob" and not SKIP.search(str(t.get("path") or ""))]
    paths = [str(t.get("path")) for t in blobs]
    readme = next((p for p in paths if p.lower() in {"readme.md", "readme.txt", "readme"}), None)
    code = sorted((t for t in blobs if str(t.get("path")).lower().endswith(CODE) and str(t.get("path")) != readme and int(t.get("size") or 0) <= 30_000),
                  key=lambda t: (str(t.get("path")).count("/"), -int(t.get("size") or 0)))[:MAX_FILES]
    parts = [f"REPOSITORY: {owner}/{name} (branch {branch})", "FILES:\n" + "\n".join(paths[:300])]
    used = sum(len(p) for p in parts)
    for path in ([readme] if readme else []) + [str(t.get("path")) for t in code]:
        try:
            text = _file(acct, user_id, owner, name, path, branch)
        except HTTPException:
            continue
        if not text.strip():
            continue
        text = text[: max(0, MAX_CHARS - used)]
        if not text:
            break
        parts.append(f"--- {path} ---\n{text}")
        used += len(text)
    return "\n\n".join(parts)


def quiet(per_day: list[int], last_at: Optional[str], now: datetime) -> bool:
    """No commit in the last two days."""
    if last_at:
        try:
            return now - datetime.fromisoformat(last_at) >= QUIET
        except ValueError:
            pass
    return not any(per_day[-2:])


def check_repos(user_id: str) -> int:
    """Every 6 hours: nudge once a day about a linked repo that's gone quiet near its deadline."""
    from routers.calendar import calendar_for
    rows = get_supabase().table("connector_links").select("cordia_id,external_id").eq("user_id", user_id).eq("connector", "github") \
        .eq("kind", "file").like("cordia_id", "repo:%").execute().data or []
    items = {i["id"]: i for i in calendar_for(user_id).get("items") or []}
    now = _now()
    stats = sync_state.get(user_id, "github").get("stats") or {}
    nudged = dict(stats.get("nudged") or {})
    count = 0
    for row in rows:
        key = row["cordia_id"].split(":", 1)[1]
        item = items.get(key)
        due = datetime.fromisoformat(str(item["due_at"]).replace("Z", "+00:00")) if item and item.get("due_at") else None
        if not item or item.get("done") or not due or not now < due <= now + timedelta(days=5) or nudged.get(key) == now.date().isoformat():
            continue
        try:
            act = activity(user_id, row["external_id"], now)
        except HTTPException:
            continue
        if quiet(act["per_day"], (act["last"] or {}).get("at"), now):
            sync_state.add_alert(user_id, "github", {"kind": "repo_quiet", "item_key": key, "title": item.get("title") or "Assignment",
                                                     "course": item.get("course"), "repo": row["external_id"], "at": now.isoformat(),
                                                     "days": max(1, (due - now).days)})
            nudged[key] = now.date().isoformat()
            count += 1
    sync_state.record(user_id, "github", stats={"repos_tracked": len(rows), "nudged": nudged})
    return count


def due(now: datetime) -> list[dict]:
    cutoff = (now - EVERY).isoformat()
    return get_supabase().table("connector_settings").select("user_id,last_synced_at").eq("connector", "github") \
        .eq("stats->>linked", "true").or_(f"last_synced_at.is.null,last_synced_at.lt.{cutoff}").limit(20).execute().data or []
