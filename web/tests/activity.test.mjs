import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLine, whenLabel } from '../lib/activityText.mjs';

test('activity lines', () => {
  assert.deepEqual(activityLine({ kind: 'guide_published', guide: { id: 'g1', title: 'Cells' } }), { text: 'shared a new public guide', link: { href: '/sets/g1', label: 'Cells' } });
  assert.equal(activityLine({ kind: 'classroom_guide', classroom: { id: 'r1', name: 'Bio group' }, guide: { id: 'g2', title: 'ATP' } }).text, 'added a guide to Bio group');
  assert.deepEqual(activityLine({ kind: 'classroom_guide', classroom: { id: 'r1', name: 'Bio group' }, folder: { id: 'f', name: 'Unit 1' } }).link, { href: '/classrooms/r1', label: 'Unit 1' });
  assert.equal(activityLine({ kind: 'streak', days: 30 }).text, 'reached a 30-day study streak');
  assert.equal(activityLine({ kind: 'comment' }).text, '', 'nothing else is ever shown');
});

test('when labels', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(whenLabel('2026-11-20T08:00:00Z', now), 'Today');
  assert.equal(whenLabel('2026-11-19T08:00:00Z', now), 'Yesterday');
  assert.equal(whenLabel('2026-11-16T08:00:00Z', now), '4 days ago');
});
