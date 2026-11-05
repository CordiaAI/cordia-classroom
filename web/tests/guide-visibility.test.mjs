import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chipLabel, firstPublishStep, outlineLine, savedMeta } from '../lib/guideVisibility.mjs';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const fresh = { created_at: '2026-11-05T11:58:00Z', study_guide: 'Q: What is lead time?\nA: The wait.', visibility: 'private' };

test('chip labels name the class only for classroom guides', () => {
  assert.equal(chipLabel('public', { code: 'MGT 300' }), 'Public');
  assert.equal(chipLabel('link'), 'Link');
  assert.equal(chipLabel('classroom', { code: 'MGT 300' }), 'Classroom · MGT 300');
  assert.equal(chipLabel('classroom', null), 'Classroom');
  assert.equal(chipLabel('everyone'), 'Private');
  assert.equal(chipLabel(undefined), 'Private');
});

test('outline preview lines are plain text', () => {
  assert.deepEqual(outlineLine('## Supply chains'), { heading: true, text: 'Supply chains' });
  assert.deepEqual(outlineLine('- Lead time'), { heading: false, text: 'Lead time' });
  assert.deepEqual(outlineLine('#hashtag stays'), { heading: false, text: '#hashtag stays' });
});

test('first-publish step: once, on a fresh guide with material, never on copies', () => {
  assert.equal(firstPublishStep(fresh, { now: NOW }), 'ask');
  assert.equal(firstPublishStep({ ...fresh, visibility: 'public' }, { now: NOW }), 'notice');
  assert.equal(firstPublishStep({ ...fresh, visibility: 'classroom' }, { now: NOW }), null);
  assert.equal(firstPublishStep(fresh, { now: NOW, asked: true }), null);
  assert.equal(firstPublishStep({ ...fresh, created_at: '2026-11-04T11:58:00Z' }, { now: NOW }), null);
  assert.equal(firstPublishStep({ ...fresh, study_guide: '  ' }, { now: NOW }), null);
  assert.equal(firstPublishStep({ ...fresh, forked_from_guide_id: 'x' }, { now: NOW }), null);
  assert.equal(firstPublishStep({ ...fresh, linked_set_id: 'x' }, { now: NOW }), null);
  assert.equal(firstPublishStep({ ...fresh, origin: 'mcp' }, { now: NOW }), null);
  assert.equal(firstPublishStep(null, { now: NOW }), null);
});

test('saved rows never name an anonymous author and flag newer versions', () => {
  assert.equal(savedMeta({ author: null, question_count: 1, version: 1, pinned_version: 1 }), 'Anonymous classmate · 1 question');
  assert.equal(savedMeta({ author: { username: 'ana', display_name: 'Ana' }, question_count: 12, version: 3, pinned_version: 2 }),
    'Ana · 12 questions · Updated since you saved it');
  assert.equal(savedMeta({ author: { username: 'ben' }, question_count: 0 }), '@ben · 0 questions');
});

test('the shared guide page stays out of search unless public', async () => {
  const page = await readFile(new URL('../pages/sets/[id].js', import.meta.url), 'utf8');
  assert.match(page, /const noindex = !guide \|\| guide\.visibility !== 'public'/);
  assert.match(page, /<meta name="robots" content="noindex"/);
});

test('new generated guides ask for the default share; other creators do not', async () => {
  const create = await readFile(new URL('../lib/guideCreate.js', import.meta.url), 'utf8');
  assert.match(create, /share_default: true/);
  for (const file of ['../components/NewSheet.js', '../pages/smartnotes.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8').catch(() => '');
    assert.doesNotMatch(source, /share_default/);
  }
});
