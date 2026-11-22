"""Printable quiz items, built only from a guide's own questions and answers.

  multiple choice  the cached Retain quiz, with the stem every option repeats taken off
                   ("A Lied is a German art song..." -> "A German art song...")
  matching         short "What is X?" questions: the term X and the answer's first sentence
  fill in          Haiku writes one sentence per answer with 1-2 blanks; every blank must be words
                   copied from the stored answer and the sentence may say nothing the question and
                   answer don't, or the item is dropped
  short answer     the guide's own why / how / describe questions, with the stored answer as key
  written          when the guide has too few ready matching terms or short-answer questions, Haiku
                   writes more from the same Q/A (checked like fill-in: nothing the question and
                   answer don't say; a written short question must re-say one source sentence, see
                   check_short; a short answer's key is always the stored answer)

`pairs` is one list of the guide's Q/A in guide order. A pair marked {"hidden": True} (a question the
guide's display hides) keeps its place, so every `source` index stays the guide's own, but it is never
picked, written or counted as a candidate.

Each item names its source question (`source`, the Q/A index) so one printout never asks the same
idea twice. Matching, short answer and fill-in are cached on the guide (study_guides.print_items)
under a hash of the Q/A (and their hidden flags) they came from.
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
def _shown(pair: dict) -> bool:
    return not pair.get("hidden")


def source_hash(pairs: list) -> str:
    """Changes when any question, answer or hidden flag changes, so items cached before a pair was
    hidden (or shown again) are rebuilt."""
    text = "\n".join(f"{pair['question']}\n{pair['answer']}\n{'' if _shown(pair) else 'hidden'}" for pair in pairs)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


_CANT = re.compile(r"\bcan['’]t\b", re.I)
_WONT = re.compile(r"\bwon['’]t\b", re.I)
_NT = re.compile(r"n['’]t\b", re.I)


def _tokens(text: str) -> list:
    """Lowercase words, with "doesn't" read as "does not" and "can't" as "cannot"."""
    text = _NT.sub(" not", _WONT.sub("will not", _CANT.sub("cannot", str(text or ""))))
    return re.findall(r"[a-z0-9%]+", normalize(text))


# ---- word forms ----
# Two words count as the same only when they differ by a plain ending (-s, -es, -ed, -ing, a final -e)
# or are listed here. Nothing is ever cut to a fixed length, so "contract" is never "control" and
# "influenza" is never "influence".
_IRREGULAR = {
    "led": "lead", "made": "make", "making": "make", "gave": "give", "given": "give", "giving": "give",
    "became": "become", "becoming": "become", "began": "begin", "begun": "begin", "used": "use",
    "told": "tell", "brought": "bring", "thought": "think", "taught": "teach", "caught": "catch",
    "sought": "seek", "bought": "buy", "held": "hold", "kept": "keep", "meant": "mean", "sent": "send",
    "spent": "spend", "built": "build", "wrote": "write", "written": "write", "took": "take",
    "taken": "take", "chose": "choose", "chosen": "choose", "grew": "grow", "grown": "grow",
    "knew": "know", "known": "know", "shown": "show", "went": "go", "gone": "go", "seen": "see",
    "spoke": "speak", "spoken": "speak", "drove": "drive", "driven": "drive", "lost": "lose",
    "paid": "pay", "said": "say", "won": "win", "using": "use", "making": "make", "taking": "take",
    "having": "have", "doing": "do", "going": "go", "being": "be",
}


def _undouble(stem: str) -> str:
    """"stopp" (from "stopped") -> "stop"; "fall" and "pass" keep their double letter."""
    if len(stem) >= 3 and stem[-1] == stem[-2] and stem[-1] not in "aeiouylsz":
        return stem[:-1]
    return stem


def _unending(word: str) -> str:
    """The word without one plain ending."""
    if word in _IRREGULAR:
        return _IRREGULAR[word]
    if len(word) > 4 and word.endswith(("ies", "ied")):
        return word[:-3] + "y"
    # At least four letters stay, so "noted" never reads as "not" nor "doing" as "do".
    if len(word) >= 7 and word.endswith("ing"):
        return _undouble(word[:-3])
    if len(word) >= 6 and word.endswith("ed") and not word.endswith("eed"):
        return _undouble(word[:-2])
    if len(word) >= 5 and re.search(r"(ss|sh|ch|x|z)es$", word):
        return word[:-2]
    if len(word) >= 4 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def _form(word: str) -> str:
    """One key for the plain forms of a word: cause, causes, caused and causing all give "caus".
    Short words keep their final e, so "one" is never "on" and "note" never "not"."""
    word = _unending(word)
    return word[:-1] if len(word) >= 5 and word.endswith("e") else word


# Endings that make another word from the same root, for spotting a matching definition that names
# its own term: mitosis/mitotic, sepsis/septic, irony/ironic, liability/liable, recursion/recursive.
_DERIVED = ("ability", "ibility", "sis", "tic", "able", "ible", "ity", "ous", "ism", "ion", "ive", "ic", "y")


def _root(word: str) -> str:
    word = _unending(word)
    for ending in _DERIVED:
        if word.endswith(ending) and len(word) - len(ending) >= 2:
            word = word[:-len(ending)]
            break
    return word[:-1] if len(word) >= 3 and word.endswith("e") else word


def _content_forms(text: str) -> set:
    """Content words in their plain forms; "not" counts, so a sentence can't flip what the source says."""
    return {_form(word) for word in _tokens(text) if word not in _STOP or word == "not"}


def _content_roots(text: str) -> set:
    return {_root(word) for word in _tokens(text) if word not in _STOP}


def _first_sentence(text: str) -> str:
    parts = re.split(r"(?<=[a-z0-9\)\"'”’])\.\s+(?=[A-Z])", str(text or "").strip(), maxsplit=1)
    return parts[0].strip().rstrip(".").strip()


def _gives_away(term: str, definition: str) -> bool:
    """The definition names its own term: the whole phrase, or at least half of the term's content
    words in a related form ("Recursion" in "A function that is recursive...", "Sepsis" in "A septic
    response..."), but not a word that only shares its first letters ("Contract" and "control")."""
    if normalize(term) in normalize(definition):
        return True
    roots = _content_roots(term)
    return bool(roots) and len(roots & _content_roots(definition)) >= (len(roots) + 1) // 2


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
        source = index_of.get(normalize(text), f"quiz:{position}")
        if isinstance(source, int) and not _shown(pairs[source]):
            continue
        wrong = [option for i, option in enumerate(options) if i != correct]
        if keep_valid(wrong, text, answer, others)[1]:
            flagged += 1
            continue
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
        if not _shown(pair):
            continue
        term = (_defined_term(pair["question"]) or "").strip("'‘’\"")
        if not term or len(term.split()) > 4 or len(term) > 40:
            continue
        definition = _first_sentence(pair["answer"])
        lead = re.match(rf"(?i)^(?:(?:a|an|the)\s+)?(?:{re.escape(term)}|it|they)\s+(?:is|are|was|were|means)\s+", definition)
        if lead:
            definition = definition[lead.end():]
        definition = _capitalize(_plain(definition))
        if len(definition.split()) < 3 or len(definition) > 130 or _gives_away(term, definition):
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
        if _shown(pair) and _EXPLAIN.search(pair["question"]) and len(pair["answer"].split()) >= 8:
            items.append({"id": f"s{index}", "source": index, "question": pair["question"].strip(),
                          "key": pair["answer"].strip(), "points": SHORT_POINTS})
    return items


# ---- matching and short answer, written when the guide has too few ready ones ----

WRITE_LIMIT = 40


_YES_NO = re.compile(r"^\s*(is|are|was|were|do|does|did|can|could|will|would|should|has|have|had|may|might)\b", re.I)


def _may_give_term(pair: dict) -> bool:
    """A pair likely to give a matching term, not just any answer: a question about one thing (not
    yes/no, not two questions in one, not a long prompt) whose answer opens with a definition-sized
    sentence that isn't itself a yes or no."""
    question, answer = str(pair["question"]).strip(), str(pair["answer"]).strip()
    first = _first_sentence(answer)
    if not 3 <= len(first.split()) <= 30 or re.match(r"(?i)^(yes|no)\b", first):
        return False
    if _YES_NO.match(question) or question.count("?") > 1 or re.search(r",\s*(and|or)\b", question):
        return False
    return 1 <= len(_content_forms(question)) <= 6


def matching_candidates(pairs: list, limit: int = WRITE_LIMIT) -> list:
    """Q/A indexes Haiku can turn into a matching term: an answer whose first sentence defines
    something, not already a ready matching item."""
    ready = {item["source"] for item in matching(pairs)}
    fits = [index for index, pair in enumerate(pairs) if index not in ready and _shown(pair) and _may_give_term(pair)]
    return fits[:limit]


def short_candidates(pairs: list, limit: int = WRITE_LIMIT) -> list:
    """Q/A indexes Haiku can turn into a short-answer question: an answer long enough to explain,
    not already a ready short-answer item."""
    ready = {item["source"] for item in short_answer(pairs)}
    fits = [index for index, pair in enumerate(pairs) if index not in ready and _shown(pair) and len(pair["answer"].split()) >= 8]
    return fits[:limit]


def _rows(pairs: list, indexes: list) -> str:
    return "\n".join(f"{n}. Q: {pairs[i]['question']}\n   A: {pairs[i]['answer']}" for n, i in enumerate(indexes))


def matching_prompt(pairs: list, indexes: list) -> str:
    return f"""Turn each question and answer below into one matching item for a printed test: a short term and its definition.
Return a JSON object {{"items": [{{"id": <number>, "term": "...", "definition": "..."}}]}}.

Rules:
1. Use only what that item's question and answer state. Add no other fact, name, date or detail.
2. The term is the name or idea the answer defines, one to four words, written as the question or answer writes it.
3. The definition is a phrase of 3 to 20 words from the answer that says what the term is, means or does. It never contains the term itself.
4. Leave an item out if its answer does not define one clear term.

{_rows(pairs, indexes)}"""


def short_prompt(pairs: list, indexes: list) -> str:
    return f"""Write one open question for a printed short-answer test from each question and answer below.
Return a JSON object {{"items": [{{"id": <number>, "question": "..."}}]}}.

Rules:
1. The question asks the student to explain, describe, compare or give reasons, and starts with Why, How, Explain, Describe, Compare, Discuss or In what ways.
2. The item's answer must fully answer it. Name no fact, name, date or term that the item's question and answer do not contain.
3. Never put the answer in the question.
4. Leave an item out if its answer is too thin to explain.

{_rows(pairs, indexes)}"""


def check_matching(term: str, definition: str, question: str, answer: str) -> Optional[dict]:
    """A matching item, or None when it breaks a rule: a term of 1-4 words and a definition of 3-20
    words that say nothing the question and answer don't, and a definition that doesn't contain
    its own term."""
    term = " ".join(str(term or "").strip().strip("'\u2018\u2019\"").split())
    definition = _capitalize(_plain(" ".join(str(definition or "").split())))
    if not term or len(term.split()) > 4 or len(term) > 40:
        return None
    if not 3 <= len(definition.split()) <= 20 or len(definition) > 130:
        return None
    if _gives_away(term, definition):
        return None
    allowed = _content_forms(question) | _content_forms(answer)
    if _content_forms(term) - allowed or _content_forms(definition) - allowed:
        return None
    return {"term": _capitalize(term), "definition": definition}


def matching_items(pairs: list, indexes: list, generated: list) -> list:
    """Checked matching items from Haiku's reply ({"id", "term", "definition"} per item); failures,
    repeated terms and repeated definitions (also against the ready items) are dropped."""
    ready = matching(pairs)
    seen_terms = {normalize(item["term"]) for item in ready}
    seen_defs = {normalize(item["definition"]) for item in ready}
    items, used = [], set()
    for item in generated if isinstance(generated, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if not 0 <= n < len(indexes) or n in used:
            continue
        index = indexes[n]
        checked = check_matching(item.get("term"), item.get("definition"), pairs[index]["question"], pairs[index]["answer"])
        if not checked or normalize(checked["term"]) in seen_terms or normalize(checked["definition"]) in seen_defs:
            continue
        used.add(n)
        seen_terms.add(normalize(checked["term"]))
        seen_defs.add(normalize(checked["definition"]))
        items.append({"id": f"am{index}", "source": index, **checked})
    return sorted(items, key=lambda item: item["source"])


# Glue that frames an explain-type question without stating anything ("Explain why X is needed",
# "Describe the role of X", "In what ways..."). Matched as whole words in their plain forms. Words
# that assert something (cause, lead, affect, prevent, only, most, before, after, not...) are never
# glue: like every other word they have to come from the stored question and answer.
_FRAME_PHRASE = re.compile(
    r"\b(in what ways?|what happens( to)?|the (main|key) (features|characteristics) of|the (circumstances|conditions) (under|in) which)\b", re.I)
_WHAT_MEANS = re.compile(r"(\bwhat\b[^.?!]*?)\bmeans?\b", re.I)  # "Discuss what the light means for Gatsby" asks, never asserts
_FRAME = {_form(word) for word in (
    "explain", "describe", "compare", "discuss", "how", "why", "what", "which", "who", "whom", "whose",
    "when", "where", "does", "do", "did", "is", "are", "was", "were", "be", "been", "being", "has", "have",
    "had", "the", "a", "an", "of", "and", "or", "to", "in", "on", "at", "for", "with", "by", "as", "from",
    "between", "its", "it", "their", "they", "them", "his", "her", "he", "she", "this", "that", "these",
    "those", "there", "so", "also", "role", "give", "need", "reason", "way", "purpose", "significance",
    "importance", "can", "could", "may", "might", "you", "your", "s",
)}
# Words that assert a relationship, an order, an amount or a polarity. One the source does contain
# must also have the same word right after it there ("given after hip surgery", not "given after
# thrombosis"), in a sentence that also holds the word before it.
_ASSERT = {_form(word) for word in (
    "cause", "lead", "result", "influence", "affect", "effect", "impact", "change", "become", "prevent",
    "increase", "decrease", "reduce", "only", "most", "more", "less", "least", "before", "after",
    "without", "rather", "always", "never", "not", "no", "cannot", "nor", "all", "every", "none", "first",
    "last", "must", "than",
)}
_NEGATORS = {_form(word) for word in ("not", "never", "no", "cannot", "nor", "without")}
_NEAR = 4


def _clauses(text: str) -> list:
    """Each sentence or clause (split at . ! ? ;) as (word forms, landings): the landings are where
    a coordinated part starts, the first word after a comma or after and / or / but. A part that
    opens with glue ("..., so that party may cancel it", "..., who funded artists") has its own
    subject, so its landing is the glue word and nothing from the main subject reaches past it."""
    clauses = []
    for part in re.split(r"(?<=[.!?;])\s+|;", str(text or "")):
        tokens, landings = [], set()
        for n, piece in enumerate(part.split(",")):
            words = [_form(word) for word in _tokens(piece)]
            if n and words:
                landings.add(len(tokens))
            landings |= {len(tokens) + i + 1 for i, word in enumerate(words[:-1]) if word in ("and", "or", "but")}
            tokens += words
        if tokens:
            clauses.append((tokens, landings))
    return clauses


def _sentences(text: str) -> list:
    return [tokens for tokens, _ in _clauses(text)]


def _negated(tokens: list, at: int) -> bool:
    """A negator right before the word, or one glue word before it: "never reach", "not an option"
    (but not "without it a promise")."""
    before = tokens[max(0, at - 2):at]
    return bool(before) and (before[-1] in _NEGATORS or (len(before) == 2 and before[1] in _FRAME and before[0] in _NEGATORS))


_ARTICLES = {_form(word) for word in ("a", "an", "the")}
# Where a written question may move on to another part of the same source sentence: after a
# preposition ("contrast in Baroque painting"), or at a word that opens a time or contrast phrase
# ("heparin prevents thrombosis | after surgery").
_BREAKS = {_form(word) for word in ("of", "in", "on", "at", "for", "with", "by", "from", "between", "as", "to")}
_BREAK_BEFORE = {_form(word) for word in ("after", "before", "without", "than", "rather")}
_SETTING = {_form(word) for word in ("in", "of", "on", "at", "during", "within", "throughout")}
# After "to", only these may differ from the source; "to give", "to need" must be there as written.
_TO_FREE = _FRAME - {_form(word) for word in ("give", "need", "role", "reason", "way", "purpose", "significance", "importance")}
_POSSESSIVE = re.compile(r"([A-Za-z0-9]+)['’]s\s+([A-Za-z0-9]+)")


def _follows(sentences: list, first: str, second: str, within: Optional[int] = None) -> bool:
    """`second` comes after `first` in one sentence (within `within` words when given)."""
    for tokens in sentences:
        for i, word in enumerate(tokens):
            if word == first and second in tokens[i + 1:(i + 1 + within) if within else None]:
                return True
    return False


def _next_word(tokens: list, at: int) -> Optional[str]:
    """The first word after `at` that isn't a/an/the."""
    return next((word for word in tokens[at + 1:] if word not in _ARTICLES), None)


def _spans_fit(clause: tuple, chain: list, breaks: list, joined: list) -> bool:
    """`chain` reads, in order, as one or more spans of the clause: inside a span each word comes
    at most _NEAR words after the one before it, and only a span that starts on the clause's first
    three words (its subject) may run on into a later coordinated part ("Collisions put keys in one
    bucket and | slow lookups down", not "colored light and | told stories"), unless the question
    joins the two words with and/or/but too ("light and shadow"). A new span may start only where
    `breaks` allows (a preposition: "dramatic contrast | in Baroque painting"), and when there is
    more than one span none is a single word, so one word can't be moved onto another clause
    ("worshippers | of the cathedral told stories")."""
    sentence, landings = clause
    states = {(q, 1, False, q) for q, word in enumerate(sentence) if word == chain[0]}
    for i in range(1, len(chain)):
        word, following = chain[i], set()
        for p, length, broke, start in states:
            subject = start <= 2
            reach = [q for q in range(p + 1, min(len(sentence), p + _NEAR + 1))
                     if subject or joined[i] or not any(p < landing <= q for landing in landings)]
            if subject:
                reach += [q for q in landings if q > p + _NEAR]
            following |= {(q, 2, broke, start) for q in reach if sentence[q] == word}
            if breaks[i] and length == 2:
                following |= {(q, 1, True, q) for q, seen in enumerate(sentence) if seen == word}
        states = following
    return any(length == 2 or not broke for _, length, broke, _ in states)


def check_short(text: str, question: str, answer: str) -> Optional[str]:
    """A short-answer question, or None when it isn't an explain-type question, runs long, or says
    anything one sentence of the stored question and answer doesn't. The opening and question glue
    aside, its words (in plain forms) must:
      - all be in the source
      - read in order as close spans of ONE source sentence, apart from words of the stored
        question's own topic (see _spans_fit), so source words can't be recombined into a claim
        the source never makes ("heparin inhibits the patient", "collisions give constant time")
      - give an asserting word (cause, after, only, every, not...) the same next word there;
        "X's Y" has X shortly before Y there, and "to Y" is "to Y" there
      - never ask as true what the source only says negated ("Gatsby can reach" from "can never reach")
    When in doubt the question is dropped: an invented question is worse than a missing one."""
    text = " ".join(str(text or "").split())
    opening = _EXPLAIN.search(text)
    if not text or len(text) > 220 or not opening:
        return None
    rest = _WHAT_MEANS.sub(r"\1", _FRAME_PHRASE.sub(" ", text[opening.end():]))
    words = [_form(word) for word in _tokens(rest)]
    content = [(at, word) for at, word in enumerate(words) if word not in _FRAME]
    clauses = _clauses(question) + _clauses(answer)
    sentences = [tokens for tokens, _ in clauses]
    topic = {word for tokens in _sentences(question) for word in tokens} - {word for tokens in _sentences(answer) for word in tokens}
    if not content or any(not any(word in tokens for tokens in sentences) for _, word in content):
        return None

    def fits(skipped: set) -> bool:
        chain, breaks, joined, last = [], [], [], -1
        for n, (at, word) in enumerate(content):
            if n in skipped:
                continue
            gap = set(words[last + 1:at])
            breaks.append(bool(_BREAKS & gap) or word in _BREAK_BEFORE)
            joined.append(bool({"and", "or", "but"} & gap))
            chain.append(word)
            last = at
        return not chain or any(_spans_fit(clause, chain, breaks, joined) for clause in clauses)

    # Words of the stored question's own topic (the answer never repeats them) read with the
    # question, or are left out where they only name what the answer is about: as the subject the
    # answer calls "it" or "they", one word inside a phrase ("after hip surgery"), or a setting at
    # the end ("...the farmers | in Animal Farm"). A run of them can't be slipped into the middle
    # ("...in one bucket to give constant average lookup time").
    runs, n = [], 0
    while n < len(content):
        if content[n][1] in topic:
            end = n
            while end + 1 < len(content) and content[end + 1][1] in topic:
                end += 1
            runs.append((n, end))
            n = end + 1
        else:
            n += 1
    skipped = set()
    for first, end in runs:
        lead = words[content[first - 1][0] + 1:content[first][0]] if first else []
        if first == 0 or (end == first and end + 1 < len(content)) or (end + 1 == len(content) and _SETTING & set(lead)):
            skipped |= set(range(first, end + 1))
    if not (fits(set()) or fits(skipped)):
        return None

    for n, (at, word) in enumerate(content):
        after = content[n + 1][1] if n + 1 < len(content) else None
        if word in _ASSERT:
            if after and not _follows(sentences, word, after, _NEAR):
                return None
        elif all(_negated(tokens, j) for tokens in sentences for j, found in enumerate(tokens) if found == word) \
                and not _negated(words, at):
            return None
    for owner, thing in _POSSESSIVE.findall(rest):
        if not (_follows(sentences, _form(owner.lower()), _form(thing.lower()), _NEAR)
                or _follows(sentences, _form(thing.lower()), _form(owner.lower()), 3)):  # "the hands of a nurse"
            return None
    if not re.match(r"(?i)\s*(compare|contrast)", text):  # "Compare X to Y": that "to" is glue
        for at, word in enumerate(words):
            target = _next_word(words, at) if word == "to" else None
            if target and target not in _TO_FREE and not any(
                    _next_word(tokens, j) == target for tokens in sentences for j, seen in enumerate(tokens) if seen == "to"):
                return None
    return text


def short_items(pairs: list, indexes: list, generated: list) -> list:
    """Checked short-answer items from Haiku's reply ({"id", "question"} per item). The key is
    always the stored answer, never anything the model wrote."""
    seen = {normalize(item["question"]) for item in short_answer(pairs)}
    items, used = [], set()
    for item in generated if isinstance(generated, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            n = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if not 0 <= n < len(indexes) or n in used:
            continue
        index = indexes[n]
        text = check_short(item.get("question"), pairs[index]["question"], pairs[index]["answer"])
        if not text or normalize(text) in seen:
            continue
        used.add(n)
        seen.add(normalize(text))
        items.append({"id": f"as{index}", "source": index, "question": text,
                      "key": pairs[index]["answer"].strip(), "points": SHORT_POINTS})
    return sorted(items, key=lambda item: item["source"])


# ---- fill in the blank ----

def fill_candidates(pairs: list, limit: int = 40) -> list:
    """Q/A pairs worth asking Haiku to turn into fill-in sentences: answers with something to blank
    but short enough for one sentence. Ideas matching and short answer can't use come first, so a
    mixed printout covers more of the guide."""
    used = {item["source"] for item in matching(pairs) + short_answer(pairs)}
    fits = [index for index, pair in enumerate(pairs) if _shown(pair) and 1 <= len(pair["answer"].split()) <= 35]
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
    allowed = _content_forms(question) | _content_forms(answer)
    if _content_forms(_BLANK.sub(lambda m: m.group(1), sentence)) - allowed:
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
