// Make it yours, contrast (DESIGN-SPEC 3.5): every accent against every built-in background, in
// light and dark, on every glass level, read straight from styles/tokens.css; and the custom-accent
// adjustment on hard colours. 4.5:1 for accent text and icons on glass and for the label on the
// accent; 3:1 for the dark-mode fill as an edge and for the focus ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS, BACKGROUNDS, PRESETS, GLASS_LEVELS } from '../lib/themeSettings.mjs';
import { SURFACES, accentVariables, contrast, deriveAccent, luminance, over, parseHex, toHex } from '../lib/accentMath.mjs';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const css = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');

// ---------- Reading tokens.css ----------

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

// ---------- The backdrops ----------

// The cloud photo is measured, not read: public/classroom-clouds.webp, shrunk to 167 x 94 pixels,
// the pixel at the 10th percentile of luminance (small patches of blue sky) and at the 98th
// (cloud). If the image changes, measure these again and update the hash.
const CLOUDS = { sha256: '58ba58b900893902c9fb5e37e845a7fb8f18c1bcdc2da02edb2acef9bac5f278', p10: [181, 201, 224], p98: [255, 254, 246] };

test('the cloud photo is the one the backdrop probes were measured on', () => {
  const hash = createHash('sha256').update(readFileSync(join(web, 'public', 'classroom-clouds.webp'))).digest('hex');
  assert.equal(hash, CLOUDS.sha256, 'classroom-clouds.webp changed: re-measure CLOUDS in this test and SURFACES in lib/accentMath.mjs');
});

// The worst backdrop a pane can sit on, per background: darkest in light mode (dark text on glass
// needs a light surface), lightest in dark mode (light text needs a dark one).
function backdrops() {
  const out = { light: {}, dark: {} };
  const lightCanvas = rgba(token(LIGHT, '--canvas')).slice(0, 3);
  const opacity = Number(token(LIGHT, '--backdrop-sky-opacity'));
  out.light.clouds = over(CLOUDS.p10, opacity, lightCanvas);
  const darkField = lightest(hexes(token(DARK, '--backdrop-field').split('\n').join(' ')));
  out.dark.clouds = over(CLOUDS.p98, Number(token(DARK, '--backdrop-sky-opacity')), darkField);
  for (const bg of BACKGROUNDS.filter(name => name !== 'clouds')) {
    const light = block(`:root[data-bg='${bg}']`);
    const dark = block(`[data-theme='dark'][data-bg='${bg}']`);
    const sky = /--backdrop-sky:\s*none/.test(light) ? null : hexes(token(light, '--backdrop-sky'));
    out.light[bg] = sky ? darkest(sky) : rgba(token(light, '--canvas')).slice(0, 3);
    const field = /--backdrop-field:\s*none/.test(dark) ? null : hexes(token(dark, '--backdrop-field').split('\n').join(' '));
    const base = field ? lightest(field) : rgba(token(dark, '--canvas')).slice(0, 3);
    out.dark[bg] = sky ? over(lightest(sky), Number(token(dark, '--backdrop-sky-opacity')), base) : base;
  }
  return out;
}
const BACKDROPS = backdrops();

// Glass fills per level, per theme, as the file defines them.
function fills() {
  const clearerLight = block(":root[data-glass='clearer']");
  const clearerDark = block("[data-theme='dark'][data-glass='clearer']");
  return {
    light: { auto: rgba(token(LIGHT, '--glass-fill')), frosted: rgba(token(LIGHT, '--glass-fill')), clearer: rgba(token(clearerLight, '--glass-fill')), solid: rgba(token(LIGHT, '--glass-solid')) },
    dark: { auto: rgba(token(DARK, '--glass-fill')), frosted: rgba(token(DARK, '--glass-fill')), clearer: rgba(token(clearerDark, '--glass-fill')), solid: rgba(token(DARK, '--glass-solid')) },
  };
}
const FILLS = fills();
const DARK_SHEEN = 0.07; // the top of a dark pane catches this much white (--glass-sheen)

function glass(mode, bg, level) {
  const under = BACKDROPS[mode][bg];
  const surface = lay(FILLS[mode][level], under);
  return mode === 'dark' && level !== 'solid' ? over([255, 255, 255], DARK_SHEEN, surface) : surface;
}
const surfaces = [];
for (const mode of ['light', 'dark']) for (const bg of BACKGROUNDS) for (const level of GLASS_LEVELS.filter(l => l !== 'auto')) surfaces.push({ mode, bg, level, color: glass(mode, bg, level) });

test('the surfaces lib/accentMath.mjs fits accents against are as hard as the worst built-in pane', () => {
  const worstLight = darkest(surfaces.filter(s => s.mode === 'light').map(s => s.color));
  const worstDark = lightest(surfaces.filter(s => s.mode === 'dark').map(s => s.color));
  assert.ok(luminance(SURFACES.light) <= luminance(worstLight) + 0.002, `light: ${SURFACES.light} is lighter than the worst pane ${worstLight.map(Math.round)}`);
  assert.ok(luminance(SURFACES.dark) >= luminance(worstDark) - 0.002, `dark: ${SURFACES.dark} is darker than the worst pane ${worstDark.map(Math.round)}`);
  const darkCanvas = rgba(token(DARK, '--canvas')).slice(0, 3);
  const card = lay(rgba(token(DARK, '--glass-fill')), darkCanvas);
  assert.ok(luminance(SURFACES.darkFill) >= luminance(card) - 0.002, 'dark fill edge surface');
});

// ---------- Every accent ----------

function seedsFor(accent) {
  if (accent === 'olive') {
    return {
      light: { fill: rgba(token(LIGHT, '--olive')).slice(0, 3), ink: rgba(token(LIGHT, '--olive-ink')).slice(0, 3), on: rgba(token(LIGHT, '--on-olive')).slice(0, 3), focus: rgba(token(LIGHT, '--focus-ring')).slice(0, 3) },
      dark: { fill: rgba(token(DARK, '--olive')).slice(0, 3), ink: rgba(token(DARK, '--olive-ink')).slice(0, 3), on: rgba(token(DARK, '--on-olive')).slice(0, 3), press: rgba(token(DARK, '--olive-glass-press')).slice(0, 3), focus: rgba(token(DARK, '--focus-ring')).slice(0, 3) },
    };
  }
  const text = block(`:root[data-accent='${accent}']`);
  return {
    light: { fill: triple(text, '--ca-l-fill'), ink: triple(text, '--ca-l-ink'), on: triple(text, '--ca-l-on'), focus: triple(text, '--ca-l-ink') },
    dark: { fill: triple(text, '--ca-d-fill'), ink: triple(text, '--ca-d-ink'), on: triple(text, '--ca-d-on'), press: triple(text, '--ca-d-glass-press'), focus: triple(text, '--ca-d-ink') },
  };
}

test('there are eight accents and six presets, and every preset is an accent on a background', () => {
  assert.equal(ACCENTS.length, 8);
  assert.equal(PRESETS.length, 6);
  assert.equal(BACKGROUNDS.length, 4);
  for (const preset of PRESETS) {
    assert.ok(ACCENTS.includes(preset.accent) && BACKGROUNDS.includes(preset.bg), preset.id);
  }
  assert.deepEqual(PRESETS.map(p => p.id), ['cordia', 'ocean', 'clay', 'plum', 'rose', 'graphite']);
});

for (const accent of ACCENTS) {
  test(`${accent}: accent text reads 4.5:1 on glass over every background, level and theme; labels and edges hold`, () => {
    const seeds = seedsFor(accent);
    for (const { mode, bg, level, color } of surfaces) {
      const ink = seeds[mode].ink;
      assert.ok(contrast(ink, color) >= 4.5, `${accent} ${mode} ${bg} ${level}: text ${toHex(ink)} on ${toHex(color)} is ${contrast(ink, color).toFixed(2)}`);
      assert.ok(contrast(seeds[mode].focus, color) >= 3, `${accent} ${mode} ${bg} ${level}: focus ring`);
    }
    assert.ok(contrast(seeds.light.on, seeds.light.fill) >= 4.5, `${accent}: white on the light fill ${contrast(seeds.light.on, seeds.light.fill).toFixed(2)}`);
    assert.ok(contrast(seeds.dark.on, seeds.dark.fill) >= 4.5, `${accent}: label on the dark fill`);
    assert.ok(contrast(seeds.dark.on, seeds.dark.press) >= 4.5, `${accent}: label on the pressed dark fill`);
    const darkCard = lay(rgba(token(DARK, '--glass-fill')), rgba(token(DARK, '--canvas')).slice(0, 3));
    assert.ok(contrast(seeds.dark.fill, darkCard) >= 3, `${accent}: dark fill against a card`);
    const swatch = parseHex(token(LIGHT, `--swatch-accent-${accent}`));
    assert.deepEqual(swatch, seeds.light.fill, `${accent}: the sheet's swatch is the light fill`);
  });
}

test('a curated accent never needs adjusting: its seeds are what the maths gives for its swatch', () => {
  for (const accent of ACCENTS.filter(name => name !== 'olive')) {
    const swatch = toHex(parseHex(token(LIGHT, `--swatch-accent-${accent}`)));
    const derived = deriveAccent(swatch);
    assert.equal(derived.adjusted, false, accent);
    const seeds = accentVariables(derived);
    const text = block(`:root[data-accent='${accent}']`);
    for (const [name, value] of Object.entries(seeds)) assert.equal(token(text, name), value, `${accent} ${name}`);
  }
});

// ---------- Custom accents ----------

const HARD = {
  'pale yellow': '#FFFFAA', 'neon green': '#39FF14', 'near-black': '#0A0A0A', 'near-white': '#FAFAFA',
  'pure yellow': '#FFFF00', 'cyan': '#00FFFF', 'white': '#FFFFFF', 'black': '#000000',
  'pale pink': '#FFD6E0', 'orange': '#FFA500', 'lime': '#CCFF00', 'pure red': '#FF0000',
  'light grey': '#E0E0E0', 'sky blue': '#87CEEB', 'hot magenta': '#FF00FF',
};

const worstLight = darkest(surfaces.filter(s => s.mode === 'light').map(s => s.color));
const worstDark = lightest(surfaces.filter(s => s.mode === 'dark').map(s => s.color));
const darkCard = lay(rgba(token(DARK, '--glass-fill')), rgba(token(DARK, '--canvas')).slice(0, 3));

test('hard colours are adjusted until 4.5:1 holds in both themes, and it says so', () => {
  assert.ok(Object.keys(HARD).length >= 10);
  for (const [name, hex] of Object.entries(HARD)) {
    const d = deriveAccent(hex);
    assert.ok(d.ok, name);
    assert.equal(d.adjusted, true, `${name} should report that it was adjusted`);
    const { light, dark } = d;
    assert.ok(contrast(light.fill, worstLight) >= 4.5, `${name}: light text on the worst pane ${contrast(light.fill, worstLight).toFixed(2)}`);
    assert.ok(contrast(light.on, light.fill) >= 4.5, `${name}: white on the light fill ${contrast(light.on, light.fill).toFixed(2)}`);
    assert.ok(contrast(light.press, worstLight) >= 4.5 && contrast(light.on, light.press) >= 4.5, `${name}: pressed light fill`);
    assert.ok(contrast(dark.ink, worstDark) >= 4.5, `${name}: dark ink on the worst pane ${contrast(dark.ink, worstDark).toFixed(2)}`);
    assert.ok(contrast(dark.on, dark.fill) >= 4.5, `${name}: label on the dark fill`);
    assert.ok(contrast(dark.on, dark.glassPress) >= 4.5, `${name}: label on the pressed dark fill`);
    assert.ok(contrast(dark.fill, darkCard) >= 3, `${name}: dark fill against a card`);
    for (const triple of [light.fill, light.press, light.edge, light.wash, dark.fill, dark.ink, dark.glassPress, dark.tint]) {
      assert.ok(triple.length === 3 && triple.every(v => Number.isInteger(v) && v >= 0 && v <= 255), `${name}: a valid colour`);
    }
  }
});

test('a colour that already reads is kept as picked (light mode) and not reported as adjusted', () => {
  for (const hex of ['#2F5F86', '#6A4A7E', '#3F4650', '#8E3E62']) {
    const d = deriveAccent(hex);
    assert.equal(d.adjusted, false, hex);
    assert.equal(toHex(d.light.fill), hex);
  }
});

test('the derived colours keep the picked hue', () => {
  const d = deriveAccent('#2F5F86');
  const [r, g, b] = d.dark.fill;
  assert.ok(b > g && g > r, 'a blue stays blue in dark mode');
  const [pr, pg, pb] = d.light.press;
  assert.ok(pb > pg && pg > pr, 'and when pressed');
});

test('deriving never throws and says when the input is not a colour', () => {
  for (const bad of [undefined, null, '', 'blue', '#12', '#GGGGGG', 12, {}, []]) assert.deepEqual(deriveAccent(bad), { ok: false });
  assert.deepEqual(accentVariables({ ok: false }), {});
  assert.deepEqual(deriveAccent('#abc').pick, [170, 187, 204]);
});

test('luminance and contrast agree with the published values', () => {
  assert.ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
  assert.ok(Math.abs(contrast([119, 119, 119], [255, 255, 255]) - 4.48) < 0.01);
});
