import test from 'node:test';
import assert from 'node:assert/strict';
import { classLabel } from '../lib/classLabel.js';

test('Canvas class names read as the name with the course code under it', () => {
  assert.deepEqual(classLabel('MUL 101 MUL-101-102: Introduction to Music'), { title: 'Introduction to Music', code: 'MUL 101' });
  assert.deepEqual(classLabel('REL 200 REL-200-101: Old Testament/Hebrew Bible'), { title: 'Old Testament/Hebrew Bible', code: 'REL 200' });
  assert.deepEqual(classLabel('ATO Pledge'), { title: 'ATO Pledge', code: '' });
  assert.deepEqual(classLabel('Biology 101'), { title: 'Biology 101', code: '' });
});
