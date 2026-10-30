// Contrast floors for the tokens the design audit (2026-10) fixed, read straight from styles/tokens.css,
// so a later token change can't quietly undo them. Surfaces are the glass fills over the canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(fileURLToPath(import.meta.url), '..', '..', 'styles', 'tokens.css'), 'utf8');
const darkStart = css.indexOf("[data-theme='dark'] {");
const LIGHT = css.slice(css.indexOf(':root {'), darkStart);
const DARK = css.slice(darkStart, css.indexOf('}', darkStart));

function token(block, name) {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `missing ${name}`);
  return match[1].trim();
}
function rgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const parts = value.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return parts;
}
// A translucent colour (rgba) laid over an opaque one.
function over(top, under) {
  const [r, g, b, a = 1] = top;
  return [r, g, b].map((channel, i) => channel * a + under[i] * (1 - a));
}
function luminance(color) {
  const [r, g, b] = color.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const lightCanvas = rgb(token(LIGHT, '--canvas'));
const lightCard = over(rgb(token(LIGHT, '--lg-fill')), lightCanvas);
const darkCanvas = rgb(token(DARK, '--canvas'));
const darkCard = over(rgb(token(DARK, '--lg-fill')), darkCanvas);

test('the keyboard focus ring is 3:1 or better on the canvas and on cards, in both themes', () => {
  for (const [block, canvas, card] of [[LIGHT, lightCanvas, lightCard], [DARK, darkCanvas, darkCard]]) {
    const ring = rgb(token(block, '--focus-ring'));
    assert.ok(ratio(ring, canvas) >= 3 && ratio(ring, card) >= 3);
  }
});

test('dark mode: olive buttons stand out from cards, their labels read, and ink is not pure white', () => {
  const olive = rgb(token(DARK, '--olive'));
  assert.ok(ratio(olive, darkCard) >= 3, 'olive fill and edge against the card');
  assert.ok(ratio(rgb(token(DARK, '--on-olive')), olive) >= 4.5, 'label on an olive button');
  assert.ok(ratio(rgb(token(DARK, '--olive-ink')), darkCard) >= 4.5, 'olive as text');
  const ink = rgb(token(DARK, '--ink'));
  assert.ok(ratio(ink, darkCanvas) >= 7 && ratio(ink, darkCard) >= 7);
  assert.notDeepEqual(ink, [255, 255, 255]);
});

test('light mode: labels on olive, the amber "still learning" count and red buttons read at 4.5:1', () => {
  assert.ok(ratio(rgb(token(LIGHT, '--on-olive')), rgb(token(LIGHT, '--olive'))) >= 4.5);
  const warning = rgb(token(LIGHT, '--warning'));
  assert.ok(ratio(warning, over(rgb(token(LIGHT, '--warning-bg')), lightCard)) >= 4.5);
  assert.ok(ratio(rgb(token(LIGHT, '--on-error')), rgb(token(LIGHT, '--error-solid'))) >= 4.5);
});
