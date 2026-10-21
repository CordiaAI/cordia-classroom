import test from 'node:test';
import assert from 'node:assert/strict';
import { visualContent } from '../lib/visualText.js';

test('a short highlight leads and its section follows, without repeating it', () => {
  const section = 'Active transport\nUses ATP to move molecules against their gradient\nThe sodium-potassium pump is the classic example';
  assert.equal(visualContent('Uses ATP to move molecules', section), 'Uses ATP to move molecules\nActive transport\nThe sodium-potassium pump is the classic example');
});

test('a long highlight is drawn on its own', () => {
  const long = 'x'.repeat(300);
  assert.equal(visualContent(long, 'Other section text'), long);
});
