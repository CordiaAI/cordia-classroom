import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Colour literals (hex, rgb, rgba, hsl) are allowed only in styles/tokens.css, where each has a
// light and a dark value. Components and other stylesheets must use var(--token).
const ROOT = new URL('..', import.meta.url).pathname;
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![-\w])|\b(?:rgba?|hsla?)\(/;
// The browser UI colour meta tag can't read CSS variables.
const EXEMPT_LINES = [/name="theme-color"/];

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(js|jsx|css|mjs)$/.test(name) ? [path] : [];
  });
}

test('no colour literals outside the token file', () => {
  const bad = [];
  for (const file of ['components', 'pages', 'styles', 'lib'].flatMap(dir => files(join(ROOT, dir)))) {
    if (file.endsWith('styles/tokens.css')) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (LITERAL.test(line) && !EXEMPT_LINES.some(rule => rule.test(line))) bad.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('every token has a dark value', () => {
  const css = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
  const light = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='dark'] {"));
  const dark = css.slice(css.indexOf("[data-theme='dark'] {"));
  const colour = /^\s*(--[\w-]+):\s*(#|rgba?\()/gm;
  const missing = [...light.matchAll(colour)].map(m => m[1]).filter(name => !dark.includes(name + ':') && !/^--google-/.test(name));
  assert.deepEqual(missing, []);
});
