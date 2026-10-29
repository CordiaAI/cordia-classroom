// The sidebar's Study now count: everything the Study now round would hold right now (due
// flashcards, Learn ideas, Retain misses and open practice problems), from the same
// loadStudyQueue() that pages/session.js runs, so the number always matches the round.
// It reads every guide, so the count is kept for a few minutes and shared by every page.
import { loadStudyQueue } from './studyQueue';

export const DUE_FRESH_MS = 5 * 60 * 1000;

let cached = null; // { count, at }
let pending = null;

export function studyDueTotal(queue) {
  return (Array.isArray(queue?.items) ? queue.items.length : 0) + (Number(queue?.problems) || 0);
}

// The saved count, or null when there is none or it's older than DUE_FRESH_MS.
export function freshDueCount(now = Date.now()) {
  return cached && now - cached.at < DUE_FRESH_MS ? cached.count : null;
}

// Studying changes the count; the next read loads it again.
export function forgetDueCount() {
  cached = null;
}

export function loadDueCount({ force = false } = {}) {
  const fresh = force ? null : freshDueCount();
  if (fresh !== null) return Promise.resolve(fresh);
  if (!pending) {
    pending = loadStudyQueue()
      .then(queue => {
        cached = { count: studyDueTotal(queue), at: Date.now() };
        return cached.count;
      })
      .catch(() => (cached ? cached.count : 0))
      .finally(() => { pending = null; });
  }
  return pending;
}
