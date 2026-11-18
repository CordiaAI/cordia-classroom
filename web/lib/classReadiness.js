import { apiFetch, getToken } from './api';
import { classExams, examReadiness, learnQuestions } from './examCountdown.mjs';
import { readCalendarCache, rememberCalendar } from './calendarCache';

// Readiness for the sidebar's classes (DESIGN-SPEC 3.3): Learn's own number for the review set tied
// to each class's next exam in the next 14 days, worked out the same way as the Dashboard's exam
// countdown (lib/examCountdown.mjs). Kept for two minutes; leaving Learn asks again.
const TTL_MS = 2 * 60 * 1000;
let cached = null; // { at, token, key, promise }

const REVIEW = /: review$/i;
const safe = promise => promise.catch(() => null);

async function upcomingExams() {
  // The Canvas feed is slow (several seconds): this device's copy first, then the server's.
  const feed = readCalendarCache() || await safe(apiFetch('/calendar/connection')).then(data => { rememberCalendar(data); return data; });
  const coursework = await safe(apiFetch('/calendar/coursework'));
  return [...(coursework?.upcoming || []), ...(feed?.connected ? feed.items || [] : [])].filter(item => item?.type === 'exam');
}

async function compute(classIds) {
  const data = await safe(apiFetch('/guides?fields=summary&limit=500'));
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const ids = new Set(classIds.map(String));
  const candidates = guides.filter(guide => ids.has(String(guide.folder_id || '')) && (REVIEW.test(String(guide.title || '').trim()) || guide.flashcard_progress?.learn?.test_date));
  if (!candidates.length) return {};
  // Exams are only needed to date a review set that Learn hasn't been given a test date for.
  const exams = candidates.some(guide => !guide.flashcard_progress?.learn?.test_date) ? await upcomingExams() : [];
  const found = classExams(classIds, candidates, exams);
  const entries = await Promise.all(Object.entries(found).map(async ([classId, exam]) => {
    const full = await safe(apiFetch('/guides/' + encodeURIComponent(exam.guideId)));
    if (!full?.guide) return null;
    return [classId, { ...exam, percent: examReadiness(learnQuestions(full.guide), full.guide.flashcard_progress?.learn) }];
  }));
  return Object.fromEntries(entries.filter(Boolean));
}

// { [classId]: { guideId, title, date, daysLeft, percent } } for the classes with an exam coming up.
export function loadClassReadiness(classIds, { fresh = false } = {}) {
  const token = getToken();
  const key = [...classIds].map(String).sort().join(',');
  if (!token || !key) return Promise.resolve({});
  if (!fresh && cached && cached.token === token && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.promise;
  const entry = { at: Date.now(), token, key };
  entry.promise = compute(classIds).catch(() => ({}));
  cached = entry;
  return entry.promise;
}
