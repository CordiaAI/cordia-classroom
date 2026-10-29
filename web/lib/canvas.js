import { apiFetch, getToken } from './api';
import { invalidateFolders } from './folders';

// Canvas + class sharing need the newer API. On an older backend these routes are
// missing, so every entry point hides itself instead of showing a broken screen.
let available = null;

// Many screens ask for the status at once (Dashboard, Settings, class chips, reminders): they share
// one request, kept for a minute per account. Connecting, syncing and disconnecting clear it.
const STATUS_TTL_MS = 60 * 1000;
let statusCache = null; // { at, token, promise }

export function canvasStatus() {
  const token = getToken();
  if (statusCache && statusCache.token === token && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.promise;
  const entry = { at: Date.now(), token };
  const forget = () => { if (statusCache === entry) statusCache = null; };
  entry.promise = apiFetch('/canvas/status').then(data => {
    available = Boolean(data && typeof data === 'object' && 'connected' in data);
    if (!available) forget();
    return available ? data : null;
  }, error => { forget(); throw error; });
  statusCache = entry;
  return entry.promise;
}

// After anything that changes the connection or its classes (which become Library classes).
export function invalidateCanvasStatus() {
  statusCache = null;
  invalidateFolders();
}

async function changed(request) {
  const data = await request;
  invalidateCanvasStatus();
  return data;
}

export const connectCanvas = body => changed(apiFetch('/canvas/connect', { method: 'POST', body: JSON.stringify(body) }));
export const syncCanvas = () => changed(apiFetch('/canvas/sync', { method: 'POST' }));
export const disconnectCanvas = () => changed(apiFetch('/canvas', { method: 'DELETE' }));

// "Sync now" answers at once with syncing: true and runs in the background; this polls the
// status until that sync is over (or ~2 minutes pass) and returns the final status.
export async function settleCanvasSync(status, { every = 3000, tries = 40 } = {}) {
  let current = status;
  for (let i = 0; current?.syncing && i < tries; i += 1) {
    await new Promise(resolve => setTimeout(resolve, every));
    invalidateCanvasStatus();
    current = (await canvasStatus()) || current;
  }
  invalidateCanvasStatus();
  return current;
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
