"""Fill in the blank: the part of each answer a student types (LEARN_LADDER_V2).

Picked once per question when the guide's quiz is built, never during study, and saved on the
question in study_guides.quiz_questions (the jsonb list already holds extra keys, so no migration):
  "blank": {"whole": true}     a short answer (a term, name, date or number): type all of it
  "blank": {"span": "..."}     a longer answer: this key span is blanked out and typed
  "blank": {"written": true}   no usable span: the question is answered in Written instead
Short answers need no AI. Longer ones get one Haiku call per batch of BATCH questions; a span is
kept only if it appears exactly in the answer, is at most MAX_WORDS words and isn't the whole
answer. Must match web/lib/learnLadder.mjs validBlank and the Type it length rule.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from typing import Callable, Optional

logger = logging.getLogger(__name__)

TERM_MAX_WORDS = 5     # the Type it / Written length rule (learnEngine.isTerm, retain.answer_shape)
MAX_WORDS = 6
BATCH = 25
_STOPWORDS = {"a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "and", "or", "but", "is", "are", "was",
              "were", "be", "it", "its", "this", "that", "these", "those", "with", "as", "from", "into", "than", "then"}
_running: set = set()
_lock = threading.Lock()


def learn_ladder_v2() -> bool:
    """The Learn format ladder (Fill in the blank, longer retry gaps, test-format practice). Off by default."""
    return os.getenv("LEARN_LADDER_V2", "false").strip().lower() in {"1", "true", "on", "yes"}


def _words(text: str) -> list:
    return str(text or "").split()


def is_short(answer: str) -> bool:
    return len(_words(answer)) <= TERM_MAX_WORDS


def valid_span(answer: str, span) -> bool:
    """The span is in the answer exactly, short, meaningful, and not the whole (long) answer."""
    if not isinstance(span, str):
        return False
    value = span.strip()
    if not value or value not in str(answer or ""):
        return False
    words = _words(value)
    if len(words) > MAX_WORDS or len(words) >= len(_words(answer)):
        return False
    if all(re.sub(r"[^\w]", "", word).lower() in _STOPWORDS for word in words):
        return False
    return bool(re.search(r"\w", value))


def answer_of(question: dict) -> str:
    options = question.get("options") if isinstance(question.get("options"), list) else []
    index = question.get("correct_index")
    return str(options[index]) if isinstance(index, int) and 0 <= index < len(options) else ""


def _prompt(items: list) -> str:
    listed = "\n".join(f"{i + 1}. Q: {item['question']}\n   A: {item['answer']}" for i, item in enumerate(items))
    return f"""For each question and answer below, choose the key span of the answer that a student should type to show they know it: the key term, name, date, number, definition, role or relationship the question is really testing.

Rules:
- Copy the span exactly as it appears in the answer, same spelling and capitals.
- At most {MAX_WORDS} words. Never a stopword or filler word on its own, and never most of the sentence.
- If no single span carries the idea, return an empty string for that item.

{listed}

Return only a JSON object: {{"items": [{{"span": "..."}}, ...]}} with one element per item, in order."""


def _ask(items: list, chat: Callable, client) -> list:
    response = chat(client, "learn_blanks",
                    messages=[{"role": "system", "content": "Choose answer spans for fill-in-the-blank questions. Return valid JSON only."},
                              {"role": "user", "content": _prompt(items)}],
                    temperature=0, response_format={"type": "json_object"})
    try:
        found = json.loads(response.choices[0].message.content or "{}").get("items", [])
    except (json.JSONDecodeError, AttributeError):
        return []
    return found if isinstance(found, list) else []


def choose_blanks(questions: list, chat: Optional[Callable] = None, client=None) -> list:
    """The questions with a "blank" on each one that lacks it (others untouched)."""
    out = [dict(q) if isinstance(q, dict) else q for q in questions]
    long_items = []
    for index, question in enumerate(out):
        if not isinstance(question, dict) or "blank" in question:
            continue
        answer = answer_of(question)
        if not answer:
            continue
        if is_short(answer):
            question["blank"] = {"whole": True}
        else:
            long_items.append((index, {"question": str(question.get("question") or ""), "answer": answer}))
    if long_items and chat is None:
        from services.llm import get_openai_client
        from services.llm_calls import chat as chat_call
        chat, client = chat_call, client or get_openai_client()
    for start in range(0, len(long_items), BATCH):
        batch = long_items[start:start + BATCH]
        try:
            spans = _ask([item for _, item in batch], chat, client)
        except Exception:
            logger.warning("Blank selection failed; those questions use Written", exc_info=True)
            spans = []
        for offset, (index, item) in enumerate(batch):
            raw = spans[offset].get("span") if offset < len(spans) and isinstance(spans[offset], dict) else None
            out[index]["blank"] = {"span": raw.strip()} if valid_span(item["answer"], raw) else {"written": True}
    return out


def needs_blanks(questions) -> bool:
    return isinstance(questions, list) and any(isinstance(q, dict) and answer_of(q) and "blank" not in q for q in questions)


def ensure_blanks(supabase, guide_id: str, user_id: str) -> None:
    """Fill in missing blanks on the owner's saved quiz. Re-reads before saving, so questions that
    changed meanwhile are left for the next call. Never raises."""
    with _lock:
        if guide_id in _running:
            return
        _running.add(guide_id)
    try:
        row = (supabase.table("study_guides").select("quiz_questions").eq("id", guide_id).eq("user_id", user_id)
               .limit(1).execute().data or [None])[0]
        questions = (row or {}).get("quiz_questions")
        if not needs_blanks(questions):
            return
        filled = choose_blanks(questions)
        latest = (supabase.table("study_guides").select("quiz_questions").eq("id", guide_id).eq("user_id", user_id)
                  .limit(1).execute().data or [None])[0]
        current = (latest or {}).get("quiz_questions")
        if not isinstance(current, list):
            return
        by_question = {(q.get("question"), answer_of(q)): q.get("blank") for q in filled if isinstance(q, dict) and "blank" in q}
        merged = [{**q, "blank": by_question[(q.get("question"), answer_of(q))]}
                  if isinstance(q, dict) and "blank" not in q and (q.get("question"), answer_of(q)) in by_question else q
                  for q in current]
        supabase.table("study_guides").update({"quiz_questions": merged}).eq("id", guide_id).eq("user_id", user_id).execute()
    except Exception:
        logger.warning("Saving blanks failed for guide %s", guide_id, exc_info=True)
    finally:
        with _lock:
            _running.discard(guide_id)


def start_blanks(supabase, guide_id: str, user_id: str, questions) -> bool:
    """In the background, so a round never waits. True when a build was started."""
    if not learn_ladder_v2() or not needs_blanks(questions):
        return False
    threading.Thread(target=ensure_blanks, args=(supabase, guide_id, user_id), daemon=True).start()
    return True
