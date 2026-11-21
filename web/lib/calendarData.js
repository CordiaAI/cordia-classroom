import { apiFetch } from './api';
import { acceptWeek, timeZone } from './studyPlans';
import { dayKey } from './learnEngine.mjs';
import { examGuides, examProgress } from './calendarViews.mjs';

// The Calendar page's reads and writes (backend routers/calendar.py and routers/plans.py). Moving,
// resizing and adding study time go through the same study_blocks rows as Plan my week, and from
// there to Google Calendar when that sync is on (services/google_sync.py).

export const loadBlocks = () => apiFetch('/calendar/blocks');

// A study block dragged, resized or moved with the keyboard, with the browser's zone (an all-day
// deadline ends at midnight there). Resolves { block } or { error }.
export async function moveBlock(id, start, end) {
  const data = await apiFetch(`/calendar/blocks/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ starts_at: start.toISOString(), ends_at: end.toISOString(), time_zone: timeZone() }), timeoutMs: 60000, reportFailure: true,
  });
  return data?.block ? { block: data.block } : { error: saveError(data, 'That study time didn’t move. It’s back where it was.') };
}

// Study time for one deadline on a day (the first free time there) or at a time.
export async function addBlock(itemKey, { day, startsAt, minutes = 60 }) {
  const body = { item_key: itemKey, minutes, time_zone: timeZone() };
  if (startsAt) body.starts_at = startsAt.toISOString();
  else body.day = dayKey(day);
  const data = await apiFetch('/calendar/blocks', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000, reportFailure: true });
  return data?.block ? { block: data.block } : { error: saveError(data, 'That study time wasn’t added. Try again.') };
}

// Find time: Plan my week's own scheduling for the picked deadlines (POST /week/accept).
export async function findTime(itemKeys) {
  const data = await acceptWeek(itemKeys);
  return typeof data?.added === 'number' ? { result: data } : { error: saveError(data, 'Cordia couldn’t find time just now. Try again.') };
}

function saveError(data, fallback) {
  const detail = typeof data?.detail === 'string' ? data.detail : '';
  // The route itself missing (a backend from before this page): say so plainly.
  if (/^(not found|method not allowed)$/i.test(detail)) return 'Moving study time isn’t available yet. Try again after the next update.';
  return detail || fallback;
}

// Readiness for each exam with a review set: Learn's own number (lib/examCountdown.mjs), the
// same one the sidebar's ring shows. { [examId]: { guideId, percent, left, perDay } }.
export async function loadExamReadiness(exams) {
  if (!exams.length) return {};
  const data = await apiFetch('/guides?fields=summary&limit=500');
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const picked = examGuides(exams, guides);
  const found = await Promise.all(exams.map(async exam => {
    const summary = picked[exam.id];
    if (!summary) return null;
    const full = await apiFetch('/guides/' + encodeURIComponent(summary.id));
    return full?.guide ? [exam.id, { guideId: summary.id, ...examProgress(full.guide, exam.at) }] : null;
  }));
  return Object.fromEntries(found.filter(Boolean));
}
