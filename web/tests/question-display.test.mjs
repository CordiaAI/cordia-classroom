// A saved question is never rewritten (review of PR 275): Learn levels, answer logs and misses are
// keyed by its text, idea ids by its wording and attempts by its position. Where it is shown, the
// backend's display wording (`shown`) is used, and one about the source itself (`hidden`, "Which
// artists are listed for Chapter 1?") keeps its place but is never asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { counts, createRound, fingerprint, pickRound, restoreLevels, saveableLevels } from '../lib/learnEngine.mjs';
import { pickLadderRound } from '../lib/learnLadder.mjs';
import { askable, questionText } from '../lib/retainEngine.mjs';
import { buildTest } from '../lib/timedTest.mjs';
import { attemptsFor } from '../lib/submitQuiz.mjs';

const q = (question, answer, extra = {}) => ({ question, options: [answer, 'B b', 'C c', 'D d'], correct_index: 0, ...extra });
const questions = [
  q('Which artists are listed for Chapter 1?', 'Leonardo, Raphael and Titian', { hidden: true }),
  q('According to Slide 5, what is the normal serum potassium range?', '3.5-5.0 mEq/L', { shown: 'What is the normal serum potassium range?' }),
  q('Who painted the Mona Lisa?', 'Leonardo da Vinci'),
];

test('the display wording never changes a progress key', () => {
  const raw = { ...questions[1] };
  delete raw.shown;
  assert.equal(fingerprint(questions[1]), fingerprint(raw));
  const saved = saveableLevels([raw], { 0: { l: 2, at: '2026-11-01', sure: false } });
  assert.equal(restoreLevels([questions[1]], saved)[0].l, 2, 'a level saved before stays');
});

test('questionText shows the display wording when there is one', () => {
  assert.equal(questionText(questions[1]), 'What is the normal serum potassium range?');
  assert.equal(questionText(questions[2]), 'Who painted the Mona Lisa?');
  assert.equal(questionText(null), '');
});

test('a hidden question keeps its place but is never asked or counted', () => {
  assert.equal(askable(questions[0]), false);
  assert.equal(askable(questions[1]), true);
  const levels = restoreLevels(questions, {});
  assert.deepEqual(pickRound(questions, levels), [1, 2]);
  assert.deepEqual(pickLadderRound(questions, levels, undefined, [0]), [1, 2]);
  assert.equal(counts(questions, levels).total, 2);
  assert.ok(createRound(questions, levels).queue.every(card => card.concept !== 0));
  assert.deepEqual(buildTest(questions, ['mc'], 1).map(item => item.concept).sort(), [1, 2]);
});

test('every place a question is shown uses its display wording', () => {
  const files = ['../components/RetainCards.js', '../components/SubmitQuiz.js', '../components/QuizReview.js',
    '../components/MatchRace.js', '../pages/learn/[guideId].js'];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, />\{(?:question|questions\[\w+\]|row\.question)\.question\}</, `${file} renders the stored text`);
    assert.match(source, /questionText\(/, file);
  }
});

test('a written answer the student checked by hand is sent, marked as theirs', () => {
  const rows = [
    { concept: 0, type: 'written', response: 'mine', credit: 1, token: null, selfMarked: true },
    { concept: 1, type: 'written', response: 'mine', credit: 0.5, token: 'signed' },
    { concept: 2, type: 'written', response: 'mine', credit: null, token: null },
    { concept: 3, type: 'mc', response: 'x', credit: 0 },
  ];
  const attempts = attemptsFor(rows);
  assert.deepEqual(attempts.map(item => item.concept), [0, 1, 3]);
  assert.equal(attempts[0].self_marked, true);
  assert.equal(attempts[1].self_marked, undefined);
  assert.equal(attempts[1].token, 'signed');
});

test('the self-check focuses the model answer, not a button that gives credit', () => {
  const source = readFileSync(new URL('../components/RetainCards.js', import.meta.url), 'utf8');
  const written = source.slice(source.indexOf('export function WrittenCard'));
  const panel = written.slice(written.indexOf('selfCheck && ('), written.indexOf('{grade && ('));
  assert.doesNotMatch(panel, /autoFocus/, 'no credit button takes focus');
  assert.match(panel, /ref=\{answerRef\}/);
  assert.match(panel, /tabIndex=\{-1\}/);
});
