import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rememberReturnTo, safeReturnTo, takeReturnTo } from '../lib/returnTo.mjs';

const store = new Map();
globalThis.sessionStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

test('only Assistant paths are followed after sign-in', () => {
  assert.equal(safeReturnTo('/assistant'), '/assistant');
  assert.equal(safeReturnTo('/assistant/app/schedule'), '/assistant/app/schedule');
  assert.equal(safeReturnTo('/assistant/app?tab=nudges'), '/assistant/app?tab=nudges');
  for (const bad of ['/dashboard', '//evil.example', 'https://evil.example/assistant', '/assistantx', '/assistant/../settings', null, undefined, 42]) {
    assert.equal(safeReturnTo(bad), null, String(bad));
  }
});

test('the return path survives one round trip and is used once', () => {
  assert.equal(rememberReturnTo('/assistant/app'), '/assistant/app');
  assert.equal(takeReturnTo(), '/assistant/app');
  assert.equal(takeReturnTo(), null);
  assert.equal(rememberReturnTo('https://evil.example'), null);
  assert.equal(takeReturnTo(), null);
});

test('/assistant is forwarded to the Assistant app, and the nav opens Settings › Assistant', () => {
  const config = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8');
  assert.match(config, /source: '\/assistant\/:path\*', destination: `\$\{assistantUrl\}\/assistant\/:path\*`/);
  const sidebar = readFileSync(new URL('../components/Sidebar.js', import.meta.url), 'utf8');
  assert.match(sidebar, /label: 'Assistant', href: '\/settings\?section=assistant'/);
});
