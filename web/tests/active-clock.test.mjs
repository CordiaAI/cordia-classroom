// Study time is active time: a hidden tab or ten idle minutes stop the clock, so a tab left open
// overnight no longer logs 24 hours.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const source = readFileSync(join(web, 'lib/activeClock.js'), 'utf8')
  .replace("import { useEffect, useRef } from 'react';", 'const useEffect = () => {}; const useRef = () => ({});');

let now = 0;
Date.now = () => now;
const listeners = {};
const on = (name, fn) => { listeners[name] = fn; };
const off = name => { delete listeners[name]; };
globalThis.document = { hidden: false, addEventListener: on, removeEventListener: off };
globalThis.window = { addEventListener: on, removeEventListener: off };
const { activeClock, IDLE_MS } = await import('data:text/javascript,' + encodeURIComponent(source));
const minutes = value => value * 60000;
const input = () => listeners.pointerdown();
const hide = hidden => { document.hidden = hidden; listeners.visibilitychange(); };

test('time counts while the student is active', () => {
  now = 0;
  const clock = activeClock();
  for (let minute = 1; minute <= 20; minute += 1) { now = minutes(minute); input(); }
  assert.equal(clock.seconds(), 20 * 60);
  clock.stop();
});

test('an idle page stops counting ten minutes after the last input', () => {
  now = 0;
  const clock = activeClock();
  now = minutes(2); input();
  now = minutes(60 * 8); // left open overnight
  assert.equal(clock.seconds(), (2 * 60000 + IDLE_MS) / 1000);
  now += minutes(1); input(); now += minutes(1);
  assert.equal(clock.seconds(), (3 * 60000 + IDLE_MS) / 1000, 'counting resumes with input, without the idle gap');
  clock.stop();
});

test('a hidden tab does not count', () => {
  now = 0;
  const clock = activeClock();
  now = minutes(1); input();
  now = minutes(2); hide(true);
  now = minutes(300); // a background tab for hours
  assert.equal(clock.seconds(), 120);
  hide(false);
  now = minutes(303); input();
  assert.equal(clock.seconds(), 300);
  clock.reset();
  assert.equal(clock.seconds(), 0);
  clock.stop();
  assert.equal(listeners.visibilitychange, undefined, 'stop removes its listeners');
});
