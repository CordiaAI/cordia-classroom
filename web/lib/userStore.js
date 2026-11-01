import { getUserId } from './api';
import { saveRetainMissesToServer } from './serverCopies';

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

// Retain misses (Quiz and Learn rounds) live on the server (retain_misses) with a copy in this
// browser; the merge rules are in retainMisses.mjs, which the MCP server shares.
import { MAX_RETAIN_MISSES, mergeRetainMisses, questionKey } from './retainMisses.mjs';
export { MAX_RETAIN_MISSES, mergeRetainMisses, questionKey };

function saveRetainMisses(guideId, update) {
  if (!guideId) return;
  const all = retainMisses();
  const next = update(Array.isArray(all[guideId]) ? all[guideId] : []);
  if (next.length) all[guideId] = next;
  else delete all[guideId];
  writeUserValue('cordiaRetainMisses', all);
  saveRetainMissesToServer(guideId, next);
}

// A round's misses join the guide's list; `cleared` (questions answered right) leave it.
export function rememberRetainMisses(guideId, misses, { cleared = [] } = {}) {
  saveRetainMisses(guideId, saved => mergeRetainMisses(saved, misses, cleared));
}

// Questions (text or { question }) the student has now answered right.
export function clearRetainMisses(guideId, questions) {
  saveRetainMisses(guideId, saved => mergeRetainMisses(saved, [], questions));
}

export function retainMisses() {
  const all = readUserValue('cordiaRetainMisses', {}) || {};
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
}

// The server's copy replaces this browser's (lib/serverSync.js).
export function replaceRetainMisses(all) {
  writeUserValue('cordiaRetainMisses', all && typeof all === 'object' && !Array.isArray(all) ? all : {});
}
