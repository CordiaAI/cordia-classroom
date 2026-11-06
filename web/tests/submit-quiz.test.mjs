import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, currentCard, firstAttempts, progress, recordResults } from '../lib/retainEngine.mjs';
import {
  attemptsFor, cleanFeedback, markAll, retryOutcome, retrySession, scoreRows, studyNowMisses, unanswered,
} from '../lib/submitQuiz.mjs';

const q = (question, answer, wrong = ['Wrong one', 'Wrong two', 'Wrong three']) => ({ question, options: [answer, ...wrong], correct_index: 0 });
const QUESTIONS = [
  q('What did Wagner call his operas?', 'Music dramas'),
  q('Who wrote Erlking?', 'Schubert'),
  q('How does Erlking portray the galloping horse?', 'Repeated piano triplets depict the galloping horse.'),
  q('What is a celesta?', 'A keyboard instrument with a bell-like timbre'),
  q('Where was Chopin born?', 'Poland'),
  q('What is a Lied?', 'A German art song for solo voice and piano'),
];
const ITEMS = [
  { id: 0, type: 'mc', concepts: [0] },
  { id: 1, type: 'fill', concepts: [1] },
  { id: 2, type: 'written', concepts: [2] },
  { id: 3, type: 'matching', concepts: [3, 4, 5] },
];

test('defaults: Quiz shows feedback after each question, the Timed test when submitted', () => {
  assert.equal(cleanFeedback(undefined, 'quiz'), 'each');
  assert.equal(cleanFeedback(undefined, 'timed'), 'submit');
  assert.equal(cleanFeedback('submit', 'quiz'), 'submit');
  assert.equal(cleanFeedback('later', 'timed'), 'submit');
});

test('unanswered questions are found before submitting, matching needs every row', () => {
  const answers = { 0: 'Music dramas', 3: { 3: 'A keyboard instrument with a bell-like timbre', 4: 'Poland' } };
  assert.deepEqual(unanswered(ITEMS, answers).map(item => item.id), [1, 2, 3]);
});

test('scoring in When I submit mode: first tries only, written by its signed grade', () => {
  const answers = {
    0: 'Music dramas',
    1: 'schubert',
    2: 'Triplets in the piano',
    3: { 3: 'A keyboard instrument with a bell-like timbre', 4: 'A German art song for solo voice and piano', 5: 'Poland' },
  };
  const rows = markAll(ITEMS, QUESTIONS, answers, { 0: 'sure', 3: 'guess' }, { 2: { credit: 0.5, token: 'signed' } });
  assert.deepEqual(rows.map(row => [row.concept, row.credit]), [[0, 1], [1, 1], [2, 0.5], [3, 1], [4, 0], [5, 0]]);
  const result = scoreRows(rows);
  assert.equal(result.score, Math.round((3.5 / 6) * 100));
  assert.equal(result.right, 3);
  assert.deepEqual(result.missed.map(row => row.concept), [2, 4, 5]);
  assert.equal(rows[0].confidence, 'sure');
  const attempts = attemptsFor(rows);
  assert.equal(attempts.find(item => item.concept === 2).token, 'signed');
  assert.equal(attempts.length, 6);
});

test('a written answer the AI could not mark is left out of the score until self-checked', () => {
  const answers = { 0: 'Music dramas', 1: 'Brahms', 2: 'Triplets in the piano', 3: {} };
  const rows = markAll(ITEMS.slice(0, 3), QUESTIONS, answers, {}, { 2: null });
  const before = scoreRows(rows);
  assert.equal(before.unchecked.length, 1);
  assert.equal(before.score, 50);
  const after = scoreRows(markAll(ITEMS.slice(0, 3), QUESTIONS, answers, {}, { 2: null }, { 2: 1 }));
  assert.equal(after.unchecked.length, 0);
  assert.equal(after.score, 67);
  // The server only counts written answers carrying the AI's signed grade.
  assert.equal(attemptsFor(markAll(ITEMS.slice(0, 3), QUESTIONS, answers, {}, { 2: null }, { 2: 1 })).some(item => item.concept === 2), false);
});

test('an unanswered question counts as a miss', () => {
  const rows = markAll(ITEMS.slice(0, 2), QUESTIONS, { 0: 'Music dramas' });
  assert.deepEqual(scoreRows(rows).missed.map(row => row.concept), [1]);
});

test('Retry my misses: only misses, a different format, two more right answers each, score unchanged', () => {
  const answers = { 0: 'Music pageants', 1: 'Schubert', 2: '', 3: { 3: 'A keyboard instrument with a bell-like timbre', 4: 'Poland', 5: 'Poland' } };
  const rows = markAll(ITEMS, QUESTIONS, answers, { 0: 'sure' });
  const first = scoreRows(rows);
  assert.deepEqual(first.missed.map(row => row.concept), [0, 2, 5]);

  let session = retrySession(QUESTIONS, rows, ['mc', 'fill', 'written', 'matching']);
  assert.deepEqual(session.queue.map(card => card.concepts[0]), [0, 2, 5]);
  // Each comes back in a different format from its first ask.
  session.queue.forEach(card => assert.notEqual(card.type, rows.find(row => row.concept === card.concepts[0]).type));
  assert.equal(progress(session).toClear, 3);

  // Answer every card right until the queue runs out: each idea needs two right answers.
  let asked = 0;
  while (currentCard(session) && asked < 50) {
    const card = currentCard(session);
    session = advance(recordResults(session, card, card.concepts.map(concept => ({ concept, credit: 1, response: 'right' }))));
    asked += 1;
  }
  assert.equal(asked, 6);
  assert.deepEqual(retryOutcome(session), { cleared: 3, of: 3 });
  // First tries are untouched: the retry never changes the score.
  assert.deepEqual(firstAttempts(session).map(item => [item.concept, item.credit]), [[0, 0], [2, 0], [5, 0]]);
  assert.equal(firstAttempts(session).find(item => item.concept === 0).confidence, 'sure');
});

test('a miss during the retry starts that idea over', () => {
  const rows = markAll(ITEMS.slice(0, 1), QUESTIONS, { 0: 'Music pageants' });
  let session = retrySession(QUESTIONS, rows, ['mc', 'fill']);
  session = advance(recordResults(session, currentCard(session), [{ concept: 0, credit: 1 }]));
  session = advance(recordResults(session, currentCard(session), [{ concept: 0, credit: 0 }]));
  assert.equal(session.concepts[0].needs, 2);
  assert.equal(retryOutcome(session).cleared, 0);
});

test('first-try misses feed Study now, confident ones first', () => {
  const rows = markAll(ITEMS.slice(0, 2), QUESTIONS, { 0: 'Music pageants', 1: 'Brahms' }, { 1: 'sure' });
  assert.deepEqual(studyNowMisses(rows, QUESTIONS).map(item => [item.question, Boolean(item.sure)]), [['Who wrote Erlking?', true], ['What did Wagner call his operas?', false]]);
});
