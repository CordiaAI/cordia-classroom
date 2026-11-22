import { USE_CASES, useCasePath } from './useCases/index.mjs';
import { COMPARISONS, comparisonPath } from './comparisons/index.mjs';
import { getUserId } from './api';
import { accountCreatedAt, getProgress, progressLoaded, progressRead, updateProgress } from './progress';
import { DEFAULT_SETTINGS, accountSettings, applySettings, bootCache, defaultAppearance, defaultSettingsFor, resolveAppearance } from './themeSettings.mjs';
import { KEEPS_SIZE, LOOK_KEY, lookKeyFor } from './themeBoot.mjs';
import { SKY_FADE_MS, skyFor, skyPeriod } from './skyTime.mjs';

// The look: light/dark and every "Make it yours" setting (lib/themeSettings.mjs). The account is the
// one source of truth (progress.look, saved in Supabase user metadata next to the old progress.theme,
// so it follows the student to every device and needs no new table); localStorage is only a cache
// read before first paint (pages/_document.js runs lib/themeBoot.mjs). Nothing else may change it.
// Public pages stay the Cordia default in light whatever is saved (the student's text size stays on /pricing).
const KEY = 'theme'; // the old light/dark choice, still written so older tabs and devices agree
const DEVICE_DARK = '(prefers-color-scheme: dark)';
const LESS_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';
const LESS_MOTION = '(prefers-reduced-motion: reduce)';
export const LIGHT_ONLY = ['/', '/login', '/signup', '/pricing', '/reset-password'];

function deviceMatches(query) {
  try { return typeof window !== 'undefined' && Boolean(window.matchMedia) && window.matchMedia(query).matches; } catch { return false; }
}
function deviceIsDark() {
  return deviceMatches(DEVICE_DARK);
}
// Glass is solid on a browser that can't frost, so the sky stays put there too (lib/skyTime.mjs skyActive).
function deviceCanFrost() {
  try { return typeof CSS === 'undefined' || !CSS.supports || CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'); } catch { return true; }
}
// The time-of-day sky to draw for these settings now (null when it does not follow the time).
function skyNow(settings) {
  return skyFor(settings, { period: skyPeriod(new Date()), reducedTransparency: deviceMatches(LESS_TRANSPARENCY), canFrost: deviceCanFrost() });
}

// The device cache is one small value per account, under "cordiaLook:<user id>" (lib/themeBoot.mjs): the id is
// in the key and never in the value, so a shared browser holds each account's look apart and another account's
// is simply not there to read. Sign-out removes every one of them (lib/api.js clearAuth). A cache written before
// that (one shared "cordiaLook", stamped `u` once the account was known) is carried over once for the account
// that has none yet, unless it names another account, then removed.
function carryOverOldLook(key) {
  try {
    const old = localStorage.getItem(LOOK_KEY);
    if (old === null) return null;
    localStorage.removeItem(LOOK_KEY);
    const raw = JSON.parse(old);
    if (!raw || typeof raw !== 'object' || (typeof raw.u === 'string' && raw.u && raw.u !== getUserId()) || !raw.s || typeof raw.s !== 'object') return null;
    const carried = bootCache(raw.s); // rebuilt from the settings alone: nothing else of the old value is kept
    localStorage.setItem(key, JSON.stringify(carried));
    return carried;
  } catch {
    return null;
  }
}
function rawCache() {
  const key = lookKeyFor(getUserId());
  if (!key) return null;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return JSON.parse(saved);
  } catch {
    return null;
  }
  return carryOverOldLook(key);
}
function readCache() {
  return rawCache();
}

// True when this browser holds another account's look. The old light/dark key is shared by every account, so
// while another account's look is here it is that account's, not this one's.
function otherLooksHere() {
  const mine = lookKeyFor(getUserId());
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${LOOK_KEY}:`) && key !== mine) return true;
    }
  } catch { /* storage blocked */ }
  return false;
}

function legacyTheme() {
  if (otherLooksHere()) return null;
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    return null;
  }
}

// The saved look as a complete, valid settings object. Before the first look is saved, the old
// light/dark choice carries over; with neither, appearance is the account's default: Match device for an
// account created after T10 shipped, Light for every other one, and for one not yet known
// (NEW_ACCOUNT_CUTOFF in themeSettings.mjs).
export function lookSettings() {
  const cached = readCache()?.s;
  const base = cached && typeof cached === 'object' ? cached : {};
  return accountSettings(base.appearance ? base : { ...base, appearance: legacyTheme() || undefined }, accountCreatedAt());
}

// The default look for this account, for Reset to Cordia: saving DEFAULT_SETTINGS instead would move an
// existing student to Match device.
export function defaultLook() {
  return defaultSettingsFor(accountCreatedAt());
}

// 'light' or 'dark', as drawn right now (Match device resolved).
export function themePreference() {
  if (typeof window === 'undefined') return 'light';
  return resolveAppearance(lookSettings().appearance, deviceIsDark());
}

// Public pages stay light; the policy pages follow the account's theme when signed in. Pricing is in
// LIGHT_ONLY: it is the Cordia default in light for everyone, signed in or not.
// Use-case pages (lib/useCases/) are public reading pages too.
// So are the guides (/guides and /guides/[slug], the route pattern _app.js passes).
export const LIGHT_WHEN_SIGNED_OUT = ['/privacy', '/terms', '/honor-code', '/mission', '/connect/claude', '/guides', '/guides/[slug]', ...USE_CASES.map(useCasePath), ...COMPARISONS.map(comparisonPath)];
export function isLightOnly(pathname) {
  if (LIGHT_WHEN_SIGNED_OUT.includes(pathname)) {
    try { return !localStorage.getItem('authToken'); } catch { return true; }
  }
  // Printed pages are always paper white.
  return LIGHT_ONLY.includes(pathname) || pathname.startsWith('/print/');
}

let lastPath = '/';
let watching = false;
// Match device follows the device while the app is open, and the sky stops following the time as soon as the
// device asks for less transparency.
function watchDevice() {
  if (watching || typeof window === 'undefined' || !window.matchMedia) return;
  watching = true;
  for (const query of [DEVICE_DARK, LESS_TRANSPARENCY]) {
    try { window.matchMedia(query).addEventListener('change', () => applyTheme(lastPath)); } catch { /* no change events */ }
  }
}

export function applyTheme(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (typeof document === 'undefined') return;
  lastPath = pathname;
  const settings = lookSettings();
  applySettings(settings, { deviceIsDark: deviceIsDark(), publicPage: isLightOnly(pathname), keepSize: KEEPS_SIZE.includes(pathname), sky: skyNow(settings) });
  watchDevice();
  watchSky();
}

// The sky follows the device's clock while the page is open. Once a minute, and whenever the page comes back into
// view, it checks the period; when it has moved on, the new sky crossfades in over SKY_FADE_MS (styles/tokens.css,
// <html data-sky-fade>), at most once per period, and at once under reduced motion. While it fades, data-sky-from
// keeps the period it left, so the glass it needed stays until the old sky has gone (tokens.css, the night glass).
// Every other change (a pick in Make it yours, first paint, a new page) is instant.
let skyWatching = false;
let fadeTimer = 0;
let lastFade = null;
function checkSky() {
  if (typeof document === 'undefined' || document.hidden) return;
  const root = document.documentElement;
  const shown = root.getAttribute('data-sky');
  const next = isLightOnly(lastPath) ? null : skyNow(lookSettings());
  if (!shown || !next || shown === next) return;
  if (lastFade !== next && !deviceMatches(LESS_MOTION)) {
    lastFade = next;
    clearTimeout(fadeTimer);
    root.setAttribute('data-sky-from', shown);
    root.setAttribute('data-sky-fade', '');
    fadeTimer = setTimeout(() => { root.removeAttribute('data-sky-fade'); root.removeAttribute('data-sky-from'); }, SKY_FADE_MS + 100);
  }
  holdTransitions(); // a Match device page may turn dark with the night: every colour swaps at once
  applyTheme(lastPath);
}
function watchSky() {
  if (skyWatching || typeof window === 'undefined' || typeof document.addEventListener !== 'function') return;
  skyWatching = true;
  setInterval(checkSky, 60000);
  document.addEventListener('visibilitychange', checkSky);
}

// A look change swaps every colour at once: for two frames nothing on the page transitions, so parts with
// their own colour transition don't fade in one by one behind the rest (styles/system.css, .is-restyling).
function holdTransitions() {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  const root = document.documentElement;
  root.classList.add('is-restyling');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('is-restyling')));
}

function cache(settings) {
  const key = lookKeyFor(getUserId());
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(bootCache(settings))); } catch { /* storage blocked */ }
}

// Saves a look (any shape; it is validated) on this device and on the account, and applies it.
// The account save is the same quiet, delayed one progress uses; if it fails the device copy stays.
export function saveLook(next) {
  const settings = accountSettings(next, accountCreatedAt());
  holdTransitions();
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
// light/dark choice carries that over). An account with no saved look gets its own default look, cached on this
// device so first paint has it from then on: Light for an existing account, Match device for a new one, and every
// other setting at its default, so the previous account's theme, accent, font, text size and glass never carry
// over on a shared browser. Until the account's own copy on this device is read nothing changes (the progress in
// memory may still be the previous account's). A look found there is applied at once; "no saved look" is only
// believed once the server has answered, since the saved copy may be on the way, and until the account's creation
// time is known the appearance stays as it is (Light when there is no cache), so a student is never moved on a guess.
export function syncThemeFromAccount() {
  if (!progressLoaded()) return;
  const progress = getProgress();
  const created = accountCreatedAt();
  if (progress.look) {
    const saved = accountSettings(progress.look, created);
    if (JSON.stringify(saved) !== JSON.stringify(lookSettings()) || !rawCache()) { cache(saved); applyTheme(lastPath); }
    return;
  }
  if (!progressRead()) return;
  const explicit = progress.theme === 'light' || progress.theme === 'dark' ? progress.theme : null;
  const appearance = explicit || (created ? defaultAppearance(created) : lookSettings().appearance);
  const next = bootCache({ ...DEFAULT_SETTINGS, appearance });
  if (JSON.stringify(readCache()?.s) === JSON.stringify(next.s)) return;
  cache(next.s);
  applyTheme(lastPath);
}
