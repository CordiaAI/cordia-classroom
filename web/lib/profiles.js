// Usernames, profiles, privacy settings and blocking (social plan, Stage 1). Everything goes through
// the API (backend/routers/profiles.py, social.py); the browser never reads user_profiles itself.
import { apiFetch } from './api';

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;

// What the student typed, as it would be stored: trimmed, lowercase, no leading @.
export function normalizeUsername(raw) {
  return String(raw || '').trim().replace(/^@+/, '').trim().toLowerCase();
}

// The quick local check before asking the server (reserved words and "taken" come from the server).
export function usernameHint(name) {
  if (!name) return '';
  if (name.length < 3) return 'Use at least 3 characters.';
  if (name.length > 24) return 'Use 24 characters or fewer.';
  if (!USERNAME_PATTERN.test(name)) return 'Use only letters, numbers, _ and .';
  return '';
}

// A response is usable only when it really is a profile (not an error body, and not a backend that
// doesn't have the route yet).
const isProfile = data => Boolean(data && typeof data === 'object' && 'username' in data && !data.detail);

export async function loadMyProfile() {
  const data = await apiFetch('/profiles/me');
  return isProfile(data) ? data : null;
}

export async function checkUsername(name) {
  const data = await apiFetch('/profiles/check-username?u=' + encodeURIComponent(name));
  return data && typeof data.available === 'boolean' ? data : null;
}

// { profile } on success, { error } otherwise.
export async function claimUsername(name) {
  const data = await apiFetch('/profiles/me/username', { method: 'POST', body: JSON.stringify({ username: name }), reportFailure: true });
  if (isProfile(data)) return { profile: data };
  return { error: typeof data?.detail === 'string' ? data.detail : "Couldn't save your username. Try again." };
}

export async function saveProfileSettings(changes) {
  const data = await apiFetch('/profiles/me', { method: 'PATCH', body: JSON.stringify(changes), reportFailure: true });
  if (isProfile(data)) return { profile: data };
  return { error: typeof data?.detail === 'string' ? data.detail : "Couldn't save. Try again." };
}

// { profile } | { redirect } | { missing: true } | { error }.
export async function loadProfile(username) {
  const data = await apiFetch('/profiles/' + encodeURIComponent(username), { reportFailure: true });
  if (data?.redirect) return { redirect: data.redirect };
  if (isProfile(data)) return { profile: data };
  if (data?.detail === 'Profile not found') return { missing: true };
  return { error: true };
}

export async function blockUser(userId) {
  const data = await apiFetch('/social/blocks/' + encodeURIComponent(userId), { method: 'POST' });
  return data?.blocked === true;
}

export async function unblockUser(userId) {
  const data = await apiFetch('/social/blocks/' + encodeURIComponent(userId), { method: 'DELETE' });
  return data?.blocked === false;
}

export async function loadBlocks() {
  const data = await apiFetch('/social/blocks');
  return Array.isArray(data?.blocks) ? data.blocks : null;
}
