import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineParts, parseTutorAnswer, readableMath } from '../lib/tutorFormat.mjs';

test('LaTeX math becomes symbols a student can read', () => {
  assert.equal(readableMath('\\(x^2 \\times 3 \\leq \\frac{a}{b}\\)'), 'x² × 3 ≤ (a)/(b)');
  assert.equal(readableMath('7 \\equiv 1 \\pmod{3}'), '7 ≡ 1 (mod 3)');
});

test('bold is split into parts and never parsed as HTML', () => {
  assert.deepEqual(inlineParts('**Key term** and <b>x</b>'), [
    { text: 'Key term', bold: true },
    { text: ' and <b>x</b>', bold: false },
  ]);
});

test('answers become paragraphs, bullets, numbered steps with work, and notes', () => {
  const blocks = parseTutorAnswer([
    'The inverse of 5 mod 26 is **21**.',
    '',
    '1. **Use the extended Euclidean algorithm**',
    '26 = 5 × 5 + 1',
    '> Divide and keep the remainder.',
    '2. **Check the answer**',
    '- 5 × 21 = 105',
    '',
    'Want to try 7 mod 26?',
  ].join('\n'));
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'step', 'step', 'paragraph']);
  assert.deepEqual(blocks[1].children, [{ type: 'work', text: '26 = 5 × 5 + 1' }, { type: 'note', text: 'Divide and keep the remainder.' }]);
  assert.deepEqual(blocks[2].children, [{ type: 'bullet', text: '5 × 21 = 105' }]);
});
