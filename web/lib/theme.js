import { USE_CASES, useCasePath } from './useCases/index.mjs';
import { getProgress, updateProgress } from './progress';

// Theme: 'light' (default) or 'dark'. The account is the one source of truth
// (progress.theme, saved in Supabase user metadata); localStorage is only a cache read
// before first paint (pages/_document.js). Nothing else may change the theme.
const KEY = 'theme';
export const LIGHT_ONLY = ['/', '/login', '/signup', '/pricing', '/reset-password'];

export function themePreference() {
  if (typeof window === 'undefined') return 'light';
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Public pages stay light; Pricing and the policy pages follow the account's theme when signed in.
// Use-case pages (lib/useCases/) are public reading pages too.
export const LIGHT_WHEN_SIGNED_OUT = ['/pricing', '/privacy', '/terms', '/honor-code', '/mission', '/connect/claude', ...USE_CASES.map(useCasePath)];
export function isLightOnly(pathname) {
  if (LIGHT_WHEN_SIGNED_OUT.includes(pathname)) {
    try { return !localStorage.getItem('authToken'); } catch { return true; }
  }
  // Printed pages are always paper white.
  return LIGHT_ONLY.includes(pathname) || pathname.startsWith('/print/');
}

export function applyTheme(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (typeof document === 'undefined') return;
  const next = isLightOnly(pathname) ? 'light' : themePreference();
  if (document.documentElement.getAttribute('data-theme') !== next) document.documentElement.setAttribute('data-theme', next);
}

function cache(preference) {
  try { localStorage.setItem(KEY, preference); } catch { /* storage blocked */ }
}

export function setThemePreference(preference) {
  const next = preference === 'dark' ? 'dark' : 'light';
  cache(next);
  updateProgress(() => ({ theme: next }));
  applyTheme();
}

// After the account loads, its saved choice replaces the cache.
export function syncThemeFromAccount() {
  const saved = getProgress().theme;
  if ((saved === 'light' || saved === 'dark') && saved !== themePreference()) {
    cache(saved);
    applyTheme();
  }
}
