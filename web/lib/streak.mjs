// Streaks and semesters, pure (the web app and the MCP's get_progress both use them).
import { dayKey } from './spacedReview.mjs';

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d - start) / 86400000 + 1) / 7)}`;
}

// Streak with one automatic freeze per week: a single missed day between two study days does not
// break it. activeDays: Set of 'YYYY-MM-DD' local days studied; now: a Date whose local date is the
// student's today. Returns { days, frozen: ISO weeks a freeze was used in, today: studied today }.
export function freezeStreak(activeDays, now = new Date(), keepDays = 400) {
  const cursor = new Date(now);
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  const frozen = [];
  for (let guard = 0; guard < keepDays; guard += 1) {
    const key = dayKey(cursor);
    if (activeDays.has(key)) { days += 1; cursor.setDate(cursor.getDate() - 1); continue; }
    const before = new Date(cursor);
    before.setDate(before.getDate() - 1);
    const week = isoWeek(cursor);
    if (!frozen.includes(week) && activeDays.has(dayKey(before)) && days > 0) {
      frozen.push(week);
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return { days, frozen, today: activeDays.has(dayKey(now)) };
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
