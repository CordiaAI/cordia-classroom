import { apiFetch } from './api';

// Assignment kickoff, study blocks, alerts and the weekly review (backend routers/plans.py).
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const path = key => `/plans/${encodeURIComponent(key)}`;

export const getPlan = key => apiFetch(path(key));
export const makePlan = key => apiFetch(path(key), { method: 'POST', timeoutMs: 60000 });
export const removePlan = key => apiFetch(path(key), { method: 'DELETE' });
export const schedulePlan = key => apiFetch(`${path(key)}/schedule`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone() }), timeoutMs: 60000 });
export async function setStepDone(key, stepId, done) {
  const data = await apiFetch(`${path(key)}/steps/${encodeURIComponent(stepId)}`, { method: 'PUT', body: JSON.stringify({ done }) });
  return Boolean(data?.step);
}

export const getAlerts = () => apiFetch('/alerts');
export const dismissAlert = id => apiFetch(`/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const getWeek = () => apiFetch(`/week?time_zone=${encodeURIComponent(timeZone())}`);
export const acceptWeek = keys => apiFetch('/week/accept', { method: 'POST', body: JSON.stringify({ item_keys: keys, time_zone: timeZone() }), timeoutMs: 120000 });
export const getAnnouncements = () => apiFetch('/announcements');

export const syncOn = connector => apiFetch(`/sync/${connector}`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone() }), timeoutMs: 120000 });
export const syncOff = connector => apiFetch(`/sync/${connector}`, { method: 'DELETE' });

export function minutesLabel(minutes) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// "4 min ago", "2 h ago", "Oct 21".
export function agoLabel(iso, now = Date.now()) {
  const time = new Date(iso || '').getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Exam prep: gather the class's material into one review guide (and space review sessions).
export const buildExamReview = key => apiFetch(`${path(key)}/review-set`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone() }), timeoutMs: 120000 });
// A review set for part of a class, e.g. a finished Canvas module.
export const buildReview = ({ folderId, prefix, title }) => apiFetch('/review-sets', { method: 'POST', body: JSON.stringify({ folder_id: folderId, prefix: prefix || '', title: title || '' }), timeoutMs: 120000 });

// Date changes found in school email or Canvas announcements: nothing moves until accepted.
export const acceptChange = id => apiFetch(`/deadline-changes/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone() }), timeoutMs: 60000 });
export const setMailWatch = (connector, on) => apiFetch(`/mail/${connector}/watch`, { method: 'PUT', body: JSON.stringify({ on }), timeoutMs: 120000 });
