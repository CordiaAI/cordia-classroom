// Make it yours, contrast (DESIGN-SPEC 3.5): every accent against every built-in background, in
// light and dark, on every glass level, read straight from styles/tokens.css; the custom-accent
// adjustment on hard colours; and the Paper & Clay look's own pairs on its own surfaces. 4.5:1 for accent
// text and icons on glass and for the label on the accent; 3:1 for the dark-mode fill as an edge and for
// the focus ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENTS, BACKGROUNDS, PRESETS, GLASS_LEVELS, LOOK_ACCENT } from '../lib/themeSettings.mjs';
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

test('there are eight accents and seven presets, and every preset is an accent on a background', () => {
  assert.equal(ACCENTS.length, 8);
  assert.equal(PRESETS.length, 7);
  assert.equal(BACKGROUNDS.length, 4);
  for (const preset of PRESETS) {
    // Paper & Clay's accent is its own (not one of the eight swatches).
    assert.ok((ACCENTS.includes(preset.accent) || preset.accent === LOOK_ACCENT) && BACKGROUNDS.includes(preset.bg), preset.id);
  }
  assert.deepEqual(PRESETS.map(p => p.id), ['cordia', 'ocean', 'clay', 'plum', 'rose', 'graphite', 'paper-clay']);
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

// ---------- Paper & Clay (the full look, DESIGN-SPEC 3.5) ----------
// Its surfaces are opaque paper, so its pairs are read straight from the tokens: no glass maths.

const LOOK_LIGHT = block(":root[data-look='paper-clay']");
const LOOK_DARK = block("[data-theme='dark'][data-look='paper-clay']");
const LOOK_SEEDS = block(":root[data-look='paper-clay']:not([data-accent])");
const LOOK_CANVAS = { light: block(":root[data-look='paper-clay']:not([data-bg='clouds'], [data-bg='dusk'], [data-bg='meadow'])"), dark: block("[data-theme='dark'][data-look='paper-clay']:not([data-bg='clouds'], [data-bg='dusk'], [data-bg='meadow'])") };
const opaque = (text, name) => { const value = rgba(token(text, name)); assert.equal(value[3], 1, `${name} must be opaque`); return value.slice(0, 3); };

function paperClay(mode) {
  const look = mode === 'light' ? LOOK_LIGHT : LOOK_DARK;
  const seed = suffix => triple(LOOK_SEEDS, `--ca-${mode === 'light' ? 'l' : 'd'}-${suffix}`);
  return {
    surfaces: { canvas: opaque(LOOK_CANVAS[mode], '--canvas'), sidebar: opaque(look, '--surface-sidebar'), raised: opaque(look, '--surface-raised') },
    others: { hover: opaque(look, '--glass-inner'), pressed: opaque(look, '--lg-press') },
    text: { ink: opaque(look, '--ink'), body: opaque(look, '--text-secondary'), muted: opaque(look, '--muted'), clay: seed('ink') },
    disabled: opaque(look, '--text-disabled'),
    edge: opaque(look, '--control-edge'),
    fill: seed('fill'), hover: seed(mode === 'light' ? 'press' : 'glass-press'), on: seed('on'),
  };
}

test('Paper & Clay: the owner\'s values are the ones in tokens.css', () => {
  const light = paperClay('light');
  const dark = paperClay('dark');
  const hex = list => toHex(list);
  assert.deepEqual([hex(light.surfaces.canvas), hex(light.surfaces.sidebar), hex(light.surfaces.raised), hex(light.others.hover), hex(light.others.pressed)], ['#FAF9F5', '#F5F4ED', '#FFFFFF', '#F0EEE6', '#E8E6DC']);
  assert.deepEqual([hex(light.text.ink), hex(light.text.body), hex(light.text.muted), hex(light.disabled), hex(light.text.clay)], ['#141413', '#3D3D3A', '#6B6A64', '#9C9A92', '#A24A29']);
  assert.deepEqual([hex(light.fill), hex(light.hover), hex(light.on)], ['#AE5630', '#9C4A27', '#FFFFFF']);
  assert.deepEqual([hex(dark.surfaces.canvas), hex(dark.surfaces.sidebar), hex(dark.surfaces.raised), hex(dark.others.hover), hex(dark.others.pressed)], ['#262624', '#1F1E1D', '#30302E', '#3A3936', '#45443F']);
  assert.deepEqual([hex(dark.text.ink), hex(dark.text.body), hex(dark.text.muted), hex(dark.disabled), hex(dark.text.clay)], ['#FAF9F5', '#C2C0B6', '#A6A39A', '#85837B', '#E8916F']);
  // Control borders are the one change from the spec (the owner's decision A): moved the smallest step that holds
  // 3:1 on the hover and pressed fills (spec #8F8C82 light, #8A877E dark).
  assert.deepEqual([hex(light.edge), hex(dark.edge)], ['#868379', '#928F86']);
  assert.deepEqual([hex(dark.fill), hex(dark.hover), hex(dark.on)], ['#D97757', '#E38A6B', '#1A1918']);
  assert.deepEqual(rgba(token(LOOK_LIGHT, '--hairline')), [31, 30, 29, 0.10]);
  assert.deepEqual(rgba(token(LOOK_DARK, '--hairline')), [250, 249, 245, 0.12]);
});

for (const mode of ['light', 'dark']) {
  test(`Paper & Clay ${mode}: text, body, muted and clay text read 4.5:1 on the canvas, the sidebar and raised surfaces`, () => {
    const look = paperClay(mode);
    for (const [surfaceName, surface] of Object.entries(look.surfaces)) {
      for (const [textName, color] of Object.entries(look.text)) {
        assert.ok(contrast(color, surface) >= 4.5, `${mode} ${textName} ${toHex(color)} on ${surfaceName} ${toHex(surface)} is ${contrast(color, surface).toFixed(2)}`);
      }
    }
  });

  test(`Paper & Clay ${mode}: the label on the accent reads 4.5:1 on the fill and on its hover shade`, () => {
    const look = paperClay(mode);
    assert.ok(contrast(look.on, look.fill) >= 4.5, `label on fill ${contrast(look.on, look.fill).toFixed(2)}`);
    assert.ok(contrast(look.on, look.hover) >= 4.5, `label on hover ${contrast(look.on, look.hover).toFixed(2)}`);
  });

  test(`Paper & Clay ${mode}: control borders hold 3:1 on the canvas, the sidebar, raised surfaces and the hover and pressed fills`, () => {
    const look = paperClay(mode);
    for (const [surfaceName, surface] of Object.entries({ ...look.surfaces, ...look.others })) assert.ok(contrast(look.edge, surface) >= 3, `${mode} control border on ${surfaceName} ${contrast(look.edge, surface).toFixed(2)}`);
  });
}

// What falls short, written down rather than hidden: pairs the spec does not require (or, for muted text
// on a pressed fill, that the source design itself calls out; it is momentary). Control borders are required
// to pass on hover and pressed (above), not listed here.
// The measured number is asserted, so a colour change shows up here. Disabled text is meant to fail 4.5:1.
const KNOWN = {
  'light disabled on canvas': 2.68, 'light disabled on sidebar': 2.56, 'light disabled on raised': 2.82,
  'dark disabled on canvas': 3.99, 'dark disabled on sidebar': 4.38, 'dark disabled on raised': 3.48,
  'light disabled on hover': 2.43, 'light disabled on pressed': 2.25, 'dark disabled on hover': 3.04, 'dark disabled on pressed': 2.57,
  'light muted on pressed': 4.34, 'dark muted on pressed': 3.87, 'dark clay on pressed': 4.05,
};
test('Paper & Clay: disabled text and the weaker pairs are measured and reported', t => {
  const found = {};
  for (const mode of ['light', 'dark']) {
    const look = paperClay(mode);
    for (const [name, surface] of Object.entries({ ...look.surfaces, ...look.others })) {
      const checks = { disabled: [look.disabled, 4.5], muted: [look.text.muted, 4.5], clay: [look.text.clay, 4.5] };
      for (const [what, [color, need]] of Object.entries(checks)) {
        const ratio = contrast(color, surface);
        if (ratio < need) found[`${mode} ${what} on ${name}`] = Number(ratio.toFixed(2));
      }
    }
  }
  t.diagnostic(`below their floor: ${JSON.stringify(found)}`);
  assert.deepEqual(Object.keys(found).sort(), Object.keys(KNOWN).sort(), 'a pair crossed its floor, one way or the other');
  for (const [name, ratio] of Object.entries(KNOWN)) assert.ok(Math.abs(found[name] - ratio) <= 0.011, `${name}: ${found[name]} not ${ratio}`);
});

test('Paper & Clay: the light and dark looks set the same tokens, with no photo, no grain, no frost and no resting shadow', () => {
  const names = text => [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]).sort();
  assert.deepEqual(names(LOOK_DARK), names(LOOK_LIGHT), 'every token the light look sets, the dark look sets too (it is less specific otherwise)');
  for (const text of [LOOK_LIGHT, LOOK_DARK]) {
    assert.equal(token(text, '--glass-blur'), 'none');
    assert.equal(token(text, '--glass-sheen'), 'none');
    assert.equal(token(text, '--glass-grain'), 'none');
    assert.equal(token(text, '--glass-grain-opacity'), '0');
    assert.equal(token(text, '--shadow-card'), '0 0 0 0 rgba(0, 0, 0, 0)', 'a resting card has no drop shadow');
    assert.equal(token(text, '--glass-shadow-depth'), '0 0 0 0 rgba(0, 0, 0, 0)', 'a resting pane has no drop shadow');
    assert.notEqual(token(text, '--lg-depth-float'), '0 0 0 0 rgba(0, 0, 0, 0)', 'menus and popovers keep theirs');
    assert.match(token(text, '--shadow-composer'), /rgba/, 'the composer keeps its shadow');
    for (const name of ['--surface-card', '--surface-raised', '--glass-fill', '--glass-fill-strong', '--glass-solid', '--lg-fill-menu', '--lg-fill-field', '--glass-control']) opaque(text, name);
    assert.deepEqual(['--r-input', '--r-row', '--r-card', '--r-panel'].map(name => token(text, name)), ['8px', '12px', '16px', '20px']);
    assert.equal(token(text, '--font-reply'), 'var(--font-display)');
  }
  for (const text of Object.values(LOOK_CANVAS)) for (const name of ['--backdrop-sky', '--backdrop-wash', '--backdrop-field']) assert.equal(token(text, name), 'none');
});

test('Paper & Clay: the sixth font pair, its three files and their licences are in the repo', () => {
  assert.match(token(css, '--font-paper-display'), /^'Source Serif 4'/);
  assert.match(token(css, '--font-paper-ui'), /^'Instrument Sans'/);
  assert.match(token(css, '--font-paper-mono'), /^'JetBrains Mono'/);
  for (const name of ['source-serif-4', 'instrument-sans', 'jetbrains-mono']) {
    assert.ok(readFileSync(join(web, 'public', 'fonts', `${name}-latin.woff2`)).length > 10000, name);
    assert.match(readFileSync(join(web, 'public', 'fonts', `${name}-LICENSE.txt`), 'utf8'), /SIL OPEN FONT LICENSE/);
  }
});

test('the tile tokens for the theme sheet exist in light and dark, and nothing in the product says Claude', () => {
  for (const name of ['--swatch-look-paper-clay', '--swatch-look-paper-clay-edge', '--swatch-look-paper-clay-dot', '--swatch-look-paper-clay-ink', '--swatch-look-paper-clay-font', '--swatch-accent-paperclay']) assert.ok(token(LIGHT, name), name);
  assert.notEqual(token(DARK, '--swatch-look-paper-clay'), token(LIGHT, '--swatch-look-paper-clay'));
  assert.ok(!/claude/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no token or selector names the assistant brand');
});
