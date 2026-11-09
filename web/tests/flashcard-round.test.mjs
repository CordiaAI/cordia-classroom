import test from 'node:test';
import assert from 'node:assert/strict';
import { againStep, gotItStep, roundResults } from '../lib/flashcardRound.mjs';
import { INTERVALS, addDays, applyResults, scheduleChanges } from '../lib/spacedReview.mjs';

const day = key => new Date(`${key}T10:00:00`);

test('a card missed once in a round goes back to the first box, even after a later Got it', () => {
  // Card 0 was in box 2, card 1 in box 1, from earlier rounds.
  const before = { known: [0, 1], unknown: [], schedule: { 0: { box: 2, due: '2026-10-22' }, 1: { box: 1, due: '2026-10-22' } } };

  let round = { queue: [0, 1], known: [], missed: new Set() };
  round = againStep(round); // card 0: Again, to the back
  assert.deepEqual(round.queue, [1, 0]);
  round = gotItStep(round); // card 1: Got it
  round = gotItStep(round); // card 0: Got it
  assert.deepEqual(round.queue, []);

  const results = roundResults(round);
  assert.deepEqual(results, { known: [1, 0], missed: [0] });

  const after = applyResults(before, results, day('2026-10-22'));
  assert.equal(after.schedule[0].box, 0);
  assert.equal(after.schedule[0].due, addDays('2026-10-22', INTERVALS[0]));
  assert.deepEqual(after.schedule[1], { box: 2, due: addDays('2026-10-22', INTERVALS[2]) });
  assert.deepEqual(after.known, [1]);
  assert.deepEqual(after.unknown, [0]);

  // What gets saved (lib/progressSave.js): card 0 as not known, back tomorrow.
  const saved = scheduleChanges(after, [...results.known, ...results.missed]);
  assert.deepEqual(saved[0], { box: 0, due: '2026-10-23', known: false });
  assert.deepEqual(saved[1], { box: 2, due: addDays('2026-10-22', INTERVALS[2]), known: true });
});

test('a round with no misses moves every card up a box (a new card starts in the first)', () => {
  let round = { queue: [0, 1], known: [], missed: new Set() };
  round = gotItStep(gotItStep(round));
  const results = roundResults(round);
  assert.deepEqual(results, { known: [0, 1], missed: [] });
  const after = applyResults({}, results, day('2026-10-22'));
  assert.equal(after.schedule[0].box, 0);
  assert.equal(after.schedule[1].box, 0);
  const next = applyResults(after, results, day('2026-10-23'));
  assert.equal(next.schedule[0].box, 1);
});
