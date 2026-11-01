// Once per page load for the signed-in student: tells the server their time zone, and brings
// Retain misses and the daily study log down from the server into this browser's copy. The first
// time (per browser) it uploads what this browser kept before the server had it, merged with what
// the server already has from other devices. Until the migration that adds these tables has run,
// every call fails quietly and the browser's copy stays as it was.
import { getToken, getUserId } from './api';
import { readUserValue, replaceRetainMisses, retainMisses, writeUserValue } from './userStore';
import { KEEP_ACTIVITY_DAYS, dayKey, readActivity, replaceActivity } from './activity';
import { mergeRetainMisses } from './retainMisses.mjs';
import { dayToRow, mergeDay, rowToDay } from './studyDays.mjs';
import { UPSERT, supabaseRest } from './serverCopies';

const UPLOADED = 'cordiaServerCopies';
const ZONE_SENT = 'cordiaTimeZoneSent';
let syncedFor = '';

async function sendTimeZone(rest) {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { zone = ''; }
  if (!zone || readUserValue(ZONE_SENT) === zone) return;
  const { ok } = await rest('/rest/v1/rpc/set_my_timezone', { method: 'POST', body: { tz: zone } });
  if (ok) writeUserValue(ZONE_SENT, zone);
}

// What this browser had before the server kept it, merged into the server's copy.
async function uploadOnce(rest, userId, serverMisses, serverDays) {
  const owned = await rest('/rest/v1/study_guides?select=id');
  if (!owned.ok || !Array.isArray(owned.data)) return false;
  const guideIds = new Set(owned.data.map(row => row.id));
  const missRows = [];
  for (const [guideId, items] of Object.entries(retainMisses())) {
    if (!guideIds.has(guideId) || !Array.isArray(items) || !items.length) continue;
    const merged = mergeRetainMisses(serverMisses[guideId] || [], items);
    serverMisses[guideId] = merged;
    missRows.push({ user_id: userId, guide_id: guideId, items: merged, updated_at: new Date().toISOString() });
  }
  const dayRows = [];
  const cutoff = dayKey(Date.now() - KEEP_ACTIVITY_DAYS * 86400000);
  for (const [day, entry] of Object.entries(readActivity())) {
    if (day < cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    serverDays[day] = mergeDay(serverDays[day], entry);
    dayRows.push(dayToRow(userId, day, serverDays[day]));
  }
  for (const [table, rows] of [['retain_misses', missRows], ['study_days', dayRows]]) {
    for (let start = 0; start < rows.length; start += 200) {
      const { ok } = await rest(`/rest/v1/${table}`, { method: 'POST', headers: UPSERT, body: rows.slice(start, start + 200) });
      if (!ok) return false;
    }
  }
  return true;
}

export async function syncServerCopies() {
  const userId = getUserId();
  if (typeof window === 'undefined' || !getToken() || !userId || syncedFor === userId) return;
  syncedFor = userId;
  const rest = supabaseRest();
  try {
    await sendTimeZone(rest);
    const cutoff = dayKey(Date.now() - KEEP_ACTIVITY_DAYS * 86400000);
    const [misses, days] = await Promise.all([
      rest('/rest/v1/retain_misses?select=guide_id,items'),
      rest(`/rest/v1/study_days?select=day,minutes,cards,right_count,total,guides&day=gte.${cutoff}`),
    ]);
    if (!misses.ok || !days.ok || !Array.isArray(misses.data) || !Array.isArray(days.data)) { syncedFor = ''; return; }
    const serverMisses = Object.fromEntries(misses.data.map(row => [row.guide_id, Array.isArray(row.items) ? row.items : []]));
    const serverDays = Object.fromEntries(days.data.map(row => [row.day, rowToDay(row)]));
    if (!readUserValue(UPLOADED)) {
      if (!(await uploadOnce(rest, userId, serverMisses, serverDays))) { syncedFor = ''; return; }
      writeUserValue(UPLOADED, 1);
    }
    replaceRetainMisses(serverMisses);
    replaceActivity(serverDays);
  } catch {
    syncedFor = '';
  }
}
