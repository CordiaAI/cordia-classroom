// Learn, behind LEARN_LADDER_V2: the format ladder (web/lib/featureFlags.js). With the flag off,
// Learn keeps using learnEngine.mjs unchanged.
//
// Four formats. Recognition: Flashcard (self), Multiple choice (mc). Recall: Fill in the blank
// (fill: short answers typed whole, longer ones with one key span blanked), Written answer.
//
//   New / Learning  -> a recognition format (the first one the student turned on)
//   right           -> Familiar, next asked in a recall format
//   Familiar        -> the mastery format: Fill in the blank for short answers, Written for longer
//                      ones (the old Type it length rule), within the student's tiles
//   right in recall -> Mastered
//   a miss          -> down one level; asked again at least MIN_GAP questions later, or first in
//                      the next round when the round is too short
//
// An idea only climbs through the formats it needs: one recognition format, then one recall format.
// Recall is always used for mastery, even when the student turned on only recognition formats
// (Choice-only no longer masters). Free accounts without Fill in the blank master in Written; when
// AI checks run out, Written falls back to the self-check, so Mastered is always reachable.
//
// In the last FINAL_DAYS days before the test, reviews of Familiar and Mastered ideas lean towards
// the test's format (testFormat). That changes which format a review uses, never the bar: an idea
// answered in a recognition format there is practice and can't be mastered by it.

import { conceptAnswer } from './retainEngine.mjs';
import { FAMILIAR, FADE_DAYS, LEARNING, MASTERED, NEW, ROUND_SIZE, dayKey, isFading, isTerm } from './learnEngine.mjs';

export const LADDER_TYPES = ['mc', 'fill', 'written', 'self'];
export const LADDER_DEFAULT = ['mc', 'fill', 'written'];
export const RECOGNITION = ['mc', 'self'];
export const RECALL = ['fill', 'written'];
export const MIN_GAP = 4;
export const FINAL_DAYS = 3;
export const TEST_FORMATS = ['mc', 'short', 'essay', 'mix', 'unsure'];
export const TEST_FORMAT_LABELS = { mc: 'Multiple choice', short: 'Short answer', essay: 'Essay', mix: 'Mix', unsure: 'Not sure' };
const BLANK_MAX_WORDS = 6;
const DAY = 86400000;

// Saved tiles from before the ladder: Type it covered short typed answers and written ones, and
// Fill the blank becomes Fill in the blank. Nothing the student picked is lost.
const OLD_WAYS = { type: ['fill', 'written'], cloze: ['fill'], mc: ['mc'], self: ['self'], fill: ['fill'], written: ['written'] };

export function ladderTypes(saved) {
  const given = new Set((Array.isArray(saved) ? saved : []).flatMap(type => OLD_WAYS[type] || []));
  const picked = LADDER_TYPES.filter(type => given.has(type));
  return picked.length ? picked : LADDER_DEFAULT;
}

export function onlyRecognition(types) {
  return !ladderTypes(types).some(type => RECALL.includes(type));
}

export function daysUntil(testDate, today = dayKey()) {
  if (!testDate) return null;
  return Math.round((new Date(testDate + 'T12:00:00') - new Date(today + 'T12:00:00')) / DAY);
}

export function cleanTestFormat(value) {
  return TEST_FORMATS.includes(value) ? value : 'unsure';
}

// The blank saved on the question when the guide was built (backend services/blanks.py):
//   {whole: true}   short answer: type all of it
//   {span: "..."}   longer answer: the key span is blanked
//   {written: true} no usable span: the question is answered in Written instead
// Checked again here, so a bad span never reaches the student.
export function validBlank(answer, span) {
  const text = String(answer || '');
  const value = String(span || '').trim();
  if (!value || !text.includes(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  const all = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= BLANK_MAX_WORDS && words.length < all.length && /[\p{L}\p{N}]/u.test(value);
}

// { whole } | { before, missing, after } | null (no blank: Written for this question).
export function blankFor(question) {
  if (isTerm(question)) return { whole: true };
  const answer = conceptAnswer(question);
  const span = question?.blank?.span;
  if (!validBlank(answer, span)) return null;
  const at = answer.indexOf(span.trim());
  return { before: answer.slice(0, at), missing: span.trim(), after: answer.slice(at + span.trim().length) };
}

// The card that shows a format for this question.
export function cardType(format, question) {
  if (format === 'fill') return blankFor(question)?.whole ? 'fill' : 'cloze';
  return format;
}

function canFill(question) {
  return Boolean(blankFor(question));
}

// The recall format that masters this question: { format, fallback } where fallback says a free
// plan without Fill in the blank was moved to Written.
export function masteryFormat(question, types, fillAvailable = true) {
  const picked = ladderTypes(types);
  const fillOn = picked.includes('fill');
  const writtenOn = picked.includes('written');
  const short = isTerm(question);
  let wanted;
  if (fillOn && !writtenOn) wanted = canFill(question) ? 'fill' : 'written';
  else if (writtenOn && !fillOn) wanted = 'written';
  else wanted = short ? 'fill' : 'written';
  if (wanted === 'fill' && !canFill(question)) wanted = 'written';
  if (wanted === 'fill' && !fillAvailable) return { format: 'written', fallback: true };
  return { format: wanted, fallback: false };
}

export function recognitionFormat(types) {
  return ladderTypes(types).find(type => RECOGNITION.includes(type)) || null;
}

// In the final days: the format a Familiar or Mastered review uses for this test format, or null
// for the normal ladder. index spreads multiple-choice tests over mostly choices plus some blanks.
function finalFormat(question, index, testFormat, fillAvailable) {
  if (testFormat === 'mc') {
    if (index % 3 === 2 && canFill(question)) return fillAvailable ? { format: 'fill', mastery: true } : { format: 'written', mastery: true, fallback: true };
    return { format: 'mc', mastery: false };
  }
  if (testFormat === 'essay') return { format: 'written', mastery: true };
  return null; // short answer uses the mastery formats (Fill in the blank and Written); mix and not sure use the ladder
}

// How to ask this question now. ctx: { types, today, fillAvailable, testFormat, testDate, index }.
// Returns { type (card), format, recall, practice, fallback }.
export function askLadder(question, entry, ctx = {}) {
  const today = ctx.today || dayKey();
  const fillAvailable = ctx.fillAvailable !== false;
  const recall = entry.l >= FAMILIAR || isFading(entry, today);
  if (!recall) {
    const first = recognitionFormat(ctx.types);
    if (first) return { type: cardType(first, question), format: first, recall: false, practice: false, fallback: false };
    // Only recall formats are on: a new idea is asked in its recall format, and a right answer
    // still only takes it to Familiar.
    const { format, fallback } = masteryFormat(question, ctx.types, fillAvailable);
    return { type: cardType(format, question), format, recall: false, practice: false, fallback };
  }
  const left = daysUntil(ctx.testDate, today);
  if (left !== null && left >= 0 && left <= FINAL_DAYS) {
    const leaning = finalFormat(question, ctx.index || 0, ctx.testFormat, fillAvailable);
    if (leaning) {
      return { type: cardType(leaning.format, question), format: leaning.format, recall: leaning.mastery, practice: !leaning.mastery, fallback: Boolean(leaning.fallback) };
    }
  }
  const { format, fallback } = masteryFormat(question, ctx.types, fillAvailable);
  return { type: cardType(format, question), format, recall: true, practice: false, fallback };
}

// Next round: misses carried over from a round too short to retry them come first (confident ones
// before the rest), then the usual order (learnEngine.pickRound): confident misses, ideas in
// progress, new ones, then fading ones.
export function pickLadderRound(questions, levels, today = dayKey(), carry = [], size = ROUND_SIZE) {
  const valid = index => Boolean(conceptAnswer(questions[index]));
  const rank = index => {
    const entry = levels[index];
    if (entry.l === MASTERED) return isFading(entry, today) ? 4 : 99;
    if (entry.sure) return 0;
    if (entry.l > NEW) return 3 - entry.l;
    return 3;
  };
  const carried = [...new Set(carry)].filter(index => valid(index) && rank(index) < 99)
    .sort((a, b) => Number(Boolean(levels[b]?.sure)) - Number(Boolean(levels[a]?.sure)));
  const rest = questions.map((_, index) => index)
    .filter(index => valid(index) && rank(index) < 99 && !carried.includes(index))
    .sort((a, b) => rank(a) - rank(b) || a - b);
  return [...carried, ...rest].slice(0, size);
}

export function createLadderRound(questions, levels, ctx = {}) {
  const today = ctx.today || dayKey();
  const picked = pickLadderRound(questions, levels, today, ctx.carry || []);
  return {
    queue: picked.map((concept, i) => ({ id: i, concept, ...askLadder(questions[concept], levels[concept], { ...ctx, today, index: concept }), again: false })),
    position: 0,
    nextId: picked.length,
    results: {},
    carry: [],
    fallbackUsed: false,
  };
}

// One answer: credit 1 right, 0.5 partly right, 0 wrong. Returns { levels, round }.
export function answerLadder(levels, round, card, credit, { confidence = '', today = dayKey(), ctx = {} } = {}) {
  const entry = { ...levels[card.concept] };
  const before = entry.l;
  if (credit === 1) {
    if (card.again) entry.l = Math.max(LEARNING, Math.min(entry.l, LEARNING));
    else if (card.practice) entry.l = Math.max(entry.l, FAMILIAR); // final-days practice: never masters
    else if (card.recall) entry.l = MASTERED;
    else if (confidence === 'guess') entry.l = Math.max(LEARNING, Math.min(entry.l, FAMILIAR));
    else entry.l = Math.max(entry.l, FAMILIAR);
    if (!card.again) entry.sure = false;
  } else if (credit === 0.5 && card.recall) {
    entry.l = FAMILIAR;
  } else {
    entry.l = Math.max(NEW, entry.l - 1);
    if (confidence === 'sure') entry.sure = true;
  }
  // Practice in the final days doesn't restart a mastered idea's fade clock: only recall does.
  if (!(card.practice && credit === 1 && before === MASTERED)) entry.at = today;
  const next = { ...round, results: { ...round.results }, carry: [...(round.carry || [])] };
  if (card.fallback) next.fallbackUsed = true;
  const prior = next.results[card.concept];
  next.results[card.concept] = { from: prior ? prior.from : before, to: entry.l, missed: Boolean(prior?.missed) || credit !== 1 };
  if (credit !== 1 && !card.again) {
    // The retry is asked in the format for the idea's new level (a dropped idea is recognised again).
    const question = ctx.questions?.[card.concept];
    const ask = question ? askLadder(question, entry, { ...ctx, today, index: card.concept })
      : { type: card.type, format: card.format, recall: card.recall, practice: card.practice, fallback: false };
    const retry = { id: next.nextId, concept: card.concept, ...ask, again: true, sure: confidence === 'sure' };
    const queue = [...next.queue];
    const after = queue.length - (round.position + 1); // questions still to come after this one
    if (after >= MIN_GAP) {
      // Back near the end; a confident miss goes before other misses waiting there.
      let at = queue.length;
      if (retry.sure) {
        const earliest = round.position + 1 + MIN_GAP;
        const firstAgain = queue.findIndex((item, index) => index >= earliest && item.again && !item.sure);
        if (firstAgain !== -1) at = firstAgain;
      }
      queue.splice(at, 0, retry);
      next.queue = queue;
      next.nextId += 1;
    } else {
      next.carry = retry.sure ? [card.concept, ...next.carry] : [...next.carry, card.concept];
    }
  }
  return { levels: { ...levels, [card.concept]: entry }, round: next };
}

// Why askLadder chose a format, for the decision log (same shape as learnEngine.formatDecision).
export function ladderDecision(question, entry, ctx = {}, chosen = null) {
  const asked = askLadder(question, entry, ctx);
  const type = chosen || asked.type;
  const picked = ladderTypes(ctx.types);
  const term = isTerm(question);
  const cards = ['mc', 'fill', 'written', 'cloze', 'self'];
  const formatOf = { mc: 'mc', fill: 'fill', cloze: 'fill', written: 'written', self: 'self' };
  const mask = {};
  cards.forEach(option => {
    const format = formatOf[option];
    if (asked.recall && RECOGNITION.includes(format) && !asked.practice) mask[option] = 'needs_recall';
    else if (!asked.recall && RECALL.includes(format) && recognitionFormat(ctx.types)) mask[option] = 'recall_not_needed';
    else if (!picked.includes(format) && !(asked.recall && !picked.some(type => RECALL.includes(type)))) mask[option] = 'turned_off';
    else if (option === 'fill' && !term) mask[option] = 'long_answer';
    else if (option === 'cloze' && term) mask[option] = 'short_answer';
    else if (option === 'written' && term) mask[option] = 'short_answer';
  });
  delete mask[type];
  const eligible = cards.filter(option => !mask[option]);
  return { candidates: cards, eligible, mask, chosen: type, recall: asked.recall, source: eligible.length === 1 ? 'student' : 'rule',
    probs: { [type]: 1 }, propensity: 1, seed: 0 };
}

// The Final check (Quiz) leans the same way in the final days: its question types for the test.
export function finalCheckTypes(testFormat, testDate, today = dayKey()) {
  const left = daysUntil(testDate, today);
  if (left === null || left < 0 || left > FINAL_DAYS) return null;
  if (testFormat === 'mc') return ['mc', 'fill'];
  if (testFormat === 'short') return ['fill', 'written'];
  if (testFormat === 'essay') return ['written'];
  return null;
}

export { FADE_DAYS };
