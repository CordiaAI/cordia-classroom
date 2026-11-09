// The study-time notice after scheduling (lib/studyTime.mjs, used by AssignmentSheet and Your week):
// a shortfall is always said out loud, with the minutes scheduled against the minutes needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { minutesLabel, scheduleNotice } from '../lib/studyTime.mjs';

const SHEET = { where: "before it's due", covered: 'Your study time already covers this.' };

test('everything fit: the same line as before', () => {
  assert.equal(scheduleNotice({ added: 2, minutes_added: 120, minutes_requested: 120 }, SHEET), "Added 2 study blocks before it's due.");
  assert.equal(scheduleNotice({ added: 1, minutes_added: 60, minutes_requested: 55 }, SHEET), "Added 1 study block before it's due.", 'rounding up is not a shortfall');
  assert.equal(scheduleNotice({ added: 0, minutes_added: 0, minutes_requested: 0 }, SHEET), 'Your study time already covers this.');
});

test('a shortfall says how much was scheduled and how much was needed', () => {
  assert.equal(
    scheduleNotice({ added: 1, minutes_added: 90, minutes_requested: 120 }, SHEET),
    "Added 1 study block before it's due: 1 h 30 min of the 2 h needed. There isn't more free time before the deadline.",
  );
  assert.equal(
    scheduleNotice({ added: 0, minutes_added: 0, minutes_requested: 120 }, SHEET),
    "There isn't free time before the deadline, so no study time was added (2 h needed).",
  );
  assert.match(scheduleNotice({ added: 3, minutes_added: 150, minutes_requested: 200 }, { where: 'to your calendar', covered: '' }), /^Added 3 study blocks to your calendar: 2 h 30 min of the 3 h 20 min needed\./);
});

test('an older backend without the minute totals keeps the old wording', () => {
  assert.equal(scheduleNotice({ added: 2 }, SHEET), "Added 2 study blocks before it's due.");
  assert.equal(minutesLabel(45), '45 min');
});

test('both places that schedule study time use the notice', async () => {
  for (const file of ['../components/AssignmentSheet.js', '../pages/week.js']) {
    assert.match(await readFile(new URL(file, import.meta.url), 'utf8'), /scheduleNotice\(result, \{/, file);
  }
});
