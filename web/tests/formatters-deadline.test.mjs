import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineCourse, deadlineTitle } from '../lib/formatters.js';

test('Canvas section codes leave deadline titles and become the class', () => {
  assert.equal(deadlineTitle({ title: 'Essay 2 [ENG-101-004]' }), 'Essay 2');
  assert.equal(deadlineCourse({ title: 'Essay 2 [ENG-101-004]' }), 'ENG-101-004');
  assert.equal(deadlineCourse({ title: 'Essay 2 [ENG-101-004]', course: 'ENG-101' }), 'ENG-101');
  assert.equal(deadlineTitle({ title: 'Lab [3] write-up' }), 'Lab [3] write-up');
  assert.equal(deadlineTitle({ title: '[ENG-101]' }), '[ENG-101]');
});

test('only web links and app pages become deadline hrefs', async () => {
  const { safeHref } = await import('../lib/formatters.js');
  assert.equal(safeHref('https://school.instructure.com/x', '/c'), 'https://school.instructure.com/x');
  assert.equal(safeHref('/lecture/1', '/c'), '/lecture/1');
  assert.equal(safeHref('javascript:alert(1)', '/c'), '/c');
  assert.equal(safeHref('//evil.example', '/c'), '/c');
  assert.equal(safeHref('', '/c'), '/c');
});
