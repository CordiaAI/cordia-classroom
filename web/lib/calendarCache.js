import { getUserId } from './api';

// The last calendar feed this account loaded, kept on this device. The server reads the whole
// Canvas feed on every request (several seconds), so pages show this at once and refresh quietly.
const KEY = 'cordiaCalendarCache';

const keyFor = userId => (userId ? `${KEY}:${userId}` : '');

export function readCalendarCache(userId = getUserId()) {
  const key = keyFor(userId);
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && Array.isArray(value.items) ? { connected: true, items: value.items } : null;
  } catch {
    return null;
  }
}

// Save a /calendar/connection response: connected -> remember it; disconnected -> forget it.
export function rememberCalendar(data, userId = getUserId()) {
  const key = keyFor(userId);
  if (!key) return;
  try {
    if (data?.connected && Array.isArray(data.items)) localStorage.setItem(key, JSON.stringify({ items: data.items, at: Date.now() }));
    else if (data && !data.detail && data.connected === false) localStorage.removeItem(key);
  } catch { /* storage full or blocked */ }
}
