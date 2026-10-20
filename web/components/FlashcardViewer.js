import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Pencil, Shuffle, Star } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';
import SessionFinish from './SessionFinish';

function shuffledOrder(length) {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

export function askAboutCard(card, guideId) {
  window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', {
    detail: { guideId: card.guideId || guideId, prompt: `Explain this question: ${card.front}`, send: true },
  }));
}

// One flashcard session. Missed cards go to the back of the queue until known.
// cards: [{ front, back, image?, guideId? }]. onFinish({ known: [i], missed: [i], seconds }).
export default function FlashcardViewer({
  flashcards, guideId, title, onBack, onFinish, onExit, starred, onToggleStar, onEdit, finishExtra,
}) {
  const total = flashcards.length;
  const [queue, setQueue] = useState(() => flashcards.map((_, index) => index));
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState([]);
  const [missed, setMissed] = useState(() => new Set());
  const [history, setHistory] = useState([]);
  const [done, setDone] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const started = useRef(Date.now());
  const cardRef = useRef(null);

  const current = queue[0];
  useEffect(() => { if (flipped) walkthroughEvent('card-flipped'); }, [flipped]);
  const card = flashcards[current];

  const finish = useCallback((nextKnown, nextMissed) => {
    const elapsed = Math.round((Date.now() - started.current) / 1000);
    setSeconds(elapsed);
    setDone(true);
    onFinish?.({ known: nextKnown, missed: [...nextMissed].filter(index => !nextKnown.includes(index)), seconds: elapsed });
  }, [onFinish]);

  function snapshot() {
    return { queue: [...queue], known: [...known], missed: new Set(missed) };
  }

  function gotIt() {
    if (!flipped || card === undefined) return;
    const nextKnown = [...known, current];
    const nextQueue = queue.slice(1);
    setHistory(list => [...list, snapshot()]);
    setKnown(nextKnown);
    setQueue(nextQueue);
    setFlipped(false);
    if (!nextQueue.length) finish(nextKnown, missed);
  }

  function again() {
    if (!flipped || card === undefined) return;
    const nextMissed = new Set(missed);
    nextMissed.add(current);
    setHistory(list => [...list, snapshot()]);
    setMissed(nextMissed);
    setQueue([...queue.slice(1), current]);
    setFlipped(false);
  }

  function back() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(list => list.slice(0, -1));
    setQueue(previous.queue);
    setKnown(previous.known);
    setMissed(previous.missed);
    setFlipped(false);
    setDone(false);
  }

  function shuffle() {
    const order = shuffledOrder(queue.length);
    setQueue(order.map(index => queue[index]));
    setFlipped(false);
  }

  function restart() {
    setQueue(flashcards.map((_, index) => index));
    setKnown([]);
    setMissed(new Set());
    setHistory([]);
    setFlipped(false);
    setDone(false);
    started.current = Date.now();
  }

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], .tutor-drawer')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (done) return;
      if (event.key === ' ' || event.key === 'Enter') {
        if (event.target.closest?.('button') && event.target !== cardRef.current) return;
        event.preventDefault();
        setFlipped(value => !value);
      } else if (event.key === '1') again();
      else if (event.key === '2') gotIt();
      else if (event.key === 'ArrowLeft') back();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const position = Math.min(total, known.length + 1);

  return (
    <div className="fc">
      <div className="c-glass fc-bar" role="toolbar" aria-label="Flashcards">
        <button type="button" className="c-icon-btn" onClick={onBack} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        <span className="fc-name c-truncate">{title}</span>
        <button type="button" className="c-icon-btn" onClick={shuffle} aria-label="Shuffle" disabled={done}><Shuffle size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        {onToggleStar && (
          <button type="button" className={'c-icon-btn' + (starred ? ' is-starred' : '')} onClick={onToggleStar} aria-pressed={Boolean(starred)} aria-label={starred ? 'Unstar' : 'Star'}>
            <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {onEdit && <button type="button" className="c-icon-btn" onClick={onEdit} aria-label="Edit"><Pencil size={20} strokeWidth={1.75} aria-hidden="true" /></button>}
        <button type="button" className="c-btn c-btn--quiet fc-ask" onClick={() => card && askAboutCard(card, guideId)} disabled={done}>
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />Ask
        </button>
      </div>

      {done ? (
        <SessionFinish
          guideId={guideId || flashcards[0]?.guideId}
          guideTitle={title}
          cards={total}
          accuracy={((total - missed.size) / Math.max(1, total)) * 100}
          minutes={seconds / 60}
          kind="cards"
          onRestart={restart}
          onDone={onExit || onBack}
        >
          {finishExtra}
        </SessionFinish>
      ) : (
        <>
          <div className="fc-progress">
            <div className="c-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={known.length}><span style={{ width: `${(known.length / total) * 100}%` }} /></div>
            <span className="c-meta">{position} / {total}</span>
          </div>
          <div
            ref={cardRef}
            data-spot="flashcard"
            className={'fc-card' + (flipped ? ' is-flipped' : '')}
            role="button"
            tabIndex={0}
            aria-roledescription="flashcard"
            aria-pressed={flipped}
            onClick={() => setFlipped(value => !value)}
          >
            <div className="fc-face fc-front" aria-hidden={flipped}>
              {card?.guideTitle && <span className="c-meta">{card.guideTitle}</span>}
              <p>{card?.front}</p>
            </div>
            <div className="fc-face fc-back" aria-hidden={!flipped}>
              <p>{card?.back}</p>
              {card?.image && <img src={card.image} alt="" />}
            </div>
          </div>
          <div className="fc-actions">
            {flipped ? (
              <>
                <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={again}>Again <kbd>1</kbd></button>
                <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={gotIt}>Got it <kbd>2</kbd></button>
              </>
            ) : (
              <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={() => setFlipped(true)}>Flip <kbd>Space</kbd></button>
            )}
          </div>
        </>
      )}
      <style jsx>{`
        .fc { display: grid; gap: 20px; width: min(760px, 100%); margin: 0 auto; }
        .fc-bar { position: sticky; top: calc(var(--bar-h) + 12px); z-index: 20; display: flex; align-items: center; gap: 4px; padding: 6px; border-radius:var(--r-pill); }
        .fc-name { flex: 1; min-width: 0; padding: 0 8px; font:600 17px/1.15 var(--font-display); }
        .fc-bar :global(.is-starred) { color: var(--olive-ink); }
        .fc-progress { display: flex; align-items: center; gap: 12px; }
        .fc-progress .c-bar { flex: 1; }
        .fc-card { position: relative; min-height: 340px; perspective: 1400px; cursor: pointer; border-radius:var(--r-card); }
        .fc-face { position: absolute; inset: 0; display: grid; align-content: center; justify-items: center; gap: 12px; padding: 32px; overflow: auto; border: 1px solid var(--line); border-radius:var(--r-card); background: var(--card); box-shadow: var(--shadow); backface-visibility: hidden; transition: transform var(--dur) var(--ease); text-align: center; }
        .fc-face p { margin: 0; max-width: 34ch; font:500 20px/1.15 var(--font-display); color: var(--ink); }
        .fc-face img { max-width: 100%; max-height: 180px; object-fit: contain; border-radius:var(--r-input); }
        .fc-back { transform: rotateY(180deg); }
        .is-flipped .fc-front { transform: rotateY(-180deg); }
        .is-flipped .fc-back { transform: rotateY(0); }
        .fc-actions { display: flex; justify-content: center; gap: 12px; }
        .fc-actions :global(.c-btn) { min-width: 150px; }
        @media (max-width: 767px) {
          .fc-bar { top: 64px; }
          .fc-card { min-height: 300px; }
          .fc-actions :global(.c-btn) { flex: 1; min-width: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fc-face { transition: none; }
          .fc-back { transform: none; opacity: 0; }
          .is-flipped .fc-front { transform: none; opacity: 0; }
          .is-flipped .fc-back { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
