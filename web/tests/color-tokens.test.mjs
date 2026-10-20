// Colors live only in styles/tokens.css. Any hex or rgb() literal elsewhere fails this test.
// One exception: the <meta name="theme-color"> in pages/_document.js (browsers need a literal).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![-\w])|rgba?\(\s*\d/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'public', 'tests'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(css|js|mjs)$/.test(name)) yield path;
  }
}

const offenders = [];
for (const path of files(web)) {
  const rel = relative(web, path);
  if (rel === join('styles', 'tokens.css') || rel.endsWith('.config.js')) continue;
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (rel === join('pages', '_document.js') && line.includes('name="theme-color"')) return;
    // Hash links and ids in JS strings (e.g. "#grove") are not colors.
    const matches = [...line.matchAll(LITERAL)].filter(match => !/#[0-9a-fA-F]{3,4}$/.test(match[0]) || !/['"`]#[a-z-]+/.test(line));
    if (matches.length) offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 100)}`);
  });
}
assert.deepEqual(offenders, [], `Color literals outside styles/tokens.css:\n${offenders.join('\n')}`);
console.log('Color tokens test passed');
