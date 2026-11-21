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
// Small words that stay lowercase in a Title Case title ("Hadley v. Baxendale", "Ethics of Care").
export const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'v', 'vs', 'with']);

const TERMS = new Set(['FA', 'FALL', 'SP', 'SPR', 'SPRNG', 'SPRING', 'SU', 'SUM', 'SUMR', 'WI', 'WIN', 'WINT']);
// Words that sit before a number without naming a department ("Sec 02", "Week 5", "COVID 19"), and
// words an all-caps title starts with ("INTRO TO CS 101").
const NOT_DEPARTMENTS = new Set(['SEC', 'SECT', 'SECTION', 'LAB', 'LEC', 'LECTURE', 'WEEK', 'WK', 'UNIT', 'MOD', 'MODULE', 'CH', 'CHAP', 'CHAPTER', 'PART', 'PT', 'SESSION', 'GROUP', 'COHORT', 'TEAM', 'BLOCK', 'CLASS', 'COVID', 'COURSE', 'TERM', 'YEAR', 'GRADE', 'LEVEL', 'ROOM', 'RM', 'CRN', 'STEP', 'DAY', 'PERIOD', 'QTR']);
// Words that go before a four-digit year, not a course number ("FY 2025", "Class of 2025", "May 2025
// Cohort ABSN"): month names and abbreviations too. The terms above do as well ("Spring 2025").
const YEAR_WORDS = new Set(['OF', 'IN', 'FY', 'AY', 'CY', 'SY', 'CLASS', 'YEAR', 'SEMESTER', 'SEM',
  'JAN', 'JANUARY', 'FEB', 'FEBRUARY', 'MAR', 'MARCH', 'APR', 'APRIL', 'MAY', 'JUN', 'JUNE', 'JUL', 'JULY',
  'AUG', 'AUGUST', 'SEP', 'SEPT', 'SEPTEMBER', 'OCT', 'OCTOBER', 'NOV', 'NOVEMBER', 'DEC', 'DECEMBER']);
const LEADING_WORDS = new Set(['TO', 'OF', 'AND', 'THE', 'FOR', 'IN', 'ON', 'AT', 'A', 'AN', 'INTRO', 'INTRODUCTION']);

// "EH-102-136" or "MUL 101 MUL-101-102: Introduction to Music" -> "EH 102", "MUL 101"; "Art History
// 210 (ART HIST 210)" -> "ART HIST 210": the department (one word, or two in capitals) and level, the
// way students name a class. A class named only in words keeps its name, cut at a dash, a colon, a
// bracket or "Section", without its term ("SP25 Adult Health I" -> "Adult Health I"). When unsure
// (a section code, a term, "Week 5", "COVID 19") it names nothing, and the label says "your". A
// number from 1900 to 2099 is a course level ("ECE 2035") unless the department is a term, month or
// year word ("Fall 2025", "FY 2025", "May 2025"), or the word before the department is one ("Class
// of 2025", "Spring ECE 2035"): then it is a year and the label says "your".
export function classShort(course) {
  const text = String(course || '').trim();
  const pattern = /\b([A-Z]{2,5}[\s_-]+[A-Z]{2,5}|[A-Za-z]{2,5})[\s_-]*(\d{3,4}[A-Za-z]?)\b/g;
  for (const { 1: dept, 2: level, index } of text.matchAll(pattern)) {
    const parts = dept.split(/[\s_-]+/);
    while (parts.length > 1 && LEADING_WORDS.has(parts[0].toUpperCase())) parts.shift();
    if (parts.some(part => TERMS.has(part.toUpperCase()) || NOT_DEPARTMENTS.has(part.toUpperCase()))) continue;
    if (/^(19|20)\d\d$/.test(level)) {
      const before = text.slice(0, index).match(/([A-Za-z]+)[\s_-]*$/)?.[1]?.toUpperCase();
      if (parts.some(part => YEAR_WORDS.has(part.toUpperCase())) || TERMS.has(before) || YEAR_WORDS.has(before)) continue;
    }
    return `${parts.join(' ').toUpperCase()} ${level.toUpperCase()}`;
  }
  const { name, named } = wordsName(text);
  return named ? shorten(name, 28) : '';
}

// A class named only in words, without its term, section or anything after a dash, colon or bracket
// ("SP25 Adult Health I: Spring" -> "Adult Health I"); named says whether it reads as a class name.
function wordsName(value) {
  const name = String(value || '')
    .replace(/^\s*(?:(?:spring|summer|fall|winter|spr|sum|fal|win|sp|su|fa|wi)\s*['’]?\d{2,4}|(?:19|20)\d\d(?:\d\d)?)\b[\s,.:-]*/i, '')
    .replace(/^\s*(?:sec|section|lab|week|unit|group|cohort)\b\s*\d*[\s,.:–—-]*/i, '')
    .replace(/\s+[–—-]\s+.*$/, '')
    .replace(/[:(\[].*$/, '')
    .replace(/\b(?:section|sec)\b.*$/i, '')
    .replace(/[\s,.-]*\b(?:spring|summer|fall|winter)\s*(?:19|20)?\d\d\s*$/i, '')
    .trim();
  const words = name.split(/\s+/).filter(Boolean);
  const named = /[a-z]/.test(name) && !/\b(?:19|20)\d\d\b/.test(name) && !NOT_DEPARTMENTS.has(words[0]?.toUpperCase()) && (words.length > 1 || /^[A-Za-z]{5,}$/.test(name));
  return { name, named };
}

// A class's name in words alone, whole (not cut for a label), for telling two classes apart: "Calculus
// I" is not "Calculus II". A course code in the text is left out ("MATH 101 Calculus I" -> "Calculus I");
// '' when nothing in it reads as a name.
export function classNameWords(value) {
  const bare = String(value || '').replace(/\b[A-Za-z]{2,5}[\s_-]*\d{3,4}[A-Za-z]?(?:[-_]\d{1,3})?\b/g, ' ').replace(/^[\s:–—,.-]+/, '');
  const { name, named } = wordsName(bare);
  return named ? name : '';
}

// A leading id Canvas puts on an assignment ("A05", "A07AA", "HW3", "PA3"), and a section code
// ("NUR-210-01"). Part words ("Wk5", "Ch5", "Pt2", "U2") are not ids: the number says which part.
const ASSIGNMENT_ID = /^(?:a|as|asg|dq|hw|pa|pr|ps|q|ws)(?:\d{1,3}|\d{2,3}[a-z]{1,3})$/i;
// An id that leads the title, with something after it: "HW 6:" (a space before the number, then a
// colon), "P4:" and "MP2 -" (a programming project; only with a colon or dash after, since "P53 Pathway
// Quiz" is a protein).
const SPACED_ID = /^(?:(?:a|as|asg|dq|hw|pa|pr|ps|q|ws|p|mp)\s+\d{1,3}[A-Za-z]{0,3}\s*:|(?:p|mp)\d{1,2}\s*[:–—-])\s+(?=\S)/i;
const SECTION_CODE = /^[A-Za-z]{2,5}[-_]\d{3,4}[A-Za-z]?(?:[-_]\d{1,3})?$/;
const isCode = token => { const bare = token.replace(/[:.,–—-]+$/, ''); return ASSIGNMENT_ID.test(bare) || SECTION_CODE.test(bare) || /^\d{1,3}$/.test(bare); };

// Every word starts with a capital (small words aside): "Packback Discussion", not "Lab report".
const isTitleCase = title => title.split(/\s+/).every(word => {
  const letters = word.replace(/^[^A-Za-z]+/, '');
  return !letters || MINOR_WORDS.has(letters.toLowerCase().replace(/\.$/, '')) || /^[A-Z]/.test(letters);
});

// An assignment's title in plain words for the Plan label: the Canvas section code, ids ("A05",
// "PA3:"), "#12" and "(1 of 2)" go; the meaning stays, numbers included ("Quiz 4", "Lab 3", "Problem
// Set 4"). The last word is lowercased when it is a work noun and the whole title is in Title Case,
// since the label reads as a sentence (lowerLast: false keeps the title's own case). "" if only codes are left ("NUR-210-01 [A05]").
export function planTitle(raw, { lowerLast = true } = {}) {
  let title = String(raw || '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\(\s*\d+\s*(?:of|\/)\s*\d+\s*\)/gi, '')
    .replace(/\s*#\s*\d+[A-Za-z]?/g, '')
    .trimStart()
    .replace(SPACED_ID, '');
  const tokens = title.split(/\s+/).filter(Boolean);
  if (tokens.every(isCode)) return '';
  while (tokens.length > 1 && isCode(tokens[0]) && !tokens.every(isCode)) tokens.shift();
  title = tokens.join(' ')
    .replace(/\s+[–—-]\s+/g, ': ')
    .replace(/\s+([:,;.])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,;.–—-]+|[\s:,;.–—-]+$/g, '');
  const last = title.match(/[A-Za-z]+$/)?.[0];
  if (lowerLast && last && WORK_NOUNS.has(last.toLowerCase()) && last !== last.toUpperCase() && isTitleCase(title)) title = title.slice(0, -last.length) + last.toLowerCase();
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
