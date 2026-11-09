import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chipLabel, outlineLine, savedMeta } from '../lib/guideVisibility.mjs';

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

test('a new guide never says it was made public or opens a publish prompt by itself', async () => {
  const page = await readFile(new URL('../pages/guide/[id].js', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /New guides are public|PublishSheet|firstPublish/);
  const sheet = await readFile(new URL('../components/PublishSheet.js', import.meta.url), 'utf8');
  assert.doesNotMatch(sheet, /New guides are public/);
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

test('no creation path asks for a default share: new guides start private', async () => {
  for (const file of ['../lib/guideCreate.js', '../components/NewSheet.js', '../pages/smartnotes.js', '../pages/create.js', '../../extension/background.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /share_default/, file);
  }
});
