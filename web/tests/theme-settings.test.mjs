// Make it yours: the settings module, applying a look to <html>, and the first-paint script.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  ACCENTS, APPEARANCES, ATTRIBUTE_NAMES, BACKGROUNDS, DEFAULT_SETTINGS, FONTS, FONT_FILES, GLASS_LEVELS, LOOKS, LOOK_ACCENT, LOOK_FONT, PRESETS, SIZES, SIZE_SCALE,
  applyPreset, applySettings, attributesFor, bootCache, customAccentVariables, isDefaultSettings, resolveAppearance, resolveTheme,
  validateSettings, withCustomAccent,
} from '../lib/themeSettings.mjs';
import { ACCENT_VARIABLES } from '../lib/accentMath.mjs';
import { LOOK_KEY, bootScript } from '../lib/themeBoot.mjs';

// A stand-in for <html>: attributes and inline custom properties.
function fakeRoot() {
  const attributes = new Map();
  const style = new Map();
  return {
    attributes, style,
    getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    style: { setProperty: (name, value) => style.set(name, value), removeProperty: name => style.delete(name) },
    get styleMap() { return style; },
  };
}
const lookAttributes = root => [...root.attributes.keys()].filter(name => ATTRIBUTE_NAMES.includes(name));

test('the lists are the ones the spec names', () => {
  assert.equal(ACCENTS.length, 8);
  assert.deepEqual(BACKGROUNDS, ['clouds', 'dusk', 'paper', 'meadow']);
  assert.deepEqual(FONTS, ['cordia', 'clean', 'bookish', 'friendly', 'readable']);
  assert.deepEqual(SIZES, ['small', 'default', 'large', 'larger']);
  assert.deepEqual(SIZE_SCALE, { small: 0.9, default: 1, large: 1.125, larger: 1.25 });
  assert.deepEqual(APPEARANCES, ['light', 'dark', 'system']);
  assert.equal(DEFAULT_SETTINGS.appearance, 'system');
  assert.ok(!BACKGROUNDS.includes('photo'), 'Your photo stays out until a private bucket is approved');
  assert.deepEqual(Object.keys(FONT_FILES).sort(), ['bookish', 'clean', 'friendly', 'paper', 'readable']);
  assert.deepEqual(FONTS, ['cordia', 'clean', 'bookish', 'friendly', 'readable'], 'the sheet still shows five pairs; the sixth is Paper & Clay\'s own');
  assert.deepEqual(LOOKS, ['none', 'paper-clay']);
  assert.ok(!ACCENTS.includes(LOOK_ACCENT), 'Paper & Clay\'s accent is not one of the eight swatches');
});

test('validation falls back to the defaults on anything bad and never throws', () => {
  for (const bad of [undefined, null, 5, 'nope', '{not json', [], [1, 2], true, () => 1, { accent: 9 }]) {
    assert.deepEqual(validateSettings(bad), DEFAULT_SETTINGS, String(bad));
  }
  const mixed = validateSettings({ accent: 'ocean', bg: 'neon', font: 'comic', size: 'huge', appearance: 'sepia', glass: 'liquid', extra: 'x' });
  assert.deepEqual(mixed, { ...DEFAULT_SETTINGS, accent: 'ocean' });
  assert.deepEqual(Object.keys(mixed).sort(), Object.keys(DEFAULT_SETTINGS).sort(), 'unknown keys are dropped');
  assert.equal(validateSettings({ bg: 'photo' }).bg, 'clouds', 'Your photo is not valid yet');
  assert.equal(validateSettings(JSON.stringify({ font: 'readable' })).font, 'readable', 'a saved JSON string works too');
});

test('a custom accent needs a real colour; without one it falls back to olive', () => {
  assert.deepEqual(validateSettings({ accent: 'custom', customAccent: '#2f5f86' }), { ...DEFAULT_SETTINGS, accent: 'custom', customAccent: '#2F5F86' });
  assert.equal(validateSettings({ accent: 'custom', customAccent: '2F5F86' }).customAccent, '#2F5F86');
  for (const bad of [undefined, 'red', '#12', '#GGGGGG', 4]) assert.deepEqual(validateSettings({ accent: 'custom', customAccent: bad }), DEFAULT_SETTINGS);
  assert.equal(validateSettings({ accent: 'ocean', customAccent: '#FF0000' }).customAccent, null, 'a stray custom colour is dropped');
});

test('every valid value survives validation', () => {
  for (const accent of ACCENTS) assert.equal(validateSettings({ accent }).accent, accent);
  for (const bg of BACKGROUNDS) assert.equal(validateSettings({ bg }).bg, bg);
  for (const font of FONTS) assert.equal(validateSettings({ font }).font, font);
  for (const size of SIZES) assert.equal(validateSettings({ size }).size, size);
  for (const appearance of APPEARANCES) assert.equal(validateSettings({ appearance }).appearance, appearance);
  for (const glass of GLASS_LEVELS) assert.equal(validateSettings({ glass }).glass, glass);
});

test('the defaults put no data attribute and no variable on <html>', () => {
  assert.deepEqual(Object.values(attributesFor(DEFAULT_SETTINGS)), [null, null, null, null, null, null]);
  assert.deepEqual(customAccentVariables(DEFAULT_SETTINGS), {});
  assert.deepEqual(bootCache(DEFAULT_SETTINGS).a, {});
  assert.deepEqual(bootCache(DEFAULT_SETTINGS).f, []);
  const root = fakeRoot();
  // Something left over from an earlier look is cleared.
  root.setAttribute('data-accent', 'plum'); root.setAttribute('data-glass', 'solid'); root.style.setProperty('--ca-l-fill', '1, 2, 3');
  const applied = applySettings(DEFAULT_SETTINGS, { root });
  assert.deepEqual(lookAttributes(root), []);
  assert.equal(root.styleMap.size, 0);
  assert.equal(applied.theme, 'light');
  assert.ok(isDefaultSettings(DEFAULT_SETTINGS) && isDefaultSettings(undefined));
  assert.ok(!isDefaultSettings({ size: 'large' }));
});

test('every setting becomes its attribute, and olive, clouds, Cordia, default size and auto glass become none', () => {
  const all = { accent: 'rose', bg: 'dusk', font: 'bookish', size: 'larger', glass: 'clearer', appearance: 'dark' };
  assert.deepEqual(attributesFor(all), { 'data-accent': 'rose', 'data-bg': 'dusk', 'data-font': 'bookish', 'data-size': 'larger', 'data-glass': 'clearer', 'data-look': null });
  assert.equal(attributesFor({ glass: 'frosted' })['data-glass'], 'frosted', 'frosted asked for explicitly stays on, so it beats the device\'s reduced transparency');
  assert.equal(attributesFor({ glass: 'auto' })['data-glass'], null);
  const root = fakeRoot();
  const applied = applySettings(all, { root });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.getAttribute('data-bg'), 'dusk');
  assert.equal(applied.theme, 'dark');
  applySettings({ ...all, bg: 'clouds' }, { root });
  assert.equal(root.getAttribute('data-bg'), null, 'back to the default removes the attribute');
});

test('appearance: Light and Dark are fixed, Match device follows the device', () => {
  assert.equal(resolveAppearance('light', true), 'light');
  assert.equal(resolveAppearance('dark', false), 'dark');
  assert.equal(resolveAppearance('system', true), 'dark');
  assert.equal(resolveAppearance('system', false), 'light');
  assert.equal(resolveAppearance(undefined, true), 'dark');
  const root = fakeRoot();
  assert.equal(applySettings({ appearance: 'system' }, { root, deviceIsDark: true }).theme, 'dark');
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(applySettings({ appearance: 'light' }, { root, deviceIsDark: true }).theme, 'light');
});

test('presets: seven, six an accent on a background and Paper & Clay a full look; the resolver names the preset or Custom', () => {
  assert.deepEqual(PRESETS.map(p => [p.id, p.accent, p.bg]), [
    ['cordia', 'olive', 'clouds'], ['ocean', 'ocean', 'clouds'], ['clay', 'clay', 'paper'],
    ['plum', 'plum', 'dusk'], ['rose', 'rose', 'dusk'], ['graphite', 'graphite', 'paper'], ['paper-clay', 'paperclay', 'paper'],
  ]);
  assert.equal(PRESETS.find(p => p.id === 'paper-clay').label, 'Paper & Clay');
  assert.equal(resolveTheme(DEFAULT_SETTINGS), 'cordia');
  for (const preset of PRESETS) assert.equal(resolveTheme(applyPreset(DEFAULT_SETTINGS, preset.id)), preset.id);
  assert.equal(resolveTheme({ accent: 'ocean', bg: 'dusk' }), 'custom', 'changing the background marks it Custom');
  assert.equal(resolveTheme({ accent: 'teal', bg: 'clouds' }), 'custom');
  assert.equal(resolveTheme({ accent: 'custom', customAccent: '#2F5F86' }), 'custom');
  const keeps = applyPreset({ font: 'clean', size: 'large', glass: 'solid', appearance: 'dark' }, 'plum');
  assert.deepEqual([keeps.font, keeps.size, keeps.glass, keeps.appearance, keeps.accent, keeps.bg], ['clean', 'large', 'solid', 'dark', 'plum', 'dusk']);
  assert.deepEqual(applyPreset(DEFAULT_SETTINGS, 'nope'), DEFAULT_SETTINGS);
});

test('a custom accent writes its variables on <html>, and says when it adjusted', () => {
  const picked = withCustomAccent(DEFAULT_SETTINGS, '#FFFFAA');
  assert.equal(picked.settings.accent, 'custom');
  assert.equal(picked.settings.customAccent, '#FFFFAA');
  assert.equal(picked.adjusted, true);
  assert.equal(withCustomAccent(DEFAULT_SETTINGS, '#2F5F86').adjusted, false);
  assert.equal(withCustomAccent(DEFAULT_SETTINGS, 'nope').settings.accent, 'olive');
  const root = fakeRoot();
  applySettings(picked.settings, { root });
  assert.equal(root.getAttribute('data-accent'), 'custom');
  for (const name of ACCENT_VARIABLES) assert.match(root.styleMap.get(name), /^\d{1,3}, \d{1,3}, \d{1,3}$/, name);
  applySettings(applyPreset(picked.settings, 'ocean'), { root });
  assert.equal(root.getAttribute('data-accent'), 'ocean');
  assert.equal(root.styleMap.size, 0, 'leaving custom clears the variables');
});

test('public pages stay the Cordia default in light, whatever is saved', () => {
  const root = fakeRoot();
  const saved = { accent: 'plum', bg: 'dusk', font: 'readable', size: 'larger', glass: 'solid', appearance: 'dark' };
  const applied = applySettings(saved, { root, publicPage: true });
  assert.deepEqual(lookAttributes(root), []);
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.deepEqual(applied.settings.appearance, 'light');
  applySettings(saved, { root, publicPage: false });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  applySettings(saved, { root, publicPage: true });
  assert.deepEqual(lookAttributes(root), [], 'moving to a public page clears the look');
});

test('the font a pair needs is cached for preloading, and the default pair needs nothing extra', () => {
  assert.deepEqual(bootCache({ font: 'cordia' }).f, []);
  assert.deepEqual(bootCache({ font: 'bookish' }).f, FONT_FILES.bookish);
  assert.ok(FONT_FILES.readable.every(file => file.startsWith('/fonts/') && file.endsWith('.woff2')));
});

// ---------- First paint ----------

const PUBLIC_LIST = ['/pricing', '/privacy'];
function boot({ path = '/library', storage = {}, deviceDark = false, hasMatchMedia = true } = {}) {
  const root = fakeRoot();
  const links = [];
  const store = { ...storage };
  const sandbox = {
    document: { documentElement: root, head: { appendChild: link => links.push(link) }, createElement: () => ({}) },
    location: { pathname: path },
    localStorage: { getItem: key => (key in store ? store[key] : null) },
    window: hasMatchMedia ? { matchMedia: () => ({ matches: deviceDark }) } : {},
    matchMedia: () => ({ matches: deviceDark }),
  };
  vm.runInNewContext(bootScript(PUBLIC_LIST), sandbox);
  return { root, links };
}
const cached = settings => JSON.stringify(bootCache(settings));

test('first paint: a saved look is on <html> before anything draws, custom accent included', () => {
  const settings = { accent: 'custom', customAccent: '#FFFFAA', bg: 'meadow', font: 'bookish', size: 'large', glass: 'solid', appearance: 'dark' };
  const { root, links } = boot({ storage: { [LOOK_KEY]: cached(settings) } });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.getAttribute('data-accent'), 'custom');
  assert.equal(root.getAttribute('data-bg'), 'meadow');
  assert.equal(root.getAttribute('data-font'), 'bookish');
  assert.equal(root.getAttribute('data-size'), 'large');
  assert.equal(root.getAttribute('data-glass'), 'solid');
  assert.equal(root.getAttribute('data-side'), 'open');
  assert.equal(root.styleMap.size, ACCENT_VARIABLES.length);
  assert.deepEqual(links.map(l => l.href), FONT_FILES.bookish);
  assert.ok(links.every(l => l.rel === 'preload' && l.as === 'font' && l.crossOrigin === 'anonymous'));
});

test('first paint: Match device follows the device, and is the default with nothing saved', () => {
  assert.equal(boot({ deviceDark: true }).root.getAttribute('data-theme'), 'dark');
  assert.equal(boot({ deviceDark: false }).root.getAttribute('data-theme'), 'light');
  assert.equal(boot({ deviceDark: true, storage: { [LOOK_KEY]: cached({ appearance: 'light' }) } }).root.getAttribute('data-theme'), 'light');
  assert.equal(boot({ deviceDark: true, hasMatchMedia: false }).root.getAttribute('data-theme'), 'light', 'a browser without matchMedia stays light');
  assert.deepEqual(lookAttributes(boot().root), [], 'nothing saved: no attributes');
});

test('first paint: the old light/dark choice still decides until a look is saved', () => {
  assert.equal(boot({ deviceDark: false, storage: { theme: 'dark' } }).root.getAttribute('data-theme'), 'dark');
  assert.equal(boot({ deviceDark: true, storage: { theme: 'light' } }).root.getAttribute('data-theme'), 'light');
  assert.equal(boot({ deviceDark: false, storage: { theme: 'dark', [LOOK_KEY]: cached({ appearance: 'light' }) } }).root.getAttribute('data-theme'), 'light', 'the look wins');
});

test('first paint: public pages are the Cordia default in light', () => {
  const dark = { [LOOK_KEY]: cached({ accent: 'plum', bg: 'dusk', appearance: 'dark', size: 'larger' }), theme: 'dark' };
  for (const path of ['/', '/login', '/signup', '/reset-password', '/pricing', '/privacy', '/guides/anything']) {
    const { root } = boot({ path, storage: dark });
    assert.equal(root.getAttribute('data-theme'), 'light', path);
    assert.deepEqual(lookAttributes(root), [], path);
  }
  // Signed in, the same page is part of the app and follows the account.
  const signedIn = boot({ path: '/pricing', storage: { ...dark, authToken: 'x' } });
  assert.equal(signedIn.root.getAttribute('data-theme'), 'dark');
  assert.equal(signedIn.root.getAttribute('data-accent'), 'plum');
});

test('first paint: a damaged cache is ignored, never thrown, and never sets odd attributes', () => {
  assert.equal(boot({ storage: { [LOOK_KEY]: '{not json' } }).root.getAttribute('data-theme'), 'light');
  const hostile = JSON.stringify({ a: { 'onclick': 'x', 'data-accent': 'plum', 'data-bg': 5 }, v: { color: 'red', '--ca-l-fill': '1, 2, 3' }, f: ['https://evil.example/x.woff2', '/fonts/inter-latin.woff2'], ap: 'dark' });
  const { root, links } = boot({ storage: { [LOOK_KEY]: hostile } });
  assert.deepEqual([...root.attributes.keys()].sort(), ['data-accent', 'data-side', 'data-theme']);
  assert.deepEqual([...root.styleMap.keys()], ['--ca-l-fill']);
  assert.deepEqual(links.map(l => l.href), ['/fonts/inter-latin.woff2']);
});

// ---------- Paper & Clay ----------

const paperClay = () => applyPreset(DEFAULT_SETTINGS, 'paper-clay');

test('Paper & Clay: picking it sets the look, its accent, the paper background, its font pair and Solid glass', () => {
  const picked = paperClay();
  assert.deepEqual(picked, { ...DEFAULT_SETTINGS, look: 'paper-clay', accent: LOOK_ACCENT, bg: 'paper', font: LOOK_FONT, glass: 'solid' });
  assert.equal(resolveTheme(picked), 'paper-clay');
  assert.equal(resolveTheme(applyPreset(DEFAULT_SETTINGS, 'clay')), 'clay', 'the Clay preset (accent and background only) is still its own');
  // It keeps what the student chose elsewhere.
  const kept = applyPreset({ size: 'large', appearance: 'dark', font: 'clean', glass: 'frosted' }, 'paper-clay');
  assert.deepEqual([kept.size, kept.appearance, kept.font, kept.glass], ['large', 'dark', LOOK_FONT, 'solid']);
});

test('Paper & Clay: it writes only its own attribute (the look supplies its accent, paper and fonts) and Solid glass', () => {
  assert.deepEqual(attributesFor(paperClay()), { 'data-accent': null, 'data-bg': null, 'data-font': null, 'data-size': null, 'data-glass': 'solid', 'data-look': 'paper-clay' });
  const root = fakeRoot();
  const applied = applySettings({ ...paperClay(), appearance: 'dark' }, { root });
  assert.deepEqual(lookAttributes(root).sort(), ['data-glass', 'data-look']);
  assert.equal(root.getAttribute('data-look'), 'paper-clay');
  assert.equal(root.getAttribute('data-glass'), 'solid');
  assert.equal(applied.theme, 'dark');
  assert.equal(root.styleMap.size, 0, 'no runtime variables: its colours are all tokens');
  applySettings(DEFAULT_SETTINGS, { root });
  assert.deepEqual(lookAttributes(root), [], 'back to Cordia removes the look');
});

test('Paper & Clay: changing its accent or background makes the theme Custom, and a font change does not', () => {
  const picked = paperClay();
  assert.equal(resolveTheme({ ...picked, font: 'clean' }), 'paper-clay');
  assert.equal(resolveTheme({ ...picked, font: 'cordia' }), 'paper-clay');
  assert.equal(resolveTheme({ ...picked, size: 'larger', appearance: 'dark' }), 'paper-clay');
  assert.equal(resolveTheme({ ...picked, accent: 'ocean' }), 'custom');
  assert.equal(resolveTheme({ ...picked, accent: 'olive' }), 'custom');
  assert.equal(resolveTheme({ ...picked, bg: 'dusk' }), 'custom');
  assert.equal(resolveTheme({ ...picked, bg: 'clouds' }), 'custom');
  assert.equal(resolveTheme(withCustomAccent(picked, '#2F5F86').settings), 'custom');
  assert.equal(resolveTheme({ ...picked, accent: 'clay' }), 'custom', 'the Clay swatch on the paper look is not the Clay preset');
});

test('Paper & Clay: what the student picks over the look is written out so it shows', () => {
  const picked = paperClay();
  const asked = attributesFor({ ...picked, accent: 'olive', bg: 'clouds', font: 'cordia' });
  assert.deepEqual([asked['data-accent'], asked['data-bg'], asked['data-font']], ['olive', 'clouds', 'cordia'], 'Olive, Clouds and Cordia are normally "no attribute", which under the look would mean its own');
  const other = attributesFor({ ...picked, accent: 'plum', bg: 'dusk', font: 'friendly' });
  assert.deepEqual([other['data-accent'], other['data-bg'], other['data-font']], ['plum', 'dusk', 'friendly']);
  assert.equal(attributesFor({ ...DEFAULT_SETTINGS, bg: 'clouds' })['data-bg'], null, 'without the look Clouds is still no attribute');
});

test('Paper & Clay: Solid glass is forced while the look is on, and the look is the only thing that can hold it', () => {
  for (const glass of GLASS_LEVELS) assert.equal(validateSettings({ ...paperClay(), glass }).glass, 'solid', glass);
  assert.equal(validateSettings({ glass: 'clearer' }).glass, 'clearer', 'other looks keep their choice');
  assert.equal(validateSettings({ accent: LOOK_ACCENT }).accent, 'olive', 'its accent is not valid on glass');
  assert.equal(validateSettings({ look: 'paper-clay', accent: LOOK_ACCENT }).accent, LOOK_ACCENT);
  assert.equal(validateSettings({ look: 'sepia' }).look, 'none');
  assert.equal(validateSettings({ font: LOOK_FONT }).font, LOOK_FONT, 'the pair is just a pair: valid anywhere');
});

test('Paper & Clay: leaving it puts back the glass it forced and, if the student kept its own pair, the default pair', () => {
  const left = applyPreset(paperClay(), 'ocean');
  assert.deepEqual([left.look, left.glass, left.font, left.accent, left.bg], ['none', 'auto', 'cordia', 'ocean', 'clouds']);
  const keptFont = applyPreset({ ...paperClay(), font: 'bookish', size: 'large' }, 'plum');
  assert.deepEqual([keptFont.font, keptFont.size, keptFont.glass], ['bookish', 'large', 'auto']);
  const plain = applyPreset({ glass: 'clearer', font: 'friendly' }, 'plum');
  assert.deepEqual([plain.glass, plain.font], ['clearer', 'friendly'], 'a preset that follows another plain preset touches neither');
});

test('Paper & Clay: validation accepts it, survives hostile values and never throws', () => {
  assert.deepEqual(validateSettings(JSON.stringify(paperClay())), paperClay());
  for (const hostile of [{ look: {} }, { look: ['paper-clay'] }, { look: null, accent: LOOK_ACCENT }, { look: 'paper-clay', accent: ['paperclay'], bg: 5, font: {} }, '{"look":"paper-clay","accent":"paperclay"', { look: 'paper-clay', accent: 'custom', customAccent: 'nope' }]) {
    assert.doesNotThrow(() => validateSettings(hostile));
    const clean = validateSettings(hostile);
    assert.deepEqual(Object.keys(clean).sort(), Object.keys(DEFAULT_SETTINGS).sort());
    assert.ok(LOOKS.includes(clean.look));
  }
});

test('Paper & Clay: public pages stay the Cordia default whatever the student picked', () => {
  const root = fakeRoot();
  const applied = applySettings({ ...paperClay(), appearance: 'dark' }, { root, publicPage: true });
  assert.deepEqual(lookAttributes(root), []);
  assert.equal(root.getAttribute('data-theme'), 'light');
  assert.equal(applied.settings.look, 'none');
  applySettings({ ...paperClay(), appearance: 'dark' }, { root });
  assert.equal(root.getAttribute('data-look'), 'paper-clay');
  applySettings({ ...paperClay(), appearance: 'dark' }, { root, publicPage: true });
  assert.equal(root.getAttribute('data-look'), null, 'moving to a public page clears the look');
});

test('Paper & Clay: its font files are cached for preloading, serif and sans only', () => {
  assert.deepEqual(bootCache(paperClay()).f, FONT_FILES.paper);
  assert.deepEqual(FONT_FILES.paper, ['/fonts/source-serif-4-latin.woff2', '/fonts/instrument-sans-latin.woff2']);
  assert.deepEqual(bootCache(paperClay()).a, { 'data-glass': 'solid', 'data-look': 'paper-clay' });
  assert.deepEqual(bootCache({ ...paperClay(), font: 'clean' }).f, FONT_FILES.clean);
});

test('first paint: Paper & Clay is on <html> before anything draws, with its fonts preloaded and no flash of the default', () => {
  const settings = { ...paperClay(), appearance: 'dark' };
  const { root, links } = boot({ storage: { [LOOK_KEY]: cached(settings) } });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  assert.equal(root.getAttribute('data-look'), 'paper-clay');
  assert.equal(root.getAttribute('data-glass'), 'solid');
  assert.equal(root.getAttribute('data-accent'), null, 'the look supplies its own accent');
  assert.deepEqual(links.map(l => l.href), FONT_FILES.paper);
  assert.ok(links.every(l => l.rel === 'preload' && l.as === 'font' && l.crossOrigin === 'anonymous'));
  // With the student's own picks over it.
  const over = boot({ storage: { [LOOK_KEY]: cached({ ...paperClay(), accent: 'plum', bg: 'dusk', font: 'clean' }) } }).root;
  assert.deepEqual(['data-look', 'data-accent', 'data-bg', 'data-font'].map(name => over.getAttribute(name)), ['paper-clay', 'plum', 'dusk', 'clean']);
  // Public pages and signed-out visitors never see it.
  for (const path of ['/', '/login', '/pricing', '/guides/anything']) assert.deepEqual(lookAttributes(boot({ path, storage: { [LOOK_KEY]: cached(settings) } }).root), [], path);
  assert.equal(boot({ path: '/pricing', storage: { [LOOK_KEY]: cached(settings), authToken: 'x' } }).root.getAttribute('data-look'), 'paper-clay', 'signed in, Pricing is part of the app');
});
