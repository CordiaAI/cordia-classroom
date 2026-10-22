import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS, addDays, applyResults, dueIndices, nextDueDay } from '../lib/spacedReview.mjs';

const day = (key, hour = 10) => new Date(`${key}T${String(hour).padStart(2, '0')}:00:00`);

test('new cards are due now; a card climbs a box each time it is known and resets when missed', () => {
  assert.deepEqual(dueIndices({}, 3, '2026-10-22'), [0, 1, 2]);
  let progress = applyResults({}, { known: [0, 1], missed: [2] }, day('2026-10-22'));
  assert.deepEqual(progress.schedule[0], { box: 0, due: '2026-10-23' });
  assert.deepEqual(progress.schedule[2], { box: 0, due: '2026-10-23' });
  assert.deepEqual(dueIndices(progress, 3, '2026-10-22'), []);
  assert.deepEqual(dueIndices(progress, 3, '2026-10-23'), [0, 1, 2]);
  assert.equal(nextDueDay(progress, 3, '2026-10-22'), '2026-10-23');

  // Known again the next day: box 1, back in 2 days. Missed: back to tomorrow.
  progress = applyResults(progress, { known: [0, 2], missed: [1] }, day('2026-10-23'));
  assert.deepEqual(progress.schedule[0], { box: 1, due: addDays('2026-10-23', INTERVALS[1]) });
  assert.deepEqual(progress.schedule[1], { box: 0, due: '2026-10-24' });
  assert.deepEqual(progress.known.sort(), [0, 2]);
  assert.deepEqual(progress.unknown, [1]);
});

test('the box tops out at 30 days', () => {
  let progress = {};
  let today = '2026-01-01';
  for (let round = 0; round < 10; round += 1) {
    progress = applyResults(progress, { known: [0] }, day(today));
    if (round < 9) today = progress.schedule[0].due;
  }
  assert.equal(progress.schedule[0].box, INTERVALS.length - 1);
  assert.equal(progress.schedule[0].due, addDays(today, 30));
});

test('cards known before scheduling come back a week after they were last studied', () => {
  const legacy = { known: [0], unknown: [1], last_studied: day('2026-10-01').toISOString() };
  assert.deepEqual(dueIndices(legacy, 3, '2026-10-05'), [1, 2]);
  assert.deepEqual(dueIndices(legacy, 3, '2026-10-08'), [0, 1, 2]);
  // Known again: it starts above the first box, since it was already known once.
  const next = applyResults(legacy, { known: [0] }, day('2026-10-08'));
  assert.equal(next.schedule[0].box, 2);
});

test('a session never wipes earlier progress on cards it did not show', () => {
  const before = applyResults({}, { known: [0, 1] }, day('2026-10-20'));
  const after = applyResults(before, { known: [2] }, day('2026-10-22'));
  assert.deepEqual(after.schedule[0], before.schedule[0]);
  assert.deepEqual(after.known.sort(), [0, 1, 2]);
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
});
