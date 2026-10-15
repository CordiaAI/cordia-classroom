import { getUserId } from './api';

// Small per-account preferences kept in this browser. Keys are suffixed with the
// signed-in user id so two accounts on one computer never share them.
function key(name) {
  const id = typeof window === 'undefined' ? '' : getUserId();
  return id ? `${name}:${id}` : '';
}

export function readUserValue(name, fallback = null) {
  const storageKey = key(name);
  if (!storageKey) return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeUserValue(name, value) {
  const storageKey = key(name);
  if (!storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
}

// The last guide the student opened, for "Continue" and the Tutor's default context.
export function rememberLastGuide(guide) {
  if (!guide?.id) return;
  writeUserValue('cordiaLastGuide', { id: guide.id, title: guide.title || '', page: Number(guide.page) || 0, at: Date.now() });
}

export function lastGuide() {
  return readUserValue('cordiaLastGuide', null);
}

export function rememberGuidePage(guideId, page) {
  const last = lastGuide();
  if (last?.id === guideId) writeUserValue('cordiaLastGuide', { ...last, page });
}

// Retain misses are kept here so Today's Start session can bring them back.
export function rememberRetainMisses(guideId, misses) {
  const all = readUserValue('cordiaRetainMisses', {}) || {};
  if (misses.length) all[guideId] = misses.slice(0, 50);
  else delete all[guideId];
  writeUserValue('cordiaRetainMisses', all);
}

export function retainMisses() {
  return readUserValue('cordiaRetainMisses', {}) || {};
}
