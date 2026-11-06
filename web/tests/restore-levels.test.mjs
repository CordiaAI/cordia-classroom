import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, restoreLevels } from '../lib/learnEngine.mjs';

const q = text => ({ question: text, options: ['a', 'b'], correct_index: 0 });

test('a saved level follows its question when the author reorders or inserts questions', () => {
  const before = [q('What is lead time?'), q('What is safety stock?')];
  const saved = { 0: { l: 3, at: '2026-11-01', q: fingerprint(before[0]) }, 1: { l: 1, at: '2026-11-02', q: fingerprint(before[1]) } };
  const after = [q('What is a reorder point?'), q('What is safety stock?'), q('What is lead time?')];
  const levels = restoreLevels(after, saved);
  assert.equal(levels[0].l, 0, 'the new question starts fresh');
  assert.equal(levels[1].l, 1);
  assert.equal(levels[2].l, 3);
});

test('a level whose question changed is not restored', () => {
  const saved = { 0: { l: 2, at: '2026-11-01', q: fingerprint(q('What is lead time?')) } };
  assert.equal(restoreLevels([q('What does lead time measure in a factory?')], saved)[0].l, 0);
});
