import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Pencil, Shuffle, Star } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';
import { requestTip } from '../lib/tips';
import SessionFinish from './SessionFinish';

const SHUFFLE_KEY = 'cordiaShuffle';

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
  // Shuffle is a setting, not a one-off: on, cards come in random order (and stay that way
  // next session); off, they go back to the guide's order.
  const [shuffleOn, setShuffleOn] = useState(() => {
    try { return localStorage.getItem(SHUFFLE_KEY) === 'on'; } catch { return false; }
  });
  const [queue, setQueue] = useState(() => {
    const order = flashcards.map((_, index) => index);
    return shuffleOn ? shuffledOrder(order.length).map(index => order[index]) : order;
  });
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
  // First flashcard session on a keyboard computer: point out Space, 1 and 2.
  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) requestTip('keys'); }, []);
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

  function toggleShuffle() {
    const next = !shuffleOn;
    setShuffleOn(next);
    try { localStorage.setItem(SHUFFLE_KEY, next ? 'on' : 'off'); } catch {}
    setQueue(current => {
      if (!next) return [...current].sort((a, b) => a - b);
      const mixed = shuffledOrder(current.length).map(index => current[index]);
      // Turning shuffle on always changes the card in front, so the tap visibly does something.
      if (mixed.length > 1 && mixed[0] === current[0]) mixed.push(mixed.shift());
      return mixed;
    });
    setFlipped(false);
  }

  function restart() {
    const order = flashcards.map((_, index) => index);
    setQueue(shuffleOn ? shuffledOrder(order.length).map(index => order[index]) : order);
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
        <button type="button" className="c-icon-btn" onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffleOn} title={shuffleOn ? 'Shuffle is on' : 'Shuffle is off'} disabled={done}><Shuffle size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        {onToggleStar && (
          <button type="button" className={'c-icon-btn' + (starred ? ' is-starred' : '')} onClick={onToggleStar} aria-pressed={Boolean(starred)} aria-label={starred ? 'Unstar' : 'Star'}>
            <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {onEdit && <button type="button" className="c-icon-btn" onClick={onEdit} aria-label="Edit"><Pencil size={20} strokeWidth={1.75} aria-hidden="true" /></button>}
        <button type="button" className="c-btn c-btn--quiet fc-ask" onClick={() => card && askAboutCard(card, guideId)} disabled={done} aria-label="Ask about this card">
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" /><span className="fc-ask-label">Ask</span>
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
          <div className="fc-actions" data-tip="keys">
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
        .fc { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; width: min(760px, 100%); margin: 0 auto; min-width: 0; }
        .fc > * { min-width: 0; }
        .fc-bar { position: sticky; top: calc(var(--bar-h) + 12px); z-index: 20; display: flex; align-items: center; gap: 4px; padding: 6px; border-radius:var(--r-pill); }
        .fc-name { flex: 1; min-width: 0; padding: 0 8px; font:600 17px/1.15 var(--font-sans); }
        .fc-bar :global(.is-starred) { color: var(--olive-ink); }
        .fc-progress { display: flex; align-items: center; gap: 12px; }
        .fc-progress .c-bar { flex: 1; }
        .fc-card { position: relative; min-height: 340px; perspective: 1400px; cursor: pointer; border-radius:var(--r-card); }
        .fc-face { position: absolute; inset: 0; display: grid; align-content: center; justify-items: center; gap: 12px; padding: 32px; overflow: auto; border: 1px solid var(--line); border-radius:var(--r-card); background: var(--card); box-shadow: var(--shadow); backface-visibility: hidden; transition: transform var(--dur) var(--ease); text-align: center; }
        .fc-face p { margin: 0; max-width: 34ch; font:500 20px/1.15 var(--font-sans); color: var(--ink); }
        .fc-face img { max-width: 100%; max-height: 180px; object-fit: contain; border-radius:var(--r-input); }
        .fc-back { transform: rotateY(180deg); }
        .is-flipped .fc-front { transform: rotateY(-180deg); }
        .is-flipped .fc-back { transform: rotateY(0); }
        .fc-actions { display: flex; justify-content: center; gap: 12px; }
        .fc-actions :global(.c-btn) { min-width: 150px; }
        @media (max-width: 767px) {
          .fc-ask { padding: 0 10px; }
          .fc-ask-label { display: none; }
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
