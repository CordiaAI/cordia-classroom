// Learn: a mastery ladder per idea, studied in short rounds.
//   0 New -> 1 Learning -> 2 Familiar -> 3 Mastered
// Recognising the answer (multiple choice) moves an idea up to Familiar; only recalling it
// (typing it) masters it. A right answer the student marked as a guess doesn't move it up,
// and a miss drops it back to Learning and asks it again later in the same round.
// Mastered ideas fade after FADE_DAYS without practice and come back for a quick recall.

import { conceptAnswer } from './retainEngine.mjs';

export const LEVELS = ['New', 'Learning', 'Familiar', 'Mastered'];
export const NEW = 0;
export const LEARNING = 1;
export const FAMILIAR = 2;
export const MASTERED = 3;
export const ROUND_SIZE = 7;
export const FADE_DAYS = 5;
const TERM_MAX_WORDS = 5;
const DAY = 86400000;

export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((new Date(to + 'T12:00:00') - new Date(from + 'T12:00:00')) / DAY);
}

// A short fingerprint of the question, so saved progress is dropped if the guide's questions change.
export function fingerprint(question) {
  return String(question?.question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
}

// Saved progress -> { [index]: { l, at, sure } } for the questions as they are now.
export function restoreLevels(questions, saved) {
  const levels = {};
  questions.forEach((question, index) => {
    const entry = saved?.[index];
    levels[index] = entry && entry.q === fingerprint(question)
      ? { l: Math.max(NEW, Math.min(MASTERED, Number(entry.l) || 0)), at: entry.at || null, sure: Boolean(entry.sure) }
      : { l: NEW, at: null, sure: false };
  });
  return levels;
}

export function saveableLevels(questions, levels) {
  const out = {};
  questions.forEach((question, index) => {
    const entry = levels[index];
    if (entry && (entry.l > NEW || entry.at)) out[index] = { l: entry.l, at: entry.at, q: fingerprint(question), ...(entry.sure ? { sure: true } : {}) };
  });
  return out;
}

export function isFading(entry, today = dayKey()) {
  return entry?.l === MASTERED && entry.at && daysBetween(entry.at, today) >= FADE_DAYS;
}

// Short answers are typed and checked on the spot; longer ones are written and checked by AI.
export function isTerm(question) {
  return conceptAnswer(question).split(/\s+/).filter(Boolean).length <= TERM_MAX_WORDS;
}

// The ways a student can pick to learn with. mc and self (a flashcard flip) recognise an answer;
// fill (short answers), written (long answers, checked by AI) and self recall it.
export const LEARN_TYPES = ['mc', 'fill', 'written', 'self'];
export const DEFAULT_TYPES = ['mc', 'fill', 'written'];

export function cleanTypes(types) {
  const picked = LEARN_TYPES.filter(type => (types || []).includes(type));
  return picked.length ? picked : DEFAULT_TYPES;
}

// A new or learning idea is recognised first; a familiar or fading one is recalled. Each stage uses
// the first of the student's picks that suits the answer, else whatever they did pick.
export function askCard(question, entry, today = dayKey(), types = DEFAULT_TYPES) {
  const picked = cleanTypes(types);
  const recall = entry.l >= FAMILIAR || isFading(entry, today);
  const recallOrder = isTerm(question) ? ['fill', 'written', 'self'] : ['written', 'self'];
  const order = recall ? [...recallOrder, 'mc'] : ['mc', 'self', ...recallOrder];
  return { type: order.find(type => picked.includes(type)) || picked[0], recall };
}

export function askType(question, entry, today = dayKey(), types = DEFAULT_TYPES) {
  return askCard(question, entry, today, types).type;
}

// Next round: ideas the student got wrong while sure come first, then ones in progress (highest
// first, so they finish), then new ones, then mastered ones that are fading.
export function pickRound(questions, levels, today = dayKey(), size = ROUND_SIZE) {
  const indexes = questions.map((_, index) => index).filter(index => conceptAnswer(questions[index]));
  const rank = index => {
    const entry = levels[index];
    if (entry.l === MASTERED) return isFading(entry, today) ? 4 : 99;
    if (entry.sure) return 0;
    if (entry.l > NEW) return 3 - entry.l; // Familiar 1, Learning 2
    return 3;
  };
  return indexes
    .filter(index => rank(index) < 99)
    .sort((a, b) => rank(a) - rank(b) || a - b)
    .slice(0, size);
}

export function createRound(questions, levels, today = dayKey(), types = DEFAULT_TYPES) {
  const picked = pickRound(questions, levels, today);
  return {
    types: cleanTypes(types),
    queue: picked.map((concept, i) => ({ id: i, concept, ...askCard(questions[concept], levels[concept], today, types), again: false })),
    position: 0,
    nextId: picked.length,
    results: {},
  };
}

// One answer: credit 1 right, 0.5 partly right, 0 wrong. confidence 'guess' means a right answer
// was a lucky pick. Returns the new levels and round.
export function answer(levels, round, card, credit, { confidence = '', today = dayKey() } = {}) {
  const entry = { ...levels[card.concept] };
  const before = entry.l;
  const recall = card.recall ?? card.type !== 'mc';
  if (credit === 1) {
    // A new idea answered right and sure is already known: it skips straight to Familiar.
    // The repeat of a miss, seconds after seeing the answer, only confirms Learning.
    if (card.again) entry.l = Math.max(LEARNING, Math.min(entry.l, LEARNING));
    else if (recall) entry.l = MASTERED;
    else if (confidence === 'guess') entry.l = Math.max(LEARNING, Math.min(entry.l, FAMILIAR));
    else if (entry.l === NEW) entry.l = confidence === 'sure' ? FAMILIAR : LEARNING;
    else entry.l = Math.min(FAMILIAR, entry.l + 1);
    if (!card.again) entry.sure = false;
  } else if (credit === 0.5 && recall) {
    entry.l = FAMILIAR;
  } else {
    entry.l = LEARNING;
    if (confidence === 'sure') entry.sure = true;
  }
  entry.at = today;
  const next = { ...round, results: { ...round.results } };
  const prior = next.results[card.concept];
  next.results[card.concept] = { from: prior ? prior.from : before, to: entry.l, missed: Boolean(prior?.missed) || credit !== 1 };
  // A miss comes back once near the end of the round, as multiple choice if it was a recall and
  // the student learns with choices.
  if (credit !== 1 && !card.again) {
    const queue = [...next.queue];
    const easier = recall && credit === 0 && cleanTypes(round.types).includes('mc') ? 'mc' : card.type;
    queue.push({ id: next.nextId, concept: card.concept, type: easier, recall: easier === card.type ? recall : false, again: true });
    next.queue = queue;
    next.nextId += 1;
  }
  return { levels: { ...levels, [card.concept]: entry }, round: next };
}

export function currentCard(round) {
  return round?.queue[round.position] || null;
}

export function advance(round) {
  return { ...round, position: round.position + 1 };
}

export function counts(questions, levels, today = dayKey()) {
  const tally = { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0, fading: 0 };
  questions.forEach((question, index) => {
    if (!conceptAnswer(question)) return;
    const entry = levels[index];
    tally.total += 1;
    if (isFading(entry, today)) { tally.fading += 1; tally.familiar += 1; return; }
    tally[['new', 'learning', 'familiar', 'mastered'][entry.l]] += 1;
  });
  return tally;
}

// How ready for the test: mastered counts fully, familiar half, learning a little.
export function readiness(tally) {
  if (!tally.total) return 0;
  return Math.round(((tally.mastered + tally.familiar * 0.5 + tally.learning * 0.15) / tally.total) * 100);
}

// With a test date: days left (test day counts as 0) and ideas to master a day to finish the day before.
export function testPlan(tally, testDate, today = dayKey()) {
  if (!testDate) return null;
  const daysLeft = daysBetween(today, testDate);
  const remaining = tally.total - tally.mastered;
  if (daysLeft < 0) return { daysLeft, remaining, perDay: 0, past: true };
  const studyDays = Math.max(1, daysLeft);
  return { daysLeft, remaining, perDay: Math.ceil(remaining / studyDays), past: false };
}
