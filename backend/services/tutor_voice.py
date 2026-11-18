"""How a Tutor reply reads, checked after the model writes it (the prompt asks for the same; this is the guard).

- plain_opening: drops a slang or filler opener ("Yo,", "Hey there!", "Great question!").
- ground_general_answer: a reply written without the student's material that states specific names,
  numbers or dates gets a fixed line saying they are unchecked and offering to check them against
  the student's own material. The words are the same for every subject.
"""
import re

# A slang or filler opener counts only when punctuation follows it ("Yo, here's…", "Hey there! …",
# "Great question! …"), so real words that start the same way stay ("Yo-yo dieting", "Hey Jude is…",
# "Dude ranches", "What's up with…", "Good question to ask: …", "Okay so-called experts").
SLANG = r"yo+|ay+o*|sup|wa+s+up|what'?s\s+up|hey+(?:\s+there)?|heya|hiya|dude|bro|fam|lol|ok(?:ay)?\s+so|alright\s+so|so\s+basically"
SLANG_OPENER = re.compile(rf"^\s*(?:(?:{SLANG})(?:[,!.]+|\s*[—–])|(?:great|good)\s+question[!.,]+)\s+", re.IGNORECASE)


def plain_opening(answer: str) -> str:
    """The reply without a slang or filler opener; unchanged when that opener is all there is."""
    text = answer or ""
    match = SLANG_OPENER.match(text)
    rest = text[match.end():] if match else ""
    if not match or not rest.strip():
        return text
    return rest[:1].upper() + rest[1:]


TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
NUMBER_WORD = re.compile(rf"^(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|"
                         rf"sixteen|seventeen|eighteen|nineteen|{TENS}|hundred|thousand|million|billion|dozen|"
                         rf"(?:{TENS})-(?:one|two|three|four|five|six|seven|eight|nine))$")
MONTHS = ("january|february|march|april|may|june|july|august|september|october|november|december|"
          "jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec")
YEAR = re.compile(r"\b(?:1[0-9]{3}|20[0-9]{2})s?\b")
DATE = re.compile(rf"\b(?:{MONTHS})\.?\s+\d{{1,2}}(?:st|nd|rd|th)?\b|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:{MONTHS})\b", re.IGNORECASE)
# Counts about the answer's own structure ("here are three steps", "two ways to see it"), not facts.
META_NOUNS = {"ways", "steps", "things", "tips", "examples", "points", "ideas", "parts", "questions", "options", "reasons"}
# Plurals without an s ("six men", "fifty-six people").
IRREGULAR_PLURALS = {"men", "women", "people", "children", "feet", "teeth", "mice", "geese", "oxen", "persons", "data", "criteria"}
# Words that end a count: after "one is", "two plus two", "Step 2 is", "one by one as" nothing is being counted.
FUNCTION_WORDS = set("""
a an the and or but nor so if then than that this these those which who whom whose what when where while as at by for from in
into of on onto to with without within about above after before below between over under through per via like unlike plus
minus times is are was were be been being am has have had do does did can could will would shall should may might must
it its they them their we us our you your he him his she her not no yes each every any some more most less least same
other another again also only just even still thus here there always perhaps unless across besides whereas towards
sometimes afterwards ago apart
""".split())
# A unit right after a numeral ("500 mg", "5.0 mEq/L", "120 mmHg", "20%").
UNIT = re.compile(r"^(?:°[cf]?|mg|mcg|µg|μg|g|kg|ml|l|dl|mmol|mol|meq|mmhg|cm|mm|km|m|ft|lb|lbs|oz|bpm|kcal|cal|hz|khz|mhz|ghz|"
                  r"kb|mb|gb|tb|ms|ns|mph|kph|[a-zµμ]{1,5}/[a-z]{1,5})$", re.IGNORECASE)
TOKEN = re.compile(r"\d[\d,.]*%?|°[CFcf]?|[A-Za-zµμ][\w'’/-]*")
WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
# Capitalized for grammar or code, not because they name someone or something.
COMMON_CAPS = {"i", "i'm", "i've", "i'd", "i'll", "true", "false", "none", "null", "nil"}
DETERMINERS = {"the", "a", "an", "this", "that", "these", "those", "its", "their", "his", "her", "our", "your", "each",
               "every", "any", "some", "no"}
CODE = re.compile(r"```.*?(?:```|$)|`[^`\n]*`", re.DOTALL)


def _plain_lines(answer: str) -> list[str]:
    """The reply's sentences without code, markdown markers or bold step titles."""
    lines = []
    for line in CODE.sub(" ", answer or "").splitlines():
        line = re.sub(r"^\s*(?:>\s*|[-*]\s+|\d+[.)]\s+)", "", line)
        if re.match(r"^\*\*[^*]+\*\*\s*$", line.strip()):
            continue  # a bold step title on its own line
        lines.append(line.replace("**", ""))
    return lines


def _sentences(answer: str):
    for line in _plain_lines(answer):
        yield from (sentence for sentence in re.split(r"(?<=[.!?:;])\s+", line) if sentence.strip())


def _counts(sentence: str, asked: set, asked_numbers: set) -> bool:
    """A number followed (within three words) by what it counts: "six men", "six former soldiers",
    "206 bones", "fifty-six people", "six of them", or a numeral with a unit ("5.0 mEq/L")."""
    tokens = [token.rstrip(".,") or token for token in TOKEN.findall(sentence)]
    for index, token in enumerate(tokens):
        word = token.lower()
        digits = token[0].isdigit()
        if not digits and not NUMBER_WORD.match(word):
            continue
        if word in asked or token.rstrip("%") in asked_numbers:
            continue
        if digits and token.endswith("%"):
            return True
        ahead = [item.lower() for item in tokens[index + 1:index + 4]]
        if digits and ahead and UNIT.match(ahead[0]):
            return True
        if ahead[:2] and ahead[0] == "of" and ahead[1:2] and ahead[1] in {"them", "these", "those", "us", "whom"}:
            return True
        for following in ahead:
            if following in FUNCTION_WORDS or following[0].isdigit():
                break
            plural = following in IRREGULAR_PLURALS or (following.endswith("s") and not following.endswith("ss") and len(following) > 3)
            if plural:
                if following not in META_NOUNS:
                    return True
                break
    return False


def _names(sentence: str, asked: set) -> bool:
    """A run of capitalized words that names someone or something ("Caravaggio", "Pulaski, Tennessee"),
    not a capital the sentence or code needs, a symbol ("Na", "CoA"), or a capitalized modifier before a
    common word ("the Greek word", "Italian Renaissance painters", "the State bringing charges")."""
    words = list(WORD.finditer(sentence))
    index = 0
    while index < len(words):
        if not words[index].group(0)[0].isupper():
            index += 1
            continue
        end = index
        while end + 1 < len(words) and words[end + 1].group(0)[0].isupper() \
                and sentence[words[end].end():words[end + 1].start()] in {" ", "-"}:
            end += 1
        run = [match.group(0) for match in words[index:end + 1]]
        named = [word for word in run if _is_name(word, asked)]
        if index == 0:
            named = [word for word in named if word != run[0]]  # the sentence's first word
        before = words[index - 1].group(0).lower() if index and sentence[words[index - 1].end():words[index].start()].strip() == "" else ""
        after = words[end + 1].group(0) if end + 1 < len(words) and sentence[words[end].end():words[end + 1].start()].strip() == "" else ""
        modifier = (index == 0 or before in DETERMINERS) and after[:1].islower()
        if named and not modifier:
            return True
        index = end + 1
    return False


def _is_name(word: str, asked: set) -> bool:
    bare = re.sub(r"['’]s$", "", word.lower())
    if word.isupper() or bare in COMMON_CAPS or bare in asked:
        return False
    letters = re.sub(r"[^A-Za-z]", "", word)
    if len(letters) <= 2 or (len(letters) <= 4 and any(char.isupper() for char in letters[1:])):
        return False  # a symbol: Na, Fe, CoA, NaCl
    return True


def states_specifics(answer: str, question: str = "") -> bool:
    """Whether the reply states a specific name, number, count, amount or date the student didn't give."""
    asked = {word.lower() for word in WORD.findall(question or "")}
    asked_numbers = set(re.findall(r"\d[\d,.]*", question or ""))
    text = "\n".join(_plain_lines(answer))
    if any(year not in asked_numbers for year in YEAR.findall(text)) or DATE.search(text):
        return True
    return any(_counts(sentence, asked, asked_numbers) or _names(sentence, asked) for sentence in _sentences(answer))


UNCHECKED_NOTE = ("I don't have your class material for this, so treat the names, numbers and dates above as unchecked. "
                  "Pick a guide or attach your notes and I'll check them against it.")
OFFERS_MATERIAL = re.compile(r"\b(?:pick|choose|select|attach|add|share|upload)\b[^.?!]{0,40}\b(?:guide|notes|material)", re.IGNORECASE)


def ground_general_answer(answer: str, question: str = "") -> str:
    """A reply with no material behind it: specific facts are marked unchecked, with an offer to check them."""
    text = (answer or "").rstrip()
    if not text or not states_specifics(text, question) or OFFERS_MATERIAL.search(text):
        return text
    return f"{text}\n\n{UNCHECKED_NOTE}"
