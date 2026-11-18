// A Written question (what a multiple choice with fewer than 3 choices becomes) must never trap the
// student when the AI check fails or their AI checks are used up: the card shows the model answer and
// the student marks it themselves, recorded like a self-checked flashcard. The session then runs to
// the end, misses included. The card itself is WrittenCard (components/RetainCards.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, canChoose, createSession, currentCard, firstAttempts, gradeFailure, progress, recordResults } from '../lib/retainEngine.mjs';
import { readFileSync } from 'node:fs';

const make = (question, right, wrong) => ({ question, options: [right, ...wrong], correct_index: 0 });
const questions = [
  make('Which electrolyte rises in hyperkalemia?', 'Potassium', ['Sodium']),
  make('Who painted the Mona Lisa?', 'Leonardo da Vinci', ['Raphael']),
  make('What binds a contract?', 'Consideration', ['Estoppel']),
];

test('gradeFailure: no reply, a plain error, and a used-up allowance are all failures with a sentence to show', () => {
  assert.deepEqual(gradeFailure(null), { limit: false, message: 'Cordia could not check this answer right now.' });
  assert.deepEqual(gradeFailure({ failed: 'network', detail: "Couldn't reach Classroom." }), { limit: false, message: "Couldn't reach Classroom." });
  const quiet = gradeFailure({ detail: { code: 'limit_reached', feature: 'grade' }, limit_reached: true });
  assert.equal(quiet.limit, true);
  // Outside Learn's ladder the 402 body arrives with an object detail: never shown as text.
  const loud = gradeFailure({ detail: { code: 'limit_reached', message: 'x' } });
  assert.equal(loud.limit, true);
  assert.equal(typeof loud.message, 'string');
  assert.equal(gradeFailure({ detail: { code: 'other' } }).limit, false);
  assert.equal(typeof gradeFailure({ detail: { code: 'other' } }).message, 'string');
});

test('a 2-choice question has no choices to fall back to, so the written card needs its own way forward', () => {
  assert.ok(questions.every(question => !canChoose(question)));
  const source = readFileSync(new URL('../components/RetainCards.js', import.meta.url), 'utf8');
  const written = source.slice(source.indexOf('export function WrittenCard'));
  assert.match(written, /I got it/);
  assert.match(written, /I missed it/);
  assert.match(written, /selfMarked: true/);
  assert.match(written, /Check it myself/);
});

// What WrittenCard.mark sends when the student checks by hand.
const selfMark = (concept, credit) => [{ concept, credit, response: 'my answer', selfMarked: true }];

test('with grading down every Written card self-marks and the session runs to the end', () => {
  let session = createSession(questions, questions.map((_, index) => ({ type: 'written', concepts: [index] })), ['mc']);
  let asked = 0;
  while (currentCard(session) && asked < 50) {
    const card = currentCard(session);
    assert.equal(card.type, 'written', 'a missed 2-choice idea comes back written, never as choices');
    // Miss the first idea once, then get it right on its repeats.
    const credit = card.concepts[0] === 0 && !card.reask ? 0 : 1;
    session = advance(recordResults(session, card, selfMark(card.concepts[0], credit)));
    asked += 1;
  }
  assert.equal(currentCard(session), null);
  assert.equal(progress(session).done, true);
  assert.equal(progress(session).cleared, 3);
  assert.ok(asked < 50);
  const first = firstAttempts(session);
  assert.equal(first.length, 3);
  assert.ok(first.every(attempt => attempt.self_marked === true && attempt.token === null));
  assert.deepEqual(first.map(attempt => attempt.credit), [0, 1, 1]);
});

test('self-marking every one wrong still ends: nothing loops forever', () => {
  let session = createSession(questions, questions.map((_, index) => ({ type: 'written', concepts: [index] })), ['mc']);
  let asked = 0;
  while (currentCard(session) && asked < 200) {
    const card = currentCard(session);
    session = advance(recordResults(session, card, selfMark(card.concepts[0], 0)));
    asked += 1;
  }
  assert.equal(currentCard(session), null);
});
