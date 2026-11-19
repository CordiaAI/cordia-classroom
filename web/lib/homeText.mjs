// The chat home's words (DESIGN-SPEC 4.1) and how the composer reads a message (4.2). Pure, so
// it can be tested in Node (web/tests/chat-home.test.mjs); pages/home.js and components/Composer.js
// use it.

import { DUE_REVIEW_CARDS } from './studyQueue.mjs';

export const HEADLINE_DAYS = 7;
export const EMPTY_HEADLINE = 'What are you studying?';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// "Today", "Tomorrow" or the weekday of an exam `daysLeft` days from today (date: YYYY-MM-DD).
export function examDay(date, daysLeft) {
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  const day = new Date(String(date) + 'T12:00:00');
  return Number.isNaN(day.getTime()) ? 'Soon' : WEEKDAYS[day.getDay()];
}

// The headline: the soonest exam within a week that has a review set, with what's left and today's
// pace from Learn (plan: lib/learnEngine.mjs testPlan). Otherwise "What are you studying?" alone.
// exam: { title, date, daysLeft } (lib/examCountdown.mjs nearestExam); className: the class's name.
export function homeHeadline(exam, plan, className = '') {
  if (!exam || !Number.isFinite(exam.daysLeft) || exam.daysLeft < 0 || exam.daysLeft > HEADLINE_DAYS) return { title: EMPTY_HEADLINE, line: '' };
  const day = examDay(exam.date, exam.daysLeft);
  const name = String(className || '').trim();
  const title = name ? `${day} is your ${name} exam.` : `${day} is ${String(exam.title || 'your exam').trim()}.`;
  if (!plan || plan.past) return { title, line: '' };
  const line = plan.remaining > 0
    ? `${plural(plan.remaining, 'idea', 'ideas')} left to master. ${plan.perDay} today keeps you on pace.`
    : 'Every idea is mastered. A short review keeps it that way.';
  return { title, line };
}

const shorten = (text, max = 40) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
};

// The nouns an assignment title ends in ("Packback Discussion", "Lab Report"): lowercased at the end
// of the Plan label, since the label reads as a sentence.
const WORK_NOUNS = new Set(['assignment', 'bibliography', 'discussion', 'draft', 'essay', 'exam', 'final', 'homework', 'journal', 'lab', 'memo', 'midterm', 'outline', 'paper', 'portfolio', 'post', 'presentation', 'project', 'proposal', 'quiz', 'reading', 'reflection', 'report', 'response', 'review', 'summary', 'test', 'worksheet']);
// Words whose number says which part of the course it is, not which copy of the work ("Week 5").
const PART_WORDS = new Set(['chapter', 'lesson', 'module', 'part', 'section', 'session', 'unit', 'week']);

const TERMS = new Set(['FA', 'FALL', 'SP', 'SPR', 'SPRNG', 'SPRING', 'SU', 'SUM', 'SUMR', 'WI', 'WIN', 'WINT']);

// "EH-102-136" or "MUL 101 MUL-101-102: Introduction to Music" -> "EH 102", "MUL 101": the department
// and level, the way students name a class. A class named only in words keeps its name; anything
// else (a bare section code) names nothing.
export function classShort(course) {
  const text = String(course || '').trim();
  // A term ("FA24", "Fall 2024") is not a class.
  const code = [...text.matchAll(/\b([A-Za-z]{2,5})[\s_-]*(\d{2,4}[A-Za-z]?)\b/g)].find(([, dept, level]) => !TERMS.has(dept.toUpperCase()) && !/^(19|20)\d\d$/.test(level));
  if (code) return `${code[1].toUpperCase()} ${code[2].toUpperCase()}`;
  return /[a-z]/.test(text) && /\s/.test(text) && !/\b(?:19|20)\d\d\b/.test(text) ? shorten(text.replace(/:.*$/, ''), 28) : '';
}

// An assignment's title in plain words for the Plan label: the Canvas section code, ids ("A05"),
// "#12" and trailing numbering ("Reading response 8") go, the meaning stays. "" if nothing is left.
export function planTitle(raw) {
  let title = String(raw || '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\(\s*\d+\s*(?:of|\/)\s*\d+\s*\)/gi, '')
    .replace(/\s*#\s*\d+[A-Za-z]?/g, '')
    .replace(/^\s*[A-Za-z]{1,3}\d{1,3}[A-Za-z]{0,3}\b[\s:.–—-]*/, '');
  // A number straight after a word, then a separator or the end: "Discussion 3: Ethics", "Essay 2".
  title = title.replace(/([A-Za-z]+)[\s.,-]+(?:no\.?\s*)?\d{1,3}[A-Za-z]?(?=\s*(?:[:–—-]|$))/gi, (match, word) => (PART_WORDS.has(word.toLowerCase()) ? match : word));
  title = title
    .replace(/\s+[–—-]\s+/g, ': ')
    .replace(/\s+([:,;.])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,;.–—-]+|[\s:,;.–—-]+$/g, '');
  const last = title.match(/[A-Za-z]+$/)?.[0];
  if (last && WORK_NOUNS.has(last.toLowerCase()) && last !== last.toUpperCase()) title = title.slice(0, -last.length) + last.toLowerCase();
  return title;
}

// "Plan EH 101's Packback discussion": the class and the work in plain words. Without a known class,
// "Plan your Packback discussion"; with nothing left of the title, "Plan EH 101's next assignment".
export function planLabel(deadline) {
  const what = shorten(planTitle(deadline?.title), 36) || 'next assignment';
  const course = classShort(deadline?.course);
  if (!course) return `Plan your ${what}`;
  return `Plan ${course}${/s$/i.test(course) ? "'" : "'s"} ${what}`;
}

// A number the way students read it: 688, 1,204.
const count = value => Number(value).toLocaleString('en-US');

// Up to three suggestion pills, in the spec's order, leaving out any with nothing behind it.
// learn: { title, guideId, date } (an exam with a review set); due: due flashcards across every
// guide; deadline: { title, course } (the next Canvas deadline). The due pill starts a round of at
// most DUE_REVIEW_CARDS cards (lib/studyQueue.mjs), however many are due.
export function homeSuggestions({ learn = null, due = 0, deadline = null } = {}) {
  const pills = [];
  if (learn?.guideId) pills.push({ key: 'learn', icon: 'learn', label: `Start Learn for ${shorten(learn.title)}`, href: `/learn/${encodeURIComponent(learn.guideId)}${learn.date ? `?test=${learn.date}` : ''}` });
  if (due > 0) pills.push({ key: 'due', icon: 'cards', label: `Review flashcards (${count(due)} due)`, href: `/session?cards=${DUE_REVIEW_CARDS}` });
  if (deadline?.title) pills.push({ key: 'plan', icon: 'plan', label: planLabel(deadline) });
  return pills.slice(0, 3);
}

// Does the message ask for a study guide ("make a guide from this", "turn these slides into a
// study guide")?
export function asksForGuide(text) {
  return /\b(make|build|create|turn|generate|write)\b[^.?!\n]{0,60}\b(study\s+)?guides?\b/i.test(String(text || ''));
}

// The first web link in the message, or ''.
export function firstLink(text) {
  return String(text || '').match(/\bhttps?:\/\/[^\s<>"']+\.[^\s<>"']+/i)?.[0].replace(/[).,;:!?]+$/, '') || '';
}

// What the message holds besides the request itself: pasted notes to build a guide from.
export function pastedMaterial(text) {
  const lines = String(text || '').split('\n');
  const rest = asksForGuide(lines[0]) ? lines.slice(1).join('\n') : String(text || '');
  return rest.trim().length >= 200 ? rest.trim() : '';
}

// What Send does with the message: build a guide through the New sheet (files, a link or pasted
// notes, with or without "make a guide"), open the New sheet to pick the material, or ask the Tutor.
// files: how many files are attached.
export function composerAction(text, files = 0) {
  const message = String(text || '').trim();
  const guide = asksForGuide(message);
  if (files > 0 && (guide || !message)) return { kind: 'guide', mode: 'upload' };
  if (guide && firstLink(message)) return { kind: 'guide', mode: 'link', url: firstLink(message) };
  if (guide && pastedMaterial(message)) return { kind: 'guide', mode: 'paste', text: pastedMaterial(message) };
  if (guide && !files) return { kind: 'new-sheet' };
  return message ? { kind: 'ask' } : { kind: 'none' };
}
