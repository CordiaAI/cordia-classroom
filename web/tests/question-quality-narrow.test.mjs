// F5 narrow round (PR 287), web side. Backend side: tests/test_question_quality_narrow.py.
// 1. A card never studied (about the source itself) is never counted: the home, the Library, the guide
//    page and Study now (with the home's 50-card round) read the backend's served fixture and agree.
// 3. A study set split across connector requests never un-hides a question (below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUE_REVIEW_CARDS, buildStudyQueue, cardLimit, dueCount, studiedCards, studiedCount } from '../lib/studyQueue.mjs';
import { homeSuggestions } from '../lib/homeText.mjs';
import { MAX_CHARS, MAX_SETS, MAX_TEXTS, packed, withShownQuizzes } from '../lib/mcp/wording.mjs';

// What GET /guides?fields=summary and GET /guides/{id} send for tests/fixtures/hidden-cards/rows.json
// (the backend test holds the routes to this file).
const served = JSON.parse(readFileSync(new URL('../../tests/fixtures/hidden-cards/served.json', import.meta.url), 'utf8'));
const { today } = served;
const summary = id => served.summary.find(guide => guide.id === id);
const full = id => served.full.find(guide => guide.id === id);
const hiddenIn = id => new Set(summary(id).flashcard_hidden);
const cardsIn = items => items.filter(item => item.kind === 'card');

test('2 hidden of 3: the home and the Library say 1 due, and Study now studies that 1', () => {
  assert.deepEqual(summary('g1').flashcard_hidden, [0, 1]);
  assert.equal(dueCount(summary('g1'), today), 1, 'home / Library due');
  assert.equal(studiedCount(summary('g1')), 1, 'Library total');
  assert.equal(studiedCards(full('g1')).length, 1, 'guide page Flashcards pill and the deck');
  for (const options of [{ today, guideId: 'g1' }, { today }]) {
    const { items } = buildStudyQueue([full('g1')], {}, options);
    assert.deepEqual(items.map(item => item.index), [2], JSON.stringify(options));
  }
});

test('the reviewer\'s summary: nothing due on the home, nothing in Study now', () => {
  assert.equal(dueCount(summary('g4'), today), 0);
  assert.equal(buildStudyQueue([full('g4')], {}, { today }).items.length, 0);
});

test('a card whose quiz question is hidden is counted nowhere either', () => {
  assert.equal(dueCount(summary('g3'), today), 0);
  assert.equal(studiedCount(summary('g3')), 0);
  assert.equal(studiedCards(full('g3')).length, 0);
  assert.equal(cardsIn(buildStudyQueue([full('g3')], {}, { today }).items).length, 0);
});

test('every guide: the home\'s due count is Study now\'s card total, and its 50-card round holds no hidden card', () => {
  const home = served.summary.reduce((sum, guide) => sum + dueCount(guide, today), 0);
  assert.equal(home, 51, '1 + 0 + 50 + 0');
  const pill = homeSuggestions({ due: home }).find(item => item.key === 'due');
  assert.equal(pill.label, 'Review flashcards (51 due)');
  assert.equal(pill.href, `/session?cards=${DUE_REVIEW_CARDS}`);
  const cards = cardLimit(new URLSearchParams(pill.href.split('?')[1]).get('cards'));
  const { items, cardTotal } = buildStudyQueue(served.full, {}, { today, cards });
  assert.equal(cardTotal, home, 'Study now has exactly the cards the home counts');
  assert.equal(cardsIn(items).length, DUE_REVIEW_CARDS);
  assert.ok(cardsIn(items).every(item => !hiddenIn(item.guideId).has(item.index)), 'no hidden card in the round');
  // The usual round (30) from the same queue.
  assert.equal(cardsIn(buildStudyQueue(served.full, {}, { today }).items).length, 30);
});

test('60 cards, 10 about the source: 50 due, and the 50-card round takes exactly those 50', () => {
  assert.equal(dueCount(summary('g2'), today), 50);
  assert.equal(studiedCount(summary('g2')), 50);
  const { items } = buildStudyQueue([full('g2')], {}, { today, cards: cardLimit(DUE_REVIEW_CARDS) });
  assert.deepEqual(items.map(item => item.index).sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i).filter(i => i % 6));
});

test('the home, the Library row and the guide page count with the same rules', () => {
  const home = readFileSync(new URL('../lib/homeData.js', import.meta.url), 'utf8');
  assert.match(home, /guides\.reduce\(\(sum, guide\) => sum \+ dueCount\(guide, today\), 0\)/);
  const library = readFileSync(new URL('../pages/library.js', import.meta.url), 'utf8');
  assert.match(library, /guides\.filter\(guide => studiedCount\(guide\) > 0\)/);
  assert.match(library, /due: dueCount\(guide\), total: studiedCount\(guide\)/);
  const page = readFileSync(new URL('../pages/guide/[id].js', import.meta.url), 'utf8');
  assert.match(page, /const cardCount = studiedCards\(guide\)\.length;/);
});

test('a summary from an older backend (no flashcard_hidden) still counts', () => {
  const old = { flashcard_count: 3, flashcard_progress: {} };
  assert.equal(dueCount(old, today), 3);
  assert.equal(studiedCount(old), 3);
  assert.equal(studiedCount({ flashcard_count: 2, flashcard_hidden: [1, 1, 7, -1, 'x'] }), 1, 'only real places count');
});

// 3. A study set split across connector requests never un-hides a question. The backend's rule, as
//    POST /mcp/question-wording applies it to each quiz it is sent (services/text_processing._marks):
//    a question about the source is hidden unless every question of that quiz would be.
function backendWording(options) {
  const about = text => /covered in Chapter|listed for Chapter/i.test(text);
  const quizzes = options.body.quizzes.map(quiz => {
    const marks = quiz.map(({ question }) => (about(question) ? { hidden: true } : {}));
    return marks.some((mark, n) => !mark.hidden && quiz[n].answered) ? marks : marks.map(() => ({}));
  });
  const cards = (options.body.cards || []).map(fronts => fronts.map(front => (about(front) ? { hidden: true } : {})));
  return { ok: true, status: 200, json: async () => ({ quizzes, cards }) };
}

// rook-f5final/split.mjs: 60 sets of 20 subject questions, newest first; set 57's first question is about
// the source, and set 0 is padded so a request fills up right after it.
function splitSets() {
  const ask = text => ({ question: text, options: ['a', 'b', 'c', 'd'], correct_index: 0 });
  const sets = Array.from({ length: 60 }, (_, s) => ({
    id: `set${s}`, title: `Set ${s}`, flashcards: [], flashcard_progress: {},
    quiz_questions: Array.from({ length: 20 }, (_, n) => ask(n === 0 && s === 57 ? 'Which topics are covered in Chapter 1?' : `What is concept ${s}-${n} in renal physiology?`)),
  }));
  sets[0].quiz_questions = sets[0].quiz_questions.concat(Array.from({ length: 859 }, (_, n) => ask(`What is padding ${n} in pharmacology?`)));
  sets[57].flashcards = [{ front: 'Which topics are covered in Chapter 1?', back: 'Renal anatomy, filtration' }, { front: 'What is GFR?', back: 'Filtration rate' }];
  return sets;
}
const toTexts = sets => sets.map(set => ({
  quiz: set.quiz_questions.map(item => ({ text: item.question, answered: true })),
  cards: set.flashcards.filter(card => !set.quiz_questions.some(item => item.question === card.front)).map((card, index) => ({ text: card.front, index })),
}));

test('the 60-set read: set 57\'s quiz goes in one request and its hidden question stays hidden', async () => {
  const sets = splitSets();
  const requests = packed(toTexts(sets));
  const parts = requests.flatMap(request => request.parts.filter(part => part.at === 57 && part.quiz.length));
  assert.deepEqual(parts.map(part => part.quiz.length), [20], 'never split mid-quiz');
  for (const request of requests) {
    const texts = request.parts.flatMap(part => [...part.quiz, ...part.cards]);
    assert.ok(request.parts.length <= MAX_SETS && texts.length <= MAX_TEXTS && texts.reduce((sum, item) => sum + item.text.length, 0) <= MAX_CHARS);
  }
  const ctx = { fetchBackend: async (path, options) => backendWording(options) };
  const [alone] = await withShownQuizzes(ctx, [sets[57]]);
  const big = await withShownQuizzes(ctx, sets);
  assert.notEqual(big[57].wording, 'unknown');
  assert.equal(alone.quiz_questions[0].hidden, true);
  assert.equal(big[57].quiz_questions[0].hidden, true, 'as when the set is read alone');
  const fronts = guide => cardsIn(buildStudyQueue([guide], {}, { today }).items).map(item => item.front);
  assert.deepEqual(fronts(big[57]), ['What is GFR?']);
  assert.deepEqual(fronts(big[57]), fronts(alone));
  assert.ok(big.every((guide, at) => at === 57 || guide.quiz_questions.every(item => !item.hidden)));
});

test('a quiz too big for any one request is never sent in parts: its set is marked unknown', async () => {
  const huge = { id: 'huge', title: 'Huge', flashcards: [], quiz_questions: Array.from({ length: MAX_TEXTS + 1 }, (_, n) => ({ question: n ? `What is idea ${n}?` : 'Which topics are covered in Chapter 1?', options: ['a', 'b'], correct_index: 0 })) };
  const small = splitSets()[1];
  assert.deepEqual(packed(toTexts([huge, small])).flatMap(request => request.parts.map(part => part.at)), [1]);
  const marked = await withShownQuizzes({ fetchBackend: async (path, options) => backendWording(options) }, [huge, small]);
  assert.equal(marked[0].wording, 'unknown');
  assert.notEqual(marked[1].wording, 'unknown');
});
