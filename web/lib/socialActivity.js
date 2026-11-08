import { apiErrorMessage, apiFetch } from './api';

// Stage 10: the Activity tab, the weekly friends leaderboard, a classroom's group streak and the
// Tutor on one guide. Every rule (who sees what, minors, blocks) is on the server.
export async function loadActivity(cursor) {
  const data = await apiFetch('/social/activity' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
  return data && Array.isArray(data.items) ? data : null;
}

export async function loadLeaderboard() {
  const data = await apiFetch('/social/leaderboard', { reportFailure: true });
  if (data && Array.isArray(data.people)) return data;
  return { error: apiErrorMessage(data?.detail, 'The leaderboard couldn’t load.') };
}

// Join or leave (PATCH /profiles/me leaderboard_opt_in). Returns { ok } or { error }.
export async function setLeaderboard(joined) {
  const data = await apiFetch('/profiles/me', { method: 'PATCH', reportFailure: true, body: JSON.stringify({ leaderboard_opt_in: joined }) });
  return data && 'leaderboard_opt_in' in data ? { ok: true } : { error: apiErrorMessage(data?.detail, 'Couldn’t change that. Try again.') };
}

export async function loadGroupStreak(classroomId) {
  const data = await apiFetch(`/classrooms/${classroomId}/streak`);
  return data && typeof data.streak === 'number' ? data : null;
}

// detail: 'short' (a few sentences) or 'long' (Explain more). Returns { covered, answer, cited } or { error }.
export async function askGuide(guideId, question, detail = 'short') {
  const data = await apiFetch(`/guides/${guideId}/ask`, { method: 'POST', reportFailure: true, quietLimit: true, body: JSON.stringify({ question, detail }) });
  if (data && typeof data.answer === 'string') return data;
  if (data?.limit_reached) return { error: 'You’ve used this month’s Tutor answers. They reset next month, or upgrade for more.' };
  return { error: apiErrorMessage(data?.detail, 'The Tutor couldn’t answer right now. Try again.') };
}
