import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FEATURE_STEPS, pendingSteps } from '../lib/featureOnboarding.mjs';

const STEPS = [
  { id: 'step-old', added: '2026-10-01', title: 'Old' },
  { id: 'step-new', added: '2026-11-06', title: 'New' },
  { id: 'step-newer', added: '2026-11-08', title: 'Newer' },
];
const NONE = { announced: [], opened: [], dismissed: [] };

test('a student who onboarded before a feature shipped sees only the newer steps, oldest first', () => {
  const onboarding = { completed: true, completed_at: '2026-10-20T15:00:00Z' };
  assert.deepEqual(pendingSteps(onboarding, NONE, STEPS).map(step => step.id), ['step-new', 'step-newer']);
});

test('a new student whose onboarding covered everything sees none', () => {
  assert.deepEqual(pendingSteps({ completed: true, completed_at: '2026-11-09T09:00:00Z' }, NONE, STEPS), []);
});

test('a step finished (opened) or dismissed on any device never shows again', () => {
  const onboarding = { completed: true, completed_at: '2026-10-20T15:00:00Z' };
  assert.deepEqual(pendingSteps(onboarding, { ...NONE, opened: ['step-new'], dismissed: ['step-newer'] }, STEPS), []);
  // Being announced is not finishing it.
  assert.equal(pendingSteps(onboarding, { ...NONE, announced: ['step-new'] }, STEPS).length, 2);
});

test('nothing shows during or before the main onboarding', () => {
  assert.deepEqual(pendingSteps({ completed: false, completed_at: null }, NONE, STEPS), []);
  assert.deepEqual(pendingSteps(null, NONE, STEPS), []);
});

test('a finished onboarding with no date (older accounts) gets every step', () => {
  assert.equal(pendingSteps({ completed: true, completed_at: null }, NONE, STEPS).length, 3);
});

test('step ids are unique, dated, fit What\'s new\'s id format and never collide with a release', async () => {
  const { FEATURE_RELEASES } = await import('../lib/featureReleases.js');
  const releases = new Set(FEATURE_RELEASES.map(release => release.id));
  assert.equal(new Set(FEATURE_STEPS.map(step => step.id)).size, FEATURE_STEPS.length);
  for (const step of FEATURE_STEPS) {
    assert.match(step.added, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(step.id, /^step-[a-z0-9-]{1,34}$/);
    assert.ok(!releases.has(step.id));
  }
});

test('steps are kept with What\'s new and share its one announcement surface', async () => {
  const source = await readFile(new URL('../components/FeatureOnboarding.js', import.meta.url), 'utf8');
  assert.match(source, /claimSurface\('feature-step'\)/);
  assert.match(source, /dismissFeature\(step\.id\)/);
  assert.doesNotMatch(source, /\/onboarding\/features\//);
});
