// "Show if I'm right: When I submit" for Quiz and the Timed test. Nothing is marked until the
// whole quiz is handed in; then every answer is checked at once (written ones by AI, in parallel)
// and the results screen offers "Retry my misses", run with the usual Retain rules.
//
// An item is one question on screen: { id, type, concepts: [index, ...] }; matching has several
// concepts, every other type one. Answers: { [item id]: response }, where a matching response is
// { [concept]: chosen answer }.

import { CLEAR_AFTER, choiceText, conceptAnswer, fillMatches, normalize, reaskType } from './retainEngine.mjs';
import { makeCloze } from './learnEngine.mjs';

export const FEEDBACK = { each: 'After each question', submit: 'When I submit' };
export const FEEDBACK_DEFAULTS = { quiz: 'each', timed: 'submit' };
export const prefKey = mode => `feedback_${mode}`;

export function cleanFeedback(value, mode) {
  return value === 'each' || value === 'submit' ? value : FEEDBACK_DEFAULTS[mode] || 'each';
}

// What a type expects as the answer to one concept.
export function expected(type, question) {
  if (type === 'cloze') return makeCloze(conceptAnswer(question))?.missing || conceptAnswer(question);
  return conceptAnswer(question);
}

export function isAnswered(item, response) {
  if (item.type === 'matching') return item.concepts.every(concept => String(response?.[concept] || '').trim());
  return Boolean(String(response || '').trim());
}

export function unanswered(items, answers) {
  return items.filter(item => !isAnswered(item, answers[item.id]));
}

// Credit for one concept, checked here; written answers are marked by AI (null until then).
export function markConcept(type, question, response) {
  const given = String(response || '').trim();
  if (!given) return 0;
  if (type === 'written') return null;
  if (type === 'mc' || type === 'matching') return normalize(choiceText(given)) === normalize(choiceText(conceptAnswer(question))) ? 1 : 0;
  return fillMatches(given, expected(type, question)) ? 1 : 0;
}

// One row per concept: { itemId, concept, type, response, credit, confidence }. `grades` holds the
// AI marks for written answers ({ [item id]: { credit, token } } or null when it couldn't be marked);
// `selfMarks` the student's own verdict for a written answer that couldn't be marked.
export function markAll(items, questions, answers, confidence = {}, grades = {}, selfMarks = {}) {
  return items.flatMap(item => item.concepts.map(concept => {
    const raw = item.type === 'matching' ? answers[item.id]?.[concept] : answers[item.id];
    const response = String(raw || '').trim();
    let credit = markConcept(item.type, questions[concept], response);
    let token = null;
    let selfMarked = false;
    if (item.type === 'written' && response) {
      const grade = grades[item.id];
      if (grade && typeof grade.credit === 'number') { credit = grade.credit; token = grade.token || null; }
      else if (item.id in selfMarks) { credit = selfMarks[item.id]; selfMarked = true; }
    }
    return { itemId: item.id, concept, type: item.type, response, credit, token, selfMarked, confidence: confidence[item.id] || '' };
  }));
}

// The score is first-try credit over the answers that could be marked; a written answer that
// couldn't be marked (and hasn't been self-checked) is left out, never counted wrong.
export function scoreRows(rows) {
  const marked = rows.filter(row => typeof row.credit === 'number');
  const earned = marked.reduce((sum, row) => sum + row.credit, 0);
  return {
    score: marked.length ? Math.round((earned / marked.length) * 100) : 0,
    right: marked.filter(row => row.credit === 1).length,
    marked: marked.length,
    total: rows.length,
    missed: marked.filter(row => row.credit < 1),
    unchecked: rows.filter(row => row.credit === null),
  };
}

// The attempts the server re-checks (POST /quiz/{id}/submit). Unmarked written answers stay out,
// and so do self-checked ones: without the AI's signed grade the server can't count them.
export function attemptsFor(rows) {
  return rows.filter(row => typeof row.credit === 'number' && !(row.type === 'written' && !row.token)).map(row => ({
    concept: row.concept,
    type: row.type === 'cloze' ? 'fill' : row.type,
    response: row.response,
    credit: row.credit,
    ...(row.token ? { token: row.token } : {}),
    ...(row.confidence ? { confidence: row.confidence } : {}),
  }));
}

// The format a missed idea comes back in: a different one from its first ask when the student's
// types allow it (Retain's reask rule).
export function retryType(question, firstType, selected) {
  const first = reaskType(question, firstType, 0, selected);
  if (first !== firstType) return first;
  const second = reaskType(question, firstType, 1, selected);
  return second !== firstType ? second : first;
}

// "Retry my misses": a Retain session (lib/retainEngine.mjs) holding only the first-try misses,
// each already missed once, so each must be answered right CLEAR_AFTER more times, in a different
// format, before it clears. Their first tries are kept as they were; the score never changes.
export function retrySession(questions, rows, selected) {
  const missed = rows.filter(row => typeof row.credit === 'number' && row.credit < 1);
  const concepts = {};
  const queue = [];
  missed.forEach((row, i) => {
    const firstType = row.type === 'cloze' ? 'fill' : row.type;
    concepts[row.concept] = {
      firstType,
      first: { concept: row.concept, type: firstType, response: row.response, credit: row.credit, ...(row.confidence ? { confidence: row.confidence } : {}) },
      needs: CLEAR_AFTER,
      reasks: 1,
      missed: true,
      cleared: false,
    };
    queue.push({ type: retryType(questions[row.concept], firstType, selected), concepts: [row.concept], id: i, reask: true });
  });
  return { questions, selected: selected || [], queue, position: 0, nextId: queue.length, concepts };
}

export function retryOutcome(session) {
  const states = Object.values(session.concepts);
  return { cleared: states.filter(state => state.cleared && !state.gaveUp).length, of: states.length };
}

// First-try misses for Study now: the question and its answer, confident misses first.
export function studyNowMisses(rows, questions) {
  return rows.filter(row => typeof row.credit === 'number' && row.credit < 1)
    .map(row => ({ question: questions[row.concept]?.question || '', answer: conceptAnswer(questions[row.concept]), ...(row.confidence === 'sure' ? { sure: true } : {}) }))
    .filter(item => item.question && item.answer)
    .sort((a, b) => Number(Boolean(b.sure)) - Number(Boolean(a.sure)));
}
