// F5 narrow round (PR 287), web side. Backend side: tests/test_question_quality_narrow.py.
// 1. A card never studied (about the source itself) is never counted: the home, the Library, the guide
//    page and Study now (with the home's 50-card round) read the backend's served fixture and agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUE_REVIEW_CARDS, buildStudyQueue, cardLimit, dueCount, studiedCards, studiedCount } from '../lib/studyQueue.mjs';
import { homeSuggestions } from '../lib/homeText.mjs';

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
