// Feedback 14: every tab bar and segmented switch is the shared SegmentedControl with a sliding pill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const web = new URL('..', import.meta.url).pathname;

test('no hand-built c-seg containers are left', () => {
  const hits = execSync(`grep -rlnE 'className=("|\\{.)c-seg[ "]' components pages --include=*.js || true`, { cwd: web }).toString().trim();
  assert.equal(hits, '');
});

test('the control slides a transform-based pill, handles keys, and respects reduced motion', async () => {
  const source = await readFile(new URL('../components/SegmentedControl.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles/system.css', import.meta.url), 'utf8');
  const tokens = await readFile(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  assert.match(source, /transform: `translate3d\(/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(source, new RegExp(key));
  assert.match(source, /tabs: 'tablist', radio: 'radiogroup'/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.c-seg\.is-ready \.c-seg-pill \{ transition: none; \}/);
  // DESIGN-SPEC 6.1: a state change is 180ms on the shared ease, and a keyboard change has no transition.
  assert.match(tokens, /--seg-ease: var\(--ease\);/);
  assert.match(tokens, /--seg-dur: var\(--dur\);/);
  assert.doesNotMatch(tokens, /--seg-spring/);
  assert.match(css, /\.c-seg\.is-ready\.is-keyed \.c-seg-pill \{ transition: none; \}/);
  assert.match(source, /setKeyed\(true\)/);
  assert.match(tokens, /--lg-inner-stroke:/);
});
