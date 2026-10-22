// Spaced review for flashcards. Each card climbs a box when the student gets it and drops to
// the first box when they miss it; the box sets how many days until it comes back.
// Stored in a guide's flashcard_progress: { known, unknown, last_studied, schedule: { [index]: { box, due } } }.
export const INTERVALS = [1, 2, 4, 7, 15, 30];
const LAST_BOX = INTERVALS.length - 1;
// Cards marked "Got it" before scheduling existed come back a week after they were last studied.
const LEGACY_DAYS = 7;

// A local calendar day as YYYY-MM-DD, so "due today" follows the student's own midnight.
export function dayKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = number => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function legacyDue(progress) {
  const studied = progress?.last_studied ? new Date(progress.last_studied) : null;
  return studied && !Number.isNaN(studied.getTime()) ? addDays(dayKey(studied), LEGACY_DAYS) : '';
}

// The day a card is next due ('' means it is new and due now).
export function cardDue(progress, index) {
  const entry = progress?.schedule?.[index];
  if (entry?.due) return entry.due;
  if ((progress?.known || []).includes(index)) return legacyDue(progress);
  return '';
}

export function isDue(progress, index, today = dayKey()) {
  return cardDue(progress, index) <= today;
}

export function dueIndices(progress, count, today = dayKey()) {
  return Array.from({ length: Math.max(0, count || 0) }, (_, index) => index).filter(index => isDue(progress, index, today));
}

// The soonest day after today that any card comes back, for "All caught up" messages.
export function nextDueDay(progress, count, today = dayKey()) {
  return Array.from({ length: Math.max(0, count || 0) }, (_, index) => cardDue(progress, index))
    .filter(day => day > today)
    .sort()[0] || '';
}

// Progress after a session: known cards move up a box, missed cards go back to the first.
export function applyResults(progress, { known = [], missed = [] }, now = new Date()) {
  const today = dayKey(now);
  const before = progress || {};
  const schedule = { ...(before.schedule || {}) };
  const wasKnown = new Set(before.known || []);
  const missedSet = new Set(missed);
  for (const index of known) {
    if (missedSet.has(index)) continue;
    const previous = schedule[index]?.box ?? (wasKnown.has(index) ? 1 : -1);
    const box = Math.min(previous + 1, LAST_BOX);
    schedule[index] = { box, due: addDays(today, INTERVALS[box]) };
  }
  for (const index of missedSet) schedule[index] = { box: 0, due: addDays(today, INTERVALS[0]) };
  const knownAll = [...new Set([...(before.known || []), ...known])].filter(index => !missedSet.has(index));
  const unknownAll = [...new Set([...(before.unknown || []), ...missed])].filter(index => !knownAll.includes(index));
  return { known: knownAll, unknown: unknownAll, last_studied: now.toISOString(), schedule };
}
