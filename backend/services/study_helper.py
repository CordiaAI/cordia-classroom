"""The Tutor as a study helper: a student who says they have a test to study for gets a short plan with
buttons instead of a lecture, and a finished check-in in Learn comes back as what to do next and when.

Everything here is worked out from the student's own rows (guides, calendar exams) and the dates they
give, with no model call, so a plan never states a fact the student's material doesn't hold.
"""
import re
from datetime import date, timedelta
from typing import Optional
from urllib.parse import urlencode

# ---- Is the student asking for help with a test they sit? ----
# The test is a noun the student sits ("my bio test", "the midterm", "an art history final"), never part of a
# compound ("unit tests", "t-test", "test tube", "quiz question", "final answer", "the Howey test for…"):
# the word after it has to end the phrase, and "final" counts only as that noun or before exam/test.
_WEEKDAY = r"(?:mon|tues|wednes|thurs|fri|satur|sun)day"
_MONTH = (r"(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec|january|february|march|april|june|july|august|"
          r"september|october|november|december)")
_TEST = r"(?<![-\w])(?:tests?|exams?|midterms?|quiz(?:zes)?|finals?(?:\s+(?:exams?|tests?))?)"
TEST_WORD = re.compile(_TEST, re.IGNORECASE)
_ENDS = (r"(?=\s*(?:$|[,.!?;:—–])|\s+(?:is|are|was|'s|on|in|at|by|due|about|covering|over|and|but|so|that|which|"
         r"i|i'm|i've|we|can|could|would|please|help|any|what|how|where|today|tonight|tomorrow|tmrw|tmr|next|this|"
         rf"coming|soon|{_WEEKDAY}|{_MONTH}|\d+)\b)")
# When the test is: "tomorrow", "on Friday", "next week", "in 5 days", "Dec 3", "12/3".
_WHEN = (rf"(?:is\s+|'s\s+)?(?:today|tonight|tomorrow|tmrw|tmr|(?:on\s+|this\s+|next\s+)?{_WEEKDAY}|next\s+week|"
         rf"in\s+\w+\s+(?:days?|weeks?)|(?:on\s+)?{_MONTH}\.?\s+\d|(?:on\s+)?\d{{1,2}}/\d{{1,2}})\b")
# Words naming the class between the article and the test ("my art history final", "the CS 101 quiz"), never
# a word that makes the test the topic of something else ("a question about the final exam").
_COURSE = r"(?:(?!(?:about|of|with|on|in|to|for|from|question|questions|answer|answers|the|a|an|my|and|or)\b)[\w&.'+-]+\s+){0,4}?"
_OWNER = r"(?:(?:a|an|my|our|the|this|that|next|another|tomorrow's|today's)\s+)?"
STUDY_FOR_TEST = re.compile(
    # "I need to study for my bio test", "help me prep for the midterm", "get ready for my exam".
    r"\b(?:study|studying|prep|prepping|prepare|preparing|review|reviewing|revise|revising|cram|cramming|ready)\s+"
    rf"(?:\w+\s+){{0,2}}?for\s+{_OWNER}{_COURSE}{_TEST}{_ENDS}"
    # "I have an exam on Friday", "I've got a quiz Thursday in CS 101", "there's a test tomorrow".
    rf"|\b(?:have|has|got|there's|there\s+is)\s+(?:a|an|my|our|another)\s+{_COURSE}{_TEST}{_ENDS}"
    # "my art history final is next week", "test tomorrow on contracts", "exam on Friday".
    rf"|{_TEST}\s+{_WHEN}",
    re.IGNORECASE,
)
# Named tests and methods that are topics, not something the student sits ("the Allen test", "unit tests").
COMPOUND_TESTS = {"unit", "t", "z", "f", "chi", "chi-square", "allen", "howey", "romberg", "turing", "rinne", "weber",
                  "patch", "blood", "drug", "pregnancy", "stress", "litmus", "smoke", "regression", "integration", "load",
                  "acid", "skin", "screening", "hearing", "vision", "eye", "urine", "lab", "ab", "a/b", "beta", "alpha"}
# A question about something ("what will be on the test?", "why was question 2 wrong?") is not a plan
# request, unless it asks for help getting ready ("can you help me get ready?", "where do I start?").
ASKS_ABOUT = re.compile(r"^\s*(?:what|why|how|who|when|where|which|explain|describe|define|is|are|does|do|did)\b", re.IGNORECASE)
ASKS_FOR_HELP = re.compile(
    r"\b(?:help|what\s+(?:should|do|can)\s+i\s+(?:do|study|start)|where\s+(?:do|should)\s+i\s+(?:start|begin)|"
    r"how\s+(?:do|should|can)\s+i\s+(?:study|prep|prepare|get\s+ready|start)|plan)\b",
    re.IGNORECASE,
)
# "Learn" as the product, not the verb: "make a Learn for it", "set up Learn for my exam", "build a learn set",
# "start a Learn round", "Learn for this". Not "things to learn for the quiz" or "open the learn page".
LEARN_REQUEST = re.compile(
    r"\b(?:make|create|build|set\s*up|start|generate|open|run)\s+(?:me\s+)?(?:(?:a|an|the|my)\s+)?"
    r"learn(?:\s+(?:set|session|round|mode))?(?=\s*(?:$|[,.!?;:])|\s+(?:for|on|from|with|about|now|please)\b)"
    r"|(?:^|[.!?]\s+)learn\s+for\s+(?:it|this|that)\b"
    r"|\b(?:a|an|the|my)\s+learn\s+(?:set|session|round)\b",
    re.IGNORECASE,
)


def _sits_a_test(sentence: str) -> bool:
    for match in STUDY_FOR_TEST.finditer(sentence):
        start = match.start() + TEST_WORD.search(match.group(0)).start()
        before = re.findall(r"[\w/-]+", sentence[:start].lower())
        if not before or before[-1].rstrip("-") not in COMPOUND_TESTS:
            return True
    return False


def asks_to_study_for_test(text: str) -> bool:
    """The student says they have a test to get ready for. A question about something else that mentions a
    test, an exam word inside a compound ("unit tests", "final answer") or a topic test ("the Howey test") is not."""
    for sentence in re.split(r"(?<=[.?!;])\s+", (text or "").strip()):
        if not _sits_a_test(sentence):
            continue
        if (ASKS_ABOUT.search(sentence) or sentence.rstrip().endswith("?")) and not ASKS_FOR_HELP.search(sentence):
            continue
        return True
    return False


def asks_for_learn(text: str) -> bool:
    return bool(LEARN_REQUEST.search(text or ""))


WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {name: index for index, names in enumerate(
    [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",), ("jun", "june"),
     ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"), ("oct", "october"), ("nov", "november"),
     ("dec", "december")], 1) for name in names}
SMALL_NUMBERS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                 "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14}
MONTH_NAMES = "|".join(sorted(MONTHS, key=len, reverse=True))


def _future(year: int, month: int, day: int, today: date) -> Optional[date]:
    try:
        when = date(year, month, day)
    except ValueError:
        return None
    if when < today:
        try:
            when = date(year + 1, month, day)
        except ValueError:
            return None
    return when


def parse_test_date(text: str, today: date) -> Optional[date]:
    """The test date the student gave ("tomorrow", "on Friday", "in 5 days", "Dec 3", "12/3"), or None."""
    words = (text or "").lower()
    if match := re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", words):
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    if re.search(r"\bday after tomorrow\b", words):
        return today + timedelta(days=2)
    if re.search(r"\b(?:tomorrow|tmrw|tmr)\b", words):
        return today + timedelta(days=1)
    if re.search(r"\b(?:today|tonight|this (?:morning|afternoon|evening))\b", words):
        return today
    if match := re.search(r"\bin\s+(\d{1,2}|" + "|".join(SMALL_NUMBERS) + r")\s+(days?|weeks?)\b", words):
        count = int(match.group(1)) if match.group(1).isdigit() else SMALL_NUMBERS[match.group(1)]
        return today + timedelta(days=count * (7 if match.group(2).startswith("week") else 1))
    if re.search(r"\bnext week\b", words):
        return today + timedelta(days=7)
    if match := re.search(rf"\b({MONTH_NAMES})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", words):
        return _future(today.year, MONTHS[match.group(1)], int(match.group(2)), today)
    if match := re.search(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({MONTH_NAMES})\b", words):
        return _future(today.year, MONTHS[match.group(2)], int(match.group(1)), today)
    if match := re.search(r"\b(\d{1,2})/(\d{1,2})\b", words):
        return _future(today.year, int(match.group(1)), int(match.group(2)), today)
    if match := re.search(r"\b(next\s+)?(" + "|".join(WEEKDAYS) + r")\b", words):
        ahead = (WEEKDAYS.index(match.group(2)) - today.weekday()) % 7
        return today + timedelta(days=ahead or (7 if match.group(1) else 0))
    return None


STOP_WORDS = set("""
a an and are at be been but by can could do does for from get got have help how i i'm im in is it its just me my need
next of on or our please prep prepare preparing ready review reviewing revise revising so study studying test tests exam
exams midterm midterms final finals quiz quizzes that the their them then there this to tomorrow today tonight up want
week weeks what when which will with you your day days cram cramming about coming soon upcoming class course make learn
set it's let's lets start some going big huge important hard open questions practice
""".split()) | set(WEEKDAYS) | set(MONTHS)


def topic_words(text: str) -> set:
    """The words that name what the test is on ("bio", "cell", "101"), without dates and filler."""
    return {word for word in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(word) >= 3 and word not in STOP_WORDS}


def shared_topics(asked: set, title: str) -> int:
    """How many asked words name something in the title ("bio" names "Biology", "chem" names "Chemistry")."""
    named = topic_words(title)
    return sum(1 for word in asked if any(other.startswith(word) or word.startswith(other) for other in named))


def match_exam(question: str, exams: list, when: Optional[date]) -> Optional[dict]:
    """The upcoming exam the student means: named by its title or course, or due on the date they gave."""
    asked = topic_words(question)
    best, best_score = None, 0
    for exam in exams:
        score = 2 * shared_topics(asked, f"{exam.get('title') or ''} {exam.get('course') or ''}")
        if when and str(exam.get("due_at") or "")[:10] == when.isoformat():
            score += 3
        if score > best_score:
            best, best_score = exam, score
    return best


def match_guide(question: str, guides: list, exam: Optional[dict] = None) -> Optional[dict]:
    """The student's guide for this test: the exam's review set, else the guide whose title shares the most
    words with what they asked (most recently updated first on a tie). None when nothing matches."""
    if exam:
        review = f"{str(exam.get('title') or '').strip()}: review".lower()
        found = next((guide for guide in guides if str(guide.get("title") or "").strip().lower() == review), None)
        if found:
            return found
    asked = topic_words(question) | (topic_words(f"{exam.get('title') or ''} {exam.get('course') or ''}") if exam else set())
    best, best_score = None, 0
    for guide in guides:
        score = shared_topics(asked, guide.get("title") or "")
        if score > best_score:
            best, best_score = guide, score
    return best


def _day_label(when: date, today: date) -> str:
    days = (when - today).days
    if days == 0:
        return "today"
    if days == 1:
        return "tomorrow"
    label = f"{WEEKDAYS[when.weekday()].capitalize()}, {when.strftime('%b')} {when.day}"
    return f"on {label} ({days} days away)" if days > 1 else f"on {label}"


def learn_href(guide_id: str, when: Optional[date] = None, today: Optional[date] = None, checkin: bool = True) -> str:
    """Learn for a guide; the test date rides along (Learn saves it) and checkin starts the short first round."""
    query = {}
    if when and (today is None or when >= today):
        query["test"] = when.isoformat()
    if checkin:
        query["checkin"] = "1"
    return f"/learn/{guide_id}" + (f"?{urlencode(query)}" if query else "")


def plan_reply(*, today: date, when: Optional[date], guide: Optional[dict], exam: Optional[dict],
               material_title: str = "", canvas_connected: bool = False) -> tuple[str, dict]:
    """A short plan and its buttons: (answer, study_plan). Buttons are actions the web app knows:
    checkin (a Learn link), build (asks the Tutor to make the Learn set), canvas_review (builds the exam's
    review set from Canvas), attach (opens the file picker) and link."""
    name = str((exam or {}).get("title") or "").strip() or "your test"
    lead = f"Let's get you ready for {name}" + (f" {_day_label(when, today)}" if when else "") + "."
    days = (when - today).days if when else None
    actions: list = []
    if guide:
        title = str(guide.get("title") or "your guide")
        if days is None:
            steps = [f"**Check-in quiz:** a short Learn round on {title} to see where you stand.",
                     "**Your pace:** tell me the test date, or add it in Learn, and I'll say what to do each day."]
        elif days <= 0:
            steps = [f"**Check-in quiz now:** a short Learn round on {title}.",
                     "**One round on what you miss,** then a final check before the test."]
        elif days == 1:
            steps = [f"**Check-in quiz now:** a short Learn round on {title}.",
                     "**One round tonight** on what you miss.",
                     "**Final check** tomorrow before the test."]
        else:
            steps = [f"**Check-in quiz today:** a short Learn round on {title}.",
                     "**A Learn round each day:** I'll tell you how many ideas from your score.",
                     f"**Final check** the day before, {WEEKDAYS[(when - timedelta(days=1)).weekday()].capitalize()}."]
        actions.append({"kind": "checkin", "label": "Start the check-in quiz", "href": learn_href(guide["id"], when, today)})
        body = "\n".join(f"{index}. {step}" for index, step in enumerate(steps, 1))
        answer = f"{lead} Here's the plan:\n{body}"
    elif material_title:
        answer = (f"{lead} I'll turn {material_title} into a Learn set first, then you can start a short check-in quiz."
                  + ("" if when else " When is the test?"))
        actions.append({"kind": "build", "label": "Build the Learn set", "prompt": "Make a Learn for it"})
    elif exam and str(exam.get("id") or "").startswith("canvas-"):
        answer = (f"{lead} You don't have a guide for it yet. I can gather your Canvas material for this class "
                  "into a review set, then start a short check-in quiz.")
        actions.append({"kind": "canvas_review", "label": "Build it from Canvas", "item_key": exam["id"]})
        actions.append({"kind": "attach", "label": "Attach notes instead"})
    else:
        answer = (f"{lead} Which guide is it for? Pick it above, or attach your notes and I'll build a Learn set "
                  "from them." + ("" if when else " And when is the test?"))
        actions.append({"kind": "attach", "label": "Attach notes"})
        if not canvas_connected:
            actions.append({"kind": "link", "label": "Connect Canvas", "href": "/canvas"})
    plan = {
        "guide": {"id": guide["id"], "title": guide.get("title") or ""} if guide else None,
        "test_date": when.isoformat() if when else None,
        "exam": {"key": exam.get("id"), "title": exam.get("title") or ""} if exam else None,
        "actions": actions,
    }
    return answer, plan


def checkin_reply(*, title: str, right: int, total: int, remaining: int, when: Optional[date], today: date) -> str:
    """What to do next and when, after the check-in quiz: from the score and the days left."""
    score = right / total if total else 0
    lines = [f"Check-in done on {title}: {right} of {total} right."]
    if score >= 0.8:
        lines.append("Strong start. Keep it fresh rather than cramming.")
    elif score >= 0.5:
        lines.append("Good base. The misses are where your time goes now.")
    else:
        lines.append("That's your starting point, and now we know where to begin.")
    days = (when - today).days if when else None
    if days is None:
        lines.append("Next: do one Learn round today, and add your test date in Learn so I can pace the rest.")
    elif days < 0:
        lines.append("Your saved test date has passed. Set the next one in Learn and I'll pace you to it.")
    elif days == 0:
        lines.append("Your test is today: one quick round on what you missed, then a final check.")
    elif days == 1:
        lines.append("Your test is tomorrow: one more round tonight on what you missed, then a final check before the test.")
    else:
        per_day = -(-remaining // days) if remaining else 0  # Learn's own pace (learnEngine.mjs testPlan)
        final_day = WEEKDAYS[(when - timedelta(days=1)).weekday()].capitalize()
        pace = (f"master about {per_day} idea{'s' if per_day != 1 else ''} a day in Learn" if per_day
                else "a short round every other day keeps it fresh")
        lines.append(f"Your test is in {days} days: {pace}, and run a final check on {final_day}.")
    return " ".join(lines)
