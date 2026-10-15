import { getProgress, updateProgress } from './progress';

// Theme: 'system' (default), 'light' or 'dark'. The account is the source of truth
// (progress.theme, saved in Supabase user metadata); localStorage is a cache read
// before first paint (pages/_document.js). Nothing else may change it.
const KEY = 'theme';

export function themePreference() {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function resolvedTheme(preference = themePreference()) {
  if (preference !== 'system') return preference;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference = themePreference(), forceLight = false) {
  if (typeof document === 'undefined') return;
  const next = forceLight ? 'light' : resolvedTheme(preference);
  if (document.documentElement.getAttribute('data-theme') !== next) document.documentElement.setAttribute('data-theme', next);
}

function cache(preference) {
  try { localStorage.setItem(KEY, preference); } catch { /* storage blocked */ }
}

export function setThemePreference(preference) {
  cache(preference);
  updateProgress(() => ({ theme: preference }));
  applyTheme(preference);
}

// After the account loads: the saved choice wins over the cache.
export function syncThemeFromAccount(forceLight = false) {
  const saved = getProgress().theme;
  if ((saved === 'system' || saved === 'light' || saved === 'dark') && saved !== themePreference()) {
    cache(saved);
    applyTheme(saved, forceLight);
  }
}
