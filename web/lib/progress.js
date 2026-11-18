import { useEffect, useState } from 'react';
import { getToken, getUserId } from './api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase';

// Walkthrough, feature-use and Grove progress, saved per student on the server in
// their Supabase account metadata (key "cordia"), with a local copy for speed and
// offline use. It rides in the access token, so it stays small (no logs here).
const EMPTY = { v: 1, at: 0, theme: null, look: null, wt: null, day1Status: null, done: [], used: [], tips: [], grove: {}, rings: {}, freeze: [], first: 0, review: null, storeLine: 0, prefs: {} };
const LOCAL = 'cordiaProgress';
// When this account was created: Supabase's own `created_at`, read with the account below and kept on this device,
// one value per account under its own key (named like the progress copy), so the look can tell an existing account
// from a new one before the network answers (lib/theme.js, lib/themeSettings.mjs NEW_ACCOUNT_CUTOFF). The value is
// the creation time alone: no user id is stored in it. Not part of `state`: it is not ours to write and it must not
// ride in the token. ACCOUNT_OLD held { id, created } in one shared slot; it is read once to carry the time over,
// then removed.
const ACCOUNT = 'cordiaAccount';
const ACCOUNT_OLD = 'cordiaAccount';
let state = { ...EMPTY };
let loadedFor = '';
// The account whose server copy has answered (or failed to) at least once on this page.
let readFor = '';
let saveTimer = null;
const listeners = new Set();

function localKey() {
  const id = getUserId();
  return id ? `${LOCAL}:${id}` : '';
}

function accountKey() {
  const id = getUserId();
  return id ? `${ACCOUNT}:${id}` : '';
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
    // The "Make it yours" settings (lib/themeSettings.mjs): one small object, from whichever copy changed last.
    look: newer?.look ?? a?.look ?? b?.look ?? null,
    day1Status: a?.day1Status || b?.day1Status || null,
    done: union(a?.done, b?.done),
    used: union(a?.used, b?.used),
    tips: union(a?.tips, b?.tips),
    grove: maxMap(a?.grove, b?.grove),
    rings: maxMap(a?.rings, b?.rings),
    freeze: union(a?.freeze, b?.freeze).slice(-12),
    first: Math.min(...[a?.first, b?.first].filter(Boolean), Date.now()),
    // Study settings ({ feedback: { quiz, timed }, print }): each one from whichever copy changed last.
    prefs: { ...(a?.prefs || {}), ...(b?.prefs || {}), ...(newer?.prefs || {}) },
    // The review prompt: { asked, next, rated }. Once rated on any device it never shows again.
    review: (a?.review?.rated && a.review) || (b?.review?.rated && b.review) || newer?.review || a?.review || b?.review || null,
    // When the Chrome Web Store review line was shown (components/StoreReviewLine.js). Once shown on
    // any device, never again.
    storeLine: Math.max(a?.storeLine || 0, b?.storeLine || 0),
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

// The signed-in account's creation time as an ISO string, or '' when it is not known yet (never loaded on this
// device, or another account's copy). Unknown is treated as an existing account.
export function accountCreatedAt() {
  const key = accountKey();
  if (!key) return '';
  try {
    const saved = localStorage.getItem(key);
    if (typeof saved === 'string' && saved) return saved;
    return carryOverOldCopy(key);
  } catch {
    return '';
  }
}

// A device that already holds the old shared copy ({ id, created }) keeps the creation time it knew for the
// signed-in account, so a new account is not shown Light until the network answers. The old key is removed.
function carryOverOldCopy(key) {
  let created = '';
  try {
    const old = JSON.parse(localStorage.getItem(ACCOUNT_OLD) || 'null');
    if (old && old.id === getUserId() && typeof old.created === 'string') created = old.created;
    localStorage.removeItem(ACCOUNT_OLD);
    if (created) localStorage.setItem(key, created);
  } catch { /* storage blocked */ }
  return created;
}

// True once the signed-in account's own copy on this device is read (a look saved here is known from then on).
export function progressLoaded() {
  const key = localKey();
  return Boolean(key) && loadedFor === key;
}

// True once the account's server copy has answered (or failed) on this page: only then can "no saved look" be
// believed. lib/theme.js waits for it before it gives an account the default look.
export function progressRead() {
  const key = localKey();
  return Boolean(key) && readFor === key;
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
  readFor = key;
  const server = user?.user_metadata?.cordia;
  const id = getUserId();
  const createdKey = accountKey();
  let created = false;
  if (id && createdKey && typeof user?.created_at === 'string' && user.created_at && (!user.id || user.id === id) && accountCreatedAt() !== user.created_at) {
    try { localStorage.setItem(createdKey, user.created_at); created = true; } catch {}
  }
  if (server) {
    state = merge(state, server);
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  } else if (created || !state.look) {
    state = { ...state }; // a new object, so the look re-reads the account it now knows (or knows has no saved look)
  }
  if (server || created || !state.look) publish();
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

// Clears a tick that was set without real use (older builds ticked Calendar on opening the page).
export function unmarkUsed(feature) {
  if (!feature || !state.used.includes(feature)) return;
  updateProgress(current => ({ used: current.used.filter(item => item !== feature) }));
}

export function markUsed(feature) {
  if (!feature || state.used.includes(feature)) return;
  updateProgress(current => ({ used: [...current.used, feature] }));
}

// A study setting saved on the account (and in this browser): the "Show if I'm right" choice per
// mode, the last printable-quiz format. Small values only: the whole state rides in the token.
export function getPref(key, fallback) {
  const value = state.prefs?.[key];
  return value === undefined ? fallback : value;
}

export function setPref(key, value) {
  updateProgress(current => ({ prefs: { ...(current.prefs || {}), [key]: value } }));
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
