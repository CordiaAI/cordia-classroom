import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILIAR, LEARNING, MASTERED, NEW, ROUND_SIZE,
  answer, askType, counts, createRound, currentCard, fingerprint, linkedTestDate, pickRound, readiness, restoreLevels, saveableLevels, testPlan,
} from '../lib/learnEngine.mjs';

const q = (question, answerText) => ({ question, options: [answerText, 'x', 'y', 'z'], correct_index: 0 });
const term = q('What organelle makes ATP?', 'Mitochondria');
const long = q('Why does the market price fall when supply rises?', 'Sellers compete for the same buyers, so each must offer a lower price to make a sale');
const TODAY = '2026-10-28';

test('new ideas start as multiple choice; familiar ones are recalled in the right format', () => {
  const levels = restoreLevels([term, long], {});
  assert.equal(askType(term, levels[0], TODAY), 'mc');
  assert.equal(askType(term, { l: FAMILIAR }, TODAY), 'fill');
  assert.equal(askType(long, { l: FAMILIAR }, TODAY), 'written');
});

test('mastery needs recall: choices move an idea to Familiar at most', () => {
  let levels = restoreLevels([term], {});
  let round = createRound([term], levels, TODAY);
  ({ levels, round } = answer(levels, round, currentCard(round), 1, { confidence: 'think', today: TODAY }));
  assert.equal(levels[0].l, LEARNING);
  ({ levels } = answer(levels, round, { ...currentCard(round), type: 'mc' }, 1, { confidence: 'sure', today: TODAY }));
  assert.equal(levels[0].l, FAMILIAR);
  ({ levels } = answer(levels, round, { ...currentCard(round), type: 'fill', recall: true }, 1, { today: TODAY }));
  assert.equal(levels[0].l, MASTERED);
});

test('a new idea known for sure skips to Familiar; a lucky guess does not move it up', () => {
  const start = restoreLevels([term], {});
  const round = createRound([term], start, TODAY);
  assert.equal(answer(start, round, currentCard(round), 1, { confidence: 'sure', today: TODAY }).levels[0].l, FAMILIAR);
  const guessed = answer({ 0: { l: LEARNING, at: null } }, round, currentCard(round), 1, { confidence: 'guess', today: TODAY });
  assert.equal(guessed.levels[0].l, LEARNING);
});

test('a miss drops to Learning, is asked again in the round, and a sure miss comes first next time', () => {
  const start = { 0: { l: FAMILIAR, at: null }, 1: { l: NEW, at: null } };
  let round = createRound([term, long], start, TODAY);
  const card = round.queue.find(item => item.concept === 0);
  const result = answer(start, round, card, 0, { confidence: 'sure', today: TODAY });
  assert.equal(result.levels[0].l, LEARNING);
  assert.equal(result.levels[0].sure, true);
  assert.equal(result.round.queue.length, 3);
  assert.equal(result.round.queue.at(-1).concept, 0);
  assert.equal(result.round.queue.at(-1).type, 'mc');
  assert.deepEqual(pickRound([term, long], result.levels, TODAY), [0, 1]);
  const again = answer(result.levels, result.round, result.round.queue.at(-1), 1, { confidence: 'sure', today: TODAY });
  assert.equal(again.levels[0].l, LEARNING);
});

test('rounds hold at most seven ideas and skip mastered ones unless they are fading', () => {
  const questions = Array.from({ length: 12 }, (_, i) => q(`Question ${i}?`, `Answer ${i}`));
  const levels = restoreLevels(questions, {});
  levels[0] = { l: MASTERED, at: TODAY };
  levels[1] = { l: MASTERED, at: '2026-10-20' };
  const round = pickRound(questions, levels, TODAY);
  assert.equal(round.length, ROUND_SIZE);
  assert.ok(!round.includes(0));
  const allMastered = Object.fromEntries(questions.map((_, i) => [i, { l: MASTERED, at: i === 1 ? '2026-10-20' : TODAY }]));
  assert.deepEqual(pickRound(questions, allMastered, TODAY), [1]);
});

test('saved progress is kept only for questions that have not changed', () => {
  const saved = saveableLevels([term, long], { 0: { l: MASTERED, at: TODAY }, 1: { l: NEW, at: null } });
  assert.deepEqual(Object.keys(saved), ['0']);
  assert.equal(saved[0].q, fingerprint(term));
  assert.equal(restoreLevels([term, long], saved)[0].l, MASTERED);
  assert.equal(restoreLevels([long, term], saved)[0].l, NEW);
});

test('readiness and the daily target before a test', () => {
  const tally = counts([term, long], { 0: { l: MASTERED, at: TODAY }, 1: { l: FAMILIAR, at: TODAY } }, TODAY);
  assert.equal(tally.mastered, 1);
  assert.equal(readiness(tally), 75);
  assert.deepEqual(testPlan(tally, '2026-10-30', TODAY), { daysLeft: 2, remaining: 1, perDay: 1, past: false });
  assert.equal(testPlan(tally, '2026-10-27', TODAY).past, true);
  assert.equal(testPlan(tally, '', TODAY), null);
});

test('the ways to learn decide each card, and recall still masters with any of them', async () => {
  const { askCard, cleanTypes, DEFAULT_TYPES } = await import('../lib/learnEngine.mjs');
  assert.deepEqual(cleanTypes([]), DEFAULT_TYPES);
  assert.deepEqual(askCard(term, { l: NEW }, TODAY, ['fill', 'written']), { type: 'fill', recall: false });
  assert.deepEqual(askCard(long, { l: FAMILIAR }, TODAY, ['mc', 'self']), { type: 'self', recall: true });
  assert.deepEqual(askCard(long, { l: FAMILIAR }, TODAY, ['mc']), { type: 'mc', recall: true });
  const levels = { 0: { l: FAMILIAR, at: null } };
  const round = createRound([term], levels, TODAY, ['mc']);
  const card = currentCard(round);
  assert.equal(card.type, 'mc');
  assert.equal(answer(levels, round, card, 1, { confidence: 'sure', today: TODAY }).levels[0].l, MASTERED);
});

test('a test date from a link is taken when none is saved or it is still ahead', () => {
  assert.equal(linkedTestDate('2026-11-05', '', TODAY), '2026-11-05');
  assert.equal(linkedTestDate('2026-11-05', '2026-11-20', TODAY), '2026-11-05');
  assert.equal(linkedTestDate('2026-11-05', '2026-11-05', TODAY), '');
  assert.equal(linkedTestDate('2026-10-27', '', TODAY), '');
  assert.equal(linkedTestDate(TODAY, '', TODAY), TODAY);
  assert.equal(linkedTestDate(TODAY, '2026-11-01', TODAY), '');
  assert.equal(linkedTestDate('nope', '', TODAY), '');
});
