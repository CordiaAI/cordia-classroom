// Loading a guide to study (Flashcards, Learn, Quiz). Your own guide comes from the usual route. With
// PER_VIEWER_PROGRESS on, someone else's shared guide comes from /guides/{id}/study: the cards and
// questions of the version you're on and your own progress, in the same shape, plus `viewer`
// ({ version, current_version, update_available, stayed, changes, author }). A guide you studied
// that's since been hidden comes back as { unavailable, title }.
import { apiFetch } from './api';
import { PER_VIEWER_PROGRESS } from './featureFlags';

export async function loadStudyGuide(guideId, fields = '') {
  const own = await apiFetch(`/guides/${guideId}${fields ? `?fields=${fields}` : ''}`);
  if (own?.guide || !PER_VIEWER_PROGRESS) return own;
  const shared = await apiFetch(`/guides/${guideId}/study`);
  return shared?.guide || shared?.unavailable ? shared : own;
}

// The study screens' saves for a guide that isn't yours: by position in the version you're on; the
// server stores them by idea. Returns your progress to show next, or null when it couldn't save.
export async function saveViewerProgress(guideId, viewer, { cards = null, learn = null } = {}) {
  const data = await apiFetch(`/guides/${guideId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ version: viewer.version, cards, learn }),
  });
  return data?.flashcard_progress || null;
}

export function acceptUpdate(guideId) {
  return apiFetch(`/guides/${guideId}/accept-update`, { method: 'POST' });
}

export function stayOnVersion(guideId) {
  return apiFetch(`/guides/${guideId}/stay`, { method: 'POST' });
}

export function guideChanges(guideId) {
  return apiFetch(`/guides/${guideId}/changes`);
}
