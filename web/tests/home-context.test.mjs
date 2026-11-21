// The home's context line, top right (VISUAL-POLISH V1.4, lib/homeContext.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_DAYS, contextLine, examWhen, soonestExam } from '../lib/homeContext.mjs';

const WEDNESDAY = new Date(2026, 10, 18, 9, 30); // Wednesday, Nov 18, 2026, local time
const at = (days, hour = 10) => new Date(2026, 10, 18 + days, hour).toISOString();
const key = days => { const d = new Date(2026, 10, 18 + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('with no exam within a week it is the day and date', () => {
  assert.equal(contextLine(null, WEDNESDAY), 'Wednesday, Nov 18');
  assert.equal(contextLine({ date: key(CONTEXT_DAYS + 1), course: 'MA 125' }, WEDNESDAY), 'Wednesday, Nov 18');
  assert.equal(contextLine({ date: key(-1), course: 'MA 125' }, WEDNESDAY), 'Wednesday, Nov 18');
  assert.equal(contextLine({ date: 'not a date' }, WEDNESDAY), 'Wednesday, Nov 18');
});

test('an exam within a week: the day, then the class code and when', () => {
  assert.equal(contextLine({ date: key(1), course: 'MA 125' }, WEDNESDAY), 'Wednesday · MA 125 exam tomorrow');
  assert.equal(contextLine({ date: key(0), course: 'MA-125-001' }, WEDNESDAY), 'Wednesday · MA 125 exam today');
  assert.equal(contextLine({ date: key(3), course: 'BIO-101-002', title: 'Midterm' }, WEDNESDAY), 'Wednesday · BIO 101 exam in 3 days');
  assert.equal(contextLine({ date: key(CONTEXT_DAYS), course: 'MUL 101 MUL-101-102: Introduction to Music' }, WEDNESDAY), 'Wednesday · MUL 101 exam in 7 days');
});

test('without a class code it names the exam, shortened, or just "Exam"', () => {
  assert.equal(contextLine({ date: key(2), course: 'Adult Health I', title: 'Exam 3' }, WEDNESDAY), 'Wednesday · Adult Health I exam in 2 days');
  assert.equal(contextLine({ date: key(2), course: '', title: 'Midterm' }, WEDNESDAY), 'Wednesday · Midterm in 2 days');
  assert.equal(contextLine({ date: key(2), course: '', title: '' }, WEDNESDAY), 'Wednesday · Exam in 2 days');
  const long = contextLine({ date: key(4), title: 'Cumulative final examination covering chapters one to twelve' }, WEDNESDAY);
  assert.ok(long.length <= 'Wednesday · '.length + 32 + ' in 4 days'.length && long.includes('…'), long);
});

test('"today" and "tomorrow" read in place of "in 0 days" and "in 1 day"', () => {
  assert.deepEqual([0, 1, 2, 7].map(examWhen), ['today', 'tomorrow', 'in 2 days', 'in 7 days']);
});

test('the soonest exam: done and past ones are skipped; the review set\'s exam counts too', () => {
  const today = key(0);
  const items = [
    { type: 'exam', title: 'Final', due_at: at(6), course: 'EH 102' },
    { type: 'assignment', title: 'Lab report', due_at: at(1), course: 'BIO 101' },
    { type: 'exam', title: 'Quiz exam', due_at: at(-1), course: 'MA 125' },
    { type: 'exam', title: 'Done exam', due_at: at(2), done: true, course: 'MA 125' },
    { type: 'exam', title: 'Midterm', due_at: at(3), course: 'BIO-101-002' },
  ];
  assert.deepEqual(soonestExam(items, null, today), { date: key(3), title: 'Midterm', course: 'BIO-101-002' });
  assert.deepEqual(soonestExam(items, { title: 'Exam 2', date: key(2), course: 'Calculus I' }, today), { date: key(2), title: 'Exam 2', course: 'Calculus I' });
  assert.equal(soonestExam([], null, today), null);
  assert.equal(soonestExam([{ type: 'exam', title: 'Bad', due_at: 'soon' }], null, today), null);
});
