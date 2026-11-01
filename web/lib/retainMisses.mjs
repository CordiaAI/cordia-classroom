// Retain misses (Quiz and Learn rounds), kept so Study now can bring them back, per guide:
// [{ question, answer, sure? }], ones the student was sure of first, at most MAX_RETAIN_MISSES.
// A round's misses are added to what was saved, so a round with no misses keeps earlier ones; an
// item leaves only when it is answered right (clearRetainMisses, or `cleared` here).
export const MAX_RETAIN_MISSES = 50;

// Questions are the same idea when their words match, ignoring case and punctuation.
export function questionKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function mergeRetainMisses(saved, misses, cleared = []) {
  const drop = new Set(cleared.map(item => questionKey(item?.question ?? item)));
  const merged = new Map();
  for (const item of [...(misses || []), ...(saved || [])]) {
    const key = questionKey(item?.question);
    if (!key || !item.answer || drop.has(key)) continue;
    const earlier = merged.get(key);
    // The newest answer text wins; being sure-and-wrong once keeps the item first.
    if (earlier) { if (item.sure) earlier.sure = true; continue; }
    merged.set(key, { question: item.question, answer: item.answer, ...(item.sure ? { sure: true } : {}) });
  }
  const list = [...merged.values()];
  return [...list.filter(item => item.sure), ...list.filter(item => !item.sure)].slice(0, MAX_RETAIN_MISSES);
}
