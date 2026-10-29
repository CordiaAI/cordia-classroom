// What a student has learned lives in four places; this file reads all of them so Study now (and
// Daily review) shows one picture:
//   - flashcard_progress.schedule (lib/spacedReview.mjs): each flashcard's spaced-review box and
//     due day. The source of truth for flashcards.
//   - flashcard_progress.learn (lib/learnEngine.mjs, PATCH /guides/{id}/learn-progress): Learn's
//     level per idea (New, Learning, Familiar, Mastered; Mastered fades after FADE_DAYS). The
//     source of truth for Learn. Ideas are the guide's quiz_questions, by index.
//   - Retain misses (lib/userStore.js, this browser): questions missed in Quiz or Learn rounds,
//     kept until answered right.
//   - quiz_attempts (server): scores only; nothing here reads it.
// Flashcards and Learn's ideas both come from the guide's Q&A pairs, so the same question can be
// due in more than one place. The queue holds it once, and an answer is saved to every place it
// came from (session.js), so no record says something the others contradict.
import { apiFetch } from './api';
import { questionKey, retainMisses } from './userStore';
import { dueIndices } from './spacedReview.mjs';
import { FAMILIAR, LEARNING, answer, askCard, dayKey, isFading, restoreLevels, saveableLevels } from './learnEngine.mjs';
import { conceptAnswer } from './retainEngine.mjs';

// A card is due when it is new, or its spaced-review day has come (lib/spacedReview.mjs).
export function dueCards(guide) {
  const cards = Array.isArray(guide?.flashcards) ? guide.flashcards : [];
  const due = new Set(dueIndices(guide?.flashcard_progress, cards.length));
  return cards.map((card, index) => ({ ...card, index })).filter(card => due.has(card.index));
}

// Works on a full guide or a list summary (flashcard_count plus flashcard_progress).
export function dueCount(guide) {
  if (!Array.isArray(guide?.flashcards)) return dueIndices(guide?.flashcard_progress, Number(guide?.flashcard_count) || 0).length;
  return dueCards(guide).length;
}

// Open practice problems: saved sets with problems not yet answered right.
export function openProblems(practice) {
  const problems = Array.isArray(practice?.problems) ? practice.problems : [];
  const evaluations = practice?.progress?.evaluations || {};
  return problems.filter((_, index) => evaluations[index]?.status !== 'correct').length;
}

const SESSION_CARD_LIMIT = 30;

// Learn ideas worth a look today: still being learned (Learning, Familiar) or Mastered and fading.
export function learnIdeas(guide, today = dayKey()) {
  const questions = Array.isArray(guide?.quiz_questions) ? guide.quiz_questions : [];
  const saved = guide?.flashcard_progress?.learn?.levels;
  if (!questions.length || !saved) return [];
  const levels = restoreLevels(questions, saved);
  return questions
    .map((question, concept) => ({ question, concept, entry: levels[concept] }))
    .filter(({ question, entry }) => conceptAnswer(question) && (entry.l === LEARNING || entry.l === FAMILIAR || isFading(entry, today)))
    .map(({ question, concept, entry }) => ({ concept, front: question.question, back: conceptAnswer(question), level: entry.l }));
}

// The round from what's loaded: misses the student was sure of, due flashcards, Learn ideas, then
// other misses. A question found in more than one place is one item carrying each source:
// index (flashcard), concept (Learn idea), miss (Retain miss).
export function buildStudyQueue(guides, stored = {}, { guideId = '', today = dayKey() } = {}) {
  const cards = [];
  const learn = [];
  for (const guide of guides) {
    // Study now on a guide with nothing due still runs a full round of its cards.
    const due = dueCards(guide);
    const pool = guideId && !due.length ? (guide.flashcards || []).map((card, index) => ({ ...card, index })) : due;
    for (const card of pool) {
      cards.push({ kind: 'card', guideId: guide.id, guideTitle: guide.title, index: card.index, front: card.front, back: card.back, image: card.image, front_image: card.front_image });
    }
    for (const idea of learnIdeas(guide, today)) {
      learn.push({ kind: 'learn', guideId: guide.id, guideTitle: guide.title, concept: idea.concept, front: idea.front, back: idea.back });
    }
  }
  const misses = [];
  for (const [id, items] of Object.entries(stored || {})) {
    const guide = guides.find(item => item.id === id);
    if (!guide || !Array.isArray(items)) continue;
    items.forEach(item => misses.push({ kind: 'miss', guideId: id, guideTitle: guide.title, front: item.question, back: item.answer, miss: true, sure: Boolean(item.sure) }));
  }
  const ordered = [
    ...misses.filter(item => item.sure),
    ...cards.slice(0, SESSION_CARD_LIMIT),
    ...learn.slice(0, SESSION_CARD_LIMIT),
    ...misses.filter(item => !item.sure),
  ];
  const byKey = new Map();
  const items = [];
  for (const item of ordered) {
    const text = questionKey(item.front);
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

// Everything Daily review runs: the round above, across every guide (or one guide, for its Study
// now), then open practice. Uses only existing read endpoints.
export async function loadStudyQueue({ practiceGuides = 5, guideId = '' } = {}) {
  const data = guideId ? await apiFetch('/guides/' + guideId).then(result => ({ guides: result?.guide ? [result.guide] : [] })) : await apiFetch('/guides?limit=100');
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const { items, cardTotal } = buildStudyQueue(guides, retainMisses(), { guideId });
  const recent = guides.slice(0, practiceGuides);
  const states = await Promise.all(recent.map(guide => apiFetch(`/practice/${guide.id}/state`)));
  const practice = recent
    .map((guide, index) => ({ guideId: guide.id, guideTitle: guide.title, open: openProblems(states[index]?.practice) }))
    .filter(item => item.open > 0);
  const problems = practice.reduce((sum, item) => sum + item.open, 0);
  const minutes = Math.max(1, Math.round(items.length * 0.3 + problems * 2));
  return {
    guides,
    items,
    cardTotal,
    practice,
    problems,
    minutes: items.length || problems ? minutes : 0,
  };
}
