// The editable Outline: outline text -> HTML -> what the student typed -> outline text again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksToOutline, outlineToHtml } from '../lib/outlineDoc.js';
import { parseStudyNotes } from '../lib/formatters.js';

const NOTES = '> Cells move materials two ways.\n## Passive transport\n- **Diffusion** needs no energy\n  - Osmosis is diffusion of water\n## Key points\n- Active needs ATP';

test('outline text renders as headings and lists, bold kept, text escaped', () => {
  const html = outlineToHtml(NOTES + '\n- a < b');
  assert.match(html, /^<p class="oe-overview">Cells move materials two ways\.<\/p><h2>Passive transport<\/h2><ul><li><strong>Diffusion<\/strong> needs no energy<ul><li>Osmosis is diffusion of water<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<li>a &lt; b<\/li>/);
});

test('what the student typed saves in the form the Outline reads, plain lines as points', () => {
  const text = blocksToOutline([
    { kind: 'overview', text: 'Cells move materials two ways.' },
    { kind: 'heading', text: 'Passive transport' },
    { kind: 'point', text: '**Diffusion** needs  no energy' },
    { kind: 'detail', text: 'Osmosis is diffusion of water' },
    { kind: 'point', text: '   ' },
    { kind: 'heading', text: 'Key points' },
    { kind: 'point', text: 'Active needs ATP' },
  ]);
  assert.equal(text, NOTES);
  const notes = parseStudyNotes(text);
  assert.equal(notes.sections[0].points[0].sub[0], 'Osmosis is diffusion of water');
  assert.deepEqual(notes.keyPoints, ['Active needs ATP']);
});

test('a lecture outline keeps its levels when it moves to Notes: title dropped, sub-headings nested', async () => {
  const { shapeBlocks } = await import('../lib/outlineDoc.js');
  const lecture = [
    { kind: 'heading', level: 1, text: 'The Romantic Era in Music' },
    { kind: 'heading', level: 2, text: 'I. Course Announcements' },
    { kind: 'heading', level: 3, text: 'A. Paper Deadline' },
    { kind: 'point', text: 'The next paper is due on the 27th.' },
    { kind: 'heading', level: 3, text: 'B. **Concert** List' },
    { kind: 'point', text: 'Trombone choir tonight.' },
    { kind: 'detail', text: 'Free entry.' },
    { kind: 'heading', level: 2, text: 'II. Lieder' },
    { kind: 'point', text: 'Art songs for voice and piano.' },
  ];
  assert.equal(blocksToOutline(shapeBlocks(lecture, { title: 'The Romantic Era in Music' })), [
    '## I. Course Announcements',
    '- **A. Paper Deadline**',
    '  - The next paper is due on the 27th.',
    '- **B. Concert List**',
    '  - Trombone choir tonight.',
    '  - Free entry.',
    '## II. Lieder',
    '- Art songs for voice and piano.',
  ].join('\n'));
  // A lone top heading is the title even when it is worded differently from the note's name.
  assert.equal(shapeBlocks(lecture, { title: 'Lecture 10/22' })[0].text, 'I. Course Announcements');
});

test('notes with one heading level are left as they are, and the title only drops on request', async () => {
  const { shapeBlocks } = await import('../lib/outlineDoc.js');
  const flat = [{ kind: 'heading', level: 2, text: 'Passive transport' }, { kind: 'point', text: 'Diffusion' }];
  assert.deepEqual(shapeBlocks(flat), flat);
  // The Outline editor never passes a title, so a one-section outline keeps its heading.
  assert.deepEqual(shapeBlocks(flat, {}), flat);
});
