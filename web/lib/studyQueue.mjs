// What a student has learned lives in four places; this file reads all of them so Study now (and
// Daily review) shows one picture:
//   - flashcard_progress.schedule (lib/spacedReview.mjs): each flashcard's spaced-review box and
//     due day. The source of truth for flashcards.
//   - flashcard_progress.learn (lib/learnEngine.mjs, PATCH /guides/{id}/learn-progress): Learn's
//     level per idea (New, Learning, Familiar, Mastered; Mastered fades after FADE_DAYS). The
//     source of truth for Learn. Ideas are the guide's quiz_questions, by index.
//   - Retain misses (retain_misses on the server, lib/retainMisses.mjs): questions missed in Quiz
//     or Learn rounds, kept until answered right.
//   - quiz_attempts (server): scores only; nothing here reads it.
// Flashcards and Learn's ideas both come from the guide's Q&A pairs, so the same question can be
// due in more than one place. The queue holds it once, and an answer is saved to every place it
// came from (session.js), so no record says something the others contradict.
// Every record is keyed by the question's saved text (item.question); the backend may show a
// question in other words (its `shown` wording, item.front) or hide one about the source (`hidden`:
// never asked here). Items are joined by the saved text, so a reworded idea and its flashcard stay
// one item, and a hidden question's level and schedule are kept, untouched, for when it is asked.
// Pure: the web app (lib/studyQueue.js) and the MCP server (get_due_cards) both order Study now here.
import { questionKey } from './retainMisses.mjs';
import { dueIndices } from './spacedReview.mjs';
import { FAMILIAR, LEARNING, answer, askCard, dayKey, isFading, restoreLevels, saveableLevels } from './learnEngine.mjs';
import { askable, conceptAnswer, questionText } from './retainEngine.mjs';

// A card is due when it is new, or its spaced-review day has come (lib/spacedReview.mjs). `today`
// is the student's local day (the server passes the one in their time zone). A card about the source
// itself is never studied: marked `hidden` (backend shown_cards), or made from a quiz question that is.
export function dueCards(guide, today = dayKey()) {
  const cards = studiedCards(guide);
  const due = new Set(dueIndices(guide?.flashcard_progress, Array.isArray(guide?.flashcards) ? guide.flashcards.length : 0, today));
  return cards.filter(card => due.has(card.index));
}

// The guide's flashcards that can be studied, each with its `index` (its place in the saved deck,
// which its schedule is keyed by).
export function studiedCards(guide) {
  const cards = Array.isArray(guide?.flashcards) ? guide.flashcards : [];
  const byKey = quizByKey(guide);
  return cards.map((card, index) => ({ ...card, index }))
    .filter(card => card && !card.hidden && !byKey.get(questionKey(card.front))?.hidden);
}

// Works on a full guide or a list summary (flashcard_count, flashcard_hidden: the places of the cards
// studiedCards leaves out, from the backend's hidden_card_positions, and flashcard_progress).
export function dueCount(guide, today = dayKey()) {
  if (Array.isArray(guide?.flashcards)) return dueCards(guide, today).length;
  const hidden = new Set(Array.isArray(guide?.flashcard_hidden) ? guide.flashcard_hidden : []);
  return dueIndices(guide?.flashcard_progress, Number(guide?.flashcard_count) || 0, today).filter(index => !hidden.has(index)).length;
}

// How many of a guide's cards can be studied, on a full guide or a list summary (as dueCount).
export function studiedCount(guide) {
  if (Array.isArray(guide?.flashcards)) return studiedCards(guide).length;
  const count = Number(guide?.flashcard_count) || 0;
  const hidden = new Set((Array.isArray(guide?.flashcard_hidden) ? guide.flashcard_hidden : []).filter(index => Number.isInteger(index) && index >= 0 && index < count));
  return count - hidden.size;
}

// Open practice problems: saved sets with problems not yet answered right.
export function openProblems(practice) {
  const problems = Array.isArray(practice?.problems) ? practice.problems : [];
  const evaluations = practice?.progress?.evaluations || {};
  return problems.filter((_, index) => evaluations[index]?.status !== 'correct').length;
}

const SESSION_CARD_LIMIT = 30;
// The home's "Review flashcards (688 due)" starts a round of this many cards, not all 688.
export const DUE_REVIEW_CARDS = 50;
const MOST_CARDS = 100;

// How many flashcards a round takes, from ?cards= in the address bar: a whole number from 1 to 100,
// else the usual 30.
export function cardLimit(value) {
  const count = /^\d{1,4}$/.test(String(value ?? '').trim()) ? Number(value) : 0;
  return count >= 1 ? Math.min(count, MOST_CARDS) : SESSION_CARD_LIMIT;
}

// Learn ideas worth a look today: still being learned (Learning, Familiar) or Mastered and fading.
export function learnIdeas(guide, today = dayKey()) {
  const questions = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
  const saved = guide?.flashcard_progress?.learn?.levels;
  if (!questions.length || !saved) return [];
  const levels = restoreLevels(questions, saved);
  return questions
    .map((question, concept) => ({ question, concept, entry: levels[concept] }))
    .filter(({ question, entry }) => askable(question) && (entry.l === LEARNING || entry.l === FAMILIAR || isFading(entry, today)))
    .map(({ question, concept, entry }) => ({ concept, question: question.question, front: questionText(question), back: conceptAnswer(question), level: entry.l }));
}

// The guide's quiz questions by their saved text's key (the first with that text), for showing a
// flashcard or a miss in its question's wording, or leaving out a miss whose question is hidden.
function quizByKey(guide) {
  const byKey = new Map();
  for (const question of Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : []) {
    const key = questionKey(question?.question);
    if (key && !byKey.has(key)) byKey.set(key, question);
  }
  return byKey;
}

// The wording to show for a saved text: its quiz question's (shown when reworded), else as saved.
function shownFor(byKey, text) {
  const question = byKey.get(questionKey(text));
  return question && !question.hidden ? questionText(question) : String(text || '');
}

// Several lists dealt in turn, one item from each, so no one list fills the round.
function dealt(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map(list => list.length));
  for (let at = 0; at < longest; at += 1) for (const list of lists) if (at < list.length) out.push(list[at]);
  return out;
}

// The round from what's loaded: misses the student was sure of, due flashcards, Learn ideas, then
// other misses. A question found in more than one place is one item carrying each source:
// index (flashcard), concept (Learn idea), miss (Retain miss). interleave (a folder or classroom
// round) deals cards and ideas one guide at a time, so the card cap takes from every guide. cards is
// that cap (30 unless a round asks for more: the home's due-flashcards button asks for 50).
export function buildStudyQueue(guides, stored = {}, { guideId = '', today = dayKey(), interleave = false, cards: cardCap = SESSION_CARD_LIMIT } = {}) {
  const cardLists = [];
  const learnLists = [];
  const quizzes = new Map();
  for (const guide of guides) {
    const cards = [];
    const learn = [];
    const byKey = quizByKey(guide);
    quizzes.set(guide.id, byKey);
    cardLists.push(cards);
    learnLists.push(learn);
    // Study now on a guide with nothing due still runs a full round of its cards.
    const due = dueCards(guide, today);
    const pool = guideId && !due.length ? studiedCards(guide) : due;
    for (const card of pool) {
      // A flashcard is the student's own and is reviewed unless it is about the source (studiedCards);
      // it shows its own reworded front, else its question's wording.
      cards.push({ kind: 'card', guideId: guide.id, guideTitle: guide.title, index: card.index, question: card.front, front: card.shown || shownFor(byKey, card.front), back: card.back, image: card.image, front_image: card.front_image });
    }
    for (const idea of learnIdeas(guide, today)) {
      learn.push({ kind: 'learn', guideId: guide.id, guideTitle: guide.title, concept: idea.concept, question: idea.question, front: idea.front, back: idea.back });
    }
  }
  const cards = interleave ? dealt(cardLists) : cardLists.flat();
  const learn = interleave ? dealt(learnLists) : learnLists.flat();
  const misses = [];
  for (const [id, items] of Object.entries(stored || {})) {
    const guide = guides.find(item => item.id === id);
    if (!guide || !Array.isArray(items)) continue;
    const byKey = quizzes.get(id);
    items.forEach(item => {
      if (byKey.get(questionKey(item?.question))?.hidden) return; // about the source: never asked
      misses.push({ kind: 'miss', guideId: id, guideTitle: guide.title, question: item.question, front: shownFor(byKey, item.question), back: item.answer, miss: true, sure: Boolean(item.sure) });
    });
  }
  const ordered = [
    ...misses.filter(item => item.sure),
    ...cards.slice(0, cardCap),
    ...learn.slice(0, SESSION_CARD_LIMIT),
    ...misses.filter(item => !item.sure),
  ];
  const byKey = new Map();
  const items = [];
  for (const item of ordered) {
    const text = questionKey(item.question);
    const key = text && item.guideId + '\n' + text;
    const first = key && byKey.get(key);
    if (!first) { items.push({ ...item }); if (key) byKey.set(key, items[items.length - 1]); continue; }
    // Two flashcards (or two ideas) with the same words stay two items; anything else joins the first.
    const clash = (item.index !== undefined && first.index !== undefined) || (item.concept !== undefined && first.concept !== undefined);
    if (clash) { items.push({ ...item }); continue; }
    if (item.index !== undefined && first.index === undefined) Object.assign(first, { index: item.index, image: first.image || item.image, front_image: first.front_image || item.front_image });
    if (item.concept !== undefined && first.concept === undefined) first.concept = item.concept;
    if (item.miss) { first.miss = true; first.sure = first.sure || item.sure; }
  }
  return { items, cardTotal: cards.length, learnTotal: learn.length, missTotal: misses.length };
}

// Learn's saved progress after Study now answers ({ concept, known }), or null if nothing changed.
// A flip is a self-check: right moves a Learning idea to Familiar and masters a Familiar or fading
// one; a miss drops it back to Learning (lib/learnEngine.mjs answer()).
export function learnAfterReview(guide, results, today = dayKey()) {
  const questions = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
  const saved = guide?.flashcard_progress?.learn || {};
  if (!questions.length || !results.length) return null;
  let levels = restoreLevels(questions, saved.levels || {});
  const round = { types: ['self'], queue: [], position: 0, nextId: 0, results: {} };
  for (const { concept, known } of results) {
    if (!questions[concept]) continue;
    const card = { id: 0, concept, ...askCard(questions[concept], levels[concept], today, ['self']), again: false };
    levels = answer(levels, round, card, known ? 1 : 0, { today }).levels;
  }
  return { levels: saveableLevels(questions, levels), test_date: saved.test_date || null };
}
