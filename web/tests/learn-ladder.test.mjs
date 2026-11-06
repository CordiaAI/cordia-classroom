import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINAL_DAYS, LADDER_DEFAULT, MIN_GAP, answerLadder, askLadder, blankFor, createLadderRound, finalCheckTypes, ladderDecision,
  ladderTypes, masteryFormat, onlyRecognition, pickLadderRound, validBlank,
} from '../lib/learnLadder.mjs';
import { FAMILIAR, LEARNING, MASTERED, NEW, askCard, answer as oldAnswer, createRound } from '../lib/learnEngine.mjs';

const TODAY = '2026-11-05';
const mcq = (question, answer, extra = {}) => ({ question, options: ['Wrong one', answer, 'Wrong two'], correct_index: 1, ...extra });
const term = mcq('What makes ATP?', 'Mitochondria');
const long = mcq('Why do cells need ATP?', 'Cells use ATP to power reactions that need energy, such as building proteins',
  { blank: { span: 'power reactions' } });
const longNoBlank = mcq('How does diffusion work?', 'Particles move from high concentration to low concentration until balanced');
const entry = l => ({ l, at: null, sure: false });

test('saved tiles map across: Type it covers Fill in the blank and Written; Fill the blank becomes Fill in the blank', () => {
  assert.deepEqual(ladderTypes(['mc', 'type']), ['mc', 'fill', 'written']);
  assert.deepEqual(ladderTypes(['cloze']), ['fill']);
  assert.deepEqual(ladderTypes(['self', 'mc']), ['mc', 'self']);
  assert.deepEqual(ladderTypes(null), LADDER_DEFAULT);
  assert.deepEqual(ladderTypes(['nonsense']), LADDER_DEFAULT);
  assert.equal(onlyRecognition(['mc', 'self']), true);
  assert.equal(onlyRecognition(['mc', 'type']), false);
});

test('blank validation: present in the answer, short, never the whole long answer', () => {
  const answer = 'Cells use ATP to power reactions that need energy';
  assert.equal(validBlank(answer, 'power reactions'), true);
  assert.equal(validBlank(answer, 'Power reactions'), false, 'must appear exactly');
  assert.equal(validBlank(answer, 'missing words'), false);
  assert.equal(validBlank(answer, 'use ATP to power reactions that need'), false, 'over six words');
  assert.equal(validBlank(answer, answer), false, 'the whole long answer');
  assert.equal(validBlank(answer, ' , '), false);
  assert.deepEqual(blankFor(term), { whole: true });
  assert.deepEqual(blankFor(long), { before: 'Cells use ATP to ', missing: 'power reactions', after: ' that need energy, such as building proteins' });
  assert.equal(blankFor(longNoBlank), null, 'no saved blank: Written');
  assert.equal(blankFor({ ...long, blank: { span: 'not in it' } }), null, 'a bad saved blank falls back to Written');
});

test('ladder: recognition first, recall to master, for every tile combination', () => {
  const combos = [['mc', 'fill', 'written'], ['mc', 'fill'], ['mc', 'written'], ['mc'], ['self'], ['fill'], ['written'], ['self', 'fill', 'written']];
  for (const types of combos) {
    for (const question of [term, long, longNoBlank]) {
      const fresh = askLadder(question, entry(NEW), { types, today: TODAY });
      const firstRecognition = types.find(type => type === 'mc' || type === 'self');
      if (firstRecognition) assert.equal(fresh.format, firstRecognition, `${types}: new ideas are recognised`);
      assert.equal(fresh.recall, false);
      const familiar = askLadder(question, entry(FAMILIAR), { types, today: TODAY });
      assert.equal(familiar.recall, true, `${types}: familiar ideas are recalled`);
      assert.ok(['fill', 'written'].includes(familiar.format), `${types} ${question.question}: mastery is a recall format, got ${familiar.format}`);
    }
  }
});

test('mastery format: short answers fill, longer ones written; tiles respected', () => {
  assert.equal(masteryFormat(term, ['mc', 'fill', 'written']).format, 'fill');
  assert.equal(masteryFormat(long, ['mc', 'fill', 'written']).format, 'written');
  assert.equal(masteryFormat(long, ['mc', 'fill']).format, 'fill', 'Written off: Fill in the blank masters what it can');
  assert.equal(masteryFormat(longNoBlank, ['mc', 'fill']).format, 'written', '...and Written takes the rest');
  assert.equal(masteryFormat(term, ['mc', 'written']).format, 'written', 'Fill off: Written masters');
  assert.equal(masteryFormat(term, ['mc']).format, 'fill', 'both off: the length rule');
  assert.equal(masteryFormat(long, ['mc']).format, 'written');
});

test('an idea climbs only through the formats it needs', () => {
  const questions = [term];
  let levels = { 0: entry(NEW) };
  const ctx = { types: ['mc', 'fill', 'written', 'self'], today: TODAY, questions };
  let round = createLadderRound(questions, levels, ctx);
  const seen = [];
  for (let step = 0; step < 2; step += 1) {
    const card = round.queue[round.position];
    seen.push(card.format);
    ({ levels, round } = answerLadder(levels, round, card, 1, { confidence: 'sure', today: TODAY, ctx }));
    round = createLadderRound(questions, levels, ctx);
  }
  assert.deepEqual(seen, ['mc', 'fill']);
  assert.equal(levels[0].l, MASTERED);
});

test('Choice-only no longer masters: a right choice at Familiar is impossible, recall is asked instead', () => {
  const ask = askLadder(term, entry(FAMILIAR), { types: ['mc'], today: TODAY });
  assert.equal(ask.format, 'fill');
  assert.equal(ask.recall, true);
  const questions = [term];
  const ctx = { types: ['mc'], today: TODAY, questions };
  const round = createLadderRound(questions, { 0: entry(NEW) }, ctx);
  const { levels } = answerLadder({ 0: entry(NEW) }, round, round.queue[0], 1, { confidence: 'sure', today: TODAY, ctx });
  assert.equal(levels[0].l, FAMILIAR, 'a right choice stops at Familiar');
});

test('free plan without Fill in the blank: Written masters, and Mastered is always reachable', () => {
  const ask = askLadder(term, entry(FAMILIAR), { types: ['mc', 'fill', 'written'], today: TODAY, fillAvailable: false });
  assert.equal(ask.format, 'written');
  assert.equal(ask.fallback, true);
  for (const types of [['mc'], ['mc', 'fill'], ['fill'], ['self']]) {
    for (const question of [term, long, longNoBlank]) {
      const questions = [question];
      const ctx = { types, today: TODAY, fillAvailable: false, questions };
      let levels = { 0: entry(NEW) };
      for (let i = 0; i < 3 && levels[0].l !== MASTERED; i += 1) {
        const round = createLadderRound(questions, levels, ctx);
        assert.notEqual(round.queue[0].format, 'fill', 'never asks a Fill in the blank it can\'t give');
        ({ levels } = answerLadder(levels, round, round.queue[0], 1, { confidence: 'sure', today: TODAY, ctx }));
      }
      assert.equal(levels[0].l, MASTERED, `${types} ${question.question}`);
    }
  }
  const round = createLadderRound([term], { 0: entry(FAMILIAR) }, { types: ['mc', 'fill'], today: TODAY, fillAvailable: false, questions: [term] });
  const after = answerLadder({ 0: entry(FAMILIAR) }, round, round.queue[0], 1, { today: TODAY, ctx: { questions: [term] } });
  assert.equal(after.round.fallbackUsed, true, 'the round notes the fallback for the after-round line');
});

test('a miss drops one level and comes back at least four questions later, or first next round', () => {
  const questions = Array.from({ length: 7 }, (_, i) => mcq(`Question ${i}?`, `Answer ${i}`));
  const levels = Object.fromEntries(questions.map((_, i) => [i, entry(FAMILIAR)]));
  const ctx = { types: ['mc', 'fill', 'written'], today: TODAY, questions };
  let round = createLadderRound(questions, levels, ctx);
  let out = answerLadder(levels, round, round.queue[0], 0, { today: TODAY, ctx });
  assert.equal(out.levels[0].l, LEARNING, 'down one level');
  const at = out.round.queue.findIndex(card => card.again);
  assert.ok(at - 0 - 1 >= MIN_GAP, `retry at ${at}`);
  assert.equal(out.round.queue[at].format, 'mc', 'asked in the format for its new level');
  // Too late in the round: carried to the next round, first.
  round = { ...out.round, position: 5 };
  out = answerLadder(out.levels, round, round.queue[5], 0, { today: TODAY, ctx });
  assert.deepEqual(out.round.carry, [round.queue[5].concept]);
  assert.equal(out.round.queue.filter(card => card.again).length, 1);
  const next = pickLadderRound(questions, out.levels, TODAY, out.round.carry);
  assert.equal(next[0], round.queue[5].concept);
});

test('confident misses still come back first', () => {
  const questions = Array.from({ length: 12 }, (_, i) => mcq(`Question ${i}?`, `Answer ${i}`));
  const levels = Object.fromEntries(questions.map((_, i) => [i, entry(LEARNING)]));
  const ctx = { types: ['mc', 'fill', 'written'], today: TODAY, questions };
  let round = createLadderRound(questions, levels, ctx);
  let out = answerLadder(levels, round, round.queue[0], 0, { confidence: 'guess', today: TODAY, ctx });
  round = { ...out.round, position: 1 };
  out = answerLadder(out.levels, round, round.queue[1], 0, { confidence: 'sure', today: TODAY, ctx });
  const retries = out.round.queue.filter(card => card.again).map(card => card.concept);
  assert.deepEqual(retries, [round.queue[1].concept, round.queue[0].concept]);
  assert.equal(out.levels[round.queue[1].concept].sure, true);
  // Carried: the confident one first.
  const carried = pickLadderRound(questions, { ...out.levels }, TODAY, [round.queue[0].concept, round.queue[1].concept]);
  assert.equal(carried[0], round.queue[1].concept);
});

test('final days lean to the test format for reviews only, and never lower the bar', () => {
  const testDate = '2026-11-07';
  const ctx = (testFormat, extra = {}) => ({ types: ['mc', 'fill', 'written'], today: TODAY, testDate, testFormat, ...extra });
  // Essay: written reviews.
  assert.equal(askLadder(term, entry(FAMILIAR), ctx('essay')).format, 'written');
  // Multiple choice: mostly choices, some blanks; a choice is practice and can't master.
  const formats = [0, 1, 2, 3, 4, 5].map(index => askLadder(term, entry(FAMILIAR), { ...ctx('mc'), index }));
  assert.ok(formats.filter(f => f.format === 'mc').length >= 4);
  assert.ok(formats.some(f => f.format === 'fill'));
  const choice = formats.find(f => f.format === 'mc');
  assert.equal(choice.practice, true);
  const questions = [term];
  const round = { queue: [{ id: 0, concept: 0, ...choice, again: false }], position: 0, nextId: 1, results: {}, carry: [] };
  const out = answerLadder({ 0: entry(FAMILIAR) }, round, round.queue[0], 1, { confidence: 'sure', today: TODAY, ctx: { ...ctx('mc'), questions } });
  assert.equal(out.levels[0].l, FAMILIAR, 'a right choice in the final days is practice, not mastery');
  // A mastered, fading idea practised with a choice stays mastered but keeps fading.
  const fading = { l: MASTERED, at: '2026-10-20', sure: false };
  const practised = answerLadder({ 0: fading }, round, round.queue[0], 1, { today: TODAY, ctx: { questions } });
  assert.equal(practised.levels[0].l, MASTERED);
  assert.equal(practised.levels[0].at, '2026-10-20');
  // New and learning ideas still climb normally.
  assert.equal(askLadder(term, entry(NEW), ctx('essay')).format, 'mc');
  // Short answer, mix and not sure: the ladder.
  assert.equal(askLadder(long, entry(FAMILIAR), ctx('short')).format, 'written');
  assert.equal(askLadder(term, entry(FAMILIAR), ctx('mix')).format, 'fill');
  // Free plan: blanks become written.
  const free = [0, 1, 2].map(index => askLadder(term, entry(FAMILIAR), { ...ctx('mc'), index, fillAvailable: false }));
  assert.ok(!free.some(f => f.format === 'fill'));
  // Only in the last FINAL_DAYS days.
  assert.equal(askLadder(term, entry(FAMILIAR), { ...ctx('essay'), testDate: '2026-11-20' }).format, 'fill');
  assert.equal(askLadder(term, entry(FAMILIAR), { ...ctx('essay'), testDate: '2026-11-01' }).format, 'fill', 'a past test date changes nothing');
  assert.equal(FINAL_DAYS, 3);
});

test('final check leans the same way', () => {
  assert.deepEqual(finalCheckTypes('mc', '2026-11-07', TODAY), ['mc', 'fill']);
  assert.deepEqual(finalCheckTypes('short', '2026-11-08', TODAY), ['fill', 'written']);
  assert.deepEqual(finalCheckTypes('essay', '2026-11-05', TODAY), ['written']);
  assert.equal(finalCheckTypes('mix', '2026-11-06', TODAY), null);
  assert.equal(finalCheckTypes('essay', '2026-11-20', TODAY), null);
});

test('decision log keeps the old shape', () => {
  const decision = ladderDecision(term, entry(FAMILIAR), { types: ['mc', 'fill', 'written'], today: TODAY });
  assert.equal(decision.chosen, 'fill');
  assert.equal(decision.mask.mc, 'needs_recall');
  assert.deepEqual(decision.probs, { fill: 1 });
});

test('flag off: the old engine is unchanged (Choice-only still masters there)', () => {
  assert.deepEqual(askCard(term, { l: FAMILIAR }, TODAY, ['mc']), { type: 'mc', recall: true });
  const round = createRound([term], { 0: { l: FAMILIAR } }, TODAY, ['mc']);
  assert.equal(oldAnswer({ 0: { l: FAMILIAR } }, round, round.queue[0], 1, { confidence: 'sure', today: TODAY }).levels[0].l, MASTERED);
});

test('quiz: with the ladder a miss returns at least 6 questions later, or at the end; off keeps 3', async () => {
  const { advance, createSession, currentCard, recordResults, sinceLastAsked } = await import('../lib/retainEngine.mjs');
  const questions = Array.from({ length: 12 }, (_, i) => mcq(`Question ${i}?`, `Answer number ${i} in full words here`));
  const cards = questions.map((_, i) => ({ type: 'mc', concepts: [i] }));
  const missFirst = ladder => {
    const session = createSession(questions, cards, ['mc'], { ladder });
    const next = recordResults(session, currentCard(session), [{ concept: 0, credit: 0 }]);
    return next.queue.findIndex(card => card.reask);
  };
  assert.equal(missFirst(true) - 1, 6, 'six questions in between');
  assert.equal(missFirst(false) - 1, 3, 'flag off: unchanged');
  // Near the end: comes back at the end.
  let session = createSession(questions, cards, ['mc'], { ladder: true });
  for (let i = 0; i < 9; i += 1) { session = recordResults(session, currentCard(session), [{ concept: i, credit: 1 }]); session = advance(session); }
  session = recordResults(session, currentCard(session), [{ concept: 9, credit: 0 }]);
  assert.equal(session.queue.findIndex(card => card.reask), session.queue.length - 1);
  // Still needs 2 more right answers; only the first try is kept.
  assert.equal(session.concepts[9].needs, 2);
  assert.equal(session.concepts[9].first.credit, 0);
  // The gap since the last ask is tracked for logging.
  while (!currentCard(session).reask) session = advance(session);
  assert.equal(sinceLastAsked(session, 9), 2);
});
