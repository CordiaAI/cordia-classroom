// Quizlet import: which links are accepted, and how pasted Export text becomes cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuizletUrl, parseQuizletText } from '../lib/quizletImport.js';

test('only quizlet.com set links are accepted', () => {
  assert.ok(isQuizletUrl('https://quizlet.com/583427227/biology-flash-cards/'));
  assert.ok(isQuizletUrl(' https://quizlet.com/gb/583427227/cells/ '));
  assert.equal(isQuizletUrl('http://quizlet.com/583427227/x/'), false);
  assert.equal(isQuizletUrl('https://quizlet.com.evil.example/583427227/x/'), false);
  assert.equal(isQuizletUrl('https://quizlet.com/latest'), false);
  assert.equal(isQuizletUrl('not a link'), false);
});

test("Export text: tab between term and definition, one card per line", () => {
  const cards = parseQuizletText('Mitosis\tCell division into two identical cells\r\nTort\tA civil wrong\n\nSonnet\tA 14-line poem\n');
  assert.deepEqual(cards, [
    { term: 'Mitosis', definition: 'Cell division into two identical cells' },
    { term: 'Tort', definition: 'A civil wrong' },
    { term: 'Sonnet', definition: 'A 14-line poem' },
  ]);
});

test('dash-separated text, and lines without a separator continue the definition', () => {
  const cards = parseQuizletText('Supply - How much sellers offer\nat each price\nDemand - How much buyers want');
  assert.deepEqual(cards, [
    { term: 'Supply', definition: 'How much sellers offer\nat each price' },
    { term: 'Demand', definition: 'How much buyers want' },
  ]);
});

test('text with no clear separator gives no cards', () => {
  assert.deepEqual(parseQuizletText('Just some notes\nwith no pairs'), []);
  assert.deepEqual(parseQuizletText(''), []);
});
