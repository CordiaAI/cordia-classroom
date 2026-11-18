// "Make it yours" (DESIGN-SPEC 3.5, 4.6): how the sheet opens from anywhere, what Search matches it on,
// and the small pieces of sheet logic that are worth testing on their own. No React, no DOM unless asked.
import { ACCENTS, BACKGROUNDS, FONTS, PRESETS, SIZES, resolveTheme, validateSettings } from './themeSettings.mjs';
import { deriveAccent } from './accentMath.mjs';

export const MAKE_IT_YOURS_EVENT = 'cordia:make-it-yours';
export const UNDO_MS = 6000;

// Opens the sheet from anywhere (the account menus, Settings, Search). `returnTo` is the element focus goes
// back to when it closes; without one, whatever has focus when it opens.
export function openMakeItYours(returnTo = null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(MAKE_IT_YOURS_EVENT, { detail: { returnTo } }));
}

// Search finds the sheet by these words, whole (and while one is being typed: its first three letters or more, so
// "the" or "dar" already shows it). A query that only starts with one ("dark matter", "glass transition", "colour
// theory") is class work, not the sheet. Compared without case or extra spaces. Search lists it after the student's
// own matches (components/SearchModal.js).
export const SEARCH_WORDS = ['make it yours', 'theme', 'themes', 'dark mode', 'light mode', 'dark', 'appearance', 'accent', 'colour', 'color', 'background', 'font', 'text size', 'glass'];
export function matchesMakeItYours(query) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (q.length < 3) return false;
  return SEARCH_WORDS.some(word => word.startsWith(q));
}

// Names the sheet shows (sentence case). Presets carry their own label.
export const ACCENT_NAMES = { olive: 'Olive', ocean: 'Ocean', indigo: 'Indigo', clay: 'Clay', rose: 'Rose', plum: 'Plum', graphite: 'Graphite', teal: 'Teal' };
export const BACKGROUND_NAMES = { clouds: 'Clouds', dusk: 'Dusk', paper: 'Paper', meadow: 'Meadow' };
export const FONT_NAMES = { cordia: 'Cordia', clean: 'Clean', bookish: 'Bookish', friendly: 'Friendly', readable: 'Readable' };
export const SIZE_NAMES = { small: 'Small', default: 'Default', large: 'Large', larger: 'Larger' };
export const APPEARANCE_NAMES = { light: 'Light', dark: 'Dark', system: 'Match device' };
export const GLASS_CHOICES = ['frosted', 'clearer', 'solid'];
export const GLASS_NAMES = { frosted: 'Frosted', clearer: 'Clearer', solid: 'Solid' };

// The Glass segment shown as chosen: 'auto' is Frosted, or Solid when the device asks for less transparency;
// a look is always Solid.
export function shownGlass(settings, deviceReducesTransparency = false) {
  const clean = validateSettings(settings);
  if (clean.look !== 'none') return 'solid';
  if (clean.glass === 'auto') return deviceReducesTransparency ? 'solid' : 'frosted';
  return clean.glass;
}

// Picking a Glass segment: the one the device would get anyway is saved as 'auto' (no attribute, so it keeps
// following the device and Reset has nothing to undo); any other is saved as picked.
export function pickGlass(settings, choice, deviceReducesTransparency = false) {
  const clean = validateSettings(settings);
  if (clean.look !== 'none' || !GLASS_CHOICES.includes(choice)) return clean;
  const deviceDefault = deviceReducesTransparency ? 'solid' : 'frosted';
  return validateSettings({ ...clean, glass: choice === deviceDefault ? 'auto' : choice });
}

// The Theme row: the preset tiles, plus "Custom" while the accent or background matches none.
export function themeTiles(settings) {
  const current = resolveTheme(settings);
  const tiles = PRESETS.map(preset => ({ id: preset.id, label: preset.label, accent: preset.accent, bg: preset.bg, look: preset.look || 'none', chosen: current === preset.id }));
  if (current === 'custom') tiles.push({ id: 'custom', label: 'Custom', chosen: true });
  return tiles;
}

// "Adjusted so text stays readable": true when the saved custom accent had to move to stay readable.
export function customAccentAdjusted(settings) {
  const clean = validateSettings(settings);
  if (clean.accent !== 'custom') return false;
  const derived = deriveAccent(clean.customAccent);
  return Boolean(derived && derived.ok && derived.adjusted);
}

// True when two settings objects are the same look (Reset has nothing to do; Undo restores exactly).
export function sameSettings(a, b) {
  const x = validateSettings(a);
  const y = validateSettings(b);
  return Object.keys(x).every(key => x[key] === y[key]);
}

export { ACCENTS, BACKGROUNDS, FONTS, SIZES };
