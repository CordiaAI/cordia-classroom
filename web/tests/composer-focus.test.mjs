// The composer's focus ring (VISUAL-POLISH V1.2): a 2px ring of the focus colour at --composer-focus-alpha
// with a 4px accent-tint halo outside it, read straight from styles/tokens.css. The softened ring still
// holds 3:1 against the composer's glass for every accent (the eight, Paper & Clay's clay and custom
// picks), on every background and glass level, in light and dark: drawn over the glass, and over the
// halo and backdrop just outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS, BACKGROUNDS } from '../lib/themeSettings.mjs';
import { contrast, deriveAccent, luminance, over, parseHex, toHex } from '../lib/accentMath.mjs';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const css = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');
const system = readFileSync(join(web, 'styles', 'system.css'), 'utf8');

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
const triple = (text, name) => token(text, name).split(',').map(Number);
const hexes = text => [...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => parseHex(m[0]));
function rgba(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [...parseHex(hex[0]), 1];
  const parts = value.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
const lightest = list => list.reduce((a, b) => (luminance(b) > luminance(a) ? b : a));
const darkest = list => list.reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
const lay = (fill, under) => over(fill.slice(0, 3), fill[3], under);

const LIGHT = block(':root');
const DARK = block("[data-theme='dark']");
const ALPHA = { light: Number(token(LIGHT, '--composer-focus-alpha')), dark: Number(token(DARK, '--composer-focus-alpha')) };
const CLOUD_LIGHTEST = [255, 254, 246]; // tests/accent-contrast.test.mjs CLOUDS.p98
const DARK_SHEEN = 0.07;

// A dark ring is hardest to see on the lightest glass, a light ring on the lightest dark glass: the
// brightest backdrop each background can put behind the composer.
function backdrops() {
  const out = { light: {}, dark: {} };
  out.light.clouds = CLOUD_LIGHTEST;
  out.dark.clouds = over(CLOUD_LIGHTEST, Number(token(DARK, '--backdrop-sky-opacity')), lightest(hexes(token(DARK, '--backdrop-field'))));
  for (const bg of BACKGROUNDS.filter(name => name !== 'clouds')) {
    const light = block(`:root[data-bg='${bg}']`);
    const dark = block(`[data-theme='dark'][data-bg='${bg}']`);
    const sky = /--backdrop-sky:\s*none/.test(light) ? null : hexes(token(light, '--backdrop-sky'));
    out.light[bg] = sky ? lightest(sky) : rgba(token(light, '--canvas')).slice(0, 3);
    const field = /--backdrop-field:\s*none/.test(dark) ? null : hexes(token(dark, '--backdrop-field'));
    const base = field ? lightest(field) : rgba(token(dark, '--canvas')).slice(0, 3);
    out.dark[bg] = sky ? over(lightest(sky), Number(token(dark, '--backdrop-sky-opacity')), base) : base;
  }
  return out;
}
const BACKDROPS = backdrops();
const FILLS = {
  light: { frosted: rgba(token(LIGHT, '--glass-fill-strong')), clearer: rgba(token(block(":root[data-glass='clearer']"), '--glass-fill-strong')), solid: rgba(token(LIGHT, '--glass-solid')) },
  dark: { frosted: rgba(token(DARK, '--glass-fill-strong')), clearer: rgba(token(block("[data-theme='dark'][data-glass='clearer']"), '--glass-fill-strong')), solid: rgba(token(DARK, '--glass-solid')) },
};
const HALO = { light: [...triple(LIGHT, '--accent-rgb'), 0.14], dark: [...triple(DARK, '--accent-tint-rgb'), 0.14] };

// The ring's contrast with the glass it surrounds: the lower of the ring drawn over the glass and over the
// halo and backdrop outside the composer.
function ringContrast(focus, alpha, glass, outside) {
  return Math.min(contrast(over(focus, alpha, glass), glass), contrast(over(focus, alpha, outside), glass));
}

function everySurface(mode, focus, alpha, label) {
  let worst = Infinity;
  for (const bg of BACKGROUNDS) for (const [level, fill] of Object.entries(FILLS[mode])) {
    const backdrop = BACKDROPS[mode][bg];
    const surface = lay(fill, backdrop);
    const glass = mode === 'dark' && level !== 'solid' ? over([255, 255, 255], DARK_SHEEN, surface) : surface;
    const ratio = ringContrast(focus, alpha, glass, lay(HALO[mode], backdrop));
    worst = Math.min(worst, ratio);
    assert.ok(ratio >= 3, `${label} ${mode} ${bg} ${level}: ring ${ratio.toFixed(2)} on ${toHex(glass)}`);
  }
  return worst;
}

test('the composer rings itself with the softened ring and a 4px halo, not the heavy outline', () => {
  const rule = system.match(/\.composer:has\(\.composer-box:focus-visible\)\s*\{([^}]+)\}/);
  assert.ok(rule, 'the composer focus rule');
  assert.match(rule[1], /outline:\s*2px solid var\(--composer-focus-ring\)/);
  assert.match(rule[1], /0 0 0 6px var\(--composer-focus-halo\)/);
  assert.match(token(LIGHT, '--composer-focus-ring'), /^rgba\(var\(--focus-ring-rgb\), var\(--composer-focus-alpha\)\)$/);
  assert.deepEqual(triple(LIGHT, '--focus-ring-rgb'), parseHex(token(LIGHT, '--focus-ring')), 'light channels match the focus ring');
  assert.deepEqual(triple(DARK, '--focus-ring-rgb'), parseHex(token(DARK, '--focus-ring')), 'dark channels match the focus ring');
  for (const mode of ['light', 'dark']) assert.ok(ALPHA[mode] >= 0.55 && ALPHA[mode] <= 0.8, `${mode}: about 60%, softer than the solid ring`);
});

for (const accent of ACCENTS) {
  test(`${accent}: the composer ring holds 3:1 on its glass, on every background and glass level`, () => {
    const seeds = accent === 'olive'
      ? { light: parseHex(token(LIGHT, '--focus-ring')), dark: parseHex(token(DARK, '--focus-ring')) }
      : { light: triple(block(`:root[data-accent='${accent}']`), '--ca-l-ink'), dark: triple(block(`:root[data-accent='${accent}']`), '--ca-d-ink') };
    for (const mode of ['light', 'dark']) everySurface(mode, seeds[mode], ALPHA[mode], accent);
  });
}

test('custom accents, hard picks included: the composer ring holds 3:1', () => {
  const alpha = { light: Number(token(block(":root[data-accent='custom']"), '--composer-focus-alpha')), dark: Number(token(block("[data-theme='dark'][data-accent='custom']"), '--composer-focus-alpha')) };
  for (const hex of ['#FFFFAA', '#39FF14', '#0A0A0A', '#FAFAFA', '#FFFF00', '#00FFFF', '#FFD6E0', '#FFA500', '#CCFF00', '#FF0000', '#E0E0E0', '#87CEEB', '#FF00FF', '#2F5F86']) {
    const derived = deriveAccent(hex);
    everySurface('light', derived.light.ink, alpha.light, `custom ${hex}`);
    everySurface('dark', derived.dark.ink, alpha.dark, `custom ${hex}`);
  }
});

test('Paper & Clay: the clay ring holds 3:1 on the white composer and the dark one', () => {
  const seeds = block(":root[data-look='paper-clay']:not([data-accent])");
  const looks = { light: block(":root[data-look='paper-clay']"), dark: block("[data-theme='dark'][data-look='paper-clay']") };
  const canvas = {
    light: rgba(token(block(":root[data-look='paper-clay']:not([data-bg='clouds'], [data-bg='dusk'], [data-bg='meadow'])"), '--canvas')).slice(0, 3),
    dark: rgba(token(block("[data-theme='dark'][data-look='paper-clay']:not([data-bg='clouds'], [data-bg='dusk'], [data-bg='meadow'])"), '--canvas')).slice(0, 3),
  };
  const halo = { light: [...triple(seeds, '--ca-l-fill'), 0.14], dark: [...triple(seeds, '--ca-d-tint'), 0.14] };
  for (const mode of ['light', 'dark']) {
    const glass = rgba(token(looks[mode], '--glass-fill-strong')).slice(0, 3);
    const focus = triple(seeds, `--ca-${mode === 'light' ? 'l' : 'd'}-ink`);
    const alpha = Number(token(looks[mode], '--composer-focus-alpha'));
    const ratio = ringContrast(focus, alpha, glass, lay(halo[mode], canvas[mode]));
    assert.ok(ratio >= 3, `Paper & Clay ${mode}: ring ${ratio.toFixed(2)}`);
  }
});
