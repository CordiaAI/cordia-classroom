"""How a Tutor reply reads, checked after the model writes it (the prompt asks for the same; this is the guard).

- plain_opening: drops a slang or filler opener ("Yo,", "Hey there!", "Great question!").
- ground_general_answer: a reply written without the student's material that states specific names,
  numbers or dates gets a fixed line saying they are unchecked and offering to check them against
  the student's own material. The words are the same for every subject.
"""
import re

SLANG_OPENER = re.compile(
    r"^\s*(?:yo+|ay+o*|sup|wa+s+up|what'?s up|hey+(?:\s+there)?|heya|hiya|dude|bro|fam|lol|"
    r"ok(?:ay)?\s+so|alright\s+so|so\s+basically|great question|good question)\b[\s,!.:;—–-]*",
    re.IGNORECASE,
)


def plain_opening(answer: str) -> str:
    """The reply without a slang or filler opener; unchanged when that opener is all there is."""
    text = answer or ""
    match = SLANG_OPENER.match(text)
    rest = text[match.end():] if match else ""
    if not match or not rest.strip():
        return text
    return rest[:1].upper() + rest[1:]


NUMBER_WORDS = ("one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                "sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion|dozen")
MONTHS = ("january|february|march|april|may|june|july|august|september|october|november|december|"
          "jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec")
# Counts of things that are about the answer itself, not facts about the world ("two ways", "three steps").
META_NOUNS = {"ways", "steps", "things", "tips", "examples", "points", "ideas", "parts", "questions", "options",
              "reasons", "sentences", "words", "lines", "bullets", "times", "minutes", "seconds", "hours", "days"}
YEAR = re.compile(r"\b(?:1[0-9]{3}|20[0-9]{2})s?\b")
DATE = re.compile(rf"\b(?:{MONTHS})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\b|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:{MONTHS})\b", re.IGNORECASE)
# The number is any case; the words between it and the plural noun must be capitalized ("six Confederate veterans").
COUNT = re.compile(rf"\b(?i:\d[\d,.]*|{NUMBER_WORDS})\s+(?:[A-Z][a-z]+\s+)*([a-z]+s)\b")
WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
# Words that are capitalized for grammar, not because they name someone or something.
COMMON_CAPS = {"i", "i'm", "i've", "i'd", "i'll"}


def _plain_lines(answer: str) -> list[str]:
    """The reply's sentences without markdown markers or bold step titles."""
    lines = []
    for line in (answer or "").splitlines():
        line = re.sub(r"^\s*(?:>\s*|[-*]\s+|\d+[.)]\s+)", "", line)
        if re.match(r"^\*\*[^*]+\*\*\s*$", line.strip()):
            continue  # a bold step title on its own line
        lines.append(line.replace("**", ""))
    return lines


def _names(answer: str, asked: set) -> bool:
    """A capitalized word that isn't the first word of its sentence and wasn't in the question."""
    for line in _plain_lines(answer):
        for sentence in re.split(r"(?<=[.!?:;])\s+", line):
            words = WORD.findall(sentence)
            for word in words[1:]:
                bare = re.sub(r"['’]s$", "", word.lower())
                if word[0].isupper() and not word.isupper() and bare not in asked and bare not in COMMON_CAPS:
                    return True
    return False


def states_specifics(answer: str, question: str = "") -> bool:
    """Whether the reply states a specific name, number, count or date the student didn't give."""
    asked = {word.lower() for word in WORD.findall(question or "")}
    asked_numbers = set(re.findall(r"\d[\d,.]*", question or ""))
    text = "\n".join(_plain_lines(answer))
    if any(year not in asked_numbers for year in YEAR.findall(text)) or DATE.search(text):
        return True
    for match in COUNT.finditer(text):
        number = match.group(0).split()[0]
        if match.group(1).lower() not in META_NOUNS and number.lower() not in asked and number not in asked_numbers:
            return True
    return _names(answer, asked)


UNCHECKED_NOTE = ("I don't have your class material for this, so treat the names, numbers and dates above as unchecked. "
                  "Pick a guide or attach your notes and I'll check them against it.")
OFFERS_MATERIAL = re.compile(r"\b(?:pick|choose|select|attach|add|share|upload)\b[^.?!]{0,40}\b(?:guide|notes|material)", re.IGNORECASE)


def ground_general_answer(answer: str, question: str = "") -> str:
    """A reply with no material behind it: specific facts are marked unchecked, with an offer to check them."""
    text = (answer or "").rstrip()
    if not text or not states_specifics(text, question) or OFFERS_MATERIAL.search(text):
        return text
    return f"{text}\n\n{UNCHECKED_NOTE}"
