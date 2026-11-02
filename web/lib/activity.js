import { readUserValue, writeUserValue } from './userStore';
import { saveStudyDayToServer } from './serverCopies';
import { freezeStreak, isoWeek } from './streak.mjs';
import { addStudy } from './studyDays.mjs';
import { getProgress, groveKey, updateProgress } from './progress';

// Day-by-day study log for the heatmap, recap and streak freezes. The server keeps it (study_days,
// one row per day) and this browser keeps a copy that lib/serverSync.js refreshes on load.
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
  // The key comes from the URL; addStudy never lets it name an Object built-in.
  const day = addStudy(log[today], { guideId: guideId ? groveKey(guideId) : '', guideTitle, minutes, cards, right, total, kind });
  log[today] = day;
  const cutoff = dayKey(Date.now() - KEEP_DAYS * 86400000);
  for (const key of Object.keys(log)) if (key < cutoff) delete log[key];
  writeUserValue(KEY, log);
  saveStudyDayToServer(today, day);
}

export const KEEP_ACTIVITY_DAYS = KEEP_DAYS;

// The server's copy replaces this browser's (lib/serverSync.js).
export function replaceActivity(log) {
  writeUserValue(KEY, log && typeof log === 'object' && !Array.isArray(log) ? log : {});
}

// Streak with one automatic freeze per week (lib/streak.mjs): a single missed day between two
// study days does not break it. Returns { days, frozenThisWeek }.
export function streakWithFreeze(serverWeek = [], serverStreak = 0) {
  const active = new Set(Object.entries(readActivity()).filter(([, day]) => day.m > 0 || day.c > 0 || day.t > 0).map(([key]) => key));
  serverWeek.forEach(day => { if (day.active) active.add(day.date); });
  const used = new Set(getProgress().freeze || []);
  const { days, frozen, today } = freezeStreak(active, new Date(), KEEP_DAYS);
  const thisWeek = isoWeek(new Date());
  const newFreezes = frozen.filter(week => !used.has(week));
  if (newFreezes.length) updateProgress(current => ({ freeze: [...new Set([...(current.freeze || []), ...newFreezes])].slice(-12) }));
  return { days: Math.max(days, serverStreak || 0), frozenThisWeek: frozen.includes(thisWeek), today };
}

export { semesterName, semesterStart } from './streak.mjs';
