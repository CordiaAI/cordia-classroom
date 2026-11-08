import { apiFetch, clearAuth, getToken } from './api';
import { AGE_BLOCK_KEY, PENDING_AGE_KEY } from './age.mjs';

// Sending the sign-up age to the server (POST /auth/age; social plan, Stage 9). Under 13, the server
// deletes the account; this browser then remembers it and signs out. Storage can be blocked
// (private windows): every read and write is wrapped, and the server check still holds.
function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export function ageBlocked() {
  return read(AGE_BLOCK_KEY) === '1';
}

export function blockAge() {
  write(AGE_BLOCK_KEY, '1');
  write(PENDING_AGE_KEY, null);
}

export function rememberAge(year, month) {
  write(PENDING_AGE_KEY, JSON.stringify({ year: Number(year), month: Number(month) }));
}

// Sends the waiting answer once there's a session. Returns 'saved' | 'under_13' | 'none' | 'failed'.
export async function sendAge(answer = null) {
  let body = answer;
  if (!body) {
    try { body = JSON.parse(read(PENDING_AGE_KEY) || 'null'); } catch { body = null; }
  }
  if (!body || !getToken()) return 'none';
  const data = await apiFetch('/auth/age', { method: 'POST', reportFailure: true, body: JSON.stringify(body) });
  if (data?.detail === 'under_13') {
    blockAge();
    clearAuth();  // the Supabase client keeps no session of its own (persistSession: false)
    window.location.assign('/signup?age=1');
    return 'under_13';
  }
  // Saved, already saved, or the server can't keep it yet: nothing more to ask this browser.
  if (data?.saved || /already saved|isn.t available yet/i.test(String(data?.detail || ''))) {
    write(PENDING_AGE_KEY, null);
    return 'saved';
  }
  return 'failed';
}
