import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUESTIONS, clampCount, minutesFor, quizLimit, recommendedCount } from '../lib/quizLength.mjs';

test('the limit is the guide\'s questions, never over 50', () => {
  assert.equal(quizLimit(8), 8);
  assert.equal(quizLimit(120), MAX_QUESTIONS);
  assert.equal(quizLimit(0), 0);
  assert.equal(quizLimit('x'), 0);
});

test('recommended: everything for short guides, about half (10 to 20) for longer ones', () => {
  assert.equal(recommendedCount(6), 6);
  assert.equal(recommendedCount(10), 10);
  assert.equal(recommendedCount(14), 10);
  assert.equal(recommendedCount(30), 15);
  assert.equal(recommendedCount(50), 20);
  assert.equal(recommendedCount(200), 20);
  for (let n = 1; n <= 60; n += 1) assert.ok(recommendedCount(n) <= quizLimit(n));
});

test('picked counts stay between 1 and the limit', () => {
  assert.equal(clampCount(0, 30), 1);
  assert.equal(clampCount(99, 30), 30);
  assert.equal(clampCount(7.6, 30), 8);
  assert.equal(clampCount('abc', 30), 15, 'nonsense falls back to the recommendation');
  assert.equal(clampCount(5, 0), 0);
});

test('time hint', () => {
  assert.equal(minutesFor(1), 'about 1 minute');
  assert.equal(minutesFor(20), 'about 10 minutes');
});
