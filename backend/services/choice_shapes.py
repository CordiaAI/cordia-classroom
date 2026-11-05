"""Multiple-choice options that look like the answer.

A wrong choice must be the same kind of thing as the right one, written the same way: a year
answer ("1863") gets years, a date ("July 4, 1776") gets dates in that exact style, an amount
("$3.2 million", "45%", "12 mg") gets amounts with the same unit and precision, and a short answer
with a value inside ("In 1863", "About 45%") gets the same words around a different value. Text
answers prefer text of the same length class. Used by routers/quiz.py for new quizzes (free and AI)
and to repair saved ones when they're served.
"""

from __future__ import annotations

import hashlib
import random
import re
from dataclasses import dataclass
from typing import Iterable, Optional

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
_ABBR = {m[:3]: i for i, m in enumerate(MONTHS)}
_ABBR["sept"] = 8
_MONTH_WORD = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_MONTH = rf"(?P<month>{_MONTH_WORD})"

_YEAR = re.compile(r"^(?P<pre>(?:c\.|ca\.|circa|ad)\s*)?(?P<year>\d{3,4})(?P<decade>s)?(?P<era>\s*(?:bce|bc|ce|ad))?$"
                   r"|^(?P<pre2>(?:c\.|ca\.|circa)\s*)?(?P<year2>\d{1,4})(?P<era2>\s*(?:bce|bc|ce|ad))$", re.I)
_DATES = [
    ("mdy", re.compile(rf"^{_MONTH}\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?,\s*(?P<year>\d{{3,4}})$", re.I)),
    ("dmy", re.compile(rf"^(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+{_MONTH},?\s+(?P<year>\d{{3,4}})$", re.I)),
    ("my", re.compile(rf"^{_MONTH},?\s+(?P<year>\d{{3,4}})$", re.I)),
    ("md", re.compile(rf"^{_MONTH}\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?$", re.I)),
    ("iso", re.compile(r"^(?P<year>\d{4})-(?P<m>\d{2})-(?P<day>\d{2})$")),
    ("slash", re.compile(r"^(?P<a>\d{1,2})/(?P<b>\d{1,2})/(?P<year>\d{2}|\d{4})$")),
]
_NUMBER = re.compile(
    r"^(?P<pre>[$€£¥]|~|≈|about\s+|approximately\s+|roughly\s+|nearly\s+|over\s+|under\s+)?"
    r"(?P<sign>[-+−])?(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?P<dec>\.\d+)?"
    r"(?P<post>\s*(?:%|percent|per\s+cent|[a-zµ°/²³]+(?:/[a-z]+)?)(?:\s+(?:of\s+)?[a-z]+(?:/[a-z]+)?)?)?$",
    re.I,
)
# A short answer with one value inside it ("In 1863", "About 45% of cells", "Signed in July 1776").
_INNER = re.compile(
    rf"(?:{_MONTH_WORD}\s+\d{{1,2}}(?:st|nd|rd|th)?,\s*\d{{3,4}}|\d{{1,2}}\s+{_MONTH_WORD},?\s+\d{{3,4}}|{_MONTH_WORD},?\s+\d{{3,4}}"
    r"|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}"
    r"|[$€£¥]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|[$€£¥]?\d+(?:\.\d+)?%?)",
    re.I,
)
VALUE_KINDS = ("year", "date", "number")
SHORT_WORDS = 4
TEMPLATE_WORDS = 6


@dataclass(frozen=True)
class Shape:
    kind: str                      # year | date | number | templated | short | sentence
    style: tuple = ()              # how the value is written, compared by same_shape
    parts: Optional[dict] = None   # the parsed value, used to make new ones
    inner: Optional["Shape"] = None
    template: tuple = ()           # (before, after) around the inner value


def _strip(text) -> str:
    value = str(text if text is not None else "").strip()
    if value.endswith(".") and not value.endswith("..") and not re.search(r"\b(?:c|ca|bc|ad|bce|ce|[a-z]{3,4})\.$", value, re.I):
        value = value[:-1].rstrip()
    return re.sub(r"\s+", " ", value)


def _month_style(token: str) -> tuple:
    plain = token.rstrip(".").lower()
    index = MONTHS.index(plain) if plain in MONTHS else _ABBR.get(plain[:4] if plain.startswith("sept") else plain[:3])
    if plain in MONTHS:
        style = "full"
    else:
        style = "abbr." if token.endswith(".") else "abbr"
    case = "upper" if token.isupper() and len(token) > 1 else "title" if token[:1].isupper() else "lower"
    return index, style, case


def _value_shape(text: str) -> Optional[Shape]:
    match = _YEAR.match(text)
    if match:
        pre, year = match["pre"] or match["pre2"] or "", match["year"] or match["year2"]
        decade, era = match["decade"] or "", match["era"] or match["era2"] or ""
        style = (pre.strip().lower(), bool(decade), era.strip().upper())
        return Shape("year", style, {"year": int(year), "pre": pre, "decade": decade, "era": era})
    for name, pattern in _DATES:
        match = pattern.match(text)
        if not match:
            continue
        year = match.groupdict().get("year") or ""
        parts = {"pattern": name, "year": int(year) if year else 0, "year_digits": len(year)}
        style = [name, len(year)]
        if "month" in match.groupdict() and match["month"]:
            index, mstyle, case = _month_style(match["month"])
            if index is None:
                return None
            parts.update(month=index, mstyle=mstyle, case=case)
            style += [mstyle, case]
        if name == "iso":
            parts.update(month=int(match["m"]) - 1)
        if name == "slash":
            parts.update(a=int(match["a"]), b=int(match["b"]), pad=len(match["a"]) == 2)
            style.append(len(match["a"]) == 2)
        if match.groupdict().get("day"):
            day = match["day"]
            parts.update(day=int(day), day_pad=len(day) == 2, ordinal=bool(re.search(r"\d(?:st|nd|rd|th)", text, re.I)))
            style.append(bool(re.search(r"\d(?:st|nd|rd|th)", text, re.I)))
        if name == "dmy":
            parts.update(comma="," in text.split(match["month"])[-1][:2] if match["month"] else False)
        return Shape("date", tuple(style), parts)
    match = _NUMBER.match(text)
    if match:
        post = re.sub(r"\s+", " ", (match["post"] or "")).lower().strip()
        decimals = len(match["dec"]) - 1 if match["dec"] else 0
        style = ((match["pre"] or "").strip().lower(), post, decimals, bool(match["sign"]))
        number = float(match["int"].replace(",", "") + (match["dec"] or ""))
        if match["sign"] in ("-", "−"):
            number = -number
        return Shape("number", style, {"value": number, "pre": match["pre"] or "", "post": match["post"] or "",
                                       "decimals": decimals, "grouped": "," in match["int"], "sign": match["sign"] or ""})
    return None


def shape(text) -> Shape:
    value = _strip(text)
    found = _value_shape(value)
    if found:
        return found
    words = value.split()
    if 1 < len(words) <= TEMPLATE_WORDS:
        inner = list(_INNER.finditer(value))
        if len(inner) == 1:
            inner_shape = _value_shape(inner[0].group(0))
            if inner_shape:
                before, after = value[:inner[0].start()], value[inner[0].end():]
                return Shape("templated", (before.lower(), after.lower(), inner_shape.kind, inner_shape.style),
                             inner=inner_shape, template=(before, after))
    return Shape("short" if len(words) <= SHORT_WORDS else "sentence")


def same_shape(answer, other) -> bool:
    a, b = shape(answer), shape(other)
    return a.kind == b.kind and a.style == b.style


def is_value(answer) -> bool:
    """Answers whose wrong choices can be made safely (years, dates, amounts, or one inside a short phrase)."""
    return shape(answer).kind in (*VALUE_KINDS, "templated")


# Making new values in the same style ---------------------------------------------------------------
def _seeded(*keys) -> random.Random:
    digest = hashlib.sha256("\x1f".join(str(k) for k in keys).encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def _month_name(index: int, parts: dict) -> str:
    name = MONTHS[index % 12]
    if parts.get("mstyle", "full") != "full":
        name = "sept" if name == "september" and parts.get("mstyle") == "sept" else name[:3]
        if parts.get("mstyle") == "abbr." and len(name) < len(MONTHS[index % 12]):
            name += "."
    case = parts.get("case", "title")
    return name.upper() if case == "upper" else name.capitalize() if case == "title" else name


def _ordinal(day: int) -> str:
    suffix = "th" if 10 <= day % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def _year_text(year: int, digits: int) -> str:
    return f"{year % 100:02d}" if digits == 2 else str(year)


def _format(shape_: Shape, values: dict) -> str:
    p = {**shape_.parts, **values}
    if shape_.kind == "year":
        return f"{p['pre']}{p['year']}{p['decade']}{p['era']}"
    if shape_.kind == "number":
        decimals = p["decimals"]
        amount = abs(p["value"])
        body = f"{amount:,.{decimals}f}" if p["grouped"] or (amount >= 10000 and p["value"] >= 1000) else f"{amount:.{decimals}f}"
        sign = p["sign"] if p["value"] >= 0 else (p["sign"] or "-")
        return f"{p['pre']}{sign if p['sign'] or p['value'] < 0 else ''}{body}{p['post']}"
    pattern = p["pattern"]
    year = _year_text(p["year"], p["year_digits"])
    day = p.get("day", 1)
    day_text = _ordinal(day) if p.get("ordinal") else (f"{day:02d}" if p.get("day_pad") else str(day))
    if pattern == "mdy":
        return f"{_month_name(p['month'], p)} {day_text}, {year}"
    if pattern == "dmy":
        return f"{day_text} {_month_name(p['month'], p)}{',' if p.get('comma') else ''} {year}"
    if pattern == "my":
        return f"{_month_name(p['month'], p)} {year}"
    if pattern == "md":
        return f"{_month_name(p['month'], p)} {day_text}"
    if pattern == "iso":
        return f"{p['year']:04d}-{p['month'] + 1:02d}-{day:02d}"
    a, b = p["a"], p["b"]
    width = 2 if p.get("pad") else 1
    return f"{a:0{width}d}/{b:0{width}d}/{year}"


_NEAR_STEPS = [2, -3, 5, -2, 3, -5, 4, -4, 1, -1]
_FAR_STEPS = [7, -7, 10, -10, 12, -12, 15, -15, 20, -20]
THIS_YEAR = __import__("datetime").date.today().year
_FACTORS = [0.5, 1.5, 2, 0.75, 1.25, 3, 0.25, 0.6, 1.8]


def _steps(rng: random.Random) -> list:
    near, far = _NEAR_STEPS[:], _FAR_STEPS[:]
    rng.shuffle(near)
    rng.shuffle(far)
    return near + far


def _year_ok(year: int, original: int, era: str) -> bool:
    if year <= 0:
        return False
    # A past year never turns into a future one (BCE years count backwards, so any is fine).
    return bool(era.strip().upper().startswith("B")) or original > THIS_YEAR or year <= THIS_YEAR


def _value_variants(shape_: Shape, rng: random.Random) -> Iterable[str]:
    p = shape_.parts
    if shape_.kind == "year":
        step = 10 if p["decade"] else 1
        for delta in _steps(rng):
            year = p["year"] + delta * step
            if _year_ok(year, p["year"], p["era"]):
                yield _format(shape_, {"year": year})
        return
    if shape_.kind == "date":
        years = [("year", d) for d in _steps(rng)[:6]] if p["year_digits"] else []
        others = [("month", d) for d in (1, -2, 3, -4, 5)] + [("day", d) for d in (3, -5, 9, -11)]
        rng.shuffle(others)
        moves = [m for pair in zip(years, others) for m in pair] + years[len(others):] + others[len(years):]
        for field, delta in moves:
            values = {}
            if field == "year":
                values["year"] = p["year"] + delta
                if not _year_ok(values["year"], p["year"], ""):
                    continue
            if field == "month" and "month" in p:
                values["month"] = (p["month"] + delta) % 12
            elif field == "month" and p["pattern"] == "slash":
                values["a"] = (p["a"] - 1 + delta) % 12 + 1
            if field == "day":
                if "day" in p:
                    values["day"] = min(28, max(1, p["day"] + delta))
                    if values["day"] == p["day"]:
                        continue
                elif p["pattern"] == "slash":
                    values["b"] = min(28, max(1, p["b"] + delta))
                else:
                    continue
            if not values:
                continue
            yield _format(shape_, values)
        return
    value = p["value"]
    percent = "%" in p["post"] or "percent" in p["post"].lower() or "per cent" in p["post"].lower()
    factors = _FACTORS[:]
    rng.shuffle(factors)
    for factor in factors:
        new = value * factor
        if p["decimals"] == 0:
            new = round(new)
            if new == round(value):
                new += 1 if factor > 1 else -1
        else:
            new = round(new, p["decimals"])
        if percent and 0 <= value <= 100 and not 0 <= new <= 100:
            continue
        if value > 0 and new <= 0:
            continue
        yield _format(shape_, {"value": new})


def synthesize(answer, count: int = 3, seed="", avoid: Iterable[str] = ()) -> list:
    """New wrong choices written exactly like the answer (years, dates, amounts, or a short phrase
    around one). Deterministic for a given answer and seed. Empty for plain text answers."""
    target = shape(answer)
    inner, template = (target.inner, target.template) if target.kind == "templated" else (target, ("", ""))
    if inner is None or inner.kind not in VALUE_KINDS:
        return []
    taken = {_key(answer), *(_key(value) for value in avoid)}
    out = []
    for value in _value_variants(inner, _seeded(_strip(answer), seed)):
        text = f"{template[0]}{value}{template[1]}"
        if _key(text) not in taken:
            taken.add(_key(text))
            out.append(text)
        if len(out) >= count:
            break
    return out


def _key(text) -> str:
    return _strip(text).casefold()


def coerce(answer, candidate) -> Optional[str]:
    """The candidate rewritten in the answer's style when it holds the same kind of value written
    the same way ("In 1861" for the answer "1863" becomes "1861", and "1861" for "In 1863" becomes
    "In 1861"); None when it can't be."""
    target, other = shape(answer), shape(candidate)
    if target.kind == other.kind and target.style == other.style:
        return str(candidate).strip()
    bare = target if target.kind in VALUE_KINDS else target.inner
    if bare is None:
        return None
    found = [m.group(0) for m in _INNER.finditer(_strip(candidate))]
    values = [v for v in found if (s := _value_shape(v)) and s.kind == bare.kind and s.style == bare.style]
    if len(values) != 1:
        return None
    if target.kind == "templated":
        return f"{target.template[0]}{values[0]}{target.template[1]}"
    return values[0]


def conform(answer, preferred: Iterable = (), pool: Iterable = (), count: int = 3, seed="") -> list:
    """Up to `count` wrong choices that look like the answer, best first: the preferred choices
    (the model's) in the answer's shape, then the guide's other answers in that shape, then made-up
    values in the same style (years, dates, amounts). Plain text answers fall back to other text
    (a term to a sentence or back) but never to a year, date or amount."""
    target = shape(answer)
    seen = {_key(answer)}
    out = []

    def add(values, test=None):
        for raw in values:
            value = str(raw).strip()
            if not value or _key(value) in seen or (test and not test(value)):
                continue
            seen.add(_key(value))
            out.append(value)
            if len(out) >= count:
                return

    preferred, pool = list(preferred), list(pool)
    if is_value(answer):
        add(c for c in (coerce(answer, value) for value in preferred) if c)
        if len(out) < count:
            add(c for c in (coerce(answer, value) for value in pool) if c)
    else:
        matches = lambda value: shape(value).kind == target.kind  # noqa: E731
        add(preferred, matches)
        if len(out) < count:
            add(pool, matches)
    if len(out) < count and is_value(answer):
        add(synthesize(answer, count, seed, avoid=[*preferred, *pool, *out]))
    if len(out) < count and not is_value(answer):
        text = lambda value: not is_value(value)  # noqa: E731
        add(preferred, text)
        if len(out) < count:
            add(pool, text)
    return out[:count]


def repair(question: str, options: list, correct_index: int) -> list:
    """A saved question whose answer is a year, date or amount: replace wrong choices written some
    other way with ones in the answer's style. The right answer and its position never change."""
    if not isinstance(options, list) or not isinstance(correct_index, int) or not 0 <= correct_index < len(options):
        return options
    answer = options[correct_index]
    if not is_value(answer):
        return options
    wrong = [i for i, option in enumerate(options) if i != correct_index and not same_shape(answer, option)]
    if not wrong:
        return options
    fresh = synthesize(answer, len(wrong), seed=question, avoid=options)
    fixed = list(options)
    for index, value in zip(wrong, fresh):
        fixed[index] = value
    return fixed
