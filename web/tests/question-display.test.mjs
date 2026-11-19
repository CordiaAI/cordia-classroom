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

// --- Second review of PR 281 ---------------------------------------------------------------------
import { buildStudyQueue, dueCards, learnAfterReview } from '../lib/studyQueue.mjs';
import { applyResults } from '../lib/spacedReview.mjs';
import { examReadiness } from '../lib/examCountdown.mjs';

const TODAY = '2026-11-18';
// A guide as saved: flashcards and quiz made from the same Q&A, progress keyed by the saved text.
const RAW = [
  q('According to Slide 5, what is the normal serum potassium range?', '3.5-5.0 mEq/L'),
  q('Which artists are listed for Chapter 1?', 'Giotto, Cimabue and Duccio'),
  q('Who painted the Mona Lisa?', 'Leonardo da Vinci'),
];
// As every route now sends it (backend text_processing.shown_guide).
const SHOWN = [
  { ...RAW[0], shown: 'What is the normal serum potassium range?' },
  { ...RAW[1], hidden: true },
  RAW[2],
];
const CARDS = RAW.map(item => ({ front: item.question, back: item.options[0] }));
const PROGRESS = {
  schedule: { 0: { box: 2, due: TODAY }, 1: { box: 3, due: '2026-11-25' }, 2: { box: 1, due: TODAY } },
  learn: { levels: saveableLevels(RAW, { 0: { l: 1, at: '2026-11-10' }, 1: { l: 3, at: '2026-11-12' }, 2: { l: 2, at: '2026-11-11' } }) },
};
const guideWith = quiz => ({ id: 'g1', title: 'Electrolytes and art', flashcards: CARDS, flashcard_progress: PROGRESS, quiz_questions: quiz });

test('owner: rewording or hiding a question never resets a flashcard\'s box and due day or a Learn level', () => {
  const due = guide => dueCards(guide, TODAY).map(card => [card.index, PROGRESS.schedule[card.index].box, PROGRESS.schedule[card.index].due]);
  assert.deepEqual(due(guideWith(SHOWN)), due(guideWith(RAW)), 'same cards due, same boxes, same days');
  assert.deepEqual(restoreLevels(SHOWN, PROGRESS.learn.levels), restoreLevels(RAW, PROGRESS.learn.levels), 'same Learn levels, hidden one included');
  assert.equal(restoreLevels(SHOWN, PROGRESS.learn.levels)[1].l, 3, 'the hidden idea keeps Mastered');
});

test('owner: the card and the idea stay one Study now item, shown in the new wording', () => {
  const { items } = buildStudyQueue([guideWith(SHOWN)], {}, { today: TODAY, guideId: 'g1' });
  const reworded = items.filter(item => item.index === 0 || item.concept === 0);
  assert.equal(reworded.length, 1, 'one item for the reworded idea');
  assert.deepEqual([reworded[0].index, reworded[0].concept], [0, 0]);
  assert.equal(reworded[0].front, 'What is the normal serum potassium range?');
  assert.equal(reworded[0].question, RAW[0].question, 'keyed by the saved text');
  assert.ok(!items.some(item => item.concept === 1), 'a hidden idea is never asked');
  assert.ok(items.every(item => !/Slide 5|Chapter 1/.test(item.front)), 'no source wording shown');
});

test('owner: one answer on that item moves both the flashcard schedule and the Learn level', () => {
  const guide = guideWith(SHOWN);
  const { items } = buildStudyQueue([guide], {}, { today: TODAY, guideId: 'g1' });
  const item = items.find(entry => entry.index === 0);
  const on = new Date(2026, 10, 18, 12);
  const schedule = applyResults(guide.flashcard_progress, { known: [item.index] }, on).schedule;
  assert.equal(schedule[0].box, 3, 'box 2 -> 3');
  const learn = learnAfterReview(guide, [{ concept: item.concept, known: true }], TODAY);
  const after = restoreLevels(RAW, learn.levels);
  assert.equal(after[0].l, 2, 'Learning -> Familiar, saved under the saved text');
  assert.equal(after[1].l, 3, 'the hidden idea is untouched');
  assert.equal(after[2].l, 2);
});

test('Study now misses show the shown wording, skip hidden questions and join their card and idea', () => {
  const misses = { g1: [
    { question: RAW[0].question, answer: '3.5-5.0 mEq/L', sure: true },
    { question: RAW[1].question, answer: 'Giotto' },
  ] };
  const guide = { ...guideWith(SHOWN), flashcard_progress: { ...PROGRESS, learn: { levels: {} } } };
  const { items } = buildStudyQueue([guide], misses, { today: TODAY, guideId: 'g1' });
  const miss = items.filter(item => item.miss);
  assert.equal(miss.length, 1, 'the hidden question\'s miss is not asked');
  assert.equal(miss[0].front, 'What is the normal serum potassium range?');
  assert.equal(miss[0].question, RAW[0].question);
  assert.equal(miss[0].index, 0, 'the miss and its flashcard are one item');
  assert.equal(items.filter(item => item.question === RAW[0].question).length, 1);
});

test('Dashboard readiness is Learn\'s own once the guide comes as shown', () => {
  const levels = saveableLevels(RAW, { 0: { l: 3, at: '2026-11-17' }, 2: { l: 3, at: '2026-11-17' } });
  assert.equal(examReadiness(SHOWN, { levels }, TODAY), 100);
});

test('Study now saves answers under the saved text, never the shown wording', () => {
  const session = readFileSync(new URL('../pages/session.js', import.meta.url), 'utf8');
  assert.match(session, /entry\.cleared\.push\(card\.question \?\? card\.front\)/);
  const viewer = readFileSync(new URL('../components/FlashcardViewer.js', import.meta.url), 'utf8');
  assert.match(viewer, /question: card\.question \?\? card\.front/);
  const tutor = readFileSync(new URL('../components/RetainCards.js', import.meta.url), 'utf8');
  assert.match(tutor, /question: question\.question,/, 'the Tutor checks the saved text against the guide (the backend asks it as shown)');
});
