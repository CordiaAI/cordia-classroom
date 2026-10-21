import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, normalizePhone } from '../lib/phone.mjs';

test('phone numbers are read into E.164 for SMS sign-in', () => {
  assert.equal(normalizePhone('(251) 555-0100'), '+12515550100');
  assert.equal(normalizePhone('1 251 555 0100'), '+12515550100');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('555-0100'), '', 'too short');
  assert.equal(normalizePhone('call me'), '');
  assert.equal(formatPhone('12515550100'), '+1 (251) 555-0100');
  assert.equal(formatPhone('+442079460958'), '+442079460958');
  assert.equal(formatPhone(''), '');
});
