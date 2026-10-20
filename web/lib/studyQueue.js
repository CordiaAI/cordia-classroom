import { apiFetch } from './api';
import { retainMisses } from './userStore';

// A card is due until the student has marked it "Got it" in a finished session.
export function dueCards(guide) {
  const cards = Array.isArray(guide?.flashcards) ? guide.flashcards : [];
  const known = new Set(guide?.flashcard_progress?.known || []);
  return cards.map((card, index) => ({ ...card, index })).filter(card => !known.has(card.index));
}

export function dueCount(guide) {
  if (!Array.isArray(guide?.flashcards)) return Number(guide?.flashcard_count) || 0;
  return dueCards(guide).length;
}

// Open practice problems: saved sets with problems not yet answered right.
export function openProblems(practice) {
  const problems = Array.isArray(practice?.problems) ? practice.problems : [];
  const evaluations = practice?.progress?.evaluations || {};
  return problems.filter((_, index) => evaluations[index]?.status !== 'correct').length;
}

const SESSION_CARD_LIMIT = 30;

// Everything Today's Start runs: due flashcards, then Retain misses, then practice,
// across every guide. Uses only existing read endpoints.
export async function loadStudyQueue({ practiceGuides = 5 } = {}) {
  const data = await apiFetch('/guides?limit=100');
  const guides = Array.isArray(data?.guides) ? data.guides : [];
  const cards = [];
  for (const guide of guides) {
    for (const card of dueCards(guide)) {
      cards.push({ kind: 'card', guideId: guide.id, guideTitle: guide.title, index: card.index, front: card.front, back: card.back, image: card.image });
    }
  }
  const misses = [];
  const stored = retainMisses();
  for (const [guideId, items] of Object.entries(stored)) {
    const guide = guides.find(item => item.id === guideId);
    if (!guide) continue;
    items.forEach((item, position) => misses.push({ kind: 'miss', guideId, guideTitle: guide.title, position, front: item.question, back: item.answer }));
  }
  const recent = guides.slice(0, practiceGuides);
  const states = await Promise.all(recent.map(guide => apiFetch(`/practice/${guide.id}/state`)));
  const practice = recent
    .map((guide, index) => ({ guideId: guide.id, guideTitle: guide.title, open: openProblems(states[index]?.practice) }))
    .filter(item => item.open > 0);
  const problems = practice.reduce((sum, item) => sum + item.open, 0);
  const minutes = Math.max(1, Math.round(cards.length * 0.25 + misses.length * 0.5 + problems * 2));
  return {
    guides,
    cards: cards.slice(0, SESSION_CARD_LIMIT),
    cardTotal: cards.length,
    misses,
    practice,
    problems,
    minutes: cards.length || misses.length || problems ? minutes : 0,
  };
}
