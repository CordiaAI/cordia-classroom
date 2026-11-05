// Guide visibility, the public guide page, saves and copies (social plan, Stage 3). Everything goes
// through the API (backend/routers/guide_sharing.py), which re-checks who may see what.
import { apiFetch, getToken, responseJson } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export { VISIBILITY_LABELS } from './guideVisibility.mjs';

const detail = (data, fallback) => (typeof data?.detail === 'string' ? data.detail : fallback);

// The address someone else opens: /sets/<guide id>.
export function guideLink(id) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/sets/${id}`;
}

// { result } on success, { honor: true } when the Honor Code must be accepted first, else { error }.
export async function setGuideVisibility(id, changes) {
  const data = await apiFetch(`/guides/${id}/visibility`, { method: 'PATCH', body: JSON.stringify(changes) });
  if (data?.visibility) return { result: data };
  if (data?.detail === 'honor_code_required') return { honor: true };
  return { error: detail(data, "Couldn't change who can see it. Try again.") };
}

// Signed-out visitors read public and link guides without a token (apiFetch needs one).
async function anonymousFetch(path) {
  try {
    return await responseJson(await fetch(API + path));
  } catch {
    return null;
  }
}

// { guide } | { missing: true } | { error: true }.
export async function loadPublicGuide(id) {
  const path = `/guides/${encodeURIComponent(id)}/public`;
  const data = getToken() ? await apiFetch(path) : await anonymousFetch(path);
  if (data?.guide?.id) return { guide: data.guide };
  if (data?.detail === 'Guide not found' || data?.detail === 'Invalid guide ID') return { missing: true };
  return { error: true };
}

export async function saveForLater(id, save = true) {
  const data = await apiFetch(`/guides/${id}/save`, { method: save ? 'POST' : 'DELETE' });
  if (typeof data?.saved === 'boolean') return { saved: data.saved };
  return { error: detail(data, "Couldn't save it. Try again.") };
}

export async function copyGuide(id, carryProgress = false) {
  const data = await apiFetch(`/guides/${id}/copy`, { method: 'POST', body: JSON.stringify({ carry_progress: carryProgress }) });
  if (data?.guide_id) return { guideId: data.guide_id };
  return { error: detail(data, "Couldn't make a copy. Try again.") };
}

export async function loadSavedGuides() {
  const data = await apiFetch('/guides/saved');
  return Array.isArray(data?.guides) ? data.guides : null;
}

export async function loadVisibilityReview() {
  const data = await apiFetch('/guides/visibility-review');
  return typeof data?.count === 'number' ? data.count : 0;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
