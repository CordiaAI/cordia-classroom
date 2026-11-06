// Duplicate sets: pairs of the student's own sets that look like the same material (the backend
// checks word overlap, then asks Claude Haiku; routers/guides.py). Loaded once per page load and
// shared by the Library banner, the Notifications panel and the set page.
import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch, getUserId } from './api';
import { readUserValue, writeUserValue } from './userStore';

const SEEN = 'cordiaDuplicatesSeen';
// Fired after a merge or a restore, so a page listing sets (the Library) reloads.
export const GUIDES_CHANGED = 'cordia:guides-changed';
const changed = () => { try { window.dispatchEvent(new CustomEvent(GUIDES_CHANGED)); } catch { /* not in a browser */ } };
let state = { ready: false, available: false, pairs: [] };
let loadingFor = '';
const listeners = new Set();

const pairKey = pair => [pair.keep.id, pair.merge.id].sort().join('|');

function publish(next) {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
}

export async function loadDuplicates(force = false) {
  const id = getUserId();
  if (!id || (!force && loadingFor === id)) return state;
  loadingFor = id;
  const data = await apiFetch('/guides/duplicates').catch(() => null);
  if (!data || !Array.isArray(data.pairs)) {
    loadingFor = '';
    publish({ ready: true, available: false, pairs: [] });
    return state;
  }
  publish({ ready: true, available: Boolean(data.available), pairs: data.pairs });
  return state;
}

export function useDuplicates() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    loadDuplicates();
    return () => listeners.delete(setCurrent);
  }, []);
  return current;
}

// The bell counts pairs the student hasn't seen in the Notifications panel yet.
export function seenPairs() {
  const list = readUserValue(SEEN, []);
  return Array.isArray(list) ? list : [];
}
export function unseenPairs(pairs) {
  const seen = new Set(seenPairs());
  return pairs.filter(pair => !seen.has(pairKey(pair)));
}
export function markPairsSeen(pairs) {
  const seen = new Set(seenPairs());
  pairs.forEach(pair => seen.add(pairKey(pair)));
  writeUserValue(SEEN, [...seen].slice(-200));
}

export function pairsFor(guideId) {
  return state.pairs.filter(pair => pair.keep.id === guideId || pair.merge.id === guideId);
}

function forget(a, b) {
  publish({ pairs: state.pairs.filter(pair => !([pair.keep.id, pair.merge.id].includes(a) && [pair.keep.id, pair.merge.id].includes(b))) });
}

export async function dismissPair(pair) {
  forget(pair.keep.id, pair.merge.id);
  await apiFetch('/guides/duplicates/dismiss', { method: 'POST', body: JSON.stringify({ a: pair.keep.id, b: pair.merge.id }) }).catch(() => null);
}

export async function mergePreview(keepId, otherId) {
  const data = await apiFetch(`/guides/${keepId}/merge-preview?other=${encodeURIComponent(otherId)}`);
  if (!data || data.detail) throw new Error(apiErrorMessage(data?.detail, "This merge couldn't be checked. Try again."));
  return data;
}

export async function mergeSets(keepId, otherId) {
  const data = await apiFetch(`/guides/${keepId}/merge`, { method: 'POST', body: JSON.stringify({ other: otherId }), timeoutMs: 60000 });
  if (!data || data.detail || !data.kept) throw new Error(apiErrorMessage(data?.detail, "These sets couldn't be merged. Try again."));
  forget(keepId, otherId);
  // Any other suggestion with the merged-away set is gone with it.
  publish({ pairs: state.pairs.filter(pair => pair.keep.id !== otherId && pair.merge.id !== otherId) });
  changed();
  return data;
}

export async function mergedInto(guideId) {
  const data = await apiFetch(`/guides/${guideId}/merged`).catch(() => null);
  return Array.isArray(data?.merged) ? data.merged : [];
}

export async function restoreMerged(backupId) {
  const data = await apiFetch(`/guides/merges/${backupId}/restore`, { method: 'POST' });
  if (!data || data.detail || !data.restored) throw new Error(apiErrorMessage(data?.detail, "This set couldn't be restored. Try again."));
  loadDuplicates(true);
  changed();
  return data;
}
