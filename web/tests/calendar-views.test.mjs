// The Calendar page's model (lib/calendarViews.mjs): classes and colours, "Needs study time", each
// Agenda row's one action, the Week grid's geometry and drag maths, the Month cells, the Agenda's
// days, and exam readiness that equals Learn's (and the sidebar's) for the same review set.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaDays, buildBlocks, dueSoon, buildDeadlines, classFor, classIndex, courseKey, dayEntries, examProgress, examReviewGuide,
  gridBox, hasStudyTime, lanes, monthCell, monthGrid, needsStudyTime, nowLine, pickView, plannedHours, rowAction,
  shiftBlock, span, startOfWeek, weekRangeLabel,
} from '../lib/calendarViews.mjs';
import { classExams, examReadiness, learnQuestions } from '../lib/examCountdown.mjs';

// Wednesday, Nov 18, 2026, 10:40 AM (local), the mockups' "now".
const NOW = new Date(2026, 10, 18, 10, 40);
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const FOLDERS = [
  { id: 'f-ma', name: 'MA 125: Calculus I' },
  { id: 'f-eh', name: 'EH 101 EH-101-004: English Composition' },
  { id: 'f-cis', name: 'CIS 115: Programming' },
];
const ITEMS = [
  { id: 'canvas-1', title: 'Reflection 7', course: 'BUS-101-002', due_at: at(16, 23, 59), type: 'assignment', done: true },
  { id: 'canvas-2', title: 'Peer review comments', course: 'EH 101', due_at: at(18, 23, 59), type: 'assignment' },
  { id: 'canvas-3', title: 'Exam 3 [MA-125-001]', due_at: at(19, 9, 30), type: 'exam' },
  { id: 'canvas-4', title: 'Argument essay draft', course: 'EH 101', due_at: at(19, 23, 59), type: 'assignment' },
  { id: 'canvas-5', title: 'Quiz 10', course: 'CIS 115', due_at: at(22, 23, 59), type: 'quiz' },
  { id: 'canvas-6', title: 'Career portfolio', course: 'BUS 101', due_at: at(20, 17), type: 'assignment' },
  { id: 'canvas-7', title: 'Final essay', course: 'EH 101', due_at: at(30, 23, 59), type: 'assignment' },
  { id: 'lecture-9', title: 'Problem set 3', course: 'From Lecture 12', due_at: at(21, 12), type: 'assignment', internal: true, url: '/lecture/9' },
];
const BLOCKS = [
  { id: 'b1', item_key: 'canvas-3', kind: 'review', title: 'Review: Exam 3', starts_at: at(17, 16), ends_at: at(17, 17), done: true },
  { id: 'b2', item_key: 'canvas-3', kind: 'review', title: 'Review: Exam 3', starts_at: at(18, 11), ends_at: at(18, 12) },
  { id: 'b3', item_key: 'canvas-4', kind: 'work', title: 'Argument essay draft: Draft body paragraphs', starts_at: at(18, 19), ends_at: at(18, 20, 30) },
  { id: 'b4', item_key: 'canvas-6', kind: 'work', title: 'Work on Career portfolio', starts_at: at(20, 13), ends_at: at(20, 14) },
];

const index = classIndex(FOLDERS);
const deadlines = buildDeadlines(ITEMS, index);
const blocks = buildBlocks(BLOCKS, deadlines, index);
const byId = id => deadlines.find(entry => entry.id === id);

test('course codes match the student\'s classes, with the sidebar\'s colour', () => {
  assert.equal(courseKey('MA-125-001'), 'MA 125');
  assert.equal(courseKey('ma125'), 'MA 125');
  assert.equal(courseKey('Biology 101'), 'biology 101');
  assert.equal(byId('canvas-3').cls.classId, 'f-ma');
  assert.equal(byId('canvas-3').title, 'Exam 3');
  assert.equal(byId('canvas-2').cls.classId, 'f-eh');
  assert.equal(byId('canvas-2').cls.tone, byId('canvas-4').cls.tone);
  // A course with no class of the student's own still gets one steady colour.
  assert.equal(byId('canvas-1').cls.classId, null);
  assert.equal(byId('canvas-1').cls.tone, byId('canvas-6').cls.tone);
  assert.equal(classFor('From Lecture 12', index), null);
  // A block reads as its own step; its deadline's name stays in fullTitle.
  const b3 = blocks.find(block => block.id === 'b3');
  assert.equal(b3.title, 'Draft body paragraphs');
  assert.equal(b3.fullTitle, 'Argument essay draft: Draft body paragraphs');
  assert.equal(blocks.find(block => block.id === 'b2').title, 'Review: Exam 3');
  // Blocks take their deadline's class.
  assert.equal(blocks.find(block => block.id === 'b3').cls.key, 'EH 101');
});

test('Needs study time: due in the next 7 days, not done, no block for that class before it', () => {
  const needs = needsStudyTime(deadlines, blocks, NOW).map(entry => entry.id);
  // canvas-2 (EH 101, tonight): the EH 101 block at 7 PM tonight is before it, so it has time.
  // canvas-3 (exam) has review blocks; canvas-4 has b3; canvas-6 has b4.
  // canvas-5 (CIS 115, Sunday) has none. canvas-7 is past 7 days; canvas-1 is done; lecture-9 is a to-do.
  assert.deepEqual(needs, ['canvas-5']);
  // A block for the class after the deadline doesn't count.
  const late = buildBlocks([{ id: 'x', item_key: 'canvas-5', kind: 'work', title: 'Late', starts_at: at(23, 10), ends_at: at(23, 11) }], deadlines, index);
  assert.equal(hasStudyTime(byId('canvas-5'), late), false);
  // A block for another deadline of the same class, before it, counts.
  const sameClass = buildBlocks([{ id: 'y', item_key: 'canvas-x', course: 'CIS-115-001', kind: 'work', title: 'Loops', starts_at: at(21, 10), ends_at: at(21, 11) }], deadlines, index);
  assert.equal(hasStudyTime(byId('canvas-5'), sameClass), true);
  // A block more than a week before the deadline doesn't count.
  const old = buildBlocks([{ id: 'z', item_key: 'canvas-5', kind: 'work', title: 'Old', starts_at: at(10, 10), ends_at: at(10, 11) }], deadlines, index);
  assert.equal(hasStudyTime(byId('canvas-5'), old), false);
  // The pool it's drawn from: due in the next 7 days, open, not a lecture to-do.
  assert.deepEqual(dueSoon(deadlines, NOW).map(entry => entry.id), ['canvas-2', 'canvas-3', 'canvas-4', 'canvas-6', 'canvas-5']);
  // Already past: never "needs" anything.
  assert.deepEqual(needsStudyTime(deadlines, [], new Date(2026, 11, 30)), []);
});

test('each Agenda row has one action', () => {
  assert.equal(rowAction(blocks.find(b => b.id === 'b2'), blocks, NOW), 'start');
  assert.equal(rowAction(blocks.find(b => b.id === 'b1'), blocks, NOW), null, 'done study time');
  assert.equal(rowAction(byId('canvas-3'), blocks, NOW), 'review');
  assert.equal(rowAction(byId('canvas-4'), blocks, NOW), 'planned');
  assert.equal(rowAction(byId('canvas-5'), blocks, NOW), 'find');
  assert.equal(rowAction(byId('canvas-1'), blocks, NOW), null, 'done deadline');
  assert.equal(rowAction(byId('lecture-9'), blocks, NOW), null, 'a lecture to-do opens its lecture');
});

test('weeks start on Monday and read like the mockups', () => {
  const start = startOfWeek(NOW);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 16);
  assert.equal(weekRangeLabel(start), 'Nov 16 – 22, 2026');
  assert.equal(weekRangeLabel(new Date(2026, 10, 30)), 'Nov 30 – Dec 6, 2026');
  assert.equal(span(new Date(2026, 10, 19, 9, 30), new Date(2026, 10, 19, 10, 45)), '9:30 – 10:45 AM');
  assert.equal(span(new Date(2026, 10, 18, 11), new Date(2026, 10, 18, 12)), '11 AM – 12 PM');
  const grid = monthGrid(NOW);
  assert.equal(grid.length, 42);
  assert.equal(grid[0].getDate(), 26); // Mon, Oct 26
  assert.equal(grid[6].getDate(), 1);
});

test('the Week grid: boxes, lanes, the now line', () => {
  const box = gridBox(new Date(2026, 10, 18, 11), new Date(2026, 10, 18, 12));
  assert.equal(box.top, 3 / 14);
  assert.equal(box.height, 1 / 14);
  assert.equal(gridBox(new Date(2026, 10, 18, 6), new Date(2026, 10, 18, 7)).hidden, true);
  assert.equal(nowLine(NOW), (2 * 60 + 40) / (14 * 60));
  assert.equal(nowLine(new Date(2026, 10, 18, 23)), null);
  const overlapping = buildBlocks([
    { id: 'p', item_key: 'a', title: 'A', starts_at: at(18, 10), ends_at: at(18, 11, 30) },
    { id: 'q', item_key: 'b', title: 'B', starts_at: at(18, 11), ends_at: at(18, 12) },
    { id: 'r', item_key: 'c', title: 'C', starts_at: at(18, 14), ends_at: at(18, 15) },
  ], [], index);
  const placed = lanes(overlapping);
  assert.deepEqual(placed['block-p'], { lane: 0, lanes: 2 });
  assert.deepEqual(placed['block-q'], { lane: 1, lanes: 2 });
  assert.deepEqual(placed['block-r'], { lane: 0, lanes: 1 });
});

test('dragging and keys: snapped, kept inside the day, 15 minutes to 6 hours', () => {
  const block = { start: new Date(2026, 10, 18, 11), end: new Date(2026, 10, 18, 12) };
  const moved = shiftBlock(block, { days: 1, minutes: 37 });
  assert.equal(moved.start.getDate(), 19);
  assert.equal(moved.start.getHours() * 60 + moved.start.getMinutes(), 11 * 60 + 30); // 11:37 snaps to 11:30
  assert.equal(moved.end - moved.start, 3600000);
  const early = shiftBlock(block, { minutes: -6 * 60 });
  assert.equal(early.start.getHours(), 8);
  const late = shiftBlock(block, { minutes: 20 * 60 });
  assert.equal(late.end.getHours(), 22);
  assert.equal(shiftBlock(block, { minutes: -120, resize: true }).end - block.start, 15 * 60000);
  assert.equal(shiftBlock(block, { minutes: 30, resize: true }).end.getHours() * 60 + shiftBlock(block, { minutes: 30, resize: true }).end.getMinutes(), 12 * 60 + 30);
  assert.equal(shiftBlock(block, { minutes: 20 * 60, resize: true }).end.getHours(), 17, 'never past 6 hours');
  const evening = { start: new Date(2026, 10, 18, 21), end: new Date(2026, 10, 18, 21, 30) };
  assert.equal(shiftBlock(evening, { minutes: 4 * 60, resize: true }).end.getHours(), 22, 'never past 10 PM');
});

test('Board hours, Month cells, Agenda days', () => {
  assert.equal(plannedHours(new Date(2026, 10, 18), blocks), 2.5);
  assert.equal(plannedHours(new Date(2026, 10, 16), blocks), 0);
  const thursday = monthCell(new Date(2026, 10, 19), deadlines, blocks);
  assert.deepEqual(thursday.due.map(entry => entry.id), ['canvas-3', 'canvas-4']);
  assert.equal(thursday.more, 0);
  const busy = buildDeadlines(Array.from({ length: 5 }, (_, i) => ({ id: 'q' + i, title: 'Reading ' + i, due_at: at(24, 9 + i) })), index);
  assert.equal(monthCell(new Date(2026, 10, 24), busy, []).more, 3);
  assert.equal(monthCell(new Date(2026, 10, 18), deadlines, blocks).study, 2);
  const days = agendaDays(startOfWeek(NOW), deadlines, blocks, NOW);
  assert.equal(days[0].day.getDate(), 17, 'starts yesterday');
  assert.ok(days.some(({ day }) => day.getDate() === 18));
  assert.ok(days.every(({ day, entries }) => entries.length || day.getDate() === 18));
  assert.deepEqual(dayEntries(new Date(2026, 10, 18), deadlines, blocks).map(entry => entry.key), ['block-b2', 'block-b3', 'due-canvas-2']);
});

test('the view defaults: Week on wide screens, Agenda on phones, the saved one otherwise', () => {
  assert.equal(pickView(null, true), 'week');
  assert.equal(pickView('month', true), 'month');
  assert.equal(pickView('month', false), 'agenda');
  assert.equal(pickView('bogus', true), 'week');
});

test('exam readiness equals Learn\'s and the sidebar\'s for the same review set', () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({ question: `What does idea ${i} explain?`, options: [`Idea ${i} explains part ${i}`], correct_index: 0 }));
  const fingerprint = q => q.question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
  const levels = Object.fromEntries(questions.map((q, i) => [i, { q: fingerprint(q), l: [3, 3, 3, 3, 2, 2, 1, 0, 0, 0][i], at: '2026-11-17', sure: true }]));
  const guide = { id: 'g1', title: 'Exam 3 [MA-125-001]: review', folder_id: 'f-ma', quiz_questions: questions,
    flashcard_progress: { learn: { levels, test_date: '2026-11-19' } } };
  const exam = byId('canvas-3');
  assert.equal(examReviewGuide(exam, [{ id: 'other', title: 'Exam 3: notes' }, guide]).id, 'g1');
  const progress = examProgress(guide, exam.at, '2026-11-18');
  const learn = examReadiness(learnQuestions(guide), guide.flashcard_progress.learn, '2026-11-18');
  assert.equal(progress.percent, learn);
  assert.equal(progress.percent, Math.round(((4 + 2 * 0.5 + 0.15) / 10) * 100));
  assert.equal(progress.left, 6);
  // The sidebar finds the same review set for the class.
  const sidebar = classExams(['f-ma'], [guide], [{ ...ITEMS[2], due_at: '2026-11-19T15:30:00.000Z' }], '2026-11-18');
  assert.equal(sidebar['f-ma'].guideId, 'g1');
});
