// One progress record: Retain misses merge instead of replacing each other, and Study now builds one
// round from due flashcards, Learn ideas (Learning, Familiar or fading) and Retain misses, each
// question once, with its answer saved back to every place it came from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const dataUrl = source => 'data:text/javascript,' + encodeURIComponent(source).replace(/'/g, '%27');
// The lib's .js files use bare relative imports Next resolves; point them at real files or stubs.
function load(file, stubs = {}) {
  let source = readFileSync(join(web, file), 'utf8');
  for (const [line, replacement] of Object.entries(stubs)) {
    assert.ok(source.includes(line), `${file} imports ${line}`);
    source = source.replace(line, replacement);
  }
  source = source.replace(/from '\.\/([\w.]+\.mjs)'/g, (_, name) => `from '${pathToFileURL(join(web, 'lib', name)).href}'`);
  return source;
}

const store = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
};
const userStoreSource = load('lib/userStore.js', { "import { getUserId } from './api';": "const getUserId = () => 'student-1';" });
const userStore = await import(dataUrl(userStoreSource));
const queueLib = await import(dataUrl(load('lib/studyQueue.js', {
  "import { apiFetch } from './api';": 'const apiFetch = () => Promise.resolve(null);',
  "from './userStore';": `from '${dataUrl(userStoreSource)}';`,
})));
const { buildStudyQueue, learnAfterReview, learnIdeas } = queueLib;
const { fingerprint } = await import('../lib/learnEngine.mjs');

const miss = (question, sure = false) => ({ question, answer: 'answer to ' + question, ...(sure ? { sure: true } : {}) });
const saved = guideId => userStore.retainMisses()[guideId] || [];

test('a round with no misses keeps the misses saved before', () => {
  store.clear();
  userStore.rememberRetainMisses('g1', [miss('What is osmosis?'), miss('Define tort', true)]);
  userStore.rememberRetainMisses('g1', []);
  assert.deepEqual(saved('g1').map(item => item.question), ['Define tort', 'What is osmosis?']);
});

test('new misses join the list once, sure ones first, capped', () => {
  store.clear();
  userStore.rememberRetainMisses('g1', [miss('What is osmosis?'), miss('Who painted the Arnolfini Portrait?')]);
  userStore.rememberRetainMisses('g1', [miss('what is OSMOSIS', true), miss('What is a stack?')]);
  const list = saved('g1');
  assert.deepEqual(list.map(item => item.question), ['what is OSMOSIS', 'What is a stack?', 'Who painted the Arnolfini Portrait?']);
  assert.equal(list[0].sure, true);
  userStore.rememberRetainMisses('g1', Array.from({ length: 60 }, (_, n) => miss('Question ' + n)));
  assert.equal(saved('g1').length, userStore.MAX_RETAIN_MISSES);
  assert.equal(saved('g1')[0].question, 'what is OSMOSIS', 'a sure miss is never pushed out by unsure ones');
});

test('only questions answered right leave the list', () => {
  store.clear();
  userStore.rememberRetainMisses('g1', [miss('What is osmosis?'), miss('Define tort'), miss('What is a stack?')]);
  userStore.clearRetainMisses('g1', ['what is osmosis?', { question: 'Define tort' }]);
  assert.deepEqual(saved('g1').map(item => item.question), ['What is a stack?']);
  userStore.rememberRetainMisses('g1', [miss('Define tort')], { cleared: ['What is a stack?'] });
  assert.deepEqual(saved('g1').map(item => item.question), ['Define tort']);
  userStore.clearRetainMisses('g1', ['Define tort']);
  assert.deepEqual(userStore.retainMisses(), {}, 'an empty guide is dropped');
  userStore.rememberRetainMisses('g2', [miss('Kept elsewhere')]);
  assert.equal(saved('g2').length, 1, 'other guides are untouched');
});

const TODAY = '2026-10-28';
const question = (text, answerText) => ({ question: text, options: [answerText, 'x', 'y', 'z'], correct_index: 0 });
const QUESTIONS = [
  question('What organelle makes ATP?', 'Mitochondria'),
  question('Who painted the Arnolfini Portrait?', 'Jan van Eyck'),
  question('What is consideration in contract law?', 'Something of value exchanged'),
  question('What is a stack?', 'A last-in, first-out list'),
  question('What is a metaphor?', 'A comparison without like or as'),
];
const level = (index, l, at = TODAY) => ({ l, at, q: fingerprint(QUESTIONS[index]) });
function guide(extra = {}) {
  return {
    id: 'g1',
    title: 'Mixed course',
    quiz_questions: QUESTIONS,
    // Cards 0 and 1 have been studied and aren't due; card 2 is due; card 3 is new.
    flashcards: QUESTIONS.slice(0, 4).map(item => ({ front: item.question, back: item.options[0] })),
    flashcard_progress: {
      schedule: { 0: { box: 2, due: '2026-11-05' }, 1: { box: 1, due: '2026-11-01' }, 2: { box: 0, due: '2026-10-27' } },
      learn: {
        levels: {
          0: level(0, 1), // Learning
          1: level(1, 3, '2026-10-20'), // Mastered 8 days ago: fading
          2: level(2, 2), // Familiar, and its flashcard is due too
          4: level(4, 3), // Mastered today: not asked
        },
        test_date: '2026-11-10',
      },
    },
    ...extra,
  };
}

test('Learn ideas in the round are the ones Learning, Familiar or fading', () => {
  assert.deepEqual(learnIdeas(guide(), TODAY).map(idea => idea.concept), [0, 1, 2]);
  assert.deepEqual(learnIdeas(guide({ quiz_questions: undefined }), TODAY), []);
});

test('one round holds each question once and knows every place it came from', () => {
  const stored = { g1: [miss('What is a stack?', true), miss('What is a metaphor?')], gone: [miss('Deleted guide')] };
  const { items } = buildStudyQueue([guide()], stored, { today: TODAY });
  const shape = items.map(item => [item.front, item.index, item.concept, Boolean(item.miss)]);
  assert.deepEqual(shape, [
    ['What is a stack?', 3, undefined, true], // sure miss first; also the new flashcard 3
    ['What is consideration in contract law?', 2, 2, false], // due card that Learn has as Familiar
    ['What organelle makes ATP?', undefined, 0, false], // Learning
    ['Who painted the Arnolfini Portrait?', undefined, 1, false], // fading
    ['What is a metaphor?', undefined, undefined, true], // unsure miss last
  ]);
  assert.equal(new Set(items.map(item => item.front.toLowerCase())).size, items.length);
});

test("a guide's Study now with nothing due still runs its cards, without repeating Learn's", () => {
  const caughtUp = guide();
  caughtUp.flashcard_progress.schedule = Object.fromEntries([0, 1, 2, 3].map(index => [index, { box: 2, due: '2026-11-05' }]));
  const { items } = buildStudyQueue([caughtUp], {}, { guideId: 'g1', today: TODAY });
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(item => item.concept), [0, 1, 2, undefined]);
  assert.deepEqual(buildStudyQueue([caughtUp], {}, { today: TODAY }).items.map(item => item.concept), [0, 1, 2], 'Daily review: only Learn ideas are left');
});

test("Study now answers move Learn's levels and keep its test date", () => {
  const saved = learnAfterReview(guide(), [{ concept: 0, known: true }, { concept: 1, known: true }, { concept: 2, known: false }], TODAY);
  assert.equal(saved.levels[0].l, 2, 'Learning, flipped right: Familiar');
  assert.deepEqual([saved.levels[1].l, saved.levels[1].at], [3, TODAY], 'fading, recalled: Mastered again today');
  assert.equal(saved.levels[2].l, 1, 'a miss drops back to Learning');
  assert.equal(saved.levels[4].l, 3, 'ideas not asked are kept');
  assert.equal(saved.test_date, '2026-11-10');
  assert.equal(learnAfterReview(guide(), [], TODAY), null);
});

test("the knowledge map takes the stronger of a card's flashcard box and Learn level", () => {
  const source = readFileSync(join(web, 'components/KnowledgeMap.js'), 'utf8');
  const body = source.slice(source.indexOf('const LEVELS'), source.indexOf('function seeded')).replace('export function', 'function');
  const cardLevel = new Function(body + '; return cardLevel;')();
  const progress = { schedule: { 0: { box: 0 }, 1: { box: 4 } }, known: [2] };
  assert.equal(cardLevel(progress, 0, { 0: 3 }), 'mastered');
  assert.equal(cardLevel(progress, 1, { 1: 1 }), 'mastered');
  assert.equal(cardLevel(progress, 2, undefined), 'known');
  assert.equal(cardLevel(progress, 3, { 3: 2 }), 'known');
  assert.equal(cardLevel(progress, 4, {}), 'new');
});
