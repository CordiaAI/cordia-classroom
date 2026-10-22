import { currentWalkthrough } from './walkthrough';

// A new guide opens on "Check yourself": five quick questions before reading, because recalling
// beats rereading and students rarely choose it on their own. The first-run walkthrough keeps
// its own path to the guide. The quiz page falls back to the guide when there are no questions.
export function newGuideHref(guideId) {
  return currentWalkthrough() ? '/guide/' + guideId : `/quiz/${guideId}?check=1`;
}

export const CHECK_COUNT = 5;

// Five cards spread across the whole guide, not just its first five ideas.
export function spreadCards(cards, count = CHECK_COUNT) {
  if (cards.length <= count) return cards;
  return Array.from({ length: count }, (_, index) => cards[Math.floor((index * cards.length) / count)]);
}
