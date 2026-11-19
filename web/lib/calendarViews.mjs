// The Calendar page's four views (Week, Board, Month, Agenda) read one model built here: deadlines
// (Canvas, calendar link, lecture to-dos) and study blocks, each with its class's colour, plus the
// rules the views share ("Needs study time", what each Agenda row offers, the Week grid's geometry
// and drag maths). No browser APIs, so it is tested in Node (web/tests/calendar-views.test.mjs).
import { colorFor, coverFor, COVER_COLORS } from './coverDesign.mjs';
import { counts, dayKey, restoreLevels, testPlan } from './learnEngine.mjs';
import { classExams, examReadiness, learnQuestions, learnTestDate, reviewSetFor } from './examCountdown.mjs';
import { deadlineTitle } from './formatters.js';

export const VIEWS = ['week', 'board', 'month', 'agenda'];
export const VIEW_LABELS = { week: 'Week', board: 'Board', month: 'Month', agenda: 'Agenda' };
export const PHONE_MAX = 767; // Agenda is the only view below 768px.
export const DAY_START_HOUR = 8; // The Week grid: 8 AM to 10 PM.
export const DAY_END_HOUR = 22;
export const SNAP_MINUTES = 15;
export const MIN_BLOCK_MINUTES = 15;
export const MAX_BLOCK_MINUTES = 6 * 60;
export const NEEDS_DAYS = 7;
// Where Add study time can put a block on a day (backend services/planner.py: DAY_START, DAY_END,
// MIN_BLOCK), so a day is only offered when it has room before the deadline.
export const PLAN_START_HOUR = 9;
export const PLAN_END_HOUR = 22;
export const PLAN_MIN_MINUTES = 25;
const DAY = 86400000;

// ---- Dates ----

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Weeks start on Monday, as in the mockups.
export function startOfWeek(date) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function sameDay(a, b) {
  return dayKey(a) === dayKey(b);
}

export function weekDays(weekStart) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

// Six Monday-first rows covering the month, with the days before and after it.
export function monthGrid(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

// "Nov 16 – 22, 2026", "Nov 30 – Dec 6, 2026", "Dec 28, 2026 – Jan 3, 2027".
export function weekRangeLabel(weekStart) {
  const end = addDays(weekStart, 6);
  const month = date => date.toLocaleDateString('en-US', { month: 'short' });
  if (weekStart.getFullYear() !== end.getFullYear()) {
    return `${month(weekStart)} ${weekStart.getDate()}, ${weekStart.getFullYear()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (weekStart.getMonth() !== end.getMonth()) return `${month(weekStart)} ${weekStart.getDate()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  return `${month(weekStart)} ${weekStart.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
}

export const monthLabel = date => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// "9 AM", "9:30 AM", "12 PM".
export function clock(date) {
  const d = new Date(date);
  const hour = d.getHours() % 12 || 12;
  const minutes = d.getMinutes() ? `:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return `${hour}${minutes} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

// "9:30 – 10:45 AM", "11 AM – 12 PM".
export function span(start, end) {
  const a = clock(start);
  const b = clock(end);
  const sameHalf = (new Date(start).getHours() < 12) === (new Date(end).getHours() < 12);
  return sameHalf ? `${a.replace(/ (AM|PM)$/, '')} – ${b}` : `${a} – ${b}`;
}

// A deadline's time: "11:59 PM", or "All day" for a date-only Canvas item.
export function dueClock(entry) {
  return entry.allDay ? 'All day' : clock(entry.at);
}

// "Today", "Tomorrow", "Yesterday", "Friday" (this week), "Mon, Nov 30" (later).
export function relativeDay(date, now = new Date()) {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Tonight" for later today, else a short weekday ("Sun") this week, else "Nov 30".
export function dueWhen(date, now = new Date()) {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (diff === 0) return new Date(date).getHours() >= 17 ? 'Tonight' : 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- Classes and their colours ----

// "MA-125-001", "MA 125", "ma125" -> "MA 125". Names without a code ("Biology 101") stay as words.
export function courseKey(text) {
  const value = String(text || '').trim();
  const code = value.match(/\b([A-Za-z]{2,5})[\s-]?(\d{2,4}[A-Za-z]?)\b/);
  if (code) return `${code[1].toUpperCase()} ${code[2].toUpperCase()}`;
  return value.toLowerCase().replace(/\s+/g, ' ');
}

const SECTION_CODE = /\s*\[([^\]]{2,80})\]\s*$/;
// A title without its Canvas section code ("Exam 3 [MA-125-001]" -> "Exam 3"): the home's own
// cleaning (lib/formatters.js deadlineTitle, used by lib/homeData.js). The one place the Calendar
// cleans titles, so a newer cleaner can be swapped in here.
export const cleanTitle = title => deadlineTitle({ title });
const courseOf = item => item?.course || String(item?.title || '').match(SECTION_CODE)?.[1] || '';

// Canvas names a class "MUL 101 MUL-101-102: Introduction to Music"; its code reads first.
function classCode(name) {
  const text = String(name || '').trim();
  const colon = text.indexOf(': ');
  const before = colon < 0 ? text : text.slice(0, colon);
  return before.match(/^[A-Z]{2,5}\s?\d{2,4}[A-Z]?/)?.[0] || before;
}

// The student's classes by course key, each with the sidebar's tone (1-8): the class cover's colour.
export function classIndex(folders) {
  const index = new Map();
  (folders || []).forEach(folder => {
    const code = classCode(folder.name);
    const key = courseKey(code);
    if (key && !index.has(key)) index.set(key, { id: folder.id, code: code || folder.name, tone: (coverFor(folder).color % COVER_COLORS) + 1 });
  });
  return index;
}

// A deadline's class: the student's own class when the code matches (its cover colour), else the
// course as Canvas names it, with a colour of its own that stays the same everywhere.
export function classFor(course, index) {
  const raw = String(course || '').trim();
  if (!raw || /^From /.test(raw)) return null;
  const key = courseKey(raw);
  const known = index?.get?.(key);
  if (known) return { key, code: known.code, tone: known.tone, classId: known.id };
  const code = /^[A-Z]{2,5} \d/.test(key) ? key : raw;
  return { key, code, tone: (colorFor(key) % COVER_COLORS) + 1, classId: null };
}

// ---- Entries ----

const time = value => {
  const parsed = new Date(value || '').getTime();
  return Number.isNaN(parsed) ? null : parsed;
};

// Deadlines from the calendar feed (Canvas token or link) and lecture to-dos, newest model.
export function buildDeadlines(items, index) {
  return (items || []).filter(item => item && time(item.due_at) !== null && !item.cancelled).map(item => {
    const cls = classFor(courseOf(item), index);
    const type = item.type || 'assignment';
    return {
      kind: 'due',
      key: `due-${item.id}`,
      id: item.id,
      rawTitle: String(item.title || '').trim(),
      title: cleanTitle(item.title),
      at: new Date(item.due_at),
      allDay: Boolean(item.all_day),
      type,
      exam: type === 'exam',
      done: Boolean(item.done),
      url: item.url || '',
      internal: Boolean(item.internal),
      source: item,
      cls,
      from: !cls && /^From /.test(String(item.course || '')) ? item.course : '',
    };
  }).sort((a, b) => a.at - b.at);
}

// A block's full title without section codes: "Review: Exam 3 [MA-125-001]" -> "Review: Exam 3",
// "Essay [EH-101-002]: Outline" -> "Essay: Outline" (the backend names blocks after the raw title).
export const blockTitle = title => (String(title || '').trim() || 'Study').split(': ').map(cleanTitle).join(': ');

// A block's own words: "Argument essay draft: Finish the draft" reads "Finish the draft" (its class
// and deadline show beside it); "Review: Exam 3" and "Work on Quiz 10" stay as they are.
export function blockLabel(title, deadline) {
  const text = blockTitle(title);
  for (const name of [deadline?.title, deadline?.rawTitle && cleanTitle(deadline.rawTitle)].filter(Boolean)) {
    if (text.toLowerCase().startsWith(`${name.toLowerCase()}: `) && text.length > name.length + 2) return text.slice(name.length + 2);
  }
  return text;
}

// Study blocks from /calendar/blocks, with the class of the deadline each one is for.
export function buildBlocks(blocks, deadlines, index) {
  const byId = new Map((deadlines || []).map(entry => [entry.id, entry]));
  return (blocks || []).filter(block => time(block?.starts_at) !== null && time(block?.ends_at) !== null).map(block => {
    const deadline = byId.get(block.item_key) || null;
    const cls = deadline?.cls || classFor(block.course, index);
    return {
      kind: 'study',
      key: `block-${block.id}`,
      id: block.id,
      itemKey: block.item_key,
      title: blockLabel(block.title, deadline),
      fullTitle: blockTitle(block.title),
      start: new Date(block.starts_at),
      end: new Date(block.ends_at),
      review: block.kind === 'review',
      done: Boolean(block.done) || block.status === 'done',
      deadline,
      cls,
    };
  }).sort((a, b) => a.start - b.start);
}

export const entryTime = entry => (entry.kind === 'study' ? entry.start : entry.at);

// When a deadline is over: its due time, or the end of its day when it is due all day (the feed
// gives those as the day's local midnight).
export const dueBy = entry => (entry.allDay ? addDays(startOfDay(entry.at), 1) : entry.at);

// Can Add study time place a block for this deadline on this day? Only when Plan my week's window
// that day, from now on, leaves room for its shortest block before the deadline.
export function roomOn(day, entry, now = new Date()) {
  const base = startOfDay(day).getTime();
  const soon = Math.ceil((now.getTime() + 15 * 60000) / (15 * 60000)) * 15 * 60000;
  const opens = Math.max(base + PLAN_START_HOUR * 3600000, soon);
  const closes = Math.min(base + PLAN_END_HOUR * 3600000, dueBy(entry).getTime());
  return closes - opens >= PLAN_MIN_MINUTES * 60000;
}

// A moved study block still ends by its deadline (or has none to keep to).
export const endsInTime = (span, deadline) => !deadline || span.end.getTime() <= dueBy(deadline).getTime();
const classMatch = (block, deadline) => (deadline.cls ? block.cls?.key === deadline.cls.key : block.itemKey === deadline.id);

// Has study time: a block for the deadline's class (or for the deadline itself, when it has no
// class) that starts before it is due and inside the week before it.
export function hasStudyTime(deadline, blocks) {
  const due = dueBy(deadline).getTime();
  return (blocks || []).some(block => classMatch(block, deadline) && block.start.getTime() < due && block.end.getTime() > due - NEEDS_DAYS * DAY);
}

// Deadlines Plan my week could schedule in the next 7 days (the pool "Needs study time" is drawn from).
export function dueSoon(deadlines, now = new Date()) {
  const from = now.getTime();
  return (deadlines || []).filter(entry => !entry.done && !entry.internal && dueBy(entry).getTime() > from && entry.at.getTime() <= from + NEEDS_DAYS * DAY);
}

// "Needs study time": a deadline in the next 7 days, not done, with no study block for that class
// before it. Lecture to-dos aren't included: Plan my week can't schedule them (they aren't Canvas items).
export function needsStudyTime(deadlines, blocks, now = new Date()) {
  return dueSoon(deadlines, now).filter(entry => !hasStudyTime(entry, blocks));
}

// The one action an Agenda row offers.
export function rowAction(entry, blocks, now = new Date()) {
  if (entry.kind === 'study') return entry.done || entry.end < now ? null : 'start';
  if (entry.done || dueBy(entry) < now) return null;
  if (entry.exam) return 'review';
  if (entry.internal) return null;
  return hasStudyTime(entry, blocks) ? 'planned' : 'find';
}

// Everything on one day, in time order (all-day deadlines first).
export function dayEntries(day, deadlines, blocks) {
  const key = dayKey(day);
  const due = (deadlines || []).filter(entry => dayKey(entry.at) === key);
  const study = (blocks || []).filter(block => dayKey(block.start) === key);
  return [...due, ...study].sort((a, b) => {
    const allA = a.kind === 'due' && a.allDay ? 0 : 1;
    const allB = b.kind === 'due' && b.allDay ? 0 : 1;
    return allA - allB || entryTime(a) - entryTime(b);
  });
}

// Planned study hours on a day (the Board's bar), to the half hour: 2.5.
export function plannedHours(day, blocks) {
  const minutes = (blocks || []).filter(block => sameDay(block.start, day)).reduce((sum, block) => sum + (block.end - block.start) / 60000, 0);
  return Math.round(minutes / 30) / 2;
}

export const hoursLabel = hours => `${hours}h`;

// Month cells: up to two deadline chips, "+N more", and the day's study count.
export function monthCell(day, deadlines, blocks, chips = 2) {
  const key = dayKey(day);
  const due = (deadlines || []).filter(entry => dayKey(entry.at) === key);
  return { due: due.slice(0, chips), more: Math.max(0, due.length - chips), study: (blocks || []).filter(block => dayKey(block.start) === key).length };
}

// The Agenda's days: for the week holding today, yesterday through a week from today; for any
// other week, its seven days. Days with nothing are left out, except today.
export function agendaDays(weekStart, deadlines, blocks, now = new Date()) {
  const thisWeek = sameDay(startOfWeek(now), weekStart);
  const first = thisWeek ? addDays(startOfDay(now), -1) : weekStart;
  const count = thisWeek ? 9 : 7;
  return Array.from({ length: count }, (_, i) => addDays(first, i))
    .map(day => ({ day, entries: dayEntries(day, deadlines, blocks) }))
    .filter(({ day, entries }) => entries.length || sameDay(day, now));
}

// ---- The Week grid ----

export const GRID_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

// Is something wholly before or after the grid's hours? 'earlier', 'later', or '' when it shows.
export function offGrid(start, end) {
  if (!gridBox(start, end).hidden) return '';
  return (new Date(start) - startOfDay(start)) / 60000 < DAY_START_HOUR * 60 ? 'earlier' : 'later';
}

// Does a timed exam start inside the grid's hours? One that starts before 8 AM (or at 10 PM or
// later) joins the Due strip, where its start time reads in full.
export function startsInGrid(date) {
  const minutes = (new Date(date) - startOfDay(date)) / 60000;
  return minutes >= DAY_START_HOUR * 60 && minutes < DAY_END_HOUR * 60;
}

// A block's place in its day column, as fractions of the grid's height (clipped to 8 AM-10 PM).
export function gridBox(start, end) {
  const day = startOfDay(start);
  const from = (new Date(start) - day) / 60000 - DAY_START_HOUR * 60;
  const to = (new Date(end) - day) / 60000 - DAY_START_HOUR * 60;
  const top = Math.max(0, Math.min(GRID_MINUTES, from));
  const bottom = Math.max(0, Math.min(GRID_MINUTES, to));
  return { top: top / GRID_MINUTES, height: Math.max(0, bottom - top) / GRID_MINUTES, hidden: bottom <= top };
}

// Side-by-side lanes for blocks that overlap in one day: { [key]: { lane, lanes } }.
export function lanes(entries) {
  const sorted = [...entries].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = {};
  let group = [];
  let groupEnd = 0;
  const close = () => { const count = Math.max(1, ...group.map(key => out[key].lane + 1)); group.forEach(key => { out[key].lanes = count; }); group = []; };
  const laneEnds = [];
  sorted.forEach(entry => {
    if (group.length && entry.start.getTime() >= groupEnd) { close(); laneEnds.length = 0; }
    let lane = laneEnds.findIndex(end => end <= entry.start.getTime());
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = entry.end.getTime();
    out[entry.key] = { lane, lanes: 1 };
    group.push(entry.key);
    groupEnd = Math.max(groupEnd, entry.end.getTime());
  });
  if (group.length) close();
  return out;
}

// The now line: a fraction of the grid's height, or null outside 8 AM-10 PM.
export function nowLine(now = new Date()) {
  const box = gridBox(now, now);
  const minutes = now.getHours() * 60 + now.getMinutes() - DAY_START_HOUR * 60;
  return minutes < 0 || minutes > GRID_MINUTES ? null : box.top;
}

const snap = minutes => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

// A drag or a key press: move by whole days and snapped minutes, or (resize) change the end only.
// The block stays inside the grid's hours of its day and between 15 minutes and 6 hours long.
export function shiftBlock({ start, end }, { days = 0, minutes = 0, resize = false }) {
  const length = (end - start) / 60000;
  if (resize) {
    const dayStart = startOfDay(start);
    const latest = (dayStart.getTime() + DAY_END_HOUR * 3600000 - start.getTime()) / 60000;
    const longest = Math.max(MIN_BLOCK_MINUTES, Math.min(MAX_BLOCK_MINUTES, latest));
    const next = Math.max(MIN_BLOCK_MINUTES, Math.min(longest, snap(length + minutes)));
    return { start: new Date(start), end: new Date(start.getTime() + next * 60000) };
  }
  const day = addDays(startOfDay(start), days);
  const offset = (start - startOfDay(start)) / 60000 + minutes;
  const latest = DAY_END_HOUR * 60 - Math.min(length, GRID_MINUTES);
  const at = Math.max(DAY_START_HOUR * 60, Math.min(latest, snap(offset)));
  const nextStart = new Date(day.getTime() + at * 60000);
  // Daylight-saving days: rebuild from the local date and minutes so the clock time holds.
  nextStart.setHours(Math.floor(at / 60), at % 60, 0, 0);
  return { start: nextStart, end: new Date(nextStart.getTime() + length * 60000) };
}

export const sameSpan = (a, b) => a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();

// ---- Exam readiness (Learn's own number, DESIGN-SPEC 3.3) ----

// An exam's guide, matched the way the sidebar and the Dashboard countdown match it
// (lib/examCountdown.mjs): its review set ("<exam>: review"), else a guide Learn was given this
// exam's date as its test date, in the exam's class (or the only one that day, when the class
// isn't one of the student's).
export function examReviewGuide(exam, guides) {
  const own = reviewSetFor(exam.rawTitle || exam.title, guides);
  if (own) return own;
  const day = dayKey(exam.at);
  const dated = (guides || []).filter(guide => learnTestDate(guide) === day);
  const classId = exam.cls?.classId;
  if (classId) return dated.find(guide => String(guide?.folder_id || '') === String(classId)) || null;
  return dated.length === 1 ? dated[0] : null;
}

// Each exam's guide, so a ring here always matches the sidebar's: its review set, else the guide the
// sidebar rings for the exam's class (classExams: that class's nearest Learn test date in the next
// two weeks), given to the class's exam nearest that date; else a guide dated that very day
// (examReviewGuide). { [examId]: guide summary }.
export function examGuides(exams, guides, today = dayKey()) {
  const found = {};
  const all = exams || [];
  const open = all.filter(exam => !exam.done); // The sidebar leaves done exams out.
  all.forEach(exam => { const own = reviewSetFor(exam.rawTitle || exam.title, guides); if (own) found[exam.id] = own; });
  const items = open.map(exam => ({ title: exam.rawTitle || exam.title, due_at: exam.source?.due_at || exam.at.toISOString(), type: 'exam' }));
  const classIds = [...new Set(open.map(exam => exam.cls?.classId).filter(Boolean))];
  const rings = classExams(classIds, guides, items, today);
  Object.entries(rings).forEach(([classId, ring]) => {
    const guide = (guides || []).find(item => item.id === ring.guideId);
    if (!guide || Object.values(found).some(item => item.id === guide.id)) return;
    const gap = exam => Math.abs(new Date(`${dayKey(exam.at)}T12:00:00`) - new Date(`${ring.date}T12:00:00`));
    const nearest = open.filter(exam => exam.cls?.classId === classId && !found[exam.id]).sort((a, b) => gap(a) - gap(b) || a.at - b.at)[0];
    if (nearest) found[nearest.id] = guide;
  });
  all.forEach(exam => { if (!found[exam.id]) { const dated = examReviewGuide(exam, guides); if (dated) found[exam.id] = dated; } });
  return found;
}

// Readiness for one exam from its full review guide: the same sum as Learn and the sidebar
// (examReadiness), with the ideas left and how many a day keep pace.
export function examProgress(guide, examDate, today = dayKey()) {
  const questions = learnQuestions(guide);
  const learn = guide?.flashcard_progress?.learn;
  const tally = counts(questions, restoreLevels(questions, learn?.levels || {}), today);
  const percent = examReadiness(questions, learn, today);
  const plan = testPlan(tally, learn?.test_date || (examDate ? dayKey(examDate) : null), today);
  return { percent, total: tally.total, left: plan ? plan.remaining : tally.total - tally.mastered, perDay: plan && !plan.past ? plan.perDay : 0 };
}

// ---- Storage of the chosen view ----

export function pickView(saved, wide) {
  if (!wide) return 'agenda';
  return VIEWS.includes(saved) ? saved : 'week';
}
