"""Printable quiz items, built only from a guide's own questions and answers.

  multiple choice  the cached Retain quiz, with the stem every option repeats taken off
                   ("A Lied is a German art song..." -> "A German art song...")
  matching         short "What is X?" questions: the term X and the answer's first sentence
  fill in          Haiku writes one sentence per answer with 1-2 blanks; every blank must be words
                   copied from the stored answer and the sentence may say nothing the question and
                   answer don't, or the item is dropped
  short answer     the guide's own why / how / describe questions, with the stored answer as key

Each item names its source question (`source`, the Q/A index) so one printout never asks the same
idea twice. Matching, short answer and fill-in are cached on the guide (study_guides.print_items)
under a hash of the Q/A they came from.
"""

import hashlib
import re
from typing import Optional

from services.distractor_check import keep_valid
from services.retain import concept_answer, normalize

VERSION = 1
SHORT_POINTS = 4
_COPULA = {"is", "are", "was", "were", "means", "meant"}
_STOP = {
    "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "for", "is", "are", "was", "were", "be",
    "by", "with", "as", "its", "it", "that", "this", "from", "into", "than", "what", "which", "who", "whom",
    "whose", "when", "where", "why", "how", "does", "did", "do", "has", "have", "had", "not", "his", "her",
    "their", "they", "he", "she", "there", "these", "those", "also", "but", "so", "one", "s",
}
_EXPLAIN = re.compile(
    r"^\s*(why|how|describe|explain|compare|contrast|discuss|in what ways?|what (role|effect|impact|characterizes|are the (musical |main |key )?(characteristics|features|effects|causes)))\b",
    re.I)


def source_hash(pairs: list) -> str:
    text = "\n".join(f"{pair['question']}\n{pair['answer']}" for pair in pairs)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def _tokens(text: str) -> list:
    return re.findall(r"[a-z0-9%]+", normalize(text))


def _stem(word: str) -> str:
    return word[:5] if len(word) > 5 else word


def _content_stems(text: str) -> set:
    return {_stem(word) for word in _tokens(text) if word not in _STOP}


def _first_sentence(text: str) -> str:
    parts = re.split(r"(?<=[a-z0-9\)\"'”’])\.\s+(?=[A-Z])", str(text or "").strip(), maxsplit=1)
    return parts[0].strip().rstrip(".").strip()


def _capitalize(text: str) -> str:
    """First letter up, after any opening quote or bracket: '"robbed time"' -> '"Robbed time"'."""
    lead = len(text) - len(text.lstrip("\"'\u201c\u2018(["))
    return text[:lead] + text[lead:lead + 1].upper() + text[lead + 1:] if text else text


def _plain(text: str) -> str:
    """Without a lone closing period, like a quiz choice."""
    value = str(text or "").strip()
    return value[:-1].rstrip() if value.endswith(".") and not value.endswith("..") else value


# ---- multiple choice ----

def _key(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower().replace("\u2019", "'").split("'")[0])


def strip_stem(question: str, options: list) -> list:
    """The options without the words every one of them repeats from the question, so the choices
    read as answers: "A Lied is a German art song" -> "A German art song", "Wagner called his
    operas music dramas" -> "Music dramas", "It is associated with the fall of..." -> "The fall
    of...". Only a prefix every option shares is removed, and only when each of its words is a
    linking verb, a small filler word or a word from the question, and it doesn't end on "a/an/the"."""
    words = [str(option).split() for option in options]
    if len(words) < 2 or any(len(option) < 2 for option in words):
        return [str(option) for option in options]
    common = 0
    while all(common < len(option) - 1 for option in words) and len({_key(option[common]) for option in words}) == 1:
        common += 1
    asked = [_key(word) for word in str(question).split()]

    def from_question(word):
        return any(word == q or (min(len(word), len(q)) >= 3 and (word.startswith(q) or q.startswith(word))) for q in asked)

    cut = 0
    for size in range(1, common + 1):
        prefix = [_key(word) for word in words[0][:size]]
        if prefix[-1] in {"a", "an", "the"}:
            continue
        if not all(word in _COPULA or word in _STOP or from_question(word) for word in prefix):
            break
        # A linking verb, or two words from the question: "Brahms used..." (the subject alone) stays.
        if any(word in _COPULA for word in prefix) or sum(1 for word in prefix if word not in _STOP and from_question(word)) >= 2:
            cut = size
    if not cut:
        return [str(option) for option in options]
    return [_capitalize(" ".join(option[cut:])) for option in words]


def multiple_choice(quiz: list, pairs: list) -> tuple:
    """(items, flagged): printable multiple-choice questions from the cached quiz. A question whose
    choices fail the distractor check is left out (flagged counts them) until the student refreshes
    the answer choices; the saved quiz itself is never changed here."""
    index_of = {normalize(pair["question"]): i for i, pair in enumerate(pairs)}
    others = [(str(q.get("question") or ""), concept_answer(q)) for q in quiz if isinstance(q, dict)]
    items, flagged = [], 0
    for position, question in enumerate(quiz):
        if not isinstance(question, dict) or not isinstance(question.get("options"), list):
            continue
        text, answer = str(question.get("question") or ""), concept_answer(question)
        options = [_plain(option) for option in question["options"]]
        correct = question.get("correct_index")
        if not text or not answer or len(options) < 3 or not isinstance(correct, int):
            continue
        wrong = [option for i, option in enumerate(options) if i != correct]
        if keep_valid(wrong, text, answer, others)[1]:
            flagged += 1
            continue
        source = index_of.get(normalize(text), f"quiz:{position}")
        items.append({"id": f"mc{position}", "source": source, "question": text,
                      "options": strip_stem(text, options), "answer": correct})
    return items, flagged


# ---- matching ----

def _defined_term(question: str) -> Optional[str]:
    """X in a plain "What is X?" / "What are X?" question (without a/an/the), else None."""
    text = " ".join(str(question or "").split()).rstrip("?").strip()
    lower = text.lower()
    lead = next((lead for lead in ("what is ", "what are ") if lower.startswith(lead)), None)
    if not lead or "," in text or "?" in text:
        return None
    term = text[len(lead):]
    article = next((word for word in ("a ", "an ", "the ") if term.lower().startswith(word)), "")
    return term[len(article):].strip() or None


def matching(pairs: list) -> list:
    """Term / definition pairs from short "What is X?" questions: the term is X as the question
    writes it, the definition the answer's first sentence without its "X is" / "It is" opening."""
    items, seen = [], set()
    for index, pair in enumerate(pairs):
        term = (_defined_term(pair["question"]) or "").strip("'‘’\"")
        if not term or len(term.split()) > 4 or len(term) > 40:
            continue
        definition = _first_sentence(pair["answer"])
        lead = re.match(rf"(?i)^(?:(?:a|an|the)\s+)?(?:{re.escape(term)}|it|they)\s+(?:is|are|was|were|means)\s+", definition)
        if lead:
            definition = definition[lead.end():]
        definition = _capitalize(_plain(definition))
        if len(definition.split()) < 3 or len(definition) > 130 or normalize(term) in normalize(definition):
            continue
        key = normalize(definition)
        if key in seen:
            continue
        seen.add(key)
        items.append({"id": f"m{index}", "source": index, "term": _capitalize(term), "definition": definition})
    return items


# ---- short answer ----

def short_answer(pairs: list) -> list:
    """The guide's own why / how / describe questions with an answer long enough to explain,
    keyed with the stored answer."""
    items = []
    for index, pair in enumerate(pairs):
        if _EXPLAIN.search(pair["question"]) and len(pair["answer"].split()) >= 8:
            items.append({"id": f"s{index}", "source": index, "question": pair["question"].strip(),
                          "key": pair["answer"].strip(), "points": SHORT_POINTS})
    return items


# ---- fill in the blank ----

def fill_candidates(pairs: list, limit: int = 40) -> list:
    """Q/A pairs worth asking Haiku to turn into fill-in sentences: answers with something to blank
    but short enough for one sentence. Ideas matching and short answer can't use come first, so a
    mixed printout covers more of the guide."""
    used = {item["source"] for item in matching(pairs) + short_answer(pairs)}
    fits = [index for index, pair in enumerate(pairs) if 1 <= len(pair["answer"].split()) <= 35]
    ordered = [index for index in fits if index not in used] + [index for index in fits if index in used]
    return sorted(ordered[:limit])


def fill_prompt(pairs: list, indexes: list) -> str:
    rows = "\n".join(f"{n}. Q: {pairs[i]['question']}\n   A: {pairs[i]['answer']}" for n, i in enumerate(indexes))
    return f"""Turn each question and answer below into one fill-in-the-blank sentence for a printed test.
Return a JSON object {{"items": [{{"id": <number>, "sentence": "..."}}]}}.

Rules:
1. Use only what that item's question and answer state. Add no other fact, name, date or detail.
2. Mark one or two blanks with double square brackets, for example "The term came from a painting by [[Claude Monet]]." Copy each blank exactly from the answer: the key word or short phrase a student has to recall, at most four words.
3. The sentence reads naturally on its own, without the question, and never gives away a blank elsewhere in it.
4. Leave an item out if its answer has no single key word or phrase worth blanking.

{rows}"""


_BLANK = re.compile(r"\[\[([^\[\]]{1,60})\]\]")


def check_fill(sentence: str, question: str, answer: str) -> Optional[dict]:
    """The sentence as printable parts, or None when it breaks a rule: 1-2 blanks, each copied word
    for word from the stored answer (and not a filler word), no blank given away elsewhere in the
    sentence, and no content word that the question and answer don't contain."""
    sentence = str(sentence or "").strip()
    blanks = [value.strip() for value in _BLANK.findall(sentence)]
    if not 1 <= len(blanks) <= 2:
        return None
    answer_norm = " " + " ".join(_tokens(answer)) + " "
    for blank in blanks:
        words = _tokens(blank)
        if not words or len(words) > 4 or all(word in _STOP for word in words):
            return None
        if f" {' '.join(words)} " not in answer_norm:
            return None
    rest = _BLANK.sub(" ", sentence)
    rest_words = set(_tokens(rest))
    if any(set(_tokens(blank)) - _STOP <= rest_words for blank in blanks):
        return None
    allowed = _content_stems(question) | _content_stems(answer)
    if _content_stems(_BLANK.sub(lambda m: m.group(1), sentence)) - allowed:
        return None
    parts, cursor = [], 0
    for found in _BLANK.finditer(sentence):
        if found.start() > cursor:
            parts.append(sentence[cursor:found.start()])
        parts.append({"blank": found.group(1).strip()})
        cursor = found.end()
    if cursor < len(sentence):
        parts.append(sentence[cursor:])
    return {"parts": parts, "blanks": blanks, "points": len(blanks)}


def fill_items(pairs: list, indexes: list, generated: list) -> list:
    """Checked fill-in items from Haiku's reply ({"id", "sentence"} per item); failures are dropped."""
    items, seen = [], set()
    for item in generated if isinstance(generated, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if not 0 <= n < len(indexes) or n in seen:
            continue
        index = indexes[n]
        checked = check_fill(item.get("sentence"), pairs[index]["question"], pairs[index]["answer"])
        if checked:
            seen.add(n)
            items.append({"id": f"f{index}", "source": index, **checked})
    return sorted(items, key=lambda item: item["source"])


def cached(print_items: Optional[dict], pairs: list) -> dict:
    """The guide's cached items when they were built from these same questions, else {}."""
    if isinstance(print_items, dict) and print_items.get("v") == VERSION and print_items.get("source") == source_hash(pairs):
        return print_items
    return {}
