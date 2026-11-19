// The Dashboard's exam countdown: the nearest exam in the next two weeks that has a Learn guide,
// and how ready the student is for it (Learn's own readiness).
import { counts, dayKey, readiness, restoreLevels } from './learnEngine.mjs';
import { parseQAPairs } from './guideText.mjs';

export const COUNTDOWN_DAYS = 14;
const DAY = 86400000;

function daysUntil(date, today) {
  return Math.round((new Date(date + 'T12:00:00') - new Date(today + 'T12:00:00')) / DAY);
}

const reviewTitle = title => `${String(title || '').trim()}: review`.toLowerCase();

// The two ways a guide belongs to an exam, shared by the Dashboard countdown, the sidebar's rings
// and the Calendar: the exam's review set ("<exam>: review"), or a guide Learn was given a test
// date for.
export const reviewSetFor = (title, guides) => (guides || []).find(item => String(item?.title || '').trim().toLowerCase() === reviewTitle(title)) || null;
export const learnTestDate = guide => guide?.flashcard_progress?.learn?.test_date || null;

// guides: list summaries (flashcard_progress.learn.test_date); exams: calendar or course-work items
// of type 'exam'. An exam's guide is its review set ("<exam>: review"); any guide with a Learn
// test date counts too. Returns { guideId, title, date, daysLeft } or null.
export function nearestExam(guides, exams, today = dayKey()) {
  const found = [];
  const inRange = date => date && daysUntil(date, today) >= 0 && daysUntil(date, today) <= COUNTDOWN_DAYS;
  (exams || []).forEach(exam => {
    if (exam?.done || !exam?.due_at) return;
    const date = dayKey(exam.due_at);
    const guide = reviewSetFor(exam.title, guides);
    if (guide && inRange(date)) found.push({ guideId: guide.id, title: String(exam.title).trim(), date });
  });
  (guides || []).forEach(guide => {
    const date = learnTestDate(guide);
    if (inRange(date) && !found.some(item => item.guideId === guide.id)) found.push({ guideId: guide.id, title: String(guide.title || '').replace(/: review$/i, ''), date });
  });
  const nearest = found.sort((a, b) => a.date.localeCompare(b.date))[0];
  return nearest ? { ...nearest, daysLeft: daysUntil(nearest.date, today) } : null;
}

// questions: the guide's Learn questions; learn: its saved flashcard_progress.learn.
export function examReadiness(questions, learn, today = dayKey()) {
  const list = Array.isArray(questions) ? questions : [];
  return readiness(counts(list, restoreLevels(list, learn?.levels || {}), today));
}

// Learn's questions for a guide (the saved quiz), or its own questions before Learn first opens.
export function learnQuestions(guide) {
  if (Array.isArray(guide?.quiz_questions) && guide.quiz_questions.length) return guide.quiz_questions;
  return parseQAPairs(guide?.study_guide).map(pair => ({ question: pair.question, options: [pair.answer], correct_index: 0 }));
}

// The sidebar's readiness rings (DESIGN-SPEC 3.3): for each class, the nearest exam in the next two
// weeks that has a review set among that class's guides (nearestExam above). Returns
// { [classId]: { guideId, title, date, daysLeft } } for the classes that have one.
export function classExams(classIds, guides, exams, today = dayKey()) {
  const found = {};
  (classIds || []).forEach(id => {
    const own = (guides || []).filter(guide => String(guide?.folder_id || '') === String(id));
    const exam = own.length ? nearestExam(own, exams, today) : null;
    if (exam) found[id] = exam;
  });
  return found;
}
