import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api';

export default function FlashcardViewer({ flashcards, guideId, onComplete }) {
  const total = flashcards.length;
  // queue[0] is always the current card index. Wrong cards move to back of queue.
  const [queue, setQueue] = useState(() => flashcards.map((_, i) => i));
  const [isFlipped, setIsFlipped] = useState(false);
  const [correctDone, setCorrectDone] = useState([]); // indices fully mastered
  const [missedSet, setMissedSet] = useState(new Set()); // indices ever marked wrong
  const [historyStack, setHistoryStack] = useState([]); // for back button
  const [done, setDone] = useState(false);
  const startTime = useRef(Date.now());

  function flip() { setIsFlipped(f => !f); }

  function markKnown() {
    if (!isFlipped) return;
    const cardIndex = queue[0];
    const snapshot = { queue: [...queue], correctDone: [...correctDone], missedSet: new Set(missedSet) };
    const newCorrect = [...correctDone, cardIndex];
    const newQueue = queue.slice(1);
    setHistoryStack(h => [...h, snapshot]);
    setCorrectDone(newCorrect);
    setQueue(newQueue);
    setIsFlipped(false);
    if (newQueue.length === 0) finish(newCorrect, missedSet);
  }

  function markUnknown() {
    if (!isFlipped) return;
    const cardIndex = queue[0];
    const snapshot = { queue: [...queue], correctDone: [...correctDone], missedSet: new Set(missedSet) };
    const newMissed = new Set(missedSet);
    newMissed.add(cardIndex);
    // Move card to back of queue for re-practice
    const newQueue = [...queue.slice(1), cardIndex];
    setHistoryStack(h => [...h, snapshot]);
    setMissedSet(newMissed);
    setQueue(newQueue);
    setIsFlipped(false);
    window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', {
      detail: {
        guideId,
        prompt: `Explain this question: ${flashcards[cardIndex].front}`,
      },
    }));
  }

  function goBack() {
    if (historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setHistoryStack(h => h.slice(0, -1));
    setQueue(prev.queue);
    setCorrectDone(prev.correctDone);
    setMissedSet(prev.missedSet);
    setIsFlipped(false);
    setDone(false);
  }

  async function finish(c, m) {
    setDone(true);
    const elapsed = Math.round((Date.now() - startTime.current) / 1000);
    const knownIndices = c;
    const unknownIndices = [...m].filter(i => !c.includes(i));
    if (guideId) {
      await Promise.all([
        apiFetch('/guides/' + guideId + '/flashcard-progress', {
          method: 'PATCH',
          body: JSON.stringify({ known: knownIndices, unknown: unknownIndices, last_studied: new Date().toISOString() })
        }),
        apiFetch('/stats/log-session', {
          method: 'POST',
          body: JSON.stringify({
            guide_id: guideId,
            session_type: 'flashcard',
            duration_seconds: elapsed,
            metadata: { cards_studied: total, cards_correct: c.length }
          })
        })
      ]);
    }
    if (onComplete) onComplete({ known: knownIndices, unknown: unknownIndices });
  }

  function restart() {
    setQueue(flashcards.map((_, i) => i));
    setCorrectDone([]);
    setMissedSet(new Set());
    setHistoryStack([]);
    setIsFlipped(false);
    setDone(false);
    startTime.current = Date.now();
  }

  if (done) {
    return (
      <div className="completion-card">
        <div className="completion-icon">&#127881;</div>
        <div className="completion-title">Session Complete!</div>
        <div className="completion-stat">{correctDone.length}/{total}</div>
        <div className="completion-detail">cards mastered</div>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--success)', fontSize: '1.4em', fontWeight: 800, letterSpacing: '-0.04em' }}>{correctDone.length}</div>
            <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginTop: 3 }}>Correct</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--error)', fontSize: '1.4em', fontWeight: 800, letterSpacing: '-0.04em' }}>{missedSet.size}</div>
            <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginTop: 3 }}>Missed</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="progress-bar-container" style={{ height: 8 }}>
            <div className="progress-bar-fill green" style={{ width: (correctDone.length / total * 100) + '%' }} />
          </div>
        </div>
        <div className="completion-actions">
          <button className="btn-outline" onClick={() => window.history.back()}>Done</button>
          <button className="btn" onClick={restart}>Restart</button>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    finish(correctDone, missedSet);
    return null;
  }

  const card = flashcards[queue[0]];
  const correctCount = correctDone.length;
  // Cards still in queue that were previously missed
  const wrongCount = queue.filter(i => missedSet.has(i)).length;
  // Cards not yet shown (in queue, never missed)
  const unseenCount = queue.length - wrongCount;

  return (
    <div>
      {/* Progress tracker */}
      <div className="fc-progress-tracker">
        <div className="fc-progress-stat fc-correct">
          <span className="fc-progress-count">{correctCount}</span>
          <span className="fc-progress-label">Correct</span>
        </div>
        <div className="fc-progress-stat fc-wrong">
          <span className="fc-progress-count">{wrongCount}</span>
          <span className="fc-progress-label">Missed</span>
        </div>
        <div className="fc-progress-stat fc-unseen">
          <span className="fc-progress-count">{unseenCount}</span>
          <span className="fc-progress-label">Remaining</span>
        </div>
      </div>

      <div className="progress-bar-container" style={{ marginBottom: 12 }}>
        <div className="progress-bar-fill" style={{ width: (correctCount / total * 100) + '%' }} />
      </div>

      <div className="flashcard-container" onClick={flip} role="button" tabIndex={0} aria-label={isFlipped ? 'Show question' : 'Reveal answer'} aria-pressed={isFlipped} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); } }}>
        <div className={'flashcard-inner' + (isFlipped ? ' flipped' : '')}>
          <div className="flashcard-face flashcard-front" aria-hidden={isFlipped}>
            <div className="flashcard-label">Question</div>
            {card.front}
          </div>
          <div className="flashcard-face flashcard-back" aria-hidden={!isFlipped}>
            <div className="flashcard-label">Answer</div>
            {card.back}
            {card.image && (
              <img
                src={card.image}
                alt=""
                style={{ maxWidth: '100%', maxHeight: 200, marginTop: 12, borderRadius: 8, objectFit: 'contain' }}
              />
            )}
          </div>
        </div>
      </div>

      {!isFlipped ? (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginBottom: historyStack.length > 0 ? 8 : 0 }}>
            Click card to reveal answer
          </p>
          {historyStack.length > 0 && (
            <button className="fc-btn-back-subtle" onClick={goBack}>&#8592; Previous card</button>
          )}
        </div>
      ) : (
        <div className="flashcard-actions">
          {historyStack.length > 0 && (
            <button className="fc-btn fc-btn-back" onClick={goBack}>&#8592;</button>
          )}
          <button className="fc-btn fc-btn-again" onClick={markUnknown}>Study Again</button>
          <button className="fc-btn fc-btn-know" onClick={markKnown}>Got It</button>
        </div>
      )}
    </div>
  );
}
