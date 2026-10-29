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

// Retain misses (Quiz and Learn rounds) are kept here so Study now can bring them back, per guide:
// [{ question, answer, sure? }], ones the student was sure of first, at most MAX_RETAIN_MISSES.
// A round's misses are added to what was saved, so a round with no misses keeps earlier ones; an
// item leaves only when it is answered right (clearRetainMisses, or `cleared` here).
export const MAX_RETAIN_MISSES = 50;

// Questions are the same idea when their words match, ignoring case and punctuation.
export function questionKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function mergeRetainMisses(saved, misses, cleared = []) {
  const drop = new Set(cleared.map(item => questionKey(item?.question ?? item)));
  const merged = new Map();
  for (const item of [...(misses || []), ...(saved || [])]) {
    const key = questionKey(item?.question);
    if (!key || !item.answer || drop.has(key)) continue;
    const earlier = merged.get(key);
    // The newest answer text wins; being sure-and-wrong once keeps the item first.
    if (earlier) { if (item.sure) earlier.sure = true; continue; }
    merged.set(key, { question: item.question, answer: item.answer, ...(item.sure ? { sure: true } : {}) });
  }
  const list = [...merged.values()];
  return [...list.filter(item => item.sure), ...list.filter(item => !item.sure)].slice(0, MAX_RETAIN_MISSES);
}

function saveRetainMisses(guideId, update) {
  if (!guideId) return;
  const all = retainMisses();
  const next = update(Array.isArray(all[guideId]) ? all[guideId] : []);
  if (next.length) all[guideId] = next;
  else delete all[guideId];
  writeUserValue('cordiaRetainMisses', all);
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
