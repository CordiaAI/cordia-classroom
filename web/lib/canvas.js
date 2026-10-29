import { apiFetch } from './api';

// Canvas + class sharing need the newer API. On an older backend these routes are
// missing, so every entry point hides itself instead of showing a broken screen.
let available = null;

export async function canvasStatus() {
  const data = await apiFetch('/canvas/status');
  available = Boolean(data && typeof data === 'object' && 'connected' in data);
  return available ? data : null;
}

export function canvasKnownAvailable() {
  return available;
}

export async function schoolPolicy({ domain = '', school = '' } = {}) {
  const query = new URLSearchParams();
  if (domain) query.set('domain', domain);
  if (school) query.set('school', school);
  const data = await apiFetch('/canvas/policy?' + query);
  return data && typeof data.tokens_allowed === 'boolean' ? data : { tokens_allowed: true };
}

// The last day of the current term, for the token's Expires field.
export function termEndDate(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const end = month <= 4 ? new Date(year, 4, 20) : month <= 6 ? new Date(year, 7, 15) : new Date(year, 11, 20);
  const pad = value => String(value).padStart(2, '0');
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

export function displayDate(iso) {
  if (!iso) return '';
  const date = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// Canvas URLs pasted in any shape: "school.instructure.com", "https://school.instructure.com/courses/1".
export function canvasHost(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text.includes('://') ? text : 'https://' + text).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Check a deadline off (or back on). Canvas items and calendar-link items both use their item id.
export async function setDeadlineDone(id, done) {
  const data = await apiFetch(`/calendar/items/${encodeURIComponent(id)}/done`, { method: 'PUT', body: JSON.stringify({ done }) });
  return typeof data?.done === 'boolean';
}
