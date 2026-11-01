// Retain misses and the study log on the server, and the app's search over the shared function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dayToRow, mergeDay, rowToDay } from '../lib/studyDays.mjs';
import { mergeRetainMisses, questionKey } from '../lib/retainMisses.mjs';
import { searchRows } from '../lib/searchResults.mjs';

test('a study day round-trips between the browser copy and the server row', () => {
  const day = { m: 12.34, c: 20, r: 15, t: 18, g: { abcd1234: { n: 'Cells', m: 12.3, k: ['quiz'] } } };
  const row = dayToRow('u', '2026-10-30', day);
  assert.deepEqual({ ...row, updated_at: undefined }, { user_id: 'u', day: '2026-10-30', minutes: 12.3, cards: 20, right_count: 15, total: 18, guides: day.g, updated_at: undefined });
  assert.deepEqual(rowToDay(row), { m: 12.3, c: 20, r: 15, t: 18, g: day.g });
  assert.equal(dayToRow('u', 'd', { m: 9999 }).minutes, 1440);
  assert.deepEqual(rowToDay({}), { m: 0, c: 0, r: 0, t: 0, g: {} });
});

test('the same day from two places keeps the larger numbers and every guide', () => {
  const merged = mergeDay(
    { m: 10, c: 5, r: 1, t: 2, g: { a: { n: 'A', m: 10, k: ['read'] } } },
    { m: 4, c: 9, r: 3, t: 1, g: { a: { n: 'A', m: 2, k: ['quiz'] }, b: { n: 'B', m: 4, k: [] }, __proto__: { m: 1 } } },
  );
  assert.deepEqual(merged, { m: 10, c: 9, r: 3, t: 2, g: { a: { n: 'A', m: 10, k: ['read', 'quiz'] }, b: { n: 'B', m: 4, k: [] } } });
});

test('uploading misses merges with the server: sure ones first, no duplicates', () => {
  const server = [{ question: 'What makes ATP?', answer: 'Mitochondria' }];
  const local = [{ question: 'what makes atp', answer: 'Mitochondria', sure: true }, { question: 'Osmosis?', answer: 'Water moves' }];
  const merged = mergeRetainMisses(server, local);
  assert.equal(merged.length, 2);
  assert.equal(questionKey(merged[0].question), 'what makes atp');
  assert.equal(merged[0].sure, true);
});

test('search results become the list, grouped and linked', () => {
  const rows = searchRows([
    { kind: 'lecture', id: 'l1', title: 'Lecture 4', snippet: 'mitochondria', timestamp_seconds: 95 },
    { kind: 'flashcard', id: 'g1', title: 'Cells', snippet: 'What makes ATP? — Mitochondria', card_index: 0 },
    { kind: 'study_guide', id: 'g1', title: 'Cells', snippet: '…' },
    { kind: 'note', id: 'n1', title: '', snippet: '…' },
    { kind: 'something_else', id: 'x' },
  ]);
  assert.deepEqual(rows.map(row => [row.kind, row.title, row.href]), [
    ['guide', 'Cells', '/guide/g1'],
    ['card', 'What makes ATP?', '/flashcards/study?guideId=g1'],
    ['note', 'Untitled', '/smartnotes?id=n1'],
    ['lecture', 'Lecture 4', '/lecture/l1'],
  ]);
});

test('the app saves misses and study days as it changes them, and syncs once per load', () => {
  const store = readFileSync(new URL('../lib/userStore.js', import.meta.url), 'utf8');
  assert.match(store, /writeUserValue\('cordiaRetainMisses', all\);\n  saveRetainMissesToServer\(guideId, next\);/);
  const activity = readFileSync(new URL('../lib/activity.js', import.meta.url), 'utf8');
  assert.match(activity, /writeUserValue\(KEY, log\);\n  saveStudyDayToServer\(today, day\);/);
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.match(app, /syncServerCopies\(\)/);
  const sync = readFileSync(new URL('../lib/serverSync.js', import.meta.url), 'utf8');
  assert.match(sync, /\/rest\/v1\/rpc\/set_my_timezone/);
  assert.match(sync, /if \(!readUserValue\(UPLOADED\)\)/, 'the browser copy is uploaded once');
});
