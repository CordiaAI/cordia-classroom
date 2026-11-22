// The class page in the new shell (docs/redesign/PLAN.md T7, DESIGN-SPEC 4.4): its tabs, the words
// on its rows and cards and which exam its card shows. Pure, so it
// can be tested in Node (web/tests/class-page.test.mjs); components/ClassProject.js renders it.
// Readiness, ideas left and the pace are Learn's own numbers (lib/examCountdown.mjs and
// lib/learnEngine.mjs); nothing here works them out a second way.
import { dayKey } from './learnEngine.mjs';
import { nearestExam, reviewSetFor } from './examCountdown.mjs';
import { deadlineTitle } from './formatters.js';

const DAY = 86400000;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// The tabs (DESIGN-SPEC 4.4). Files and Grades are a Canvas class's own.
export const CLASS_TABS = [
  { key: 'chats', label: 'Chats' },
  { key: 'guides', label: 'Guides' },
  { key: 'files', label: 'Files', canvas: true },
  { key: 'deadlines', label: 'Deadlines' },
  { key: 'grades', label: 'Grades', canvas: true },
];
export const DEFAULT_TAB = 'guides';

export function classTabs(canvas) {
  return CLASS_TABS.filter(tab => !tab.canvas || canvas);
}

// The tab in the address (?tab=), when the class has it; Guides otherwise.
export function pickTab(wanted, canvas) {
  return classTabs(canvas).some(tab => tab.key === wanted) ? wanted : DEFAULT_TAB;
}

// A review set: a guide built for an exam ("<exam>: review") or from a class's material.
export function isReviewSet(guide) {
  return /: review$/i.test(String(guide?.title || '').trim()) || guide?.source_type === 'review';
}

// Where a guide came from, in a word or two ("PDF", "Lecture recording", "Canvas module").
export function sourceLabel(guide) {
  const type = String(guide?.source_type || '');
  const title = String(guide?.source_title || '');
  if (type === 'file' || type === 'screenshot') {
    if (/\.pdf$/i.test(title)) return 'PDF';
    if (/\.(pptx?|key|odp)$/i.test(title)) return 'Lecture slides';
    if (/\.(docx?|odt|rtf|txt|md)$/i.test(title)) return 'Document';
    if (/\.(png|jpe?g|gif|webp|heic)$/i.test(title) || type === 'screenshot') return 'Image';
    return 'File';
  }
  if (type.startsWith('note:') || type === 'notes' || type === 'text') return 'Notes';
  return {
    lecture: 'Lecture recording', video: 'Video', webpage: 'Web page', selected_text: 'Web page', pasted_text: 'Pasted notes',
    canvas_module: 'Canvas module', gdrive: 'Google Drive', dropbox: 'Dropbox', review: 'Review set', sample: 'Sample',
    study_guide: 'Copy of a guide',
  }[type] || 'Guide';
}

// The meta line under a guide's title: "PDF · 18 ideas" (the ideas only once they're known).
export function guideMeta(guide, tally) {
  return [isReviewSet(guide) ? 'Review set' : sourceLabel(guide), tally?.total ? plural(tally.total, 'idea', 'ideas') : ''].filter(Boolean).join(' · ');
}

// The mastery bar (DESIGN-SPEC 4.4): mastered, familiar, learning, new, each as wide as its share.
// Fading ideas are counted as familiar, as Learn counts them. Empty parts are left out.
export function masteryParts(tally) {
  if (!tally?.total) return [];
  return [
    { key: 'mastered', count: tally.mastered },
    { key: 'familiar', count: tally.familiar },
    { key: 'learning', count: tally.learning },
    { key: 'new', count: tally.new },
  ].filter(part => part.count > 0);
}

export function masteredLine(tally) {
  return tally?.total ? `${tally.mastered} of ${tally.total} mastered` : '';
}

// The review set for the class's exam leads; the rest stay newest first.
export function orderGuides(guides, leadId = '') {
  const list = [...(guides || [])].sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0));
  const at = leadId ? list.findIndex(guide => String(guide.id) === String(leadId)) : -1;
  if (at > 0) list.unshift(...list.splice(at, 1));
  return list;
}

function daysBetween(fromDay, toDay) {
  return Math.round((new Date(toDay + 'T12:00:00') - new Date(fromDay + 'T12:00:00')) / DAY);
}

// The class's next exam for its card (DESIGN-SPEC 4.4): the soonest of the exam with a review set in
// the next two weeks (nearestExam, the same one the sidebar's ring and the home's headline use) and
// the class's own upcoming Canvas exams (exams whose id is one of the class's deadlines).
// guides: the class's guide summaries; exams: calendar or course-work items of type 'exam';
// itemIds: the class's deadline ids. Returns { title, date, dueAt, daysLeft, guideId, itemId } or null.
export function classExam(guides, exams, itemIds = [], today = dayKey()) {
  const ids = new Set([...itemIds].map(String));
  const list = (exams || []).filter(exam => exam?.type === 'exam' && !exam.done && exam.due_at);
  const own = list
    .filter(exam => ids.has(String(exam.id)) || reviewSetFor(guides, exam.title) || reviewSetFor(guides, deadlineTitle(exam)))
    .filter(exam => dayKey(exam.due_at) >= today)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  const near = nearestExam(guides, list, today);
  const next = own[0] || null;
  if (near && (!next || near.date <= dayKey(next.due_at))) {
    const sameDay = own.filter(exam => dayKey(exam.due_at) === near.date);
    const item = sameDay.find(exam => [exam.title, deadlineTitle(exam)].some(title => reviewSetFor(guides, title)?.id === near.guideId)) || sameDay[0] || null;
    return { title: deadlineTitle({ title: near.title }), date: near.date, dueAt: item?.due_at || '', daysLeft: near.daysLeft, guideId: near.guideId, itemId: item ? String(item.id) : '', item };
  }
  if (!next) return null;
  const date = dayKey(next.due_at);
  const set = reviewSetFor(guides, next.title) || reviewSetFor(guides, deadlineTitle(next));
  return { title: deadlineTitle(next), date, dueAt: next.due_at, daysLeft: daysBetween(today, date), guideId: set ? set.id : '', itemId: String(next.id || ''), item: next };
}

// "Thu, Nov 19"
export function shortDay(value, locale) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + 'T12:00:00' : value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

// "11:59 PM"
export function clockTime(value, locale) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

// "today", "tomorrow", "in 3 days"
export function inDays(daysLeft) {
  if (!Number.isFinite(daysLeft)) return '';
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}

// The exam card's date line: "Thu, Nov 19 · 9:30 AM · in 3 days" (no time for a date-only exam).
export function examWhen(exam, locale) {
  if (!exam?.date) return '';
  return [shortDay(exam.date, locale), exam.dueAt ? clockTime(exam.dueAt, locale) : '', inDays(exam.daysLeft)].filter(Boolean).join(' · ');
}

// A deadline's line: "Fri, Nov 20 · 11:59 PM".
export function dueWhen(dueAt, locale) {
  return [shortDay(dueAt, locale), clockTime(dueAt, locale)].filter(Boolean).join(' · ');
}

// Due soon (DESIGN-SPEC 4.4): the next few deadlines not done yet, soonest first.
export function dueSoon(deadlines, now = Date.now(), limit = 3) {
  return (deadlines || [])
    .filter(item => item && !item.done && item.due_at && new Date(item.due_at).getTime() >= now)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, limit);
}

// The grade estimate the Grades tab shows (GET /canvas/courses/{id}/grades, components/ClassGrades.js):
// Canvas's own score and letter when it has them. { percent: '88%', letter: 'B' } or null.
export function gradeEstimate(grades) {
  const score = grades?.canvas_score ?? grades?.score;
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  const value = Number(score);
  return { percent: `${Number.isInteger(value) ? value : value.toFixed(1)}%`, letter: String(grades.canvas_letter || grades.letter || '').trim() };
}

// How long ago Canvas last synced: "just now", "12 min ago", "3 h ago", or "on Thu, Nov 19".
export function syncAgo(iso, now = Date.now(), locale) {
  const time = new Date(iso || '').getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `on ${shortDay(new Date(time).toISOString(), locale)}`;
}

// The header's line for a Canvas class: "MA 125 · synced from Canvas 12 min ago".
export function syncLine(code, ago) {
  return [code, ago ? `synced from Canvas ${ago}` : ''].filter(Boolean).join(' · ');
}
