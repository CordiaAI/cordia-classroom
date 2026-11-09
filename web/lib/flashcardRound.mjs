// One flashcard round's bookkeeping (components/FlashcardViewer.js): { queue, known, missed } with
// queue and known as card indexes and missed a Set. Again marks the card missed and sends it to the
// back of the queue; Got it marks it known and takes it off. The round ends when the queue is empty,
// so every card ends up known, and a card missed on the way stays in missed as well: the spaced
// review sends it back to the first box (lib/spacedReview.mjs applyResults).
export function gotItStep({ queue, known, missed }) {
  return { queue: queue.slice(1), known: [...known, queue[0]], missed };
}

export function againStep({ queue, known, missed }) {
  return { queue: [...queue.slice(1), queue[0]], known, missed: new Set([...missed, queue[0]]) };
}

// What onFinish gets: every card known this round, and every card missed at least once in it.
export function roundResults({ known, missed }) {
  return { known: [...known], missed: [...missed] };
}
