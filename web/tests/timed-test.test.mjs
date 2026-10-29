import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIAR, LEARNING, MASTERED, NEW } from '../lib/learnEngine.mjs';
import { applyTest, buildTest, clock, markLocal, testResults, timeLimitSeconds } from '../lib/timedTest.mjs';

const q = (question, answer) => ({ question, options: [answer, 'x', 'y', 'z'], correct_index: 0 });
const term = q('What organelle makes ATP?', 'Mitochondria');
const long = q('Why does the market price fall when supply rises?', 'Sellers compete for the same buyers, so each must offer a lower price to make a sale');
const questions = [term, long, q('Who painted the Sistine ceiling?', 'Michelangelo'), q('What is a tort?', 'A civil wrong that causes harm and leads to liability'), { question: 'No answer', options: [] }];

test('every idea with an answer is asked once, in a mix of the chosen ways that suit it', () => {
  const items = buildTest(questions, ['mc', 'fill', 'written'], 7);
  assert.deepEqual(items.map(item => item.concept).sort(), [0, 1, 2, 3]);
  assert.ok(new Set(items.map(item => item.type)).size > 1);
  items.filter(item => item.type === 'fill').forEach(item => assert.ok([0, 2].includes(item.concept)));
});

test('flashcards alone become choices; Type it writes long answers; Fill the blank needs a long enough answer', () => {
  assert.ok(buildTest(questions, ['self'], 3).every(item => item.type === 'mc'));
  assert.deepEqual(buildTest([long], ['type'], 1).map(item => item.type), ['written']);
  assert.deepEqual(buildTest([long], ['cloze'], 1).map(item => item.type), ['cloze']);
  assert.deepEqual(buildTest([term], ['cloze'], 1).map(item => item.type), ['fill']);
});

test('the clock: a minute per question by default, and the student can pick half or two', () => {
  assert.equal(timeLimitSeconds(20), 1200);
  assert.equal(timeLimitSeconds(20, 0.5), 600);
  assert.equal(timeLimitSeconds(20, 2), 2400);
  assert.equal(timeLimitSeconds(20, 7), 1200);
  assert.equal(clock(605), '10:05');
  assert.equal(clock(-3), '0:00');
});

test('choices and typed answers are marked locally; written ones wait for AI', () => {
  assert.equal(markLocal({ type: 'mc' }, term, 'Mitochondria'), 1);
  assert.equal(markLocal({ type: 'mc' }, term, 'x'), 0);
  assert.equal(markLocal({ type: 'fill' }, term, 'mitochondria'), 1);
  assert.equal(markLocal({ type: 'fill' }, term, ''), 0);
  assert.equal(markLocal({ type: 'written' }, long, 'Because of competition'), null);
  assert.equal(markLocal({ type: 'cloze' }, long, 'compete'), 0);
  assert.equal(markLocal({ type: 'cloze' }, long, 'sellers'), 1, 'the blank is the answer\'s longest meaningful word');
});

test('score counts unanswered as missed and leaves unchecked answers out', () => {
  const items = [0, 1, 2, 3].map(id => ({ id, concept: id, type: 'mc' }));
  const result = testResults(items, { 0: 1, 1: 0.5, 3: null });
  assert.equal(result.checked, 3);
  assert.equal(result.score, 50);
  assert.equal(result.right, 1);
  assert.deepEqual(result.missed.map(item => item.id), [1, 2]);
  assert.deepEqual(result.unchecked.map(item => item.id), [3]);
});

test('missed ideas drop to Learning for Learn; the others keep their level', () => {
  const levels = { 0: { l: MASTERED, at: '2026-10-01' }, 1: { l: NEW, at: null }, 2: { l: FAMILIAR, at: '2026-10-20' } };
  const next = applyTest(levels, [{ concept: 0 }, { concept: 1 }], '2026-10-29');
  assert.deepEqual(next[0], { l: LEARNING, at: '2026-10-29' });
  assert.equal(next[1].l, LEARNING);
  assert.equal(next[2], levels[2]);
});
