import { USE_CASES, useCasePath } from './useCases/index.mjs';
import { COMPARISONS, comparisonPath } from './comparisons/index.mjs';
import { getProgress, updateProgress } from './progress';
import { applySettings, bootCache, resolveAppearance, validateSettings } from './themeSettings.mjs';
import { LOOK_KEY } from './themeBoot.mjs';

// The look: light/dark and every "Make it yours" setting (lib/themeSettings.mjs). The account is the
// one source of truth (progress.look, saved in Supabase user metadata next to the old progress.theme,
// so it follows the student to every device and needs no new table); localStorage is only a cache
// read before first paint (pages/_document.js runs lib/themeBoot.mjs). Nothing else may change it.
// Public pages stay the Cordia default in light whatever is saved.
const KEY = 'theme'; // the old light/dark choice, still written so older tabs and devices agree
const DEVICE_DARK = '(prefers-color-scheme: dark)';
export const LIGHT_ONLY = ['/', '/login', '/signup', '/pricing', '/reset-password'];

function deviceIsDark() {
  try { return typeof window !== 'undefined' && Boolean(window.matchMedia) && window.matchMedia(DEVICE_DARK).matches; } catch { return false; }
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); } catch { return null; }
}

function legacyTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    return null;
  }
}

// The saved look as a complete, valid settings object. Before the first look is saved, the old
// light/dark choice carries over; with neither, appearance is Match device.
export function lookSettings() {
  const cached = readCache()?.s;
  const base = cached && typeof cached === 'object' ? cached : {};
  return validateSettings(base.appearance ? base : { ...base, appearance: legacyTheme() || undefined });
}

// 'light' or 'dark', as drawn right now (Match device resolved).
export function themePreference() {
  if (typeof window === 'undefined') return 'light';
  return resolveAppearance(lookSettings().appearance, deviceIsDark());
}

// Public pages stay light; Pricing and the policy pages follow the account's theme when signed in.
// Use-case pages (lib/useCases/) are public reading pages too.
// So are the guides (/guides and /guides/[slug], the route pattern _app.js passes).
export const LIGHT_WHEN_SIGNED_OUT = ['/pricing', '/privacy', '/terms', '/honor-code', '/mission', '/connect/claude', '/guides', '/guides/[slug]', ...USE_CASES.map(useCasePath), ...COMPARISONS.map(comparisonPath)];
export function isLightOnly(pathname) {
  if (LIGHT_WHEN_SIGNED_OUT.includes(pathname)) {
    try { return !localStorage.getItem('authToken'); } catch { return true; }
  }
  // Printed pages are always paper white.
  return LIGHT_ONLY.includes(pathname) || pathname.startsWith('/print/');
}

let lastPath = '/';
let watching = false;
// Match device follows the device while the app is open.
function watchDevice() {
  if (watching || typeof window === 'undefined' || !window.matchMedia) return;
  watching = true;
  try { window.matchMedia(DEVICE_DARK).addEventListener('change', () => applyTheme(lastPath)); } catch { /* no change events */ }
}

export function applyTheme(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (typeof document === 'undefined') return;
  lastPath = pathname;
  applySettings(lookSettings(), { deviceIsDark: deviceIsDark(), publicPage: isLightOnly(pathname) });
  watchDevice();
}

function cache(settings) {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(bootCache(settings))); } catch { /* storage blocked */ }
}

// Saves a look (any shape; it is validated) on this device and on the account, and applies it.
// The account save is the same quiet, delayed one progress uses; if it fails the device copy stays.
export function saveLook(next) {
  const settings = validateSettings(next);
  cache(settings);
  const explicit = settings.appearance === 'system' ? null : settings.appearance;
  if (explicit) { try { localStorage.setItem(KEY, explicit); } catch { /* storage blocked */ } }
  updateProgress(() => (explicit ? { look: settings, theme: explicit } : { look: settings }));
  applyTheme(lastPath);
  return settings;
}

// The old light/dark control: just the appearance of the look.
export function setThemePreference(preference) {
  saveLook({ ...lookSettings(), appearance: preference === 'dark' ? 'dark' : 'light' });
}

// After the account loads, its saved look replaces the cache (an account with only the old
// light/dark choice carries that over).
export function syncThemeFromAccount() {
  const progress = getProgress();
  if (progress.look) {
    const saved = validateSettings(progress.look);
    if (JSON.stringify(saved) !== JSON.stringify(lookSettings())) { cache(saved); applyTheme(lastPath); }
    return;
  }
  const saved = progress.theme;
  if ((saved === 'light' || saved === 'dark') && !readCache()?.s?.appearance && saved !== themePreference()) {
    cache({ ...lookSettings(), appearance: saved });
    applyTheme(lastPath);
  }
}
