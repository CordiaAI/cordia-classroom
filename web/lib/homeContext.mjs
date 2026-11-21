// The home's context line, top right (VISUAL-POLISH V1.4): "Wednesday · MA 125 exam in 2 days" when an
// exam is within a week, otherwise the day and date ("Wednesday, Nov 19"). Pure, so it can be tested in
// Node (web/tests/home-context.test.mjs); lib/homeData.js picks the exam from what the home already loads
// and pages/home.js shows the line.
import { dayKey } from './learnEngine.mjs';
import { classShort } from './homeText.mjs';

export const CONTEXT_DAYS = 7;
const DAY = 86400000;

const daysUntil = (date, today) => Math.round((new Date(date + 'T12:00:00') - new Date(today + 'T12:00:00')) / DAY);
const shorten = (text, max = 32) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
};

// The nearest exam from today on: calendar or course-work items of type 'exam' ({ title, due_at, done,
// course }) and the review set's exam the headline uses ({ title, date, course }). Returns
// { date: 'YYYY-MM-DD', title, course } or null. course is whatever names the class (a Canvas section
// code or the class's name); the line shortens it.
export function soonestExam(items = [], extra = null, today = dayKey()) {
  const found = (items || [])
    .filter(item => item && item.type === 'exam' && !item.done && item.due_at && !Number.isNaN(new Date(item.due_at).getTime()))
    .map(item => ({ date: dayKey(item.due_at), title: String(item.title || '').trim(), course: String(item.course || '').trim() }));
  if (extra?.date) found.push({ date: String(extra.date), title: String(extra.title || '').trim(), course: String(extra.course || '').trim() });
  return found
    .filter(item => daysUntil(item.date, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// "today", "tomorrow", "in 3 days".
export function examWhen(daysLeft) {
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}

// exam: soonestExam's answer (or null); now: the moment the line is for.
export function contextLine(exam, now = new Date()) {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const daysLeft = exam?.date ? daysUntil(exam.date, dayKey(now)) : NaN;
  if (!Number.isFinite(daysLeft) || daysLeft < 0 || daysLeft > CONTEXT_DAYS) {
    return now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const code = classShort(exam.course);
  const what = code ? `${code} exam` : shorten(exam.title) || 'Exam';
  return `${weekday} · ${what} ${examWhen(daysLeft)}`;
}
