// Timed test: a mock exam over every idea in a guide. Formats mix the ways the student learns
// with (Learn's types) and there is one clock for the whole test. Marking: lib/submitQuiz.mjs.
// Ideas missed on the test drop back to Learning so Learn's next rounds pick them up.

import { conceptAnswer, shuffled } from './retainEngine.mjs';
import { LEARNING, cardFor, cleanTypes } from './learnEngine.mjs';

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

// Missed ideas (partly right included) drop to Learning; the rest keep their level.
export function applyTest(levels, missed, today) {
  const next = { ...levels };
  missed.forEach(item => { next[item.concept] = { ...next[item.concept], l: LEARNING, at: today }; });
  return next;
}
