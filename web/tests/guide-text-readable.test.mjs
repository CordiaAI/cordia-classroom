// readableText (lib/guideText.mjs): guide or uploaded HTML as plain text for Practice, with
// paragraph breaks kept, every tag removed and entities decoded once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readableText } from '../lib/guideText.mjs';

test('block tags become line breaks and the paragraphs stay apart', () => {
  assert.equal(readableText('<h2>Cells</h2><p>Mitochondria make ATP.</p><p>Ribosomes make <b>proteins</b>.</p>'),
    'Cells\n\nMitochondria make ATP.\n\nRibosomes make proteins.');
  assert.equal(readableText('Line one<br>Line two'), 'Line one\nLine two');
  assert.equal(readableText(null), '');
});

test('entities are decoded once, with &amp; last', () => {
  assert.equal(readableText('<p>A &amp; B &lt; C&nbsp;D</p>'), 'A & B < C D');
  assert.equal(readableText('<p>Write &amp;lt;b&amp;gt; for bold</p>'), 'Write &lt;b&gt; for bold');
});

test('tags are removed until none are left', () => {
  assert.equal(readableText('a<<b>i>b'), 'ab');
  assert.doesNotMatch(readableText('<<b>em>x</em>'), /<em>/);
});

test('Practice uses the shared helper', async () => {
  const practice = await readFile(new URL('../components/PracticeWorkspace.js', import.meta.url), 'utf8');
  assert.match(practice, /import \{ readableText \} from '\.\.\/lib\/guideText\.mjs'/);
  assert.doesNotMatch(practice, /function readableText/);
});
