// One answer given outside the app's study screens (a connected app's record_answer), applied the
// way Study now applies it (pages/session.js): to every record the question lives in.
//   - a flashcard climbs a spaced-review box or drops to the first (lib/spacedReview.mjs);
//   - a Learn idea is a self-check flip, with the student's confidence (lib/learnEngine.mjs);
//   - a Retain miss is cleared when answered right; a quiz question or idea missed is kept as one,
//     first in line when the student was sure (lib/retainMisses.mjs, as Quiz and Learn rounds do);
//   - a practice problem is marked solved or not (practice_state, as the practice screen does).
// Items are found as Study now merges them (lib/studyQueue.mjs): the same words in the same study set
// are one question. Pure: returns what changed; the caller saves it in one step.
import { applyResults, cardDue, scheduleChanges } from './spacedReview.mjs';
import { LEVELS, answer, askCard, changedLevels, restoreLevels, saveableLevels } from './learnEngine.mjs';
import { mergeRetainMisses, questionKey } from './retainMisses.mjs';
import { conceptAnswer } from './retainEngine.mjs';
import { buildStudyQueue } from './studyQueue.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ITEM = new RegExp(`^(${UUID}):(card|idea|quiz|practice|miss):(.{1,400})$`, 'i');

// get_due_cards cuts a miss's id at 200 characters, which can split an escape: drop the partial one.
function decodeRef(ref) {
  try {
    return decodeURIComponent(ref.replace(/%[0-9a-f]?$/i, ''));
  } catch {
    return ref;
  }
}

// '<study set id>:card:3' -> { guideId, kind, ref }, or null. Ids come from get_due_cards and
// get_study_set: card (flashcard), idea and quiz (a quiz question / Learn idea), practice, miss.
export function parseItemId(itemId) {
  const match = String(itemId || '').match(ITEM);
  if (!match) return null;
  const [, guideId, kind, ref] = match;
  if (['card', 'idea', 'quiz', 'practice'].includes(kind) && !/^\d{1,4}$/.test(ref)) return null;
  return { guideId: guideId.toLowerCase(), kind: kind === 'quiz' ? 'idea' : kind, ref: kind === 'miss' ? decodeRef(ref) : Number(ref) };
}

// The records one item lives in: { front, back, index?, concept?, miss?, practice? }, or null.
export function sourcesFor(guide, misses, parsed) {
  const cards = Array.isArray(guide?.flashcards) ? guide.flashcards : [];
  const questions = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
  const problems = Array.isArray(guide?.practice_state?.problems) ? guide.practice_state.problems : [];
  let front = '';
  let back = '';
  const found = {};
  if (parsed.kind === 'practice') {
    const problem = problems[parsed.ref];
    if (!problem) return null;
    return { front: String(problem.prompt || ''), back: String(problem.answer || ''), practice: parsed.ref };
  }
  if (parsed.kind === 'card') {
    if (!cards[parsed.ref]) return null;
    ({ front, back } = cards[parsed.ref]);
    found.index = parsed.ref;
  } else if (parsed.kind === 'idea') {
    if (!questions[parsed.ref]) return null;
    front = questions[parsed.ref].question;
    back = conceptAnswer(questions[parsed.ref]);
    found.concept = parsed.ref;
  } else {
    const miss = (misses || []).find(item => questionKey(item.question) === questionKey(parsed.ref));
    if (!miss) return null;
    front = miss.question;
    back = miss.answer;
  }
  const key = questionKey(front);
  if (key) {
    if (found.index === undefined) {
      const index = cards.findIndex(card => questionKey(card?.front) === key);
      if (index >= 0) found.index = index;
    }
    if (found.concept === undefined) {
      const concept = questions.findIndex(question => questionKey(question?.question) === key && conceptAnswer(question));
      if (concept >= 0) found.concept = concept;
    }
    const miss = (misses || []).find(item => questionKey(item.question) === key);
    if (miss) found.miss = miss;
  }
  return { front: String(front || ''), back: String(back || ''), ...found };
}

// What one answer changes. today is the student's local day ('YYYY-MM-DD'); on is a Date whose local
// fields are that day (lib/mcp/zoned.mjs localDate), for the spaced-review maths.
export function applyAnswer(guide, misses, sources, { correct, confidence = '', today, on }) {
  const progress = guide?.flashcard_progress || {};
  const out = { cards: null, learn: null, misses: null, practice: null, nextDueOn: null, strength: null };

  if (sources.index !== undefined) {
    const next = applyResults(progress, correct ? { known: [sources.index] } : { missed: [sources.index] }, on);
    out.cards = scheduleChanges(next, [sources.index]);
    out.nextDueOn = next.schedule[sources.index].due;
    out.strength = `Box ${next.schedule[sources.index].box + 1} of 6`;
  }

  if (sources.concept !== undefined) {
    const questions = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
    const saved = progress.learn?.levels || {};
    const levels = restoreLevels(questions, saved);
    const card = { id: 0, concept: sources.concept, ...askCard(questions[sources.concept], levels[sources.concept], today, ['self']), again: false };
    const round = { types: ['self'], queue: [card], position: 0, nextId: 1, results: {} };
    const after = answer(levels, round, card, correct ? 1 : 0, { confidence, today }).levels;
    const changed = changedLevels(saved, saveableLevels(questions, after));
    if (Object.keys(changed).length) out.learn = { levels: changed };
    out.strength = out.strength ? `${out.strength}; Learn: ${LEVELS[after[sources.concept].l]}` : `Learn: ${LEVELS[after[sources.concept].l]}`;
  }

  // Misses: answered right clears it; a quiz question or idea missed is kept (sure ones first).
  const quizLike = sources.concept !== undefined || sources.miss;
  if (sources.miss || (quizLike && !correct)) {
    const item = { question: sources.front, answer: sources.back, ...(confidence === 'sure' && !correct ? { sure: true } : {}) };
    out.misses = correct ? mergeRetainMisses(misses, [], [sources.front]) : mergeRetainMisses(misses, [item]);
  }

  if (sources.practice !== undefined) out.practice = { index: sources.practice, status: correct ? 'correct' : 'retry' };
  return out;
}

// The guide as it is after the answer, for counting what is still due in it.
export function guideAfter(guide, change) {
  const progress = { ...(guide?.flashcard_progress || {}) };
  if (change.cards) {
    const schedule = { ...(progress.schedule || {}) };
    const known = new Set(progress.known || []);
    for (const [index, entry] of Object.entries(change.cards)) {
      schedule[index] = { box: entry.box, due: entry.due };
      if (entry.known) known.add(Number(index)); else known.delete(Number(index));
    }
    Object.assign(progress, { schedule, known: [...known] });
  }
  if (change.learn) progress.learn = { ...(progress.learn || {}), levels: { ...(progress.learn?.levels || {}), ...change.learn.levels } };
  return { ...guide, flashcard_progress: progress };
}

// How many of the study set's Study now items are still due today.
export function remainingDue(guide, misses, today) {
  return buildStudyQueue([guide], { [guide.id]: misses || [] }, { today }).items.length;
}

export { cardDue };
