// The chat home's words (DESIGN-SPEC 4.1) and how the composer reads a message (4.2). Pure, so
// it can be tested in Node (web/tests/chat-home.test.mjs); pages/home.js and components/Composer.js
// use it.

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

// Up to three suggestion pills, in the spec's order, leaving out any with nothing behind it.
// learn: { title, guideId, date } (an exam with a review set); due: due flashcards across every
// guide; deadline: { title } (the next Canvas deadline).
export function homeSuggestions({ learn = null, due = 0, deadline = null } = {}) {
  const pills = [];
  if (learn?.guideId) pills.push({ key: 'learn', icon: 'learn', label: `Start Learn for ${shorten(learn.title)}`, href: `/learn/${encodeURIComponent(learn.guideId)}${learn.date ? `?test=${learn.date}` : ''}` });
  if (due > 0) pills.push({ key: 'due', icon: 'cards', label: `Review ${plural(due, 'due flashcard', 'due flashcards')}`, href: '/session' });
  if (deadline?.title) pills.push({ key: 'plan', icon: 'plan', label: `Plan the ${shorten(deadline.title)}` });
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
