// "Sky follows the time" (VISUAL-POLISH V3): the period for a time of day, when the option turns itself off, what
// it writes on <html>, the crossfade while a page is open, and text contrast in every period, light and dark, on
// glass over the sky, read straight from styles/tokens.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKY_FADE_MS, SKY_PERIODS, msUntilNextPeriod, nightIsDark, skyActive, skyAllowed, skyBlockedBy, skyFor, skyPeriod } from '../lib/skyTime.mjs';
import * as settingsModule from '../lib/themeSettings.mjs';
import * as bootModule from '../lib/themeBoot.mjs';
import * as skyModule from '../lib/skyTime.mjs';
import { SURFACES, contrast, luminance, over, toHex } from '../lib/accentMath.mjs';

const { DEFAULT_SETTINGS, applyPreset, applySettings, bootCache, validateSettings } = settingsModule;
const web = join(fileURLToPath(import.meta.url), '..', '..');
const css = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');

// ---------- The period ----------

test('the periods and the hours they start on are the ones the spec names', () => {
  assert.deepEqual(SKY_PERIODS, ['morning', 'day', 'evening', 'night']);
  assert.equal(SKY_FADE_MS, 3000);
  const expected = h => (h >= 6 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'evening' : 'night');
  for (let h = 0; h < 24; h += 1) assert.equal(skyPeriod(h), expected(h), `${h}:00`);
});

test('each period starts on its hour: a minute before is still the one before', () => {
  const at = (h, m) => new Date(2026, 10, 18, h, m);
  assert.equal(skyPeriod(at(5, 59)), 'night');
  assert.equal(skyPeriod(at(6, 0)), 'morning');
  assert.equal(skyPeriod(at(10, 59)), 'morning');
  assert.equal(skyPeriod(at(11, 0)), 'day');
  assert.equal(skyPeriod(at(16, 59)), 'day');
  assert.equal(skyPeriod(at(17, 0)), 'evening');
  assert.equal(skyPeriod(at(19, 59)), 'evening');
  assert.equal(skyPeriod(at(20, 0)), 'night');
  assert.equal(skyPeriod(at(23, 59)), 'night');
  assert.equal(skyPeriod(at(0, 0)), 'night');
  assert.equal(skyPeriod(Number.NaN), 'day', 'an unreadable time is the plain sky');
  assert.equal(skyPeriod(25), 'night', 'hours wrap');
});

test('the time to the next period counts to the next start, across midnight too', () => {
  assert.equal(msUntilNextPeriod(new Date(2026, 10, 18, 16, 59, 0)), 60000);
  assert.equal(msUntilNextPeriod(new Date(2026, 10, 18, 22, 0, 0)), 8 * 3600000);
  assert.equal(msUntilNextPeriod(new Date(2026, 10, 18, 6, 0, 0)), 5 * 3600000);
  assert.ok(msUntilNextPeriod(new Date(2026, 10, 18, 10, 59, 59, 999)) >= 1000, 'never less than a second');
});

// ---------- The option and its opt-outs ----------

test('it is on by default, and only an explicit off turns it off', () => {
  assert.equal(DEFAULT_SETTINGS.skyTime, true);
  assert.equal(validateSettings({}).skyTime, true, 'a look saved before the option existed keeps the default');
  assert.equal(validateSettings({ skyTime: false }).skyTime, false);
  for (const junk of ['no', 0, null, 'false']) assert.equal(validateSettings({ skyTime: junk }).skyTime, true, String(junk));
  assert.equal(skyActive(DEFAULT_SETTINGS), true, 'the default look is Clouds, so the sky follows the time');
});

test('it follows the time only on Clouds, with see-through glass, no full look and a device that allows it', () => {
  const clouds = validateSettings({});
  for (const glass of ['auto', 'frosted', 'clearer']) assert.equal(skyActive({ ...clouds, glass }), true, glass);
  assert.equal(skyActive({ ...clouds, glass: 'solid' }), false, 'Solid glass');
  for (const bg of ['dusk', 'paper', 'meadow']) assert.equal(skyActive({ ...clouds, bg }), false, bg);
  assert.equal(skyActive(applyPreset(clouds, 'paper-clay')), false, 'Paper & Clay');
  assert.equal(skyActive(validateSettings({ look: 'paper-clay', bg: 'clouds' })), false, 'Paper & Clay over Clouds is still Paper & Clay');
  assert.equal(skyActive({ ...clouds, skyTime: false }), false, 'turned off');
  assert.equal(skyActive(clouds, { reducedTransparency: true }), false, 'reduced transparency');
  assert.equal(skyActive({ ...clouds, glass: 'frosted' }, { reducedTransparency: true }), false, 'reduced transparency, even with Frosted picked');
  assert.equal(skyActive(clouds, { canFrost: false }), false, 'a browser that cannot frost has solid glass');
  assert.equal(skyAllowed(null), false);
  assert.equal(skyFor(clouds, { period: 'evening' }), 'evening');
  assert.equal(skyFor({ ...clouds, glass: 'solid' }, { period: 'evening' }), null);
});

test('the sheet can say why it is off', () => {
  const clouds = validateSettings({});
  assert.equal(skyBlockedBy(clouds), null);
  assert.equal(skyBlockedBy({ ...clouds, skyTime: false }), null, 'turned off by the student is not blocked');
  assert.equal(skyBlockedBy({ ...clouds, bg: 'dusk' }), 'background');
  assert.equal(skyBlockedBy({ ...clouds, glass: 'solid' }), 'solid');
  assert.equal(skyBlockedBy(clouds, { reducedTransparency: true }), 'transparency');
  assert.equal(skyBlockedBy(applyPreset(clouds, 'paper-clay')), 'look');
});

// ---------- On <html> ----------

function fakeRoot() {
  const attributes = new Map();
  return {
    attributes,
    getAttribute: name => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    classList: { add() {}, remove() {} },
    style: { setProperty() {}, removeProperty() {} },
  };
}

test('the period is data-sky, removed whenever the sky does not follow the time', () => {
  const root = fakeRoot();
  for (const period of SKY_PERIODS) {
    assert.equal(applySettings(DEFAULT_SETTINGS, { root, sky: period }).sky, period);
    assert.equal(root.getAttribute('data-sky'), period);
  }
  applySettings({ ...DEFAULT_SETTINGS, glass: 'solid' }, { root, sky: 'night' });
  assert.equal(root.getAttribute('data-sky'), null, 'Solid glass');
  applySettings(DEFAULT_SETTINGS, { root, sky: 'night' });
  applySettings({ ...DEFAULT_SETTINGS, bg: 'meadow' }, { root, sky: 'night' });
  assert.equal(root.getAttribute('data-sky'), null, 'another background');
  applySettings(DEFAULT_SETTINGS, { root, sky: 'night' });
  applySettings(applyPreset(DEFAULT_SETTINGS, 'paper-clay'), { root, sky: 'night' });
  assert.equal(root.getAttribute('data-sky'), null, 'Paper & Clay');
  applySettings(DEFAULT_SETTINGS, { root, sky: 'night' });
  applySettings(DEFAULT_SETTINGS, { root, sky: 'night', publicPage: true });
  assert.equal(root.getAttribute('data-sky'), null, 'public pages stay the Cordia default');
  applySettings(DEFAULT_SETTINGS, { root, sky: 'dawn' });
  assert.equal(root.getAttribute('data-sky'), null, 'not a period');
  applySettings(DEFAULT_SETTINGS, { root });
  assert.equal(root.getAttribute('data-sky'), null, 'no period given');
});

test('at night a Match device page turns dark; a student who chose Light or Dark keeps it', () => {
  assert.equal(nightIsDark('system', 'night'), true);
  assert.equal(nightIsDark('light', 'night'), false);
  assert.equal(nightIsDark('system', 'evening'), false);
  const theme = (appearance, sky, deviceIsDark = false, extra = {}) => applySettings({ ...DEFAULT_SETTINGS, appearance, ...extra }, { root: fakeRoot(), sky, deviceIsDark }).theme;
  assert.equal(theme('system', 'night'), 'dark', 'Match device on a light device, at night');
  assert.equal(theme('system', 'evening'), 'light');
  assert.equal(theme('system', 'morning', true), 'dark', 'a dark device stays dark in the morning');
  assert.equal(theme('light', 'night'), 'light', 'Light is never forced dark');
  assert.equal(theme('dark', 'day'), 'dark');
  assert.equal(theme('system', 'night', false, { glass: 'solid' }), 'light', 'with the sky off, Match device follows the device alone');
  assert.equal(theme('system', 'night', false, { skyTime: false }), 'light');
});

test('the first-paint cache says whether the saved settings allow the sky', () => {
  assert.equal(bootCache(DEFAULT_SETTINGS).k, 1);
  assert.equal(bootCache({ ...DEFAULT_SETTINGS, skyTime: false }).k, 0);
  assert.equal(bootCache({ ...DEFAULT_SETTINGS, glass: 'solid' }).k, 0);
  assert.equal(bootCache({ ...DEFAULT_SETTINGS, bg: 'dusk' }).k, 0);
  assert.equal(bootCache(applyPreset(DEFAULT_SETTINGS, 'paper-clay')).k, 0);
});

// ---------- The crossfade while a page is open ----------
// lib/theme.js, loaded by hand (as tests/account-look.test.mjs does) against a fake <html>, a fake document and
// node's mock clock.

async function load(file, deps) {
  let source = await readFile(new URL(`../lib/${file}`, import.meta.url), 'utf8');
  const names = [];
  source = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?$/gm, (_, list, from) => `const {${list}} = __deps[${JSON.stringify(from)}];`);
  source = source.replace(/^export\s+(async function|function|const|let)\s+(\w+)/gm, (_, kind, name) => { names.push(name); return `${kind} ${name}`; });
  return new Function('__deps', `${source}\nreturn { ${names.join(', ')} };`)(deps);
}

async function page({ reducedMotion = false, look = DEFAULT_SETTINGS } = {}) {
  const root = fakeRoot();
  const listeners = {};
  const store = new Map([['userId', 'me'], ['authToken', 'x'], [bootModule.lookKeyFor('me'), JSON.stringify(bootCache(look))]]);
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key),
    get length() { return store.size; }, key: index => [...store.keys()][index] ?? null,
  };
  globalThis.window = { matchMedia: query => ({ matches: reducedMotion && query.includes('reduced-motion'), addEventListener() {} }), location: { pathname: '/library' } };
  globalThis.document = { documentElement: root, hidden: false, addEventListener: (type, fn) => { listeners[type] = fn; } };
  globalThis.requestAnimationFrame = callback => callback();
  const theme = await load('theme.js', {
    './useCases/index.mjs': { USE_CASES: [], useCasePath: p => `/${p.slug}` },
    './comparisons/index.mjs': { COMPARISONS: [], comparisonPath: p => `/${p.slug}` },
    './api': { getUserId: () => 'me' },
    './progress': { accountCreatedAt: () => '', getProgress: () => ({}), progressLoaded: () => false, progressRead: () => false, updateProgress() {} },
    './themeSettings.mjs': settingsModule,
    './themeBoot.mjs': bootModule,
    './skyTime.mjs': skyModule,
  });
  return { root, theme, listeners };
}

test('a period change crossfades over 3 seconds, once, and keeps the period it left while it fades', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 16, 59, 30).getTime() });
  const { root, theme } = await page();
  theme.applyTheme('/library');
  assert.equal(root.getAttribute('data-sky'), 'day');
  assert.equal(root.getAttribute('data-sky-fade'), null, 'first paint and every pick are instant');
  t.mock.timers.tick(60000); // 17:00:30
  assert.equal(root.getAttribute('data-sky'), 'evening');
  assert.equal(root.getAttribute('data-sky-fade'), '', 'the evening sky fades in');
  assert.equal(root.getAttribute('data-sky-from'), 'day');
  t.mock.timers.tick(SKY_FADE_MS + 100);
  assert.equal(root.getAttribute('data-sky-fade'), null, 'and the fade is over after 3 seconds');
  assert.equal(root.getAttribute('data-sky-from'), null);
  for (let minute = 0; minute < 30; minute += 1) {
    t.mock.timers.tick(60000);
    assert.equal(root.getAttribute('data-sky-fade'), null, 'nothing else happens within the period');
  }
  assert.equal(root.getAttribute('data-sky'), 'evening');
});

test('under reduced motion the new sky is there at once, with no fade', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 19, 59, 30).getTime() });
  const { root, theme } = await page({ reducedMotion: true });
  theme.applyTheme('/library');
  assert.equal(root.getAttribute('data-sky'), 'evening');
  t.mock.timers.tick(60000);
  assert.equal(root.getAttribute('data-sky'), 'night');
  assert.equal(root.getAttribute('data-sky-fade'), null);
});

test('a page coming back into view catches up with the clock; with the sky off nothing follows it', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 10, 0, 0).getTime() });
  const { root, theme, listeners } = await page({ look: { ...DEFAULT_SETTINGS, appearance: 'system' } });
  theme.applyTheme('/library');
  assert.equal(root.getAttribute('data-sky'), 'morning');
  t.mock.timers.setTime(new Date(2026, 10, 18, 21, 0, 0).getTime());
  listeners.visibilitychange();
  assert.equal(root.getAttribute('data-sky'), 'night');
  assert.equal(root.getAttribute('data-theme'), 'dark', 'Match device follows the night');
  theme.saveLook({ ...DEFAULT_SETTINGS, appearance: 'system', glass: 'solid' });
  assert.equal(root.getAttribute('data-sky'), null, 'Solid glass turns it off at once');
  assert.equal(root.getAttribute('data-theme'), 'light', 'and Match device follows the device alone again');
});

// ---------- The CSS ----------

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
}
function token(text, name) {
  const match = text.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `missing ${name}`);
  return match[1].trim();
}
function rgba(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const parts = value.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
const lay = (fill, under) => over(fill.slice(0, 3), fill[3], under);
const hexes = text => [...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => rgba(m[0]).slice(0, 3));

const LIGHT = block(':root');
const DARK = block("[data-theme='dark']");
const NIGHT_LIGHT = block(":root:is([data-sky='night'], [data-sky-from='night']):not([data-theme='dark'])");
const NIGHT_LIGHT_CLEARER = block(":root:is([data-sky='night'], [data-sky-from='night'])[data-glass='clearer']:not([data-theme='dark'])");
const SKY_TOKENS = ['--sky-morning-top', '--sky-morning-bottom', '--sky-evening', '--sky-night-top', '--sky-night-bottom', '--sky-night-glow', '--sky-star'];

test('every sky colour is a token, in light and in dark, and the layer is drawn only from them', () => {
  for (const name of SKY_TOKENS) { rgba(token(LIGHT, name)); rgba(token(DARK, name)); }
  const layer = block(':root[data-sky]::after');
  assert.doesNotMatch(layer, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literal in the layer itself');
  assert.doesNotMatch(layer, /url\(/, 'no image: the stars are drawn');
  const stars = layer.match(/var\(--sky-star\)/g) || [];
  assert.ok(stars.length >= 8 && stars.length <= 20, `a few stars (${stars.length})`);
  assert.match(layer, /pointer-events: none/);
  assert.match(layer, /position: fixed/);
  for (const name of ['--sky-m', '--sky-e', '--sky-n']) assert.match(css, new RegExp(`@property ${name} \\{ syntax: '<number>'; inherits: false; initial-value: 0; \\}`));
});

test('the crossfade is 3 seconds on named properties only, and instant under reduced motion', () => {
  assert.equal(token(LIGHT, '--dur-sky'), '3000ms');
  const fade = block(':root[data-sky-fade]::after');
  assert.match(fade, /transition: --sky-m var\(--dur-sky\) var\(--ease-sky\), --sky-e var\(--dur-sky\) var\(--ease-sky\), --sky-n var\(--dur-sky\) var\(--ease-sky\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ :root\[data-sky-fade\]::after \{ transition: none; \} \}/);
  assert.doesNotMatch(css, /transition:\s*all/);
});

// ---------- Contrast in every period ----------
// The model the accent tests use (tests/accent-contrast.test.mjs): the cloud photo's darkest probe in light (dark
// text needs a light pane) and its lightest in dark, the photo at its opacity over the canvas or the lightest part of
// the dark field. Each period lays its wash over that at the wash's strongest point for that theme. A pane is the
// glass fill over the result (plus the sheen in dark). Every pane must stay as light (light) or as dark (dark) as
// the surface lib/accentMath.mjs fits every accent to, so accent text keeps 4.5:1 too; ink and muted text must read
// 4.5:1 on glass, and ink and the stronger muted text 4.5:1 straight on the sky.

const CLOUDS = { p10: [181, 201, 224], p98: [255, 254, 246] };
const WHITE = [255, 255, 255];
const lightBase = over(CLOUDS.p10, Number(token(LIGHT, '--backdrop-sky-opacity')), rgba(token(LIGHT, '--canvas')).slice(0, 3));
const darkField = hexes(token(DARK, '--backdrop-field').split('\n').join(' ')).reduce((a, b) => (luminance(b) > luminance(a) ? b : a));
const darkBase = over(CLOUDS.p98, Number(token(DARK, '--backdrop-sky-opacity')), darkField);

function skies(mode) {
  const block_ = mode === 'light' ? LIGHT : DARK;
  const base = mode === 'light' ? lightBase : darkBase;
  const t = name => rgba(token(block_, name));
  const worst = list => list.reduce((a, b) => ((mode === 'light' ? luminance(b) < luminance(a) : luminance(b) > luminance(a)) ? b : a));
  return {
    morning: worst([lay(t('--sky-morning-top'), base), lay(t('--sky-morning-bottom'), base)]),
    day: base,
    evening: lay(t('--sky-evening'), base),
    night: worst([lay(t('--sky-night-glow'), lay(t('--sky-night-top'), base)), lay(t('--sky-night-bottom'), base)]),
  };
}

function fillsFor(mode, period) {
  if (mode === 'dark') return { frosted: rgba(token(DARK, '--glass-fill')), clearer: rgba(token(block("[data-theme='dark'][data-glass='clearer']"), '--glass-fill')) };
  if (period === 'night') return { frosted: rgba(token(NIGHT_LIGHT, '--glass-fill')), clearer: rgba(token(NIGHT_LIGHT_CLEARER, '--glass-fill')) };
  return { frosted: rgba(token(LIGHT, '--glass-fill')), clearer: rgba(token(block(":root[data-glass='clearer']"), '--glass-fill')) };
}
function textFor(mode, period) {
  const base = mode === 'light' ? LIGHT : DARK;
  const night = mode === 'light' && period === 'night' ? NIGHT_LIGHT : null;
  const pick = name => rgba(token(night && night.includes(`${name}:`) ? night : base, name));
  return { ink: pick('--ink'), muted: pick('--muted'), mutedStrong: pick('--muted-strong') };
}

const measured = [];
for (const mode of ['light', 'dark']) {
  const sky = skies(mode);
  for (const period of SKY_PERIODS) {
    test(`${mode} ${period}: text reads 4.5:1 on glass over the sky and straight on it, and panes stay inside the accents' surface`, () => {
      const text = textFor(mode, period);
      const backdrop = sky[period];
      for (const [level, fill] of Object.entries(fillsFor(mode, period))) {
        let pane = lay(fill, backdrop);
        if (mode === 'dark') pane = over(WHITE, 0.07, pane); // the dark sheen at the top of a pane
        const ink = contrast(text.ink.slice(0, 3), pane);
        const muted = contrast(lay(text.muted, pane), pane);
        measured.push({ mode, period, where: `${level} glass`, ink: ink.toFixed(2), muted: muted.toFixed(2), surface: toHex(pane.map(Math.round)) });
        assert.ok(ink >= 4.5 && muted >= 4.5, `${mode} ${period} ${level}: ink ${ink.toFixed(2)}, muted ${muted.toFixed(2)} on ${toHex(pane.map(Math.round))}`);
        if (mode === 'light') assert.ok(luminance(pane) >= luminance(SURFACES.light) - 0.002, `${period} ${level}: pane ${toHex(pane.map(Math.round))} is darker than the accents' light surface`);
        else assert.ok(luminance(pane) <= luminance(SURFACES.dark) + 0.002, `${period} ${level}: pane ${toHex(pane.map(Math.round))} is lighter than the accents' dark surface`);
      }
      const ink = contrast(text.ink.slice(0, 3), backdrop);
      const strong = contrast(lay(text.mutedStrong, backdrop), backdrop);
      measured.push({ mode, period, where: 'straight on the sky', ink: ink.toFixed(2), muted: `${strong.toFixed(2)} (strong)`, surface: toHex(backdrop.map(Math.round)) });
      assert.ok(ink >= 4.5 && strong >= 4.5, `${mode} ${period} on the sky: ink ${ink.toFixed(2)}, muted-strong ${strong.toFixed(2)}`);
    });
  }
}

test('contrast in every period, for the record', () => {
  assert.equal(measured.length, 2 * 4 * 3);
  if (process.env.SKY_CONTRAST) console.table(measured);
});
