import test from 'node:test';
import assert from 'node:assert/strict';
import { fileNamesOnly, firstGuideClasses, makesStudySetOnOpen, needsStudySet, studySetRequestId, studySetSource } from '../lib/studySet.mjs';
import { examReadiness, nearestExam } from '../lib/examCountdown.mjs';
import { MASTERED, fingerprint } from '../lib/learnEngine.mjs';

const notes = '## Cell energy\n- ATP is the energy currency of the cell.\n- Mitochondria make ATP through respiration.';

test('a Canvas import with notes and no questions gets its study set when opened', () => {
  const canvas = { id: 'g1', notes, study_guide: '', source_type: 'canvas_module' };
  assert.ok(needsStudySet(canvas));
  assert.ok(makesStudySetOnOpen(canvas));
  assert.ok(makesStudySetOnOpen({ ...canvas, source_type: 'review' }));
  assert.ok(!needsStudySet({ ...canvas, study_guide: 'Q1: x\nA1: y' }));
  assert.equal(studySetSource(notes), 'Cell energy\nATP is the energy currency of the cell.\nMitochondria make ATP through respiration.');
  assert.equal(studySetRequestId('g1'), 'study-set:g1');
});

test('no notes, file names only, or the student\'s own notes page: nothing is made on open', () => {
  assert.ok(!needsStudySet({ notes: '', study_guide: '' }));
  assert.ok(!needsStudySet({ notes: '- Short', study_guide: '' }));
  assert.ok(fileNamesOnly('- Chapters 18 - 20-1.pptx\n- Week 3 reading.pdf'));
  assert.ok(!needsStudySet({ notes: '- Chapters 18 - 20-1.pptx\n- Week 3 reading and lecture slides.pdf', study_guide: '' }));
  const own = { notes, study_guide: '', source_type: 'notes' };
  assert.ok(needsStudySet(own));
  assert.ok(!makesStudySetOnOpen(own));
  assert.ok(!makesStudySetOnOpen({ ...own, source_type: 'note:abc' }));
});

test('exam countdown: the nearest exam in two weeks with a review set or a Learn test date', () => {
  const today = '2026-10-29';
  const guides = [
    { id: 'r', title: 'Midterm 2: review' },
    { id: 'l', title: 'Contracts', flashcard_progress: { learn: { test_date: '2026-11-03' } } },
    { id: 'far', title: 'Far', flashcard_progress: { learn: { test_date: '2026-12-20' } } },
  ];
  const exams = [{ title: 'Midterm 2', due_at: '2026-11-06T15:00:00', type: 'exam' }, { title: 'Final', due_at: '2026-11-01T15:00:00', type: 'exam' }];
  assert.deepEqual(nearestExam(guides, exams, today), { guideId: 'l', title: 'Contracts', date: '2026-11-03', daysLeft: 5 });
  assert.equal(nearestExam(guides.slice(0, 1), exams, today).guideId, 'r');
  assert.equal(nearestExam(guides.slice(0, 1), exams, today).daysLeft, 8);
  assert.equal(nearestExam([guides[2]], [], today), null);
  assert.equal(nearestExam(guides.slice(0, 1), [{ ...exams[0], done: true }], today), null);
});

test('exam readiness uses the saved Learn levels', () => {
  const questions = [{ question: 'A?', options: ['a', 'b'], correct_index: 0 }, { question: 'B?', options: ['b', 'c'], correct_index: 0 }];
  assert.equal(examReadiness(questions, { levels: { 0: { l: MASTERED, at: '2026-10-29', q: fingerprint(questions[0]) } } }, '2026-10-29'), 50);
  assert.equal(examReadiness([], null), 0);
});

test('first study set: the class with the soonest work is offered first', () => {
  const courses = [{ id: 1, code: 'ART 210', name: 'Renaissance Art' }, { id: 2, code: 'BUS-101', name: 'Business Law', imported: true }, { id: 3, code: 'NUR 300', name: 'Pharmacology' }];
  const upcoming = [{ course: 'NUR 300', due_at: '2026-11-04T12:00:00Z' }, { course: 'Renaissance Art', due_at: '2026-11-01T12:00:00Z' }];
  assert.deepEqual(firstGuideClasses(courses, upcoming).map(course => course.id), [1, 3, 2]);
  assert.deepEqual(firstGuideClasses(courses, []).map(course => course.id), [2, 1, 3]);
});
