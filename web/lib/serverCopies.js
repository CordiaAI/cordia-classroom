// Saves Retain misses and the daily study log to the server as the app changes them (the browser
// keeps a copy; lib/serverSync.js refreshes it from the server). Fire and forget: studying never
// waits on these, and a failed save is caught up by the next load's sync.
import { getToken, getUserId, tryRefreshToken } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';
import { restClient } from './supabaseRest.mjs';
import { dayToRow } from './studyDays.mjs';

let client = null;
export function supabaseRest() {
  if (!client) client = restClient({ supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, getToken, refresh: tryRefreshToken });
  return client;
}

export const UPSERT = { Prefer: 'resolution=merge-duplicates,return=minimal' };

export function saveRetainMissesToServer(guideId, items) {
  const userId = getUserId();
  if (!getToken() || !userId || !guideId) return;
  const request = items.length
    ? supabaseRest()('/rest/v1/retain_misses', { method: 'POST', headers: UPSERT, body: [{ user_id: userId, guide_id: guideId, items, updated_at: new Date().toISOString() }] })
    : supabaseRest()(`/rest/v1/retain_misses?guide_id=eq.${encodeURIComponent(guideId)}`, { method: 'DELETE' });
  request.catch(() => { /* the next load's sync catches up */ });
}

export function saveStudyDayToServer(day, entry) {
  const userId = getUserId();
  if (!getToken() || !userId || !day) return;
  supabaseRest()('/rest/v1/study_days', { method: 'POST', headers: UPSERT, body: [dayToRow(userId, day, entry)] })
    .catch(() => { /* the next load's sync catches up */ });
}
