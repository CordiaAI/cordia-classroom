// "Sky follows the time" (VISUAL-POLISH V3): the period for a time of day, when the option turns itself off, what
// it writes on <html>, the crossfade while a page is open, and text contrast in every period, light and dark, on
// glass over the sky, read straight from styles/tokens.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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

async function page({ reducedMotion = false, look = DEFAULT_SETTINGS, root = fakeRoot(), signedIn = true } = {}) {
  const listeners = {};
  const store = new Map([['userId', 'me'], [bootModule.lookKeyFor('me'), JSON.stringify(bootCache(look))]]);
  if (signedIn) store.set('authToken', 'x');
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
  t.mock.timers.tick(31000); // 17:00:01, just after the timer to the next period fired
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
  assert.equal(root.getAttribute('data-theme'), 'light', 'the theme waits for the next page load');
  theme.saveLook({ ...DEFAULT_SETTINGS, appearance: 'system', glass: 'solid' });
  assert.equal(root.getAttribute('data-sky'), null, 'Solid glass turns it off at once');
  assert.equal(root.getAttribute('data-theme'), 'light', 'and Match device follows the device alone');
});

// ---------- The clock never flips light and dark while a page is open ----------

test('Match device on a light device: crossing 20:00 with the page open fades the sky and keeps the theme; a reload after 20:00 is dark', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 19, 59, 0).getTime() });
  const look = { ...DEFAULT_SETTINGS, appearance: 'system' };
  const { root, theme } = await page({ look });
  theme.applyTheme('/library');
  assert.deepEqual([root.getAttribute('data-sky'), root.getAttribute('data-theme')], ['evening', 'light']);
  t.mock.timers.tick(61000); // 20:00:01
  assert.equal(root.getAttribute('data-sky'), 'night');
  assert.equal(root.getAttribute('data-sky-fade'), '', 'the night sky fades in over 3 seconds');
  assert.equal(root.getAttribute('data-theme'), 'light', 'and the app stays light while the page is open');
  t.mock.timers.tick(SKY_FADE_MS + 100);
  assert.equal(root.getAttribute('data-theme'), 'light');
  theme.applyTheme('/home'); // a new page in the same tab is not a page load
  assert.equal(root.getAttribute('data-theme'), 'light');
  // The reload: the first-paint script, then a fresh theme.js on the same <html>.
  const reloaded = fakeRoot();
  const sandbox = {
    document: { documentElement: reloaded, head: { appendChild() {} }, createElement: () => ({}) },
    location: { pathname: '/library' },
    localStorage: globalThis.localStorage,
    window: { matchMedia: () => ({ matches: false }) }, matchMedia: () => ({ matches: false }),
    Date,
  };
  vm.runInNewContext(bootModule.bootScript(), sandbox);
  assert.deepEqual([reloaded.getAttribute('data-sky'), reloaded.getAttribute('data-theme')], ['night', 'dark'], 'first paint after 20:00');
  const after = await page({ look, root: reloaded });
  after.theme.applyTheme('/library');
  assert.deepEqual([reloaded.getAttribute('data-sky'), reloaded.getAttribute('data-theme')], ['night', 'dark'], 'and theme.js agrees');
});

test('a Match device page that loaded at night stays dark through 06:00 while it is open', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 5, 59, 0).getTime() });
  const { root, theme } = await page({ look: { ...DEFAULT_SETTINGS, appearance: 'system' } });
  theme.applyTheme('/library');
  assert.deepEqual([root.getAttribute('data-sky'), root.getAttribute('data-theme')], ['night', 'dark']);
  t.mock.timers.tick(61000); // 06:00:01
  assert.equal(root.getAttribute('data-sky'), 'morning');
  assert.equal(root.getAttribute('data-theme'), 'dark');
});

test('the theme follows the night the first-paint script drew, not a clock read a moment later', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 20, 0, 1).getTime() });
  const root = fakeRoot();
  root.setAttribute('data-sky', 'evening'); // drawn at 19:59:59.9, before React ran
  root.setAttribute('data-theme', 'light');
  const { theme } = await page({ look: { ...DEFAULT_SETTINGS, appearance: 'system' }, root });
  theme.applyTheme('/library');
  assert.equal(root.getAttribute('data-theme'), 'light', 'no flip between first paint and hydration');
});

// ---------- One timer, only when it can change something ----------

function spyTimeouts() {
  const calls = [];
  const real = globalThis.setTimeout;
  const realInterval = globalThis.setInterval;
  globalThis.setTimeout = (fn, ms) => { calls.push(ms); return real(fn, ms); };
  globalThis.setInterval = (fn, ms) => { calls.push(`interval ${ms}`); return realInterval(fn, ms); };
  return { calls, restore() { globalThis.setTimeout = real; globalThis.setInterval = realInterval; } };
}

test('the sky waits with one timeout to the next period, and arms none while it is off, on a public page or hidden', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 16, 59, 30).getTime() });
  const spy = spyTimeouts();
  t.after(() => spy.restore());
  const { root, theme, listeners } = await page();
  theme.applyTheme('/library');
  assert.deepEqual(spy.calls, [30500], 'one timeout, just past 17:00');
  assert.ok(!spy.calls.some(call => String(call).startsWith('interval')), 'no interval');

  spy.calls.length = 0;
  theme.saveLook({ ...DEFAULT_SETTINGS, glass: 'solid' });
  assert.deepEqual(spy.calls, [], 'Solid glass: nothing armed');
  t.mock.timers.tick(60000);
  assert.equal(root.getAttribute('data-sky'), null);
  theme.saveLook({ ...DEFAULT_SETTINGS, skyTime: false });
  assert.deepEqual(spy.calls, [], 'switched off: nothing armed');

  theme.saveLook(DEFAULT_SETTINGS); // 17:00:30: back on, armed to 20:00
  assert.equal(root.getAttribute('data-sky'), 'evening');
  assert.deepEqual(spy.calls, [3 * 3600000 - 30000 + 500], 'a settings change re-arms it');

  spy.calls.length = 0;
  globalThis.document.hidden = true;
  listeners.visibilitychange();
  t.mock.timers.tick(3 * 3600000); // 20:00:30, hidden all along
  assert.equal(root.getAttribute('data-sky'), 'evening', 'a hidden tab does nothing');
  assert.deepEqual(spy.calls, [], 'and arms nothing');
  globalThis.document.hidden = false;
  listeners.visibilitychange();
  assert.equal(root.getAttribute('data-sky'), 'night', 'coming back into view catches up at once');
  assert.ok(spy.calls.includes(10 * 3600000 - 30000 + 500), 're-armed to 06:00');

  spy.calls.length = 0;
  theme.applyTheme('/');
  assert.equal(root.getAttribute('data-sky'), null);
  assert.deepEqual(spy.calls, [], 'a public page arms nothing');
});

// ---------- Public pages: one list for first paint and theme.js ----------

test('every public page in the shared list gets no sky signed out, at first paint and from theme.js alike', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date(2026, 10, 18, 22, 0, 0).getTime() });
  const pages = [...bootModule.LIGHT_ONLY, ...bootModule.LIGHT_SIGNED_OUT, '/guides/how-to-study'];
  for (const path of ['/instructors', '/copyright', '/connect/claude', '/privacy', '/guides']) assert.ok(pages.includes(path), path);
  const document_ = readFileSync(join(web, 'pages', '_document.js'), 'utf8');
  assert.match(document_, /bootScript\(\)/, '_document uses the shared list');
  assert.doesNotMatch(document_, /LIGHT_SIGNED_OUT\s*=/, 'and keeps no list of its own');
  const theme_ = readFileSync(join(web, 'lib', 'theme.js'), 'utf8');
  assert.doesNotMatch(theme_, /LIGHT_WHEN_SIGNED_OUT\s*=|'\/privacy'/, 'theme.js keeps no list of its own');
  for (const path of pages) {
    const root = fakeRoot();
    vm.runInNewContext(bootModule.bootScript(), {
      document: { documentElement: root, head: { appendChild() {} }, createElement: () => ({}) },
      location: { pathname: path }, localStorage: { getItem: key => (key === 'userId' ? 'me' : null), length: 0, key: () => null },
      window: { matchMedia: () => ({ matches: false }) }, matchMedia: () => ({ matches: false }), Date,
    });
    assert.equal(root.getAttribute('data-sky'), null, `first paint, ${path}`);
    const { root: shown, theme } = await page({ signedIn: false });
    theme.applyTheme(path === '/guides/how-to-study' ? '/guides/[slug]' : path);
    assert.equal(shown.getAttribute('data-sky'), null, `theme.js, ${path}`);
    assert.equal(theme.isLightOnly(path), true, path);
  }
  const { root, theme } = await page({ signedIn: false });
  theme.applyTheme('/library');
  assert.equal(root.getAttribute('data-sky'), 'night', 'an app page still draws it');
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

const skyStart = css.indexOf('.c-sky { display: none; }');
const skyCss = skyStart < 0 ? '' : css.slice(skyStart, css.indexOf('/* Note paper', skyStart));

test('every sky colour is a token, in light and in dark, and the layers are drawn only from them', () => {
  for (const name of SKY_TOKENS) { rgba(token(LIGHT, name)); rgba(token(DARK, name)); }
  assert.ok(skyCss.length > 0, 'the sky layers are in tokens.css');
  assert.doesNotMatch(skyCss, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no colour literal in the layers themselves');
  assert.doesNotMatch(skyCss, /url\(/, 'no image: the stars are drawn');
  const night = block('.c-sky-night');
  const stars = night.match(/var\(--sky-star\)/g) || [];
  assert.ok(stars.length >= 8 && stars.length <= 20, `a few stars (${stars.length})`);
  assert.match(night, /var\(--sky-night-glow\)/);
  assert.match(night, /var\(--sky-night-top\), var\(--sky-night-bottom\)/);
  assert.match(block('.c-sky::before'), /var\(--sky-morning-top\), var\(--sky-morning-bottom\)/);
  assert.match(block('.c-sky::after'), /var\(--sky-evening\)/);
  assert.doesNotMatch(css, /@property --sky-|color-mix\([^)]*--sky-/, 'no registered numbers and no colour-mix per frame');
});

test('the sky is its own layer over the washes and under every page, drawn only while data-sky is set', () => {
  const document_ = readFileSync(join(web, 'pages', '_document.js'), 'utf8');
  assert.match(document_, /<body>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div className="c-sky" aria-hidden="true"><div className="c-sky-night" \/><\/div>\s*<Main \/>/, 'first in <body>, outside React');
  assert.match(css, /body::before, body::after, \[data-theme='dark'\]::before \{\s*content: ''; position: fixed; z-index: -2;/, 'the backdrop sits under it');
  assert.match(css, /\.c-sky \{ display: none; \}/);
  assert.match(css, /:root\[data-sky\] \.c-sky \{ display: block; position: fixed; inset: 0; z-index: -1; pointer-events: none;/);
  const system = readFileSync(join(web, 'styles', 'system.css'), 'utf8');
  assert.match(system, /html\.is-restyling :not\(\.miy-sheet, \.miy-sheet \*, \.c-sky, \.c-sky \*\), html\.is-restyling :not\(\.miy-sheet \*, \.c-sky\)::before, html\.is-restyling :not\(\.miy-sheet \*, \.c-sky\)::after \{ transition: none !important; \}/, 'a restyle never cuts the crossfade short');
});

test('the crossfade is 3 seconds of opacity only, and instant under reduced motion', () => {
  assert.equal(token(LIGHT, '--dur-sky'), '3000ms');
  const layers = ':root[data-sky-fade] .c-sky::before, :root[data-sky-fade] .c-sky::after, :root[data-sky-fade] .c-sky-night';
  assert.match(css, new RegExp(`${layers.replace(/[[\]().*]/g, m => `\\${m}`)} \\{ transition: opacity var\\(--dur-sky\\) var\\(--ease-sky\\); will-change: opacity; \\}`));
  assert.match(css, /:root\[data-sky='morning'\] \.c-sky::before, :root\[data-sky='evening'\] \.c-sky::after, :root\[data-sky='night'\] \.c-sky-night \{ opacity: 1; \}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  :root[data-sky-fade]'));
  assert.match(reduced, /^@media \(prefers-reduced-motion: reduce\) \{\n  :root\[data-sky-fade\] \.c-sky::before, :root\[data-sky-fade\] \.c-sky::after, :root\[data-sky-fade\] \.c-sky-night \{ transition: none; \}\n\}/);
  assert.doesNotMatch(skyCss, /transition:(?!\s*(none|opacity )[^,;]*;)/, 'nothing but opacity transitions');
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
