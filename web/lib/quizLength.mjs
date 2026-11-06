// How many questions a Quiz asks. The student picks; Cordia recommends.
//   available: questions the guide's quiz can ask (its saved quiz, or its Q/A pairs before one is built)
//   limit:     never more than available, and never more than MAX (a quiz holds at most 50)
//   recommended: a short guide asks everything; a longer one about half, 10 to 20, a sitting's worth
// The server picks which questions at random and shuffles their order (backend/services/retain.py).

export const MAX_QUESTIONS = 50;
export const MIN_RECOMMENDED = 10;
export const MAX_RECOMMENDED = 20;

export function quizLimit(available) {
  const count = Math.max(0, Math.floor(Number(available) || 0));
  return Math.min(count, MAX_QUESTIONS);
}

export function recommendedCount(available) {
  const limit = quizLimit(available);
  if (limit <= MIN_RECOMMENDED) return limit;
  return Math.min(limit, Math.max(MIN_RECOMMENDED, Math.min(MAX_RECOMMENDED, Math.round(limit / 2))));
}

// A typed or stepped value kept inside 1..limit.
export function clampCount(value, available) {
  const limit = quizLimit(available);
  if (!limit) return 0;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return recommendedCount(available);
  return Math.min(limit, Math.max(1, number));
}

// About how long a quiz of this size takes (roughly 30 seconds a question), for the picker's hint.
export function minutesFor(count) {
  const minutes = Math.max(1, Math.round((Number(count) || 0) / 2));
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}
