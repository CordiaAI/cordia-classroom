import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { getToken, getUserId, tryRefreshToken } from './api';
import { HOME_ROUTE, SHELL_ENDPOINT, WIDE_QUERY, cachedShell, rememberShell, shellOn } from './newShell.mjs';

// The new shell in the browser (rules: lib/newShell.mjs). The server decides per account
// (/api/new-shell); this browser keeps the answer for the signed-in account. The shell itself only
// shows from 768px up, so phones keep today's layout and navigation.
const CHANGED = 'cordia:shell';
// A fresh sign-in waits up to LANDING_WAIT_MS for the answer before choosing where to land; the
// answer is still kept when it comes later (up to ASK_TIMEOUT_MS).
const LANDING_WAIT_MS = 4000;
const ASK_TIMEOUT_MS = 15000;

// What the page knew from the server's environment before anyone signed in (the boot script in
// pages/_document.js leaves it here): { fixed } in development, { guess } on a preview deployment.
const pageDefault = () => (typeof window !== 'undefined' && window.__cordiaShell) || {};
const decidedByPage = () => typeof pageDefault().fixed === 'boolean';

function storage() {
  try { return window.localStorage; } catch { return null; }
}

// Is the switch on for whoever is signed in on this browser, from what it knows now?
export function shellFlag() {
  if (typeof window === 'undefined') return false;
  const store = storage();
  let cached = null;
  try { cached = store ? cachedShell(store, getUserId()) : null; } catch { /* storage blocked */ }
  return shellOn(pageDefault(), cached);
}

// The new shell is showing: the switch is on and the window is at least 768px wide.
export function shellActive() {
  return shellFlag() && window.matchMedia(WIDE_QUERY).matches;
}

// Where a signed-in student lands: the chat home in the new shell, the Dashboard otherwise.
export function homeRoute() {
  return typeof window !== 'undefined' && shellActive() ? HOME_ROUTE : '/dashboard';
}

// Keeps <html data-shell> in step with the switch after sign-in or a change of account (the boot
// script in pages/_document.js sets it before the first paint of every full page load).
export function syncShellAttribute() {
  if (typeof document === 'undefined') return;
  if (shellFlag()) document.documentElement.setAttribute('data-shell', 'new');
  else document.documentElement.removeAttribute('data-shell');
}

export function shellChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

function ask(token, signal) {
  return fetch(SHELL_ENDPOINT, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
}

// Asks the server whether the switch is on for the signed-in account and keeps the answer on this
// device for that account. Resolves to shellFlag() afterwards. Only a verified answer (200) is kept:
// a signed-out or unchecked call (401, 503, offline, too slow) leaves what the device knew.
let asking = null;
// Once per page load, ask again in the background (useNewShell), so a change on the server reaches
// this device; a page load that already has a fresh answer (a sign-in just asked) skips it.
let checkedThisLoad = false;
export function refreshShell() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (decidedByPage()) return Promise.resolve(shellFlag());
  if (asking) return asking;
  const userId = getUserId();
  if (!getToken() || !userId) return Promise.resolve(shellFlag());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  asking = (async () => {
    try {
      let response = await ask(getToken(), controller.signal);
      if (response.status === 401 && await tryRefreshToken()) response = await ask(getToken(), controller.signal);
      const body = response.ok ? await response.json() : null;
      if (typeof body?.newShell === 'boolean' && getUserId() === userId) {
        checkedThisLoad = true;
        const store = storage();
        if (store) rememberShell(store, userId, body.newShell);
        shellChanged();
      }
    } catch { /* offline or too slow: keep what this device knew */ }
    clearTimeout(timer);
    asking = null;
    return shellFlag();
  })();
  return asking;
}

// The landing route after a fresh sign-in: asks first, so a listed account lands on the home and
// any other on the Dashboard, and neither shell shows before the other.
export async function landingRoute() {
  await Promise.race([refreshShell(), new Promise(resolve => setTimeout(resolve, LANDING_WAIT_MS))]);
  return homeRoute();
}

function subscribe(onChange) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

// true or false in the browser; null while the server renders and while the page hydrates (the
// server can't know who is signed in, so it renders today's navigation and the stylesheet hides
// it for anyone on the new shell until this turns true, before the next paint).
export function useNewShell() {
  const active = useSyncExternalStore(subscribe, shellActive, () => null);
  useLayoutEffect(() => { if (active !== null) syncShellAttribute(); }, [active]);
  useEffect(() => {
    if (checkedThisLoad) return;
    checkedThisLoad = true;
    refreshShell();
  }, []);
  return active;
}
