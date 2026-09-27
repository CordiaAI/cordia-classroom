"""Shared Cordia Tutor session state for the web app and browser side panel."""

from datetime import datetime, timezone
from hashlib import sha256
from uuid import uuid4

from fastapi import HTTPException

from database import get_supabase


TUTOR_SKILLS = {
    "explain": {
        "label": "Explain",
        "version": 1,
        "available": True,
        "outcome": "Teach the selected material using the student's learning guidance.",
        "complete_when": "The answer is grounded in the selected source and resolves the student's question.",
        "tools": ["read_context"],
        "requires_context": True,
        "confirm": [],
        "instruction": "Explain only from the selected source and make the reasoning easy to follow.",
    },
    "capture": {
        "label": "Capture",
        "version": 1,
        "available": True,
        "outcome": "Read the student-approved active browser page as study material.",
        "complete_when": "The approved page is extracted or a specific access failure is reported.",
        "tools": ["read_page"],
        "requires_context": False,
        "confirm": [],
        "instruction": "Identify the useful study material in the approved browser page without inventing missing content.",
    },
    "build_guide": {
        "label": "Build guide",
        "version": 1,
        "available": True,
        "outcome": "Create a source-grounded study guide in the matching class.",
        "complete_when": "A complete guide with flashcards is saved with its class and source provenance.",
        "tools": ["read_context", "create_guide"],
        "requires_context": True,
        "confirm": [],
        "instruction": "Create a complete study guide from the selected source and preserve its class and provenance.",
    },
    "practice": {
        "label": "Practice",
        "version": 1,
        "available": True,
        "outcome": "Create source-grounded practice problems in the matching class.",
        "complete_when": "A practice guide is saved in the source material's class.",
        "tools": ["read_context", "create_guide"],
        "requires_context": True,
        "confirm": [],
        "instruction": "Create practice problems that test the selected source without introducing unsupported facts.",
    },
    "retain": {
        "label": "Retain",
        "version": 1,
        "available": True,
        "outcome": "Help the student understand and remember missed material.",
        "complete_when": "The missed concept and a usable memory cue are explained from the source.",
        "tools": ["read_context"],
        "requires_context": True,
        "confirm": [],
        "instruction": "Teach the distinction behind the missed answer conversationally; use the guide as the authority and general knowledge only to clarify it.",
    },
    "plan": {
        "label": "Plan",
        "version": 1,
        "available": True,
        "outcome": "Turn course deadlines and study material into a practical study plan.",
        "complete_when": "The plan covers known deadlines without claiming unconfirmed calendar writes.",
        "tools": ["read_context", "read_deadlines"],
        "requires_context": False,
        "confirm": ["calendar_write"],
        "instruction": "Produce a realistic study plan from known deadlines; do not claim calendar changes without confirmation.",
    },
    "find_material": {
        "label": "Find material",
        "version": 1,
        "available": True,
        "outcome": "Locate relevant material by following bounded course links from the student-approved active page.",
        "complete_when": "Relevant sources are extracted with their original locations and the strongest safe source is opened.",
        "tools": ["read_page", "navigate_same_origin"],
        "requires_context": False,
        "confirm": [],
        "instruction": "Follow only bounded same-origin course links from the approved active page and report exactly which relevant sources were found.",
    },
    "organize": {
        "label": "Organize",
        "version": 1,
        "available": True,
        "outcome": "Place learning material in the appropriate existing class.",
        "complete_when": "The material is assigned once to the correct existing class.",
        "tools": ["read_context", "organize_material"],
        "requires_context": True,
        "confirm": [],
        "instruction": "Organize material by its real course and source; do not create duplicate classes or guides.",
    },
}
DEFAULT_SKILL = "explain"
MAX_SESSION_MESSAGES = 60
MAX_ACTION_HISTORY = 30
BROWSER_TTL_SECONDS = 45
RUN_TTL_SECONDS = 180
TUTOR_SAFETY_POLICY = (
    "Never take graded assessments, submit assignments, change grades, or impersonate the student. "
    "Require explicit confirmation before downloads, calendar changes, external messages, or learning-platform writes."
)
BROWSER_COMMAND_PERMISSIONS = {
    "capture_current_page": "read_page",
    "find_material_current_page": "read_page",
}


def _history_entry(result: dict) -> dict:
    entry = {
        "status": result.get("status") or "completed",
        "action": result.get("action") or "answered",
        "at": datetime.now(timezone.utc).isoformat(),
    }
    if result.get("error"):
        entry["error"] = str(result["error"])[:500]
    if result.get("evidence"):
        entry["evidence_count"] = len(result["evidence"])
    return entry


def infer_tutor_skill(message: str) -> str:
    text = (message or "").lower()
    if any(term in text for term in ("practice problem", "practice question", "practice guide")):
        return "practice"
    if "guide" in text and any(term in text for term in ("create", "make", "build", "generate", "turn this into")):
        return "build_guide"
    if any(term in text for term in ("flashcard", "retain", "remember this")):
        return "retain"
    if any(term in text for term in ("schedule", "study plan", "calendar", "deadline")):
        return "plan"
    if any(term in text for term in ("find material", "find notes", "look in canvas", "search canvas")):
        return "find_material"
    if any(term in text for term in ("organize", "move this", "classify")):
        return "organize"
    if any(term in text for term in ("capture", "read this page", "read this document")):
        return "capture"
    return DEFAULT_SKILL


def validate_skill(skill: str | None, message: str = "") -> str:
    selected = skill or infer_tutor_skill(message)
    if selected not in TUTOR_SKILLS:
        raise HTTPException(status_code=400, detail="Unknown Tutor skill")
    if not TUTOR_SKILLS[selected]["available"]:
        raise HTTPException(status_code=409, detail=f"{TUTOR_SKILLS[selected]['label']} is not available yet")
    return selected


def tutor_skill_instruction(skill: str | None) -> str:
    return TUTOR_SKILLS.get(skill or DEFAULT_SKILL, TUTOR_SKILLS[DEFAULT_SKILL])["instruction"]


def _owned_session(user_id: str, session_id: str):
    result = (
        get_supabase().table("tutor_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Tutor session not found")
    return result.data[0]


def get_or_create_tutor_session(user_id: str):
    table = get_supabase().table("tutor_sessions")
    result = table.select("*").eq("user_id", user_id).limit(1).execute()
    if result.data:
        return result.data[0]
    created = table.upsert({"user_id": user_id}, on_conflict="user_id").execute()
    if not created.data:
        # A concurrent request may have won the unique-user upsert.
        result = table.select("*").eq("user_id", user_id).limit(1).execute()
        if result.data:
            return result.data[0]
        raise HTTPException(status_code=500, detail="Tutor session could not be created")
    return created.data[0]


def _browser_is_available(row: dict) -> bool:
    if not row.get("browser_available") or not row.get("browser_last_seen_at"):
        return False
    try:
        seen = datetime.fromisoformat(str(row["browser_last_seen_at"]).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - seen).total_seconds() <= BROWSER_TTL_SECONDS
    except (TypeError, ValueError):
        return False


def _run_is_stale(row: dict) -> bool:
    if row.get("status") not in {"running", "waiting_browser"} or not row.get("run_started_at"):
        return False
    try:
        started = datetime.fromisoformat(str(row["run_started_at"]).replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - started).total_seconds() > RUN_TTL_SECONDS
    except (TypeError, ValueError):
        return False


def public_tutor_session(row: dict) -> dict:
    browser_content = row.get("browser_content") or ""
    return {
        "id": row["id"],
        "active_skill": row.get("active_skill") or DEFAULT_SKILL,
        "current_goal": row.get("current_goal") or "",
        "active_class_id": row.get("active_class_id"),
        "active_guide_id": row.get("active_guide_id"),
        "conversation_version": row.get("conversation_version") or 0,
        "status": "idle" if _run_is_stale(row) else (row.get("status") or "idle"),
        "messages": row.get("messages") or [],
        "browser_available": _browser_is_available(row),
        "browser_observation": row.get("browser_observation") or {},
        "browser_content_available": bool(browser_content),
        "browser_content_revision": sha256(browser_content.encode()).hexdigest()[:12] if browser_content else "",
        "browser_command": row.get("browser_command") or {},
        "permission_scope": row.get("permission_scope") or [],
        "last_action_result": row.get("last_action_result") or {},
        "action_history": row.get("action_history") or [],
        "skills": [{"id": key, **definition} for key, definition in TUTOR_SKILLS.items()],
        "updated_at": row.get("updated_at"),
    }


def tutor_browser_content(user_id: str) -> dict:
    row = get_or_create_tutor_session(user_id)
    content = row.get("browser_content") or ""
    return {
        "content": content,
        "observation": row.get("browser_observation") or {},
        "revision": sha256(content.encode()).hexdigest()[:12] if content else "",
    }


def update_browser_context(user_id: str, session_id: str, update: dict):
    row = _owned_session(user_id, session_id)
    action_result = update.get("last_action_result")
    completes_command = False
    if action_result is not None:
        command = row.get("browser_command") or {}
        if command.get("id") != action_result.get("command_id"):
            raise HTTPException(status_code=409, detail="Browser command is no longer active")
        if command.get("status") != "pending":
            return row
        if row.get("status") != "waiting_browser" or not row.get("run_id"):
            raise HTTPException(status_code=409, detail="Tutor is no longer waiting for this browser result")
        completes_command = True

    payload = {
        "browser_available": bool(update.get("browser_available")),
        "permission_scope": update.get("permission_scope") or ["read_page"],
        "browser_last_seen_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if update.get("browser_observation") is not None:
        payload["browser_observation"] = update["browser_observation"]
    if update.get("browser_content") is not None:
        payload["browser_content"] = update["browser_content"]
    if action_result is not None:
        payload["last_action_result"] = action_result
        command = row.get("browser_command") or {}
        payload["browser_command"] = {
            **command,
            "status": action_result.get("status") or "completed",
        }
        count = action_result.get("section_count") or 0
        evidence = action_result.get("evidence") or []
        if action_result.get("status") == "failed":
            text = f"Browser action failed: {action_result.get('error') or 'The current page could not be read.'}"
        elif action_result.get("action") == "find_material_current_page":
            text = f"Found {len(evidence)} relevant source{'s' if len(evidence) != 1 else ''} on the current page."
        else:
            text = f"Captured {count} study section{'s' if count != 1 else ''} from the current page."
        messages = list(row.get("messages") or [])
        messages.append({"role": "ai", "text": text, "evidence": evidence})
        payload.update({
            "status": "idle",
            "run_id": None,
            "run_started_at": None,
            "messages": messages[-MAX_SESSION_MESSAGES:],
            "conversation_version": (row.get("conversation_version") or 0) + 1,
            "action_history": [*(row.get("action_history") or []), _history_entry(action_result)][-MAX_ACTION_HISTORY:],
        })

    query = (
        get_supabase().table("tutor_sessions")
        .update(payload)
        .eq("id", session_id)
        .eq("user_id", user_id)
    )
    if completes_command:
        query = (
            query.eq("conversation_version", row.get("conversation_version") or 0)
            .eq("run_id", row["run_id"])
            .eq("status", "waiting_browser")
        )
    result = query.execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Tutor session not found")
    return result.data[0]


def queue_browser_command(user_id: str, turn: dict, command_type: str, goal: str):
    required_permission = BROWSER_COMMAND_PERMISSIONS.get(command_type)
    if not required_permission:
        raise HTTPException(status_code=400, detail="Unsupported browser command")
    if required_permission not in (turn.get("permission_scope") or []):
        raise HTTPException(status_code=403, detail=f"Browser permission required: {required_permission}")
    command = {
        "id": str(uuid4()),
        "type": command_type,
        "goal": goal,
        "required_permission": required_permission,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = (
        get_supabase().table("tutor_sessions")
        .update({"browser_command": command})
        .eq("id", turn["id"])
        .eq("user_id", user_id)
        .eq("run_id", turn["run_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Browser command could not be queued")
    turn.update(result.data[0])
    return command


def append_tutor_message(user_id: str, text: str):
    """Post a Tutor reply outside a chat turn (e.g. feedback on a missed practice answer)."""
    row = get_or_create_tutor_session(user_id)
    messages = list(row.get("messages") or [])
    messages.append({"role": "ai", "text": text})
    get_supabase().table("tutor_sessions").update({
        "messages": messages[-MAX_SESSION_MESSAGES:],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", row["id"]).eq("user_id", user_id).execute()


def wait_for_browser_result(user_id: str, turn: dict, answer: str):
    messages = list(turn.get("messages") or [])
    messages.append({"role": "ai", "text": answer})
    result = (
        get_supabase().table("tutor_sessions")
        .update({
            "status": "waiting_browser",
            "messages": messages[-MAX_SESSION_MESSAGES:],
            "last_action_result": {"status": "pending", "action": "browser_command_queued"},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", turn["id"])
        .eq("user_id", user_id)
        .eq("run_id", turn["run_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Browser action could not be synchronized")
    return result.data[0]


def update_tutor_skill(user_id: str, session_id: str, skill: str):
    _owned_session(user_id, session_id)
    selected = validate_skill(skill)
    result = (
        get_supabase().table("tutor_sessions")
        .update({
            "active_skill": selected,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", session_id)
        .eq("user_id", user_id)
        .eq("status", "idle")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Wait for Cordia Tutor to finish before changing skills")
    return result.data[0]


def claim_tutor_turn(
    user_id: str,
    session_id: str,
    expected_version: int | None,
    message: str,
    requested_skill: str | None,
    guide_id: str | None = None,
    class_id: str | None = None,
):
    row = _owned_session(user_id, session_id)
    version = row.get("conversation_version") or 0
    if expected_version is not None and expected_version != version:
        raise HTTPException(status_code=409, detail="Tutor conversation changed. Refresh and try again.")
    if row.get("status") in {"running", "waiting_browser"}:
        if not _run_is_stale(row):
            raise HTTPException(status_code=409, detail="Cordia Tutor is already working on a request.")
        recovered = (
            get_supabase().table("tutor_sessions")
            .update({"status": "idle", "run_id": None, "run_started_at": None})
            .eq("id", session_id)
            .eq("user_id", user_id)
            .eq("run_id", row.get("run_id"))
            .execute()
        )
        if not recovered.data:
            raise HTTPException(status_code=409, detail="Cordia Tutor is already working on a request.")
        row = recovered.data[0]

    skill = validate_skill(requested_skill, message)
    run_id = str(uuid4())
    messages = list(row.get("messages") or [])[-(MAX_SESSION_MESSAGES - 1):]
    messages.append({"role": "user", "text": message})
    payload = {
        "status": "running",
        "run_id": run_id,
        "run_started_at": datetime.now(timezone.utc).isoformat(),
        "active_skill": skill,
        "current_goal": message,
        "active_guide_id": guide_id,
        "active_class_id": class_id,
        "messages": messages,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = (
        get_supabase().table("tutor_sessions")
        .update(payload)
        .eq("id", session_id)
        .eq("user_id", user_id)
        .eq("conversation_version", version)
        .eq("status", "idle")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Cordia Tutor received another request first. Refresh and try again.")
    claimed = result.data[0]
    claimed["run_id"] = run_id
    claimed["active_skill"] = skill
    claimed["conversation_version"] = version
    return claimed


def complete_tutor_turn(user_id: str, turn: dict, response: dict):
    messages = list(turn.get("messages") or [])
    assistant_message = {"role": "ai", "text": response.get("answer") or ""}
    if response.get("source"):
        assistant_message["source"] = response["source"]
    if response.get("guide"):
        assistant_message["guide"] = response["guide"]
    messages.append(assistant_message)
    next_version = (turn.get("conversation_version") or 0) + 1
    action_result = {
        "status": "completed",
        "action": response.get("action") or "answered",
    }
    result = (
        get_supabase().table("tutor_sessions")
        .update({
            "status": "idle",
            "run_id": None,
            "run_started_at": None,
            "messages": messages[-MAX_SESSION_MESSAGES:],
            "conversation_version": next_version,
            "last_action_result": action_result,
            "action_history": [*(turn.get("action_history") or []), _history_entry(action_result)][-MAX_ACTION_HISTORY:],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", turn["id"])
        .eq("user_id", user_id)
        .eq("run_id", turn["run_id"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="Tutor response could not be synchronized")
    return result.data[0]


def fail_tutor_turn(user_id: str, turn: dict | None, detail: str):
    if not turn:
        return
    action_result = {"status": "failed", "error": detail[:500]}
    (
        get_supabase().table("tutor_sessions")
        .update({
            "status": "idle",
            "run_id": None,
            "run_started_at": None,
            "last_action_result": action_result,
            "action_history": [*(turn.get("action_history") or []), _history_entry(action_result)][-MAX_ACTION_HISTORY:],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", turn["id"])
        .eq("user_id", user_id)
        .eq("run_id", turn["run_id"])
        .execute()
    )
