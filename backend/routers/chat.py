"""POST /chat: every Tutor message, from the web app and the extension side panel.

A message is answered by one of: a browser command (capture / find material),
organizing a guide or note into a class, building a guide or practice set from
the selected material, editing the selected guide's outline, an app action (open a guide, class or
page; move, rename or delete a guide; make a class, notes page or guide), or a grounded Tutor reply.
"""
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from auth_utils import get_user_id
from ids import require_uuid
from database import get_supabase
from rate_limit import limiter
from routers import connectors, folders, guides, smart_notes
from routers.quiz import start_quiz_warmup
from schemas import ChatRequest, ChatResponse
from services.entitlements import record, require
from services.guidance import learning_guidance, style_instruction
from services.llm import (
    answer_question, edit_outline, explain_retain_answer, generate_practice_guide, generate_study_guide, plan_app_action, write_visual_text,
    study_guide_is_complete, study_guide_to_flashcards,
)
from services import study_helper
from services.text_processing import asked_as, chunk_text, clean_text, html_to_text
from services.tutor_voice import ground_general_answer, plain_opening
from services.tutor_sessions import (
    TUTOR_SAFETY_POLICY, claim_tutor_turn, complete_tutor_turn, fail_tutor_turn,
    public_tutor_session, queue_browser_command, tutor_skill_instruction, wait_for_browser_result,
)

router = APIRouter(tags=["tutor"])

MAX_CONTENT_LENGTH = 500_000
TUTOR_CONTEXT_TOKENS = int(os.getenv("CLASSROOM_TUTOR_CONTEXT_TOKENS", "128000"))
TUTOR_RESERVED_TOKENS = 6_000
CONTEXT_FULL = "context_window_full"
# The source on a general answer (no material selected), shown instead of "Based on <material>".
GENERAL_SOURCE = {"type": "general", "title": "General knowledge, not your study material"}
# An instruction to change the selected guide's outline: "fix the spelling of GihHub", "change X to Y",
# "add a section on Z to my notes". Questions ("what does…", "explain…") are never edits.
OUTLINE_EDIT_VERB = re.compile(
    r"\b(?:add|remove|delete|rewrite|reword|edit|update|fix|correct|change|replace|rename|respell|spell|"
    r"capitali[sz]e|bold|shorten|expand|simplify|reorganize|reorder|insert|include|merge|split|move|put)\b",
    re.IGNORECASE,
)
# Verbs that only mean an edit when the request also names a part of the outline.
OUTLINE_EDIT_TARGET = re.compile(r"\b(?:outline|notes?|sections?|points?|bullets?|headings?|key points|lines?|spelling|typos?|words?|titles?)\b", re.IGNORECASE)
OUTLINE_EDIT_ALWAYS = re.compile(r"\b(?:fix|correct|change|replace|rename|respell|capitali[sz]e)\b", re.IGNORECASE)
QUESTION_START = re.compile(r"^\s*(?:what|why|how|who|when|where|which|explain|describe|define|summari[sz]e|tell me|is|are|does|do)\b", re.IGNORECASE)


def _asks_to_edit_outline(question: str) -> bool:
    if QUESTION_START.search(question) or not OUTLINE_EDIT_VERB.search(question):
        return False
    return bool(OUTLINE_EDIT_ALWAYS.search(question) or OUTLINE_EDIT_TARGET.search(question))


# Requests to do something in the app ("open my BUS 101 class", "put this guide in Biology",
# "rename it to Week 3", "make a class called Art History"). The planner decides; it can say none.
APP_ALWAYS = re.compile(r"\b(?:open|go to|take me|bring up|pull up|navigate|move|put|file|rename|delete|trash)\b", re.IGNORECASE)
APP_VERB = re.compile(r"\b(?:create|make|start|new|add|show me)\b", re.IGNORECASE)
APP_NOUN = re.compile(
    r"\b(?:class(?:es)?|folders?|courses?|library|calendar|dashboard|progress|settings|canvas|assistant|"
    r"page|guides?|study ?guides?|notes? page|flashcards|quiz|practice)\b",
    re.IGNORECASE,
)
PAGES = {
    "dashboard": ("/dashboard", "Dashboard"), "library": ("/library", "Library"), "calendar": ("/calendar", "Calendar"),
    "progress": ("/progress", "Progress"), "settings": ("/settings", "Settings"), "canvas": ("/canvas", "Canvas"),
    "assistant": ("/assistant", "Assistant"),
}
GUIDE_TABS = {"flashcards": "/flashcards/study?guideId={id}", "quiz": "/quiz/{id}", "practice": "/practice/{id}"}


# "Don't…", "please don't…", "let's not…": nothing to do in the app.
SAYS_NOT = re.compile(r"^\s*+(?:(?:ok(?:ay)?|so|and|no|please)[,!.]?\s++)*+(?:don['’]?t|do\s++not|never|let['’]?s\s++not)\b",
                      re.IGNORECASE)


def _asks_for_app_action(question: str) -> bool:
    # A question ("open Learn for the art history guide?") asks about the app, not for an action in it, unless
    # it's a polite request ("can you open my Biology class?"); neither does a "don't".
    if QUESTION_START.search(question) or SAYS_NOT.search(question):
        return False
    if question.rstrip().endswith("?") and not study_helper.POLITE_START.search(question):
        return False
    return bool(APP_ALWAYS.search(question) or (APP_VERB.search(question) and APP_NOUN.search(question)))


# "Make a diagram of the stages of mitosis", "visualize the water cycle", "can you draw a timeline of…".
VISUAL_REQUEST = re.compile(
    r"^\s*visuali[sz]e\b|\b(?:make|create|draw|generate|build|show|give|design|sketch)\b.{0,40}?"
    r"\b(?:visual|diagram|chart|infographic|graphic|illustration|mind ?map|flow ?chart|timeline|concept map)s?\b",
    re.IGNORECASE,
)


PRACTICE_REQUEST = re.compile(r"\b(create|make|generate|build)\b.*\bpractice\b.*\b(problems?|questions?|guide)\b", re.IGNORECASE)
BROWSER_SKILLS = {
    "capture": ("capture_current_page", "Working in the browser side panel now. Keep it open while I read the current page."),
    "find_material": ("find_material_current_page", "Looking for relevant study material linked from the current page."),
}


@dataclass
class Material:
    """What the student asked about: an owned guide or note, an attached file or page, or nothing."""
    content: str
    source: Optional[dict] = None
    guide: Optional[dict] = None
    note: Optional[dict] = None

    @property
    def owned(self) -> dict:
        return self.guide or self.note or {}

    @property
    def title(self) -> str:
        return (self.source or {}).get("title") or "Study Material"


def _owned_row(table: str, columns: str, row_id: str, user_id: str, kind: str) -> dict:
    require_uuid(row_id, f"{kind} ID")
    result = get_supabase().table(table).select(columns).eq("id", row_id).eq("user_id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{kind.capitalize()} not found")
    return result.data[0]


def _assignment_text(user_id: str, key: str) -> tuple[str, Optional[dict]]:
    """The assignment's instructions and rubric, so the Tutor can check work against each criterion."""
    from routers.plans import canvas_detail
    detail = canvas_detail(user_id, key)
    if not detail:
        return "", None
    criteria = "\n".join(
        f"{index}. {c.get('description') or ''} ({c.get('points') or 0} pts)" + (f": {c['long_description']}" if c.get("long_description") else "")
        for index, c in enumerate(detail.get("rubric") or [], 1))
    from services import docs_sync, github_sync
    try:
        draft = docs_sync.draft_text(user_id, key)
    except HTTPException:
        draft = ""  # Docs unreachable: the Tutor still has the instructions and rubric.
    try:
        code = github_sync.repo_text(user_id, key)
    except HTTPException:
        code = ""  # GitHub unreachable: same.
    text = "\n\n".join(filter(None, [
        f"ASSIGNMENT: {detail.get('title') or 'Assignment'}" + (f" ({detail['points_possible']} points)" if detail.get("points_possible") else ""),
        f"INSTRUCTIONS:\n{detail['description']}" if detail.get("description") else "",
        f"RUBRIC CRITERIA (numbered):\n{criteria}" if criteria else "",
        f"THE STUDENT'S DRAFT (linked Google Doc):\n{draft[:60000]}" if draft.strip() else "",
        f"THE STUDENT'S CODE (linked GitHub repo):\n{code}" if code.strip() else "",
    ]))
    return text, {"type": "assignment", "id": key, "title": detail.get("title") or "Assignment"}


def _load_material(body: ChatRequest, user_id: str) -> Material:
    """A saved guide or note is read from the database; the client's copy is only a fallback."""
    material = _load_owned_material(body, user_id)
    if not body.assignment_key:
        return material
    text, source = _assignment_text(user_id, body.assignment_key)
    if not text:
        return material
    # The assignment comes first; anything else the student picked (a draft, guide or file) follows it.
    work = f"\n\nALSO SELECTED BY THE STUDENT:\n{material.content}" if material.content.strip() else ""
    return Material((text + work)[:MAX_CONTENT_LENGTH], material.source or source, guide=material.guide, note=material.note)


def _load_owned_material(body: ChatRequest, user_id: str) -> Material:
    sent = (body.content or "")[:MAX_CONTENT_LENGTH]
    if body.guide_id:
        guide = _owned_row("study_guides", "id,title,folder_id,study_guide,notes,source_url", body.guide_id, user_id, "guide")
        text = guide.get("study_guide") or guide.get("notes") or sent
        source = {"type": "study_guide", "id": guide["id"], "title": guide.get("title") or "Study Guide"}
        return Material(text[:MAX_CONTENT_LENGTH], source, guide=guide)
    if body.note_id:
        note = _owned_row("smart_notes", "id,title,folder_id,content", body.note_id, user_id, "note")
        text = html_to_text(note.get("content") or sent)
        source = {"type": "smartnote", "id": note["id"], "title": note.get("title") or "Untitled Notes"}
        return Material(text[:MAX_CONTENT_LENGTH], source, note=note)
    if body.context_title and sent:
        source = {"type": "browser" if body.context_url else "file", "title": body.context_title.strip() or "Attached file"}
        if body.context_url:
            source["url"] = body.context_url
        return Material(sent, source)
    return Material(sent)


def _finish(user_id: str, turn: Optional[dict], response: ChatResponse) -> ChatResponse:
    """Save the reply to the Tutor session (when there is one) and return it with the updated session."""
    if not turn:
        return response
    row = complete_tutor_turn(user_id, turn, response.model_dump(exclude_none=True))
    return response.model_copy(update={"skill": turn["active_skill"], "session": public_tutor_session(row)})


def _run_browser_skill(user_id: str, turn: Optional[dict], skill: str, question: str) -> ChatResponse:
    if not turn or not public_tutor_session(turn)["browser_available"]:
        return _finish(user_id, turn, ChatResponse(
            answer="Open the Cordia Classroom browser side panel, then try the browser request again.",
            action="browser_unavailable",
        ))
    command, answer = BROWSER_SKILLS[skill]
    queue_browser_command(user_id, turn, command, question)
    row = wait_for_browser_result(user_id, turn, answer)
    return ChatResponse(answer=answer, action="browser_command_queued", skill=skill, session=public_tutor_session(row))


def _organize(material: Material, class_id: Optional[str], authorization: str) -> ChatResponse:
    if not material.owned:
        return ChatResponse(answer="Choose a study guide or note to organize.")
    if not class_id:
        return ChatResponse(answer="Choose the destination class before organizing this material.")
    if material.guide:
        guides.move_guide(material.guide["id"], guides.MoveGuideRequest(folder_id=class_id), authorization)
    else:
        smart_notes.update_note(material.note["id"], smart_notes.UpdateNoteRequest(folder_id=class_id), authorization)
    return ChatResponse(
        answer=f"Moved {(material.source or {}).get('title') or 'the material'} to the selected class.",
        action="organized_material",
        source=material.source,
    )


def _build_practice(user_id: str, material: Material) -> tuple:
    practice = generate_practice_guide(material.content, learning_guidance(user_id))
    if not practice:
        raise HTTPException(status_code=502, detail="Cordia could not create practice problems from this material")
    cards = study_guide_to_flashcards(practice)
    if not cards or not study_guide_is_complete(practice):
        raise HTTPException(status_code=502, detail="Cordia received incomplete practice problems. Please try again.")
    return practice, cards


def _build_guide(user_id: str, material: Material) -> tuple:
    guide = generate_study_guide(chunk_text(clean_text(material.content)), learning_guidance=learning_guidance(user_id))
    cards = study_guide_to_flashcards(guide or "")
    if not guide or not cards or not study_guide_is_complete(guide):
        raise HTTPException(status_code=502, detail="Cordia could not build a complete guide from this material")
    return guide, cards


# feature -> (title suffix, name used when saving fails, builder)
GUIDE_KINDS = {
    "practice": ("Practice Problems", "Practice guide", _build_practice),
    "guide": ("Study Guide", "Study guide", _build_guide),
}


def _check_picked_class(user_id: str, body: ChatRequest) -> None:
    """A class the student picked must be theirs (one inherited from the material already is)."""
    if body.class_id:
        guides.require_own_folder(get_supabase(), user_id, body.class_id)


def _create_guide(user_id: str, material: Material, class_id: Optional[str], feature: str) -> ChatResponse:
    """Build a guide or practice set from the selected material and save it beside its source."""
    require(user_id, feature)
    suffix, saved_name, build = GUIDE_KINDS[feature]
    study_guide, flashcards = build(user_id, material)
    source = material.source or {}
    payload = {
        "user_id": user_id,
        "folder_id": class_id,
        "title": f"{material.title} — {suffix}",
        "study_guide": study_guide,
        "flashcards": flashcards,
        "source_type": source.get("type"),
        "source_title": material.title,
        "source_id": source.get("id"),
        "source_url": source.get("url") or (material.guide or {}).get("source_url"),
    }
    if material.guide:
        payload["source_guide_id"] = material.guide["id"]
    created = get_supabase().table("study_guides").insert(payload).execute()
    if not created.data:
        raise HTTPException(status_code=500, detail=f"{saved_name} could not be saved")
    record(user_id, feature)
    saved = created.data[0]
    start_quiz_warmup(saved, user_id)
    location = " in the same class" if saved.get("folder_id") else " in Study Guides"
    return ChatResponse(
        answer=f"Created {saved['title']}{location}.",
        action="created_guide",
        guide={"id": saved["id"], "title": saved["title"], "folder_id": saved.get("folder_id")},
        source=material.source,
    )


def _visual(user_id: str, question: str, material: Material) -> Optional[ChatResponse]:
    """A visual the student described: the Tutor writes its text and the app draws it (web /api/visual)."""
    written = write_visual_text(question, material.content)
    if not written:
        return None
    record(user_id, "tutor")
    return ChatResponse(
        answer=f"Here's a visual: {written['title']}." if written["title"] else "Here's a visual.",
        action="visual",
        visual=written,
        source=material.source,
    )


def _app_action(user_id: str, question: str, material: Material, authorization: str) -> Optional[ChatResponse]:
    """Do what the student asked in the app, using only their own guides and classes; None when it isn't an app action."""
    supabase = get_supabase()
    owned_guides = supabase.table("study_guides").select("id,title,folder_id").eq("user_id", user_id) \
        .order("updated_at", desc=True).limit(300).execute().data or []
    owned_classes = supabase.table("folders").select("id,name").eq("user_id", user_id).limit(200).execute().data or []
    plan = plan_app_action(question, material.guide, owned_guides, owned_classes)
    action = plan.get("action")
    guide = next((item for item in owned_guides if item["id"] == plan.get("guide_id")), None)
    folder = next((item for item in owned_classes if item["id"] == plan.get("class_id")), None)
    title = lambda item: (item or {}).get("title") or "Untitled guide"
    name = lambda item: (item or {}).get("name") or "Untitled class"
    guide_link = lambda item: {"href": f"/guide/{item['id']}", "label": title(item)}
    class_link = lambda item: {"href": f"/folder/{item['id']}", "label": name(item)}
    needs_guide = action in {"move", "rename_guide", "delete_guide", "make"} or (action == "open" and plan.get("guide_id"))
    needs_class = action == "rename_class" or (action == "open" and plan.get("class_id")) or (action == "move" and plan.get("class_id"))
    if action == "missing" or (needs_guide and not guide) or (needs_class and not folder):
        missing = str(plan.get("name") or "").strip()[:100]
        return ChatResponse(answer=(
            f"I couldn't find “{missing}” in your guides or classes." if missing
            else "I couldn't find that in your guides or classes. Say its name as it shows in Library."
        ), action="not_found")

    if action == "open":
        if guide:
            tab = GUIDE_TABS.get(plan.get("tab"))
            link = {"href": tab.format(id=guide["id"]) if tab else f"/guide/{guide['id']}", "label": title(guide)}
        elif folder:
            link = class_link(folder)
        elif plan.get("page") in PAGES:
            href, label = PAGES[plan["page"]]
            link = {"href": href, "label": label}
        else:
            return None
        return ChatResponse(answer=f"Opening {link['label']}.", action="navigate", link=link)
    if action == "move":
        guides.move_guide(guide["id"], guides.MoveGuideRequest(folder_id=folder["id"] if folder else None), authorization)
        if not folder:
            return ChatResponse(answer=f"Took {title(guide)} out of its class.", action="organized_material", link=guide_link(guide))
        return ChatResponse(answer=f"Moved {title(guide)} to {name(folder)}.", action="organized_material", link=class_link(folder))
    if action == "rename_guide" and str(plan.get("title") or "").strip():
        renamed = guides.rename_guide(guide["id"], guides.RenameGuideRequest(title=str(plan["title"])[:500]), authorization)
        return ChatResponse(answer=f"Renamed {title(guide)} to {renamed['title']}.", action="renamed_guide",
                            link={"href": f"/guide/{guide['id']}", "label": renamed["title"]})
    if action == "create_class" and str(plan.get("name") or "").strip():
        created = folders.create_folder(folders.FolderNameRequest(name=str(plan["name"])[:100]), authorization)["folder"]
        return ChatResponse(answer=f"Made the class {name(created)}.", action="created_class", link=class_link(created))
    if action == "rename_class" and str(plan.get("name") or "").strip():
        renamed = folders.rename_folder(folder["id"], folders.FolderNameRequest(name=str(plan["name"])[:100]), authorization)["folder"]
        return ChatResponse(answer=f"Renamed {name(folder)} to {name(renamed)}.", action="renamed_class", link=class_link(renamed))
    if action == "delete_guide":
        # Deleting can't be undone, so the student confirms it with a button.
        return ChatResponse(answer=f"Delete {title(guide)}? This can't be undone.", action="confirm_delete",
                            confirm={"kind": "delete_guide", "guide_id": guide["id"], "title": title(guide)})
    if action == "new_note":
        note_title = str(plan.get("title") or "").strip()[:500] or "Untitled notes"
        created = guides.save_guide(guides.SaveGuideRequest(
            title=note_title, notes="", source_type="notes", folder_id=folder["id"] if folder else None,
        ), authorization)["guide"]
        return ChatResponse(answer=f"Made a notes page, {title(created)}.", action="navigate", link=guide_link(created))
    if action == "make":
        kind = "practice" if plan.get("kind") == "practice" else "guide"
        loaded = _owned_row("study_guides", "id,title,folder_id,study_guide,notes,source_url", guide["id"], user_id, "guide")
        content = (loaded.get("study_guide") or loaded.get("notes") or "")[:MAX_CONTENT_LENGTH]
        if not content.strip():
            return ChatResponse(answer=f"{title(guide)} has no material to build from yet.")
        source = {"type": "study_guide", "id": loaded["id"], "title": title(loaded)}
        made = _create_guide(user_id, Material(content, source, guide=loaded), loaded.get("folder_id"), kind)
        return made.model_copy(update={"link": guide_link(made.guide)})
    return None


# ---- The Tutor as a study helper (services/study_helper): a test to study for gets a plan, not a lecture ----

# "Make a study guide for my exam", "make flashcards to review for the test": the student asked for a thing.
MAKE_THING = re.compile(r"\b(?:create|make|generate|build|turn)\b.*\b(?:guides?|flashcards?|practice|notes?|outline|visual|diagram)\b", re.IGNORECASE)
STUDY_HELPER_SKILLS = {None, "explain", "plan", "retain"}
BUILD_WINDOW = timedelta(minutes=15)


def _about_learn(question: str) -> bool:
    """Learn named but not asked for ("please don't open Learn for the ethics guide", "make a Learn set or a
    quiz, which is better?"): the Tutor answers it, and the app-action planner never sees it, since it could
    build or open something nobody asked for. Unless another tool is asked for by name after it ("make a
    Learn set for it and make flashcards too"): that tool gets the turn."""
    if not study_helper.asks_about_learn(question):
        return False
    another = study_helper.ANOTHER_TOOL.search(question)
    rest = question[another.start():another.start() + 120] if another else ""  # the tool is named right after it
    return not (rest and (MAKE_THING.search(rest) or VISUAL_REQUEST.search(rest)))


def _today(body: ChatRequest) -> date:
    if body.local_date:
        try:
            return date.fromisoformat(body.local_date)
        except ValueError:
            pass
    return datetime.now(timezone.utc).date()


def _upcoming_exams(user_id: str, today: date) -> tuple[list, bool]:
    """The student's own exams and quizzes still ahead (from their calendar) and whether one is connected."""
    from routers.calendar import calendar_for
    try:
        calendar = calendar_for(user_id) or {}
    except Exception:  # an unreachable calendar never blocks the plan
        return [], False
    exams = [item for item in calendar.get("items") or []
             if item.get("type") in {"exam", "quiz"} and not item.get("done") and str(item.get("due_at") or "")[:10] >= today.isoformat()]
    return sorted(exams, key=lambda item: str(item.get("due_at"))), bool(calendar.get("connected"))


def _last_plan(turn: Optional[dict]) -> Optional[dict]:
    """The study plan in the Tutor's latest reply, so a follow-up ("it's on Friday", "make a Learn for it") continues it."""
    for message in reversed(((turn or {}).get("messages") or [])[:-1]):
        if message.get("role") in {"ai", "assistant"}:
            return message.get("study_plan")
    return None


def _owned_guide(user_id: str, guide_id: str, columns: str = "id,title,folder_id") -> Optional[dict]:
    try:
        return _owned_row("study_guides", columns, guide_id, user_id, "guide")
    except HTTPException:
        return None


def _saved_test_date(user_id: str, guide_id: str, today: date) -> Optional[date]:
    """The test date already set in Learn for this guide, when it's still ahead."""
    row = _owned_guide(user_id, guide_id, "id,flashcard_progress") or {}
    saved = str(((row.get("flashcard_progress") or {}).get("learn") or {}).get("test_date") or "")
    try:
        when = date.fromisoformat(saved)
    except ValueError:
        return None
    return when if when >= today else None


def _study_plan(body: ChatRequest, user_id: str, question: str, material: Material, carried: Optional[dict] = None) -> ChatResponse:
    """A short plan for a test with real buttons: start the check-in in Learn, or build the set first."""
    today = _today(body)
    when = study_helper.parse_test_date(question, today)
    exams, connected = _upcoming_exams(user_id, today)
    carried = carried or {}
    exam = next((item for item in exams if item.get("id") == (carried.get("exam") or {}).get("key")), None) \
        or study_helper.match_exam(question, exams, when)
    # The Tutor's picker usually has something selected; it counts only when it fits the test the student named.
    named = study_helper.topic_words(question) | study_helper.topic_words(f"{(exam or {}).get('title') or ''} {(exam or {}).get('course') or ''}")
    fits = lambda title: not named or study_helper.shared_topics(named, title) > 0
    guide = _owned_guide(user_id, carried["guide"]["id"]) if (carried.get("guide") or {}).get("id") else None
    if not guide and material.guide and fits(material.title):
        guide = material.guide
    if not guide:
        owned = get_supabase().table("study_guides").select("id,title,updated_at").eq("user_id", user_id) \
            .order("updated_at", desc=True).limit(300).execute().data or []
        guide = study_helper.match_guide(question, owned, exam)
    if not when and exam:
        when = date.fromisoformat(str(exam["due_at"])[:10])
    if not when and guide:
        when = _saved_test_date(user_id, guide["id"], today)
    from_material = material.title if material.content.strip() and not material.guide and fits(material.title) else ""
    answer, plan = study_helper.plan_reply(today=today, when=when, guide=guide, exam=exam,
                                           material_title=from_material, canvas_connected=connected)
    used = from_material or (guide and material.guide and guide["id"] == material.guide["id"])
    return ChatResponse(answer=answer, action="study_plan", study_plan=plan, source=material.source if used else None)


def _recent_build(user_id: str, material: Material, title: str) -> Optional[dict]:
    """The same set built from the same material moments ago (a second tab, a double send), to open instead."""
    since = (datetime.now(timezone.utc) - BUILD_WINDOW).isoformat()
    query = get_supabase().table("study_guides").select("id,title,folder_id").eq("user_id", user_id).eq("title", title) \
        .eq("source_title", material.title).gte("created_at", since)
    if (material.source or {}).get("id"):
        query = query.eq("source_id", material.source["id"])
    rows = query.order("created_at", desc=True).limit(1).execute().data or []
    return rows[0] if rows else None


def _make_learn(body: ChatRequest, user_id: str, question: str, material: Material, class_id: Optional[str],
                skill: Optional[str], turn: Optional[dict], form: str = "do") -> ChatResponse:
    """"Make a Learn for it": build the set (the build_guide or practice skill) when there isn't one, then open Learn.
    A build costs a model call, so it starts only from an imperative or the build button; a polite question
    ("can you make a Learn set from my notes?") gets the offer and the button instead."""
    today = _today(body)
    plan = _last_plan(turn) or {}
    when = study_helper.parse_test_date(question, today)
    if not when and plan.get("test_date"):
        when = date.fromisoformat(plan["test_date"])
    guide = material.guide
    if not guide and material.content.strip() and form == "ask":
        offer, build = study_helper.build_offer(material.title)
        return ChatResponse(answer=offer, action="study_plan", source=material.source,
                            study_plan={"guide": None, "test_date": when.isoformat() if when else None, "exam": plan.get("exam"),
                                        "actions": [build]})
    if not guide and material.content.strip():
        kind = "practice" if skill == "practice" or re.search(r"\bpractice\b", question, re.IGNORECASE) else "guide"
        _check_picked_class(user_id, body)
        guide = _recent_build(user_id, material, f"{material.title} — {GUIDE_KINDS[kind][0]}") \
            or _create_guide(user_id, material, class_id, kind).guide
    if not guide and (plan.get("guide") or {}).get("id"):
        guide = _owned_guide(user_id, plan["guide"]["id"])
    if not guide:
        return ChatResponse(answer="Pick a guide above or attach your notes, and I'll build the Learn set from them.",
                            study_plan={"guide": None, "test_date": when.isoformat() if when else None, "exam": plan.get("exam"),
                                        "actions": [{"kind": "attach", "label": "Attach notes"}]})
    title = guide.get("title") or "your guide"
    return ChatResponse(
        answer=f"Opening Learn for {title}. It starts with a short check-in quiz.",
        action="navigate",
        link={"href": study_helper.learn_href(guide["id"], when, today), "label": f"Learn for {title}"},
        guide={"id": guide["id"], "title": title, "folder_id": guide.get("folder_id")},
        source=material.source,
    )


def _study_helper(body: ChatRequest, user_id: str, question: str, material: Material, class_id: Optional[str],
                  skill: Optional[str], turn: Optional[dict]) -> Optional[ChatResponse]:
    """A plan or a Learn set when the student is studying for a test; None for everything else.
    Only in the web app's Tutor (a session): the plan's buttons and Learn live there. The extension side
    panel sends no session and shows only the answer text, so it always gets its normal answer."""
    if not turn or skill not in STUDY_HELPER_SKILLS | {"build_guide", "practice"} or body.retain_context or body.assignment_key:
        return None
    # Another tool asked for by name ("make flashcards…", "draw a diagram…") is that tool's, even if it
    # also says "learn"; what's left once the Learn request itself is taken out decides.
    form, rest = study_helper.split_learn_request(question)
    if MAKE_THING.search(rest) or VISUAL_REQUEST.search(rest):
        return None
    if form:
        return _make_learn(body, user_id, question, material, class_id, skill, turn, form)
    if skill not in STUDY_HELPER_SKILLS:
        return None
    if study_helper.asks_to_study_for_test(question):
        return _study_plan(body, user_id, question, material)
    # "It's on Friday": the date the last plan asked for.
    pending = _last_plan(turn)
    if pending and not pending.get("test_date") and len(question) <= 80 and not QUESTION_START.search(question) \
            and study_helper.parse_test_date(question, _today(body)):
        return _study_plan(body, user_id, question, material, carried=pending)
    return None


def _verified_retain_context(body: ChatRequest, content: str):
    """A missed practice question the Tutor explains must still match the guide it came from."""
    retain = body.retain_context
    if not retain:
        return None
    if not body.guide_id:
        raise HTTPException(status_code=400, detail="A Retain explanation requires its study guide")
    if retain.options and (retain.selected_answer not in retain.options or retain.correct_answer not in retain.options):
        raise HTTPException(status_code=400, detail="Retain answers do not match the question choices")
    if retain.selected_answer == retain.correct_answer:
        raise HTTPException(status_code=400, detail="This Retain answer is already correct")

    def normalized(text: str) -> str:
        return re.sub(r"\s+", " ", text).casefold()

    source = normalized(content)
    if normalized(retain.question) not in source or normalized(retain.correct_answer) not in source:
        raise HTTPException(status_code=409, detail="This Retain question no longer matches the selected guide")
    return retain


def _estimated_tokens(*texts: str) -> int:
    return int(sum(len(text or "") for text in texts) / 3.5) + 1


def _tutor_reply(body: ChatRequest, user_id: str, question: str, material: Material,
                 skill: Optional[str], turn: Optional[dict]) -> ChatResponse:
    require(user_id, "tutor")
    guidance = "\n".join(filter(None, [
        learning_guidance(user_id),
        style_instruction(user_id),
        tutor_skill_instruction(skill),
        TUTOR_SAFETY_POLICY,
    ]))
    # The session's last message is the question being answered now.
    earlier = ((turn or {}).get("messages") or [])[:-1]
    retain = _verified_retain_context(body, material.content)
    if retain:
        answer = explain_retain_answer(
            # Checked against the guide in its saved wording; explained in the wording the student saw.
            question=asked_as(retain.question),
            options=retain.options,
            selected_answer=retain.selected_answer,
            correct_answer=retain.correct_answer,
            context=material.content,
            conversation=earlier,
            learning_guidance=guidance,
        )
    else:
        # Clients without a server session (the extension) send their own history.
        history = [message.model_dump() for message in body.history] if not turn else []
        if history:
            used = _estimated_tokens(material.content[:25000], guidance, question, *(message["text"] for message in history))
            if used > TUTOR_CONTEXT_TOKENS - TUTOR_RESERVED_TOKENS:
                raise HTTPException(status_code=413, detail=CONTEXT_FULL)
        answer = answer_question(
            question=question,
            context=material.content,
            mode=body.mode,
            learning_guidance=guidance,
            conversation=history or earlier,
            allow_clarification=skill in {"explain", "retain", None},
            rich_text=body.rich_text,
            full_history=bool(history),
        )
    record(user_id, "tutor")
    return ChatResponse(answer=plain_opening(answer), source=material.source)


def _edit_outline(user_id: str, material: Material, question: str) -> Optional[ChatResponse]:
    """Change the selected guide's outline as the student asked and save it; None when nothing changed."""
    guide = material.guide
    before = guide.get("notes") or ""
    edited = edit_outline(before, question, guide.get("study_guide") or "")
    # Nothing changed (it wasn't really an edit): the Tutor answers it as a question instead.
    if not edited or edited["notes"].strip() == before.strip():
        return None
    get_supabase().table("study_guides").update({"notes": edited["notes"]}).eq("id", guide["id"]).eq("user_id", user_id).execute()
    record(user_id, "tutor")
    summary = edited["summary"] or "Done."
    return ChatResponse(
        answer=f"{summary} Your outline is updated.",
        action="outline_updated",
        guide={"id": guide["id"]},
        source=material.source,
    )


def _reply(body: ChatRequest, user_id: str, question: str, material: Material, class_id: Optional[str],
           skill: Optional[str], turn: Optional[dict], authorization: str) -> ChatResponse:
    # First: "open my calendar" or "make flashcards for X" also read as the Plan or Retain skill.
    # Not when the request plainly works on the selected material or the student picked a class above.
    if skill not in {"edit_outline", "organize"} and VISUAL_REQUEST.search(question):
        drawn = _visual(user_id, question, material)
        if drawn:
            return drawn
    # "I need to study for my bio test" / "make a Learn for it": a plan with buttons, before any lecture.
    helped = _study_helper(body, user_id, question, material, class_id, skill, turn)
    if helped:
        return helped
    # "What's in my Notion page on X" / "quiz me on my Google Doc": the Tutor reads that app, if it's on for the Tutor.
    if skill in {None, "explain"} and not body.class_id:
        app = connectors.tutor_material(user_id, question)
        if app and app.get("problem"):
            return ChatResponse(answer=app["problem"])
        if app:
            source = {"type": "connector", "id": app["connector"], "title": app["title"]}
            return _tutor_reply(body, user_id, question, Material(content=app["text"], source=source), skill, turn)
    about_material = bool(material.content.strip() and PRACTICE_REQUEST.search(question))
    if (skill in {None, "explain", "build_guide", "practice", "organize", "plan", "retain"} and not body.class_id
            and not about_material and not _about_learn(question) and _asks_for_app_action(question)):
        done = _app_action(user_id, question, material, authorization)
        if done:
            return done
    if skill == "plan" and not material.content.strip():
        return ChatResponse(
            answer="Open Canvas calendar reminders on the Dashboard to review what is due today and what is coming next.",
            action="opened_plan_help",
        )
    if skill == "organize" and body.class_id:
        return _organize(material, body.class_id, authorization)
    if skill == "organize":
        return _organize(material, body.class_id, authorization)
    # Before the empty-material check: a new notes page can be edited while still empty.
    if material.guide and (skill == "edit_outline" or (skill in {None, "explain"} and not _about_learn(question)
                                                       and _asks_to_edit_outline(question))):
        edited = _edit_outline(user_id, material, question)
        if edited:
            return edited
    if skill == "edit_outline":
        return ChatResponse(answer=(
            "I couldn't make that change to the outline. Say what to change, like “fix the spelling of GihHub”."
            if material.guide else "Pick a guide above, then tell me what to change in its outline."
        ))
    if not material.content.strip():
        if material.source:
            return ChatResponse(answer=(
                f"{material.source.get('title') or 'The selected material'} is selected, but it does not contain "
                "readable study material yet. Add content or choose another source."
            ))
        if skill != "explain":
            return ChatResponse(answer="Choose a study guide, note, or uploaded file before asking Cordia.")
        # A general chat: no material selected, answered from general knowledge. The source says so,
        # so the reply is never mistaken for one based on the student's material (it is saved with it).
        # Specific names, numbers and dates in it are marked unchecked, with an offer to check them.
        reply = _tutor_reply(body, user_id, question, material, skill, turn)
        reply.answer = ground_general_answer(reply.answer, question)
        reply.source = GENERAL_SOURCE
        return reply
    if skill == "practice" or PRACTICE_REQUEST.search(question):
        _check_picked_class(user_id, body)
        return _create_guide(user_id, material, class_id, "practice")
    if skill == "build_guide":
        _check_picked_class(user_id, body)
        return _create_guide(user_id, material, class_id, "guide")
    return _tutor_reply(body, user_id, question, material, skill, turn)


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
def chat(body: ChatRequest, request: Request, authorization: str = Header(default="")):
    user_id = get_user_id(authorization)
    if body.guide_id and body.note_id:
        raise HTTPException(status_code=400, detail="Choose one study source")
    question = body.question
    material = _load_material(body, user_id)
    class_id = body.class_id or material.owned.get("folder_id")

    turn = None
    if body.session_id:
        turn = claim_tutor_turn(
            user_id=user_id,
            session_id=body.session_id,
            expected_version=body.conversation_version,
            message=question,
            requested_skill=body.skill,
            guide_id=body.guide_id,
            class_id=class_id,
        )
    skill = turn["active_skill"] if turn else body.skill
    try:
        if skill in BROWSER_SKILLS:
            return _run_browser_skill(user_id, turn, skill, question)
        result = _finish(user_id, turn, _reply(body, user_id, question, material, class_id, skill, turn, authorization))
        # What the student shared about themselves goes to the memory the Assistant shares (background).
        from services.student_memory import learn_from_tutor
        learn_from_tutor(user_id, question, body.session_id)
        return result
    except HTTPException as error:
        if turn:
            fail_tutor_turn(user_id, turn, str(error.detail))
        raise
    except Exception:
        # The request-id middleware logs the traceback and returns a 500 the client can quote.
        if turn:
            fail_tutor_turn(user_id, turn, "Unexpected Tutor error")
        raise
