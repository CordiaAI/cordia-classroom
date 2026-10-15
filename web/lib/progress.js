import { useEffect, useState } from 'react';
import { getToken, getUserId } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';

// Walkthrough, feature-use and Grove progress, saved per student on the server in
// their Supabase account metadata (key "cordia"), with a local copy for speed and
// offline use. It rides in the access token, so it stays small (no logs here).
const EMPTY = { v: 1, at: 0, theme: null, renamed: [], wt: null, day1Status: null, done: [], used: [], tips: [], grove: {}, rings: {}, freeze: [], first: 0 };
const LOCAL = 'cordiaProgress';
let state = { ...EMPTY };
let loadedFor = '';
let saveTimer = null;
const listeners = new Set();

function localKey() {
  const id = getUserId();
  return id ? `${LOCAL}:${id}` : '';
}

function publish() {
  listeners.forEach(notify => notify(state));
}

function merge(a, b) {
  const union = (x = [], y = []) => [...new Set([...x, ...y])];
  const maxMap = (x = {}, y = {}) => {
    const out = { ...x };
    for (const [key, value] of Object.entries(y)) out[key] = Math.max(out[key] || 0, value || 0);
    return out;
  };
  // Scalar fields (the active walkthrough) come from whichever copy changed last.
  const newer = (b?.at || 0) >= (a?.at || 0) ? b : a;
  return {
    ...EMPTY,
    ...a,
    ...b,
    at: Math.max(a?.at || 0, b?.at || 0),
    wt: newer?.wt ?? null,
    theme: newer?.theme ?? a?.theme ?? b?.theme ?? null,
    day1Status: a?.day1Status || b?.day1Status || null,
    done: union(a?.done, b?.done),
    renamed: union(a?.renamed, b?.renamed),
    used: union(a?.used, b?.used),
    tips: union(a?.tips, b?.tips),
    grove: maxMap(a?.grove, b?.grove),
    rings: maxMap(a?.rings, b?.rings),
    freeze: union(a?.freeze, b?.freeze).slice(-12),
    first: Math.min(...[a?.first, b?.first].filter(Boolean), Date.now()),
  };
}

async function remote(method, body) {
  const token = getToken();
  if (!token) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function getProgress() {
  return state;
}

export async function loadProgress() {
  const key = localKey();
  if (!key || loadedFor === key) return state;
  loadedFor = key;
  let local = null;
  try { local = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  state = merge(EMPTY, local);
  publish();
  const user = await remote('GET');
  const server = user?.user_metadata?.cordia;
  if (server) {
    state = merge(state, server);
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
    publish();
  }
  if (!state.first) updateProgress(current => ({ ...current, first: Date.now() }));
  return state;
}

export function updateProgress(change) {
  state = { ...state, ...change(state), at: Date.now() };
  const key = localKey();
  try { if (key) localStorage.setItem(key, JSON.stringify(state)); } catch {}
  publish();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => remote('PUT', { data: { cordia: state } }), 1500);
}

export function useProgress() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    loadProgress();
    return () => listeners.delete(setCurrent);
  }, []);
  return current;
}

export function markUsed(feature) {
  if (!feature || state.used.includes(feature)) return;
  updateProgress(current => ({ used: [...current.used, feature] }));
}

// Grove: minutes per guide (first 8 characters of the id keep the token small).
export function groveKey(guideId) {
  return String(guideId || '').slice(0, 8);
}

export function addGrowth(guideId, minutes) {
  if (!guideId || !(minutes > 0)) return;
  const key = groveKey(guideId);
  updateProgress(current => ({ grove: { ...current.grove, [key]: Math.round(((current.grove[key] || 0) + minutes) * 10) / 10 } }));
}

export function addRing(guideId) {
  if (!guideId) return 0;
  const key = groveKey(guideId);
  const next = (state.rings[key] || 0) + 1;
  updateProgress(current => ({ rings: { ...current.rings, [key]: next } }));
  return next;
}
