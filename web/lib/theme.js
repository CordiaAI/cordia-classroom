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

// Public pages stay light, except Pricing for a signed-in student (it shows the app nav).
export function isLightOnly(pathname) {
  if (pathname === '/pricing') {
    try { return !localStorage.getItem('authToken'); } catch { return true; }
  }
  return LIGHT_ONLY.includes(pathname);
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
