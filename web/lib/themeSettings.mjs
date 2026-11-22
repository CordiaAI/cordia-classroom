// "Make it yours" settings (DESIGN-SPEC 3.5): the lists, the defaults, validation, and applying a
// settings object to <html>. Plain JS, no React, no colour literals. Every look is a token variant in
// styles/tokens.css; this file only picks which attributes (and, for a custom accent, which runtime
// variables) are on <html>.
import { ACCENT_VARIABLES, accentVariables, deriveAccent, parseHex, toHex } from './accentMath.mjs';

export const ACCENTS = ['olive', 'ocean', 'indigo', 'clay', 'rose', 'plum', 'graphite', 'teal'];
export const BACKGROUNDS = ['clouds', 'dusk', 'paper', 'meadow'];
// "Your photo" needs a private storage bucket Jude has to approve, so it is not a valid choice yet.
export const PHOTO_BACKGROUND_ENABLED = false;
export const FONTS = ['cordia', 'clean', 'bookish', 'friendly', 'readable'];
// The Paper & Clay look's own pair (Source Serif 4, Instrument Sans, JetBrains Mono). It is not one of the
// sheet's five tiles: only that preset selects it by default, and it is a valid value wherever it is saved.
export const LOOK_FONT = 'paper';
// Looks switch more than one setting (DESIGN-SPEC 3.5): 'none' is Cordia; 'paper-clay' is Paper & Clay.
// <html data-look> carries it (styles/tokens.css) because no single accent, background, font or glass
// attribute can express a look that sets all of them and the surface system besides.
export const LOOKS = ['none', 'paper-clay'];
// Paper & Clay's own clay accent (its seeds are set with the look in styles/tokens.css, and it writes no
// data-accent). It is not one of the eight swatches and is a valid accent only while that look is on.
export const LOOK_ACCENT = 'paperclay';
export const SIZES = ['small', 'default', 'large', 'larger'];
export const SIZE_SCALE = { small: 0.9, default: 1, large: 1.125, larger: 1.25 };
export const APPEARANCES = ['light', 'dark', 'system'];
// 'auto' follows the device: frosted, or solid when it asks for less transparency.
export const GLASS_LEVELS = ['auto', 'frosted', 'clearer', 'solid'];

// Each preset is an accent plus a background (DESIGN-SPEC 3.5); the seventh, Paper & Clay, is a full look: it
// also sets the look, the font pair and Solid glass. Cordia is the default.
export const PRESETS = [
  { id: 'cordia', label: 'Cordia', accent: 'olive', bg: 'clouds' },
  { id: 'ocean', label: 'Ocean', accent: 'ocean', bg: 'clouds' },
  { id: 'clay', label: 'Clay', accent: 'clay', bg: 'paper' },
  { id: 'plum', label: 'Plum', accent: 'plum', bg: 'dusk' },
  { id: 'rose', label: 'Rose', accent: 'rose', bg: 'dusk' },
  { id: 'graphite', label: 'Graphite', accent: 'graphite', bg: 'paper' },
  { id: 'paper-clay', label: 'Paper & Clay', accent: LOOK_ACCENT, bg: 'paper', look: 'paper-clay', font: LOOK_FONT, glass: 'solid' },
];

// Which font files a pair needs (preloaded before first paint so a saved pair doesn't flash the
// fallback). Cordia's own pair is loaded for everyone already.
export const FONT_FILES = {
  clean: ['/fonts/inter-latin.woff2'],
  bookish: ['/fonts/fraunces-latin.woff2', '/fonts/source-sans-3-latin.woff2'],
  friendly: ['/fonts/nunito-latin.woff2'],
  readable: ['/fonts/atkinson-hyperlegible-latin-400.woff2', '/fonts/atkinson-hyperlegible-latin-700.woff2'],
  paper: ['/fonts/source-serif-4-latin.woff2', '/fonts/instrument-sans-latin.woff2'], // JetBrains Mono is only for code: fetched when a page shows some
};

// Appearance and the two kinds of account (the owner's decision for DESIGN-SPEC 3.5): an account that existed
// before T10 shipped and never saved an appearance stays on Light, exactly as it always was; only an account
// created after T10 ships defaults to Match device. The account's creation time (Supabase's own `created_at`)
// is compared with this one cut-off. Accounts created at or after it default to Match device; accounts created
// before it, or whose creation time is not known, stay Light.
// This is the moment T10 shipped (pull request 270 merged, 2026-11-18T18:55:05Z, UTC). It is the only place it is set.
export const NEW_ACCOUNT_CUTOFF = '2026-11-18T18:55:05Z';
export const NEW_ACCOUNT_APPEARANCE = 'system';
export const LEGACY_APPEARANCE = 'light';

export const DEFAULT_SETTINGS = Object.freeze({
  accent: 'olive',
  customAccent: null, // '#RRGGBB', only while accent is 'custom'
  bg: 'clouds',
  font: 'cordia',
  size: 'default',
  appearance: LEGACY_APPEARANCE, // what no saved choice means for an existing account; defaultAppearance() decides for a new one
  glass: 'auto',
  look: 'none',
});

// The attribute each setting writes on <html>, and the value that means "default, no attribute".
const ATTRIBUTES = [
  ['accent', 'data-accent', 'olive'],
  ['bg', 'data-bg', 'clouds'],
  ['font', 'data-font', 'cordia'],
  ['size', 'data-size', 'default'],
  ['glass', 'data-glass', 'auto'],
  ['look', 'data-look', 'none'],
];
export const ATTRIBUTE_NAMES = ATTRIBUTES.map(([, attribute]) => attribute);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// A saved settings object of any shape (or none) to a complete, valid one. Unknown values fall back
// to the defaults; unknown keys are dropped; it never throws.
export function validateSettings(raw) {
  try {
    const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const settings = { ...DEFAULT_SETTINGS };
    settings.bg = pick(input.bg, BACKGROUNDS, DEFAULT_SETTINGS.bg);
    settings.look = pick(input.look, LOOKS, DEFAULT_SETTINGS.look);
    settings.font = pick(input.font, [...FONTS, LOOK_FONT], DEFAULT_SETTINGS.font);
    settings.size = pick(input.size, SIZES, DEFAULT_SETTINGS.size);
    settings.appearance = pick(input.appearance, APPEARANCES, DEFAULT_SETTINGS.appearance);
    settings.glass = pick(input.glass, GLASS_LEVELS, DEFAULT_SETTINGS.glass);
    if (input.accent === LOOK_ACCENT) {
      if (settings.look === 'paper-clay') settings.accent = LOOK_ACCENT; // anywhere else it would sit on glass it was not made for
    } else if (input.accent === 'custom') {
      const rgb = parseHex(input.customAccent);
      if (rgb && deriveAccent(toHex(rgb)).ok) {
        settings.accent = 'custom';
        settings.customAccent = toHex(rgb);
      }
    } else {
      settings.accent = pick(input.accent, ACCENTS, DEFAULT_SETTINGS.accent);
    }
    if (settings.look !== 'none') settings.glass = 'solid'; // a look is flat paper: Solid is not a choice while it is on
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// True when `createdAt` (an ISO date-time or a time in ms) is on or after the cut-off. Anything that is not a
// readable time, a missing one included, is not new: when in doubt, Light.
export function isNewAccount(createdAt, cutoff = NEW_ACCOUNT_CUTOFF) {
  const at = typeof createdAt === 'string' ? Date.parse(createdAt) : typeof createdAt === 'number' ? createdAt : NaN;
  const from = Date.parse(cutoff);
  return Number.isFinite(at) && at > 0 && Number.isFinite(from) && at >= from;
}

// The appearance of an account that has never saved one: Match device for a new account, Light otherwise.
export function defaultAppearance(createdAt, cutoff = NEW_ACCOUNT_CUTOFF) {
  return isNewAccount(createdAt, cutoff) ? NEW_ACCOUNT_APPEARANCE : LEGACY_APPEARANCE;
}

// The default look for this account (what Reset to Cordia must save, rather than DEFAULT_SETTINGS, so it
// never moves an existing student to Match device).
export function defaultSettingsFor(createdAt, cutoff = NEW_ACCOUNT_CUTOFF) {
  return { ...DEFAULT_SETTINGS, appearance: defaultAppearance(createdAt, cutoff) };
}

// True when a saved settings value (object or JSON string) carries a valid appearance of its own.
export function hasSavedAppearance(raw) {
  try {
    const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Boolean(source && typeof source === 'object' && APPEARANCES.includes(source.appearance));
  } catch {
    return false;
  }
}

// validateSettings for a signed-in account: a saved appearance (Light, Dark or Match device) is kept as it is;
// with none saved, the account's own default applies (see NEW_ACCOUNT_CUTOFF).
export function accountSettings(raw, createdAt, cutoff = NEW_ACCOUNT_CUTOFF) {
  const settings = validateSettings(raw);
  if (!hasSavedAppearance(raw)) settings.appearance = defaultAppearance(createdAt, cutoff);
  return settings;
}

// True when every setting is the default (appearance included).
export function isDefaultSettings(settings) {
  const clean = validateSettings(settings);
  return Object.keys(DEFAULT_SETTINGS).every(key => clean[key] === DEFAULT_SETTINGS[key]);
}

// "Cordia", "Ocean" ... "Paper & Clay", or 'custom' when the accent and background are no preset's (a preset
// that is a look also needs that look on). The font and glass never decide it: the student may change the
// font after picking Paper & Clay, and glass is not theirs to change while a look is on.
export function resolveTheme(settings) {
  const clean = validateSettings(settings);
  const match = PRESETS.find(preset => preset.accent === clean.accent && preset.bg === clean.bg && (preset.look || 'none') === clean.look);
  return match ? match.id : 'custom';
}

// Picking a preset sets its accent and background; the other settings stay as they are. A full look also
// sets the look, its font pair and Solid glass; leaving a look puts back the glass it forced and, if the
// student kept the look's own font pair, the default pair.
export function applyPreset(settings, presetId) {
  const clean = validateSettings(settings);
  const preset = PRESETS.find(item => item.id === presetId);
  if (!preset) return clean;
  const next = { ...clean, accent: preset.accent, customAccent: null, bg: preset.bg, look: preset.look || 'none' };
  if (preset.look) {
    next.font = preset.font;
    next.glass = preset.glass;
  } else if (clean.look !== 'none') {
    if (next.font === LOOK_FONT) next.font = DEFAULT_SETTINGS.font;
    next.glass = DEFAULT_SETTINGS.glass;
  }
  return validateSettings(next);
}

// Picking a custom colour: the settings with that accent, plus what the sheet needs to show:
// whether Cordia had to adjust it ("Adjusted so text stays readable") and the colour it used.
export function withCustomAccent(settings, hex) {
  const derived = deriveAccent(hex);
  if (!derived.ok) return { settings: validateSettings(settings), adjusted: false, derived };
  const next = validateSettings({ ...validateSettings(settings), accent: 'custom', customAccent: toHex(derived.pick) });
  return { settings: next, adjusted: derived.adjusted, derived };
}

// The attributes for a settings object: { 'data-accent': 'ocean' | null, ... }. null = remove.
export function attributesFor(settings) {
  const clean = validateSettings(settings);
  const out = {};
  for (const [key, attribute, fallback] of ATTRIBUTES) out[attribute] = clean[key] === fallback ? null : clean[key];
  // A look supplies its own accent, background and font pair when those attributes are absent, so while it
  // is on: its own values write nothing, and a student's pick of what would otherwise be the default
  // (Olive, Clouds, the Cordia pair) is written out so it shows over the look.
  if (clean.look === 'paper-clay') {
    if (clean.accent === LOOK_ACCENT) out['data-accent'] = null; else if (clean.accent === 'olive') out['data-accent'] = 'olive';
    if (clean.bg === 'paper') out['data-bg'] = null; else if (clean.bg === 'clouds') out['data-bg'] = 'clouds';
    if (clean.font === LOOK_FONT) out['data-font'] = null; else if (clean.font === 'cordia') out['data-font'] = 'cordia';
  }
  return out;
}

// 'light' or 'dark'. Only Match device follows the device; anything unrecognised is Light.
export function resolveAppearance(appearance, deviceIsDark = false) {
  if (appearance === 'dark') return 'dark';
  if (appearance === 'system') return deviceIsDark ? 'dark' : 'light';
  return 'light';
}

// The runtime variables a custom accent writes ({} for any other accent).
export function customAccentVariables(settings) {
  const clean = validateSettings(settings);
  return clean.accent === 'custom' ? accentVariables(deriveAccent(clean.customAccent)) : {};
}

// What the first-paint script needs, so it can apply the saved look with no maths: the attributes
// that are set, the appearance, the custom accent's variables and the font files to preload.
export function bootCache(settings) {
  const clean = validateSettings(settings);
  const attributes = {};
  for (const [attribute, value] of Object.entries(attributesFor(clean))) if (value) attributes[attribute] = value;
  return { s: clean, a: attributes, ap: clean.appearance, v: customAccentVariables(clean), f: FONT_FILES[clean.font] || [] };
}

// Puts a look on <html>: sets or removes the data attributes, writes (or clears) the custom accent's
// variables, and sets data-theme from the appearance. `publicPage` pages are always the Cordia
// default in light, whatever was saved. Returns what it applied.
export function applySettings(settings, { root, deviceIsDark = false, publicPage = false, keepSize = false } = {}) {
  const target = root || (typeof document !== 'undefined' ? document.documentElement : null);
  // A public page keeps the student's text size when it is asked to (`keepSize`): that is for reading, not looks.
  const clean = publicPage ? { ...DEFAULT_SETTINGS, appearance: 'light', ...(keepSize ? { size: validateSettings(settings).size } : {}) } : validateSettings(settings);
  const attributes = attributesFor(clean);
  const variables = customAccentVariables(clean);
  const theme = resolveAppearance(clean.appearance, deviceIsDark);
  if (target) {
    for (const [attribute, value] of Object.entries(attributes)) {
      if (value) { if (target.getAttribute(attribute) !== value) target.setAttribute(attribute, value); } else target.removeAttribute(attribute);
    }
    for (const name of ACCENT_VARIABLES) {
      if (variables[name]) target.style.setProperty(name, variables[name]); else target.style.removeProperty(name);
    }
    if (target.getAttribute('data-theme') !== theme) target.setAttribute('data-theme', theme);
  }
  return { settings: clean, attributes, variables, theme };
}
