// F5 final round (PR 287): a hidden question (about the source itself) never comes back through
// Study now or its flashcard, and the review's Mediums on the web side. Backend side:
// tests/test_question_quality_final.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStudyQueue, dueCards, studiedCards } from '../lib/studyQueue.mjs';
import { gradeFailure } from '../lib/retainEngine.mjs';

const TODAY = '2026-11-18';
const q = (question, answer) => ({ question, options: [answer, 'x', 'y', 'z'], correct_index: 0 });
// rook-f5v2/hiddencard.mjs: the hidden question's flashcard is due today.
const RAW = [
  q('According to Slide 5, what is the normal serum potassium range?', '3.5-5.0 mEq/L'),
  q('Which artists are listed for Chapter 1?', 'Giotto, Cimabue and Duccio'),
  q('Who painted the Mona Lisa?', 'Leonardo da Vinci'),
];
const SHOWN = [{ ...RAW[0], shown: 'What is the normal serum potassium range?' }, { ...RAW[1], hidden: true }, RAW[2]];
const CARDS = RAW.map(item => ({ front: item.question, back: item.options[0] }));
const DUE = { schedule: { 0: { box: 2, due: TODAY }, 1: { box: 3, due: TODAY }, 2: { box: 1, due: TODAY } } };

test('the hidden question\'s flashcard, due today, is not in Study now (one guide or every guide)', () => {
  const guide = { id: 'g1', title: 'T', flashcards: CARDS, flashcard_progress: DUE, quiz_questions: SHOWN };
  for (const options of [{ today: TODAY, guideId: 'g1' }, { today: TODAY }]) {
    const { items } = buildStudyQueue([guide], {}, options);
    assert.deepEqual(items.map(item => item.index), [0, 2], JSON.stringify(options));
    assert.equal(items[0].front, 'What is the normal serum potassium range?');
    assert.equal(items[0].question, RAW[0].question, 'keyed by the saved text');
  }
});

test('a card marked hidden by its own front is never studied, with or without a quiz', () => {
  const cards = [{ ...CARDS[0], shown: 'What is the normal serum potassium range?' }, { ...CARDS[1], hidden: true }, CARDS[2]];
  for (const quiz of [[], RAW.slice(2), null]) {
    const guide = { id: 'g1', title: 'T', flashcards: cards, flashcard_progress: DUE, quiz_questions: quiz };
    assert.deepEqual(dueCards(guide, TODAY).map(card => card.index), [0, 2]);
    assert.deepEqual(studiedCards(guide).map(card => card.index), [0, 2], 'its place in the saved deck is kept');
    const { items } = buildStudyQueue([guide], {}, { today: TODAY, guideId: 'g1' });
    assert.deepEqual(items.map(item => [item.index, item.front]), [[0, 'What is the normal serum potassium range?'], [2, RAW[2].question]]);
  }
});

test('a guide with nothing due still runs a full round, without the hidden card', () => {
  const later = { schedule: { 0: { box: 2, due: '2099-01-01' }, 1: { box: 3, due: '2099-01-01' }, 2: { box: 1, due: '2099-01-01' } } };
  const guide = { id: 'g1', title: 'T', flashcards: CARDS, flashcard_progress: later, quiz_questions: SHOWN };
  assert.deepEqual(buildStudyQueue([guide], {}, { today: TODAY, guideId: 'g1' }).items.map(item => item.index), [0, 2]);
});

test('the flashcard deck studies only cards that can be asked, and saves by each card\'s place in the saved deck', () => {
  const page = readFileSync(new URL('../pages/flashcards/study.js', import.meta.url), 'utf8');
  assert.match(page, /studiedCards\(guide\)\.map\(card => \(\{ \.\.\.card, question: card\.front, front: card\.shown \|\| card\.front \}\)\)/);
  assert.match(page, /const known = shownKnown\.map\(at => deck\[at\]\?\.index\)/);
  assert.match(page, /flashcards=\{deck\}/);
});

test('Quiz setup counts only the questions it can ask', () => {
  const page = readFileSync(new URL('../pages/quiz/[guideId].js', import.meta.url), 'utf8');
  assert.match(page, /guide\.guide\.quiz_questions\.filter\(askable\)\.length/);
});

test('a Written card out of AI checks shows the self-check whatever shape the 402 has', () => {
  const api = readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8');
  assert.match(api, /if \(resp\.status === 402 && data && typeof data === 'object' && !Array\.isArray\(data\)\) data\.limit_reached = true;/);
  assert.doesNotMatch(api, /else if \(resp\.status === 402/, 'set on every 402, quiet or not');
  for (const reply of [{ limit_reached: true, detail: 'Limit reached' }, { limit_reached: true, detail: { code: 'limit_reached' } }, { detail: { code: 'limit_reached' } }]) {
    assert.equal(gradeFailure(reply).limit, true, JSON.stringify(reply));
  }
  assert.equal(gradeFailure({ failed: 'network', detail: 'Couldn\'t reach Classroom.' }).limit, false);
});
