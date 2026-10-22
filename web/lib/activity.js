import { readUserValue, writeUserValue } from './userStore';
import { getProgress, groveKey, updateProgress } from './progress';

// Day-by-day study log for the heatmap, recap and streak freezes. Kept in this
// browser per student (it is too large for the account record); it starts the
// day this version is first opened.
const KEY = 'cordiaActivity';
const KEEP_DAYS = 400;

export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function readActivity() {
  return readUserValue(KEY, {}) || {};
}

export function recordStudy({ guideId, guideTitle, minutes = 0, cards = 0, right = 0, total = 0, kind = '' }) {
  const log = readActivity();
  const today = dayKey();
  const day = log[today] || { m: 0, c: 0, r: 0, t: 0, g: {} };
  day.m = Math.round((day.m + minutes) * 10) / 10;
  day.c += cards;
  day.r += right;
  day.t += total;
  // The key comes from the URL; never let it name an Object built-in.
  const groveId = guideId ? groveKey(guideId) : '';
  if (groveId && !['__proto__', 'constructor', 'prototype'].includes(groveId)) {
    const entry = (Object.hasOwn(day.g, groveId) && day.g[groveId]) || { n: guideTitle || '', m: 0, k: [] };
    entry.m = Math.round((entry.m + minutes) * 10) / 10;
    if (guideTitle) entry.n = guideTitle;
    if (kind && !entry.k.includes(kind)) entry.k.push(kind);
    day.g[groveId] = entry;
  }
  log[today] = day;
  const cutoff = dayKey(Date.now() - KEEP_DAYS * 86400000);
  for (const key of Object.keys(log)) if (key < cutoff) delete log[key];
  writeUserValue(KEY, log);
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d - start) / 86400000 + 1) / 7)}`;
}

// Streak with one automatic freeze per week: a single missed day between two study
// days does not break it. Returns { days, frozenThisWeek }.
export function streakWithFreeze(serverWeek = [], serverStreak = 0) {
  const active = new Set(Object.entries(readActivity()).filter(([, day]) => day.m > 0 || day.c > 0 || day.t > 0).map(([key]) => key));
  serverWeek.forEach(day => { if (day.active) active.add(day.date); });
  const used = new Set(getProgress().freeze || []);
  const cursor = new Date();
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  const frozen = [];
  for (let guard = 0; guard < KEEP_DAYS; guard += 1) {
    const key = dayKey(cursor);
    if (active.has(key)) { days += 1; cursor.setDate(cursor.getDate() - 1); continue; }
    const before = new Date(cursor);
    before.setDate(before.getDate() - 1);
    const week = isoWeek(cursor);
    if (!frozen.includes(week) && active.has(dayKey(before)) && days > 0) {
      frozen.push(week);
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  const thisWeek = isoWeek(new Date());
  const newFreezes = frozen.filter(week => !used.has(week));
  if (newFreezes.length) updateProgress(current => ({ freeze: [...new Set([...(current.freeze || []), ...newFreezes])].slice(-12) }));
  return { days: Math.max(days, serverStreak || 0), frozenThisWeek: frozen.includes(thisWeek), today: active.has(dayKey(new Date())) };
}

export function semesterStart(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 7) return new Date(year, 7, 1);
  if (month >= 4) return new Date(year, 4, 15);
  return new Date(year, 0, 1);
}

export function semesterName(now = new Date()) {
  const month = now.getMonth();
  return `${month >= 7 ? 'Fall' : month >= 4 ? 'Summer' : 'Spring'} ${now.getFullYear()}`;
}
