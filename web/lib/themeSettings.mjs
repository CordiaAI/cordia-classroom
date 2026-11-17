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
export const SIZES = ['small', 'default', 'large', 'larger'];
export const SIZE_SCALE = { small: 0.9, default: 1, large: 1.125, larger: 1.25 };
export const APPEARANCES = ['light', 'dark', 'system'];
// 'auto' follows the device: frosted, or solid when it asks for less transparency.
export const GLASS_LEVELS = ['auto', 'frosted', 'clearer', 'solid'];

// Each preset is an accent plus a background (DESIGN-SPEC 3.5). Cordia is the default.
export const PRESETS = [
  { id: 'cordia', label: 'Cordia', accent: 'olive', bg: 'clouds' },
  { id: 'ocean', label: 'Ocean', accent: 'ocean', bg: 'clouds' },
  { id: 'clay', label: 'Clay', accent: 'clay', bg: 'paper' },
  { id: 'plum', label: 'Plum', accent: 'plum', bg: 'dusk' },
  { id: 'rose', label: 'Rose', accent: 'rose', bg: 'dusk' },
  { id: 'graphite', label: 'Graphite', accent: 'graphite', bg: 'paper' },
];

// Which font files a pair needs (preloaded before first paint so a saved pair doesn't flash the
// fallback). Cordia's own pair is loaded for everyone already.
export const FONT_FILES = {
  clean: ['/fonts/inter-latin.woff2'],
  bookish: ['/fonts/fraunces-latin.woff2', '/fonts/source-sans-3-latin.woff2'],
  friendly: ['/fonts/nunito-latin.woff2'],
  readable: ['/fonts/atkinson-hyperlegible-latin-400.woff2', '/fonts/atkinson-hyperlegible-latin-700.woff2'],
};

export const DEFAULT_SETTINGS = Object.freeze({
  accent: 'olive',
  customAccent: null, // '#RRGGBB', only while accent is 'custom'
  bg: 'clouds',
  font: 'cordia',
  size: 'default',
  appearance: 'system',
  glass: 'auto',
});

// The attribute each setting writes on <html>, and the value that means "default, no attribute".
const ATTRIBUTES = [
  ['accent', 'data-accent', 'olive'],
  ['bg', 'data-bg', 'clouds'],
  ['font', 'data-font', 'cordia'],
  ['size', 'data-size', 'default'],
  ['glass', 'data-glass', 'auto'],
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
    settings.font = pick(input.font, FONTS, DEFAULT_SETTINGS.font);
    settings.size = pick(input.size, SIZES, DEFAULT_SETTINGS.size);
    settings.appearance = pick(input.appearance, APPEARANCES, DEFAULT_SETTINGS.appearance);
    settings.glass = pick(input.glass, GLASS_LEVELS, DEFAULT_SETTINGS.glass);
    if (input.accent === 'custom') {
      const rgb = parseHex(input.customAccent);
      if (rgb && deriveAccent(toHex(rgb)).ok) {
        settings.accent = 'custom';
        settings.customAccent = toHex(rgb);
      }
    } else {
      settings.accent = pick(input.accent, ACCENTS, DEFAULT_SETTINGS.accent);
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// True when every setting is the default (appearance included).
export function isDefaultSettings(settings) {
  const clean = validateSettings(settings);
  return Object.keys(DEFAULT_SETTINGS).every(key => clean[key] === DEFAULT_SETTINGS[key]);
}

// "Cordia", "Ocean" ... or 'custom' when the accent and background are no preset's.
export function resolveTheme(settings) {
  const clean = validateSettings(settings);
  const match = PRESETS.find(preset => preset.accent === clean.accent && preset.bg === clean.bg);
  return match ? match.id : 'custom';
}

// Picking a preset sets its accent and background; the other settings stay as they are.
export function applyPreset(settings, presetId) {
  const clean = validateSettings(settings);
  const preset = PRESETS.find(item => item.id === presetId);
  if (!preset) return clean;
  return { ...clean, accent: preset.accent, customAccent: null, bg: preset.bg };
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
  return out;
}

// 'light' or 'dark'. Match device follows the device.
export function resolveAppearance(appearance, deviceIsDark = false) {
  if (appearance === 'dark') return 'dark';
  if (appearance === 'light') return 'light';
  return deviceIsDark ? 'dark' : 'light';
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
export function applySettings(settings, { root, deviceIsDark = false, publicPage = false } = {}) {
  const target = root || (typeof document !== 'undefined' ? document.documentElement : null);
  const clean = publicPage ? { ...DEFAULT_SETTINGS, appearance: 'light' } : validateSettings(settings);
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
