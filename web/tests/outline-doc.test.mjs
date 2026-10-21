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
