import test from 'node:test';
import assert from 'node:assert/strict';
import { ageFrom, birthYears, MIN_AGE } from '../lib/age.mjs';
import { reasonsFor, reportUnavailable } from '../lib/reportReasons.mjs';

const today = new Date(2026, 10, 8); // Nov 8, 2026

test('age from birth month and year', () => {
  assert.equal(ageFrom(2013, 11, today), 13, 'born this month counts as the birthday');
  assert.equal(ageFrom(2013, 12, today), 12, 'next month: still 12');
  assert.equal(ageFrom(2008, 5, today), 18);
  assert.equal(ageFrom(2026, 12, today), null, 'not in the future');
  assert.equal(ageFrom(2000, 13, today), null);
  assert.equal(ageFrom('', 3, today), null);
  assert.ok(ageFrom(2014, 1, today) < MIN_AGE);
});

test('birth years list, newest first', () => {
  const years = birthYears(today);
  assert.equal(years[0], 2026);
  assert.equal(years.length, 100);
});

test('report reasons per target', () => {
  assert.deepEqual(reasonsFor('profile').map(r => r.key), ['harassment', 'inappropriate']);
  assert.deepEqual(reasonsFor('classroom').map(r => r.key), ['inappropriate', 'harassment', 'copied_exam']);
  assert.equal(reasonsFor('guide').length, 5);
  assert.equal(reasonsFor('guide').find(r => r.key === 'harassment').label, 'Harassment or impersonation');
  assert.ok(reportUnavailable("Reporting this isn't available yet. Use Send feedback instead."));
  assert.ok(!reportUnavailable('Pick a reason from the list'));
});
