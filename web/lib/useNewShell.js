import { useLayoutEffect, useSyncExternalStore } from 'react';
import { HOME_ROUTE, WIDE_QUERY, builtSetting, readIdentity, shellOnFor } from './newShell.mjs';

// The new shell in the browser (rules: lib/newShell.mjs). The switch is per account; the shell
// itself only shows from 768px up, so phones keep today's layout and navigation.
const SETTING = builtSetting(process.env.NEXT_PUBLIC_NEW_SHELL);
const CHANGED = 'cordia:shell';

// Is the switch on for whoever is signed in on this browser?
export function shellFlag() {
  if (typeof window === 'undefined') return false;
  let storage = null;
  try { storage = window.localStorage; } catch { return SETTING.all; }
  return shellOnFor(SETTING, readIdentity(storage));
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
  return active;
}
