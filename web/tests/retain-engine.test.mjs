import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advance, choiceText, createSession, currentCard, fillMatches, fillVerdict, firstAttempts, progress, recordResults, reaskType,
} from '../lib/retainEngine.mjs';

const q = (question, answer) => ({ question, options: [answer, 'Other A', 'Other B', 'Other C'], correct_index: 0 });
const questions = [q('Q0?', 'Mitosis'), q('Q1?', 'Tort'), q('Q2?', 'Equity'), q('Q3?', 'Recursion'), q('Q4?', 'Iambic pentameter'),
  q('Why?', 'Inflation raises prices. Money buys less than before as a result.')];
const cards = questions.map((_, index) => ({ type: index === 5 ? 'written' : 'mc', concepts: [index] }));

function answer(session, credit) {
  const card = currentCard(session);
  const results = card.concepts.map(concept => ({ concept, credit, response: credit === 1 ? 'Mitosis' : 'nope' }));
  return advance(recordResults(session, card, results));
}

test('a missed question must be answered right two more times, spaced apart, to clear', () => {
  let session = createSession(questions, cards, ['mc', 'fill', 'written']);
  session = answer(session, 0); // miss Q0
  assert.equal(session.concepts[0].needs, 2);
  const reaskAt = session.queue.findIndex(card => card.reask);
  assert.equal(reaskAt, 4, 'comes back after three other questions');
  assert.equal(session.queue[reaskAt].type, 'fill', 'a term comes back as fill in the blank');
  while (!currentCard(session).reask) session = answer(session, 1);
  session = answer(session, 1);
  assert.equal(session.concepts[0].needs, 1);
  assert.equal(session.concepts[0].cleared, false);
  while (!currentCard(session).reask) session = answer(session, 1);
  assert.equal(currentCard(session).type, 'mc', 'second retry changes format again');
  session = answer(session, 1);
  assert.equal(session.concepts[0].cleared, true);
});

test('missing a retry resets it to two more', () => {
  let session = createSession(questions, cards, ['mc']);
  session = answer(session, 0);
  while (!currentCard(session).reask) session = answer(session, 1);
  session = answer(session, 1);
  while (!currentCard(session).reask) session = answer(session, 1);
  session = answer(session, 0);
  assert.equal(session.concepts[0].needs, 2);
});

test('the score uses first tries only and the session ends when everything clears', () => {
  let session = createSession(questions, cards, ['mc', 'written']);
  session = answer(session, 0);
  while (currentCard(session)) session = answer(session, 1);
  const stats = progress(session);
  assert.equal(stats.done, true);
  assert.equal(stats.cleared, 6);
  assert.equal(stats.firstTryRight, 5);
  assert.equal(stats.missedMastered, 1);
  const first = firstAttempts(session);
  assert.equal(first.length, 6);
  assert.deepEqual(first.find(item => item.concept === 0), { concept: 0, type: 'mc', response: 'nope', credit: 0, token: null });
});

test('partial credit on a written answer counts as a miss to practise', () => {
  let session = createSession(questions, [{ type: 'written', concepts: [5] }], ['written']);
  session = advance(recordResults(session, currentCard(session), [{ concept: 5, credit: 0.5, response: 'x', token: 't' }]));
  assert.equal(session.concepts[5].needs, 2);
  assert.equal(currentCard(session).type, 'mc', 'written misses come back as multiple choice first to limit AI checks');
});

test('re-asks only use types the student turned on (multiple choice is always allowed)', () => {
  assert.equal(reaskType(questions[0], 'mc', 0, ['mc']), 'mc');
  assert.equal(reaskType(questions[0], 'matching', 0, ['matching', 'fill']), 'fill');
  assert.equal(reaskType(questions[5], 'written', 1, ['written']), 'written');
});

test('fill in the blank checks match the server rules', () => {
  assert.equal(fillMatches('the MITOSIS', 'Mitosis'), true);
  assert.equal(fillMatches('iambic pentametr', 'Iambic pentameter'), true);
  assert.equal(fillMatches('DNA', 'Deoxyribonucleic acid (DNA)'), true);
  assert.equal(fillMatches('meiosis', 'Mitosis'), false);
  assert.equal(fillMatches('1865', '1863'), false);
});

test('choices end alike: a lone closing period goes, abbreviations and ellipses keep theirs', () => {
  const cases = [
    ['ATP is made in the mitochondria.', 'ATP is made in the mitochondria'],
    ['Mitochondria', 'Mitochondria'],
    ['It rose 5.5', 'It rose 5.5'],
    ['Cells, tissues, organs, etc.', 'Cells, tissues, organs, etc.'],
    ['Founded in the U.S.', 'Founded in the U.S.'],
    ['It trails off...', 'It trails off...'],
    ['  Spaced.  ', 'Spaced'],
  ];
  for (const [raw, shown] of cases) {
    assert.equal(choiceText(raw), shown, raw);
    assert.equal(choiceText(shown), shown);
  }
});

test('typed answers: part of the answer with nothing contradicting it is close, and the student decides', () => {
  assert.equal(fillVerdict('Alpha Sigma', 'Oregon Alpha Sigma.'), 'close');
  assert.equal(fillVerdict('Oregon Alpha Sigma chapter', 'Oregon Alpha Sigma'), 'close');
  assert.equal(fillVerdict('Treaty of Versailes', 'The Treaty of Versailles of 1919'), 'wrong'); // the year is missing
  assert.equal(fillVerdict('Treaty Versailles 1919', 'The Treaty of Versailles of 1919'), 'close');
  assert.equal(fillVerdict('Alpha Tau', 'Oregon Alpha Sigma'), 'wrong');
  assert.equal(fillVerdict('photosynthesis', 'Cellular respiration'), 'wrong');
  assert.equal(fillVerdict('mitosis', 'Mitosis'), 'right');
  assert.equal(fillVerdict('', 'Mitosis'), 'wrong');
});

test('a typed answer the student counted right reaches the quiz score marked as theirs', () => {
  const qs = [{ question: 'Which chapter?', options: ['Oregon Alpha Sigma', 'B', 'C', 'D'], correct_index: 0 }];
  const session = createSession(qs, [{ type: 'fill', concepts: [0] }], ['fill']);
  const after = recordResults(session, currentCard(session), [{ concept: 0, credit: 1, response: 'Alpha Sigma', selfMarked: true }]);
  assert.deepEqual(firstAttempts(after).map(a => [a.credit, a.self_marked]), [[1, true]]);
});
