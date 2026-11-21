// The home's headline by class picker (FEEDBACK-BATCH-1 H1). All classes: a greeting with the
// student's first name. A class picked: the first of an exam within a week with a review set, a
// deadline within three days, a weak idea from Learn, or a plain line about the class. Pure and
// seeded, so it can be tested in Node (web/tests/home-headline.test.mjs); pages/home.js uses it, and
// lib/homeData.js builds the per-class facts it reads from data the home already loads.

import { HEADLINE_DAYS, MINOR_WORDS, classNameWords, classShort, homeHeadline, planTitle } from './homeText.mjs';
import { LEARNING, dayKey, restoreLevels, testPlan } from './learnEngine.mjs';
import { examReadiness, learnQuestions } from './examCountdown.mjs';

export const DEADLINE_DAYS = 3;
// A weak idea is one Learn put at Learning (a miss, or a guess) in the last week.
export const WEAK_DAYS = 7;
// Assignment names and topics are cut near this many characters, at a word.
export const NAME_MAX = 40;
const NAME_MIN = 24;
const DAY = 86400000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Calendar days from one YYYY-MM-DD to another (negative when it is behind).
export function dayDiff(from, to) {
  return Math.round((new Date(String(to) + 'T12:00:00') - new Date(String(from) + 'T12:00:00')) / DAY);
}

// A number from text, the same each time: FNV-1a with a final mix, so the low bits are even.
export function seedOf(text) {
  let hash = 2166136261;
  for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  hash ^= hash >>> 15; hash = Math.imul(hash, 2246822507); hash ^= hash >>> 13; hash = Math.imul(hash, 3266489909); hash ^= hash >>> 16;
  return hash >>> 0;
}

// The same line for a student, a class ('' for All classes) and a calendar day.
export const headlineSeed = (studentKey, classId, today) => seedOf(`${studentKey || ''}|${classId || ''}|${today}`);

// "Jane Q. Smith" -> "Jane"; "" when there is no usable name (nothing, an email or phone, initials, a
// username like "jane.doe", or a placeholder like "User" or "Student").
const TITLES = /^(?:dr|mr|mrs|ms|mx|prof|professor|sr|rev|fr|sir)\.?$/i;
const PLACEHOLDERS = new Set(['user', 'student', 'anonymous', 'guest', 'test', 'me', 'null', 'undefined', 'unknown', 'name']);
export function firstName(full) {
  const words = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (words.some(word => PLACEHOLDERS.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')))) return '';
  while (words.length > 1 && TITLES.test(words[0])) words.shift();
  const word = words[0] || '';
  if (/[@\d]/.test(word) || String(full || '').includes(',')) return '';
  const name = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (/[._]/.test(name) || (name.match(/\p{L}/gu) || []).length < 2 || name.length > 24) return '';
  return name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

// 5 to 11:59 AM, noon to 4:59 PM, 5 to 10:59 PM, and 11 PM to 4:59 AM.
export function dayPart(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'late';
}

// Six lines: four by the time of day, two for any time. The seed picks one of four slots, two of
// them the time-of-day line, so those come up twice as often as either of the others; a neutral
// line stays the day's line, and the time-of-day one follows the clock.
export function greeting({ name = '', hour = 12, seed = 0 } = {}) {
  const slot = seed % 4;
  const say = (base, mark = '') => (name ? `${base}, ${name}${mark}` : `${base}${mark}`);
  if (slot === 2) return say("What's on your mind", '?');
  if (slot === 3) return say('Ready when you are');
  const part = dayPart(hour);
  if (part === 'late') return say('Up late', '?');
  return say(part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : 'Good evening');
}

// Cut near NAME_MAX at a word, with an ellipsis; short names stay as they are. A cut never ends on a
// small word ("... in The…") or inside an open bracket ("Dynamic Programming (Knapsack…").
export function shortenName(text, max = NAME_MAX) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space >= NAME_MIN) cut = cut.slice(0, space);
  const open = cut.lastIndexOf('(');
  if (open > 0 && open > cut.lastIndexOf(')')) cut = cut.slice(0, open);
  for (;;) {
    const trimmed = cut.replace(/[\s,;:.–—-]+$/, '');
    const last = trimmed.match(/\s(\S+)$/);
    if (last && MINOR_WORDS.has(last[1].toLowerCase())) cut = trimmed.slice(0, last.index); else { cut = trimmed; break; }
  }
  return cut + '…';
}

const upperFirst = text => text.charAt(0).toUpperCase() + text.slice(1);

// An assignment's name for the sentence: plain words (lib/homeText.mjs planTitle), in the title's own
// case, without the class's course code when the title starts with it ("NUR 220 Week 5 Discussion" in
// NUR 220 -> "Week 5 Discussion"); when it is longer than NAME_MAX, the part before its colon if that
// stands alone ("Packback Discussion: Seven Ethical Frameworks and ..." -> "Packback Discussion"), else
// cut at a word.
const plain = raw => planTitle(raw, { lowerLast: false });
export function assignmentName(raw, code = '') {
  let title = plain(raw);
  const lead = title.match(/^([A-Za-z]{2,5}[\s_-]*\d{3,4}[A-Za-z]?)(?:[-_]\d{1,3})?\b/);
  if (lead && code && classShort(lead[1]).toLowerCase() === String(code).toLowerCase()) title = plain(title.slice(lead[0].length).replace(/^[\s:–—,.-]+/, ''));
  if (title.length <= NAME_MAX) return title;
  const head = title.split(/:\s/)[0];
  if (head !== title && head.length >= 8 && head.length <= NAME_MAX) return plain(head) || head;
  return shortenName(title);
}

// A class's name as the headline says it: the picker's name, or its code when it has none or the
// name is long and the code is short.
export function classWords(pick) {
  const name = pick?.name && pick.name !== 'Class' ? String(pick.name).trim() : '';
  const code = String(pick?.code || '').trim();
  if (!name) return code;
  return name.length > 36 && code && code.length < name.length ? code : name;
}

// The course code the way students say it ("BUS 210"); the picker's own code when it names no course.
export const courseCode = pick => classShort(pick?.code) || String(pick?.code || '').trim();

const clock = date => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "today", "tomorrow" or the weekday of a due date, and the second line's "Due ... at 11:59 PM".
function deadlineWords(due, days, allDay) {
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : WEEKDAYS[due.getDay()];
  return { when, line: `Due ${when}${allDay ? '' : ` at ${clock(due)}`}` };
}

// A guide's topic name: its title without the review-set suffix, cut near NAME_MAX.
export const topicName = title => shortenName(String(title || '').replace(/\s*:\s*review\s*$/i, ''));

const norm = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Does a Canvas course ("MUL-101-102", "Introduction to Music") belong to a class named
// "MUL 101 MUL-101-102: Introduction to Music"? Course codes are compared as codes; when a code is on
// one side only, or neither, the names in words are compared, and they must be the same name: "Calculus
// I" is not "Calculus II", "History" is not "Art History".
export function sameClass(course, className) {
  const a = classShort(course);
  const b = classShort(className);
  const looksLikeCode = value => /\d/.test(value);
  if (a && b && looksLikeCode(a) && looksLikeCode(b)) return a.toLowerCase() === b.toLowerCase();
  const x = norm(classNameWords(course));
  const y = norm(classNameWords(className));
  return x.length >= 3 && x === y;
}

// The next few deadlines in one class, soonest first. items: Canvas items { title, course, due_at,
// all_day } that are not exams and not done. Kept raw: the page decides what is "within three days"
// when it draws, since the saved copy may be a day old.
export function classDeadlines(className, items, now = new Date(), limit = 3) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return (items || [])
    .filter(item => item?.due_at && !Number.isNaN(new Date(item.due_at).getTime()) && new Date(item.due_at).getTime() >= start && sameClass(item.course, className))
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, limit)
    .map(({ id, title, course, due_at, all_day }) => ({ id, title, course, due_at, ...(all_day ? { all_day: true } : {}) }));
}

// The guides in this class with an idea Learn holds at Learning (a miss, or a right guess) in the
// last WEAK_DAYS, the one missed most recently first. Reads the list summaries the home already loads
// (flashcard_progress.learn.levels); the summary has no questions, so it only names the guide, and
// the number comes from the guide itself (weakFromGuide). Returns [{ guideId, title, at }].
export function weakIdeas(guides, today = dayKey()) {
  const found = [];
  for (const guide of guides || []) {
    const levels = guide?.flashcard_progress?.learn?.levels;
    const entries = levels && typeof levels === 'object' ? Object.values(levels).filter(entry => entry && Number.isFinite(Number(entry.l))) : [];
    const title = topicName(guide?.title);
    if (!title || !entries.length) continue;
    const recent = entries.filter(entry => Number(entry.l) === LEARNING && entry.at && dayDiff(entry.at, today) >= 0 && dayDiff(entry.at, today) <= WEAK_DAYS);
    if (recent.length) found.push({ guideId: guide.id, title, at: recent.map(entry => entry.at).sort().pop(), missed: recent.length });
  }
  return found.sort((a, b) => b.at.localeCompare(a.at) || b.missed - a.missed).map(({ guideId, title, at }) => ({ guideId, title, at }));
}

export const weakIdea = (guides, today = dayKey()) => weakIdeas(guides, today)[0] || null;

// A whole guide's weak idea and its readiness, the way Learn counts: only ideas that are current
// questions (a level saved for a question since edited out is not one), and the same number as the
// Dashboard's exam countdown (lib/examCountdown.mjs examReadiness). guide: GET /guides/<id>'s guide.
// Returns { percent, at } or null when nothing in it was missed in the last WEAK_DAYS.
export function weakFromGuide(guide, today = dayKey()) {
  const questions = learnQuestions(guide);
  const learn = guide?.flashcard_progress?.learn;
  if (!questions.length) return null;
  const recent = Object.values(restoreLevels(questions, learn?.levels || {}))
    .filter(entry => entry.l === LEARNING && entry.at && dayDiff(entry.at, today) >= 0 && dayDiff(entry.at, today) <= WEAK_DAYS);
  if (!recent.length) return null;
  return { percent: examReadiness(questions, learn, today), at: recent.map(entry => entry.at).sort().pop() };
}

// Milliseconds from `now` to the next moment the headline can read differently: 5:00 AM, noon, 5 PM,
// 11 PM, midnight (a new day), or the hour a timed deadline in this class passes. At least a second, so
// a timer set at the boundary does not fire at it again.
export function nextHeadlineChange(now = new Date(), info = null) {
  const at = (hour, plusDays = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + plusDays, hour, 0, 0, 0).getTime();
  const times = [5, 12, 17, 23].map(hour => at(hour)).concat(at(0, 1), at(5, 1));
  for (const item of info?.deadlines || []) {
    const due = new Date(item?.due_at).getTime();
    if (!item?.all_day && Number.isFinite(due)) times.push(due);
  }
  const next = Math.min(...times.filter(time => time > now.getTime()));
  return Math.max(1000, next - now.getTime() + 50);
}

// The four lines for a class with nothing pressing, by the seed.
const CLASS_LINES = [name => `What's next in ${name}?`, name => `Picking up ${name}?`, name => `Where were we in ${name}?`, name => `Let's work on ${name}`];

// A course code is kept on one line: "BUS 210" has a no-break space.
const tight = text => text.replace(/\b([A-Z]{2,5}) (\d{3,4}[A-Z]?)\b/g, '$1\u00a0$2');

// The headline and the line under it.
//   pick: the picked class { id, name, code } or null for All classes
//   info: that class's facts from lib/homeData.js { exam, tally, deadlines, weak } or undefined
//   now, name (the student's first name), studentKey (their id): what makes the line theirs today
// Returns { title, line, kind: 'greeting' | 'exam' | 'deadline' | 'weak' | 'class' }.
export function homeHeadlineFor({ pick = null, info = null, now = new Date(), name = '', studentKey = '' } = {}) {
  const today = dayKey(now);
  const seed = headlineSeed(studentKey, pick?.id, today);
  if (!pick) return { title: greeting({ name, hour: now.getHours(), seed }), line: '', kind: 'greeting' };
  const words = classWords(pick);
  const code = courseCode(pick);
  const say = (title, line, kind) => ({ title: tight(title), line: tight(line), kind });

  const exam = info?.exam;
  if (exam?.date) {
    const daysLeft = dayDiff(today, exam.date);
    if (daysLeft >= 0 && daysLeft <= HEADLINE_DAYS) {
      const plan = info.tally ? testPlan(info.tally, exam.date, today) : null;
      const { title, line } = homeHeadline({ title: exam.title, date: exam.date, daysLeft }, plan, words);
      return say(title, line, 'exam');
    }
  }

  const deadlines = [...(info?.deadlines || [])].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  for (const item of deadlines) {
    const due = new Date(item.due_at);
    if (Number.isNaN(due.getTime())) continue;
    const days = dayDiff(today, dayKey(due));
    if (days < 0 || days > DEADLINE_DAYS || (!item.all_day && due.getTime() < now.getTime())) continue;
    const { when, line } = deadlineWords(due, days, Boolean(item.all_day));
    const what = upperFirst(assignmentName(item.title, code) || 'your next assignment');
    return say(`${what} for ${code} is due ${when}.`, line, 'deadline');
  }

  const weak = info?.weak;
  if (weak?.title && weak.at && dayDiff(weak.at, today) >= 0 && dayDiff(weak.at, today) <= WEAK_DAYS) {
    return say(`Want another look at ${weak.title}?`, Number.isFinite(weak.percent) ? `${weak.percent}% ready in ${code}` : '', 'weak');
  }

  return say(CLASS_LINES[seed % CLASS_LINES.length](words), '', 'class');
}
