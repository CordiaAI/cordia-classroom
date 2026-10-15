import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWED = new Set(['639px', '640px', '1023px', '1024px', '1279px', '1280px']);

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(js|css|mjs)$/.test(name) ? [path] : [];
  });
}

test('only the 640 / 1024 / 1280 breakpoints are used', () => {
  const bad = [];
  for (const file of ['components', 'pages', 'styles', 'lib'].flatMap(dir => files(join(ROOT, dir)))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\((?:max|min)-width:\s*([0-9.]+px)\)/g)) {
      if (!ALLOWED.has(match[1])) bad.push(`${file.replace(ROOT, '')}: ${match[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
