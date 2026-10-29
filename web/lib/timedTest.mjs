// Timed test: a mock exam over every idea in a guide. Formats mix the ways the student learns
// with (Learn's types), there is one clock for the whole test, and nothing is marked until the end.
// Ideas missed on the test drop back to Learning so Learn's next rounds pick them up.

import { conceptAnswer, fillMatches, shuffled } from './retainEngine.mjs';
import { LEARNING, cardFor, cleanTypes, makeCloze } from './learnEngine.mjs';

// A flashcard flip shows the answer, so a test asks those students with choices instead.
export const TEST_TYPES = ['mc', 'type', 'cloze'];
export const MINUTE_CHOICES = [0.5, 1, 2];
export const DEFAULT_MINUTES = 1;

// Every idea once, in a shuffled order, each in one of the student's ways (in the card that suits
// its answer), taking turns so the formats mix.
export function buildTest(questions, types, seed = Date.now() % 233280) {
  const picked = cleanTypes(types).filter(type => TEST_TYPES.includes(type));
  const ways = picked.length ? picked : ['mc'];
  const concepts = questions.map((_, index) => index).filter(index => conceptAnswer(questions[index]));
  return shuffled(concepts, seed).map((concept, position) => {
    const type = cardFor(ways[position % ways.length], questions[concept]);
    return { id: position, concept, type };
  });
}

export function timeLimitSeconds(count, minutesPer = DEFAULT_MINUTES) {
  const minutes = MINUTE_CHOICES.includes(minutesPer) ? minutesPer : DEFAULT_MINUTES;
  return Math.round(count * minutes * 60);
}

// "12:05"; never below zero.
export function clock(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// Choices and typed answers are marked here; written ones are marked by AI (null until then).
export function markLocal(item, question, response) {
  const given = String(response || '').trim();
  if (!given) return 0;
  if (item.type === 'mc') return given === conceptAnswer(question) ? 1 : 0;
  if (item.type === 'fill') return fillMatches(given, conceptAnswer(question)) ? 1 : 0;
  if (item.type === 'cloze') return fillMatches(given, makeCloze(conceptAnswer(question))?.missing || '') ? 1 : 0;
  return null;
}

// credits: { [item id]: 1 | 0.5 | 0 | null }. A missing credit is an unanswered question (0); null
// is a written answer that couldn't be checked, left out of the score.
export function testResults(items, credits) {
  let earned = 0;
  let checked = 0;
  const missed = [];
  const unchecked = [];
  items.forEach(item => {
    const credit = item.id in credits ? credits[item.id] : 0;
    if (credit === null) { unchecked.push(item); return; }
    checked += 1;
    earned += credit;
    if (credit < 1) missed.push(item);
  });
  return {
    score: checked ? Math.round((earned / checked) * 100) : 0,
    right: checked - missed.length,
    checked,
    total: items.length,
    missed,
    unchecked,
  };
}

// Missed ideas (partly right included) drop to Learning; the rest keep their level.
export function applyTest(levels, missed, today) {
  const next = { ...levels };
  missed.forEach(item => { next[item.concept] = { ...next[item.concept], l: LEARNING, at: today }; });
  return next;
}
