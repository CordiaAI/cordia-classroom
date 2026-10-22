import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Pencil, Shuffle, Star } from 'lucide-react';
import { walkthroughEvent } from '../lib/walkthrough';
import { requestTip } from '../lib/tips';
import SessionFinish from './SessionFinish';
import { isCardImage } from '../lib/cardImages';

const SHUFFLE_KEY = 'cordiaShuffle';
// Swipe: past this many pixels the card is answered (right = Got it, left = Again).
const SWIPE_PX = 110;
const FLY_MS = 220;

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

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
  // Drag state for swiping: the card follows the finger, then flies off or springs back.
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false, leaving: '' });
  const dragStart = useRef(null);
  const dragged = useRef(false);
  // Bumps the matching counter when a card is answered.
  const [bump, setBump] = useState({ know: 0, learning: 0 });

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

  function gotIt(swiped = false) {
    if ((!flipped && !swiped) || card === undefined) return;
    setBump(value => ({ ...value, know: value.know + 1 }));
    const nextKnown = [...known, current];
    const nextQueue = queue.slice(1);
    setHistory(list => [...list, snapshot()]);
    setKnown(nextKnown);
    setQueue(nextQueue);
    setFlipped(false);
    if (!nextQueue.length) finish(nextKnown, missed);
  }

  function again(swiped = false) {
    if ((!flipped && !swiped) || card === undefined) return;
    setBump(value => ({ ...value, learning: value.learning + 1 }));
    const nextMissed = new Set(missed);
    nextMissed.add(current);
    setHistory(list => [...list, snapshot()]);
    setMissed(nextMissed);
    setQueue([...queue.slice(1), current]);
    setFlipped(false);
  }

  // A button or key answer flies the card off the same way a swipe does.
  function answer(known, swiped = false) {
    if (card === undefined || drag.leaving || (!flipped && !swiped)) return;
    if (reducedMotion()) { if (known) gotIt(swiped); else again(swiped); return; }
    setDrag({ dx: 0, dy: 0, active: false, leaving: known ? 'right' : 'left' });
    setTimeout(() => {
      if (known) gotIt(true); else again(true);
      setDrag({ dx: 0, dy: 0, active: false, leaving: '' });
    }, FLY_MS);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!dragStart.current || drag.leaving) return;
    const dx = event.clientX - dragStart.current.x;
    const dy = event.clientY - dragStart.current.y;
    if (!dragged.current && Math.abs(dx) < 8) return;
    dragged.current = true;
    setDrag({ dx, dy: dy * 0.25, active: true, leaving: '' });
  }

  function onPointerUp() {
    if (!dragStart.current) return;
    dragStart.current = null;
    const dx = drag.dx;
    if (dragged.current && Math.abs(dx) >= SWIPE_PX) answer(dx > 0, true);
    else setDrag({ dx: 0, dy: 0, active: false, leaving: '' });
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
      } else if (event.key === '1') answer(false);
      else if (event.key === '2') answer(true);
      else if (event.key === 'ArrowLeft') back();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const position = Math.min(total, known.length + 1);
  // Quizlet-style tallies: cards missed and not yet known, and cards known.
  const learning = [...missed].filter(index => !known.includes(index)).length;
  const gotRight = known.filter(index => !missed.has(index));
  const lean = drag.leaving ? (drag.leaving === 'right' ? 1 : -1) : Math.max(-1, Math.min(1, drag.dx / SWIPE_PX));
  const cardStyle = drag.leaving
    ? { transform: `translateX(${drag.leaving === 'right' ? 130 : -130}%) rotate(${drag.leaving === 'right' ? 18 : -18}deg)`, opacity: 0, transition: `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in` }
    : drag.active ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 18}deg)`, transition: 'none' } : undefined;

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
          <div className="fc-results">
            <ResultList tone="learning" label="Missed" cards={[...missed].map(index => flashcards[index])} />
            <ResultList tone="know" label="Got right" cards={gotRight.map(index => flashcards[index])} />
          </div>
          {finishExtra}
        </SessionFinish>
      ) : (
        <>
          <div className="fc-progress">
            <span className="fc-count is-learning" title="Still learning"><span className="fc-count-label">Still learning</span><strong key={'l' + bump.learning} className={bump.learning ? 'is-bumped' : ''} aria-label={`Still learning: ${learning}`}>{learning}</strong></span>
            <div className="c-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={known.length}><span style={{ width: `${(known.length / total) * 100}%` }} /></div>
            <span className="c-meta">{position} / {total}</span>
            <span className="fc-count is-know" title="Know"><strong key={'k' + bump.know} className={bump.know ? 'is-bumped' : ''} aria-label={`Know: ${known.length}`}>{known.length}</strong><span className="fc-count-label">Know</span></span>
          </div>
          <div className="fc-deck">
            {/* A new key per card, so a swiped card's position never carries over to the next. */}
            <div key={`${current}-${queue.length}-${known.length}`} className="fc-top" style={cardStyle}>
              <div
                ref={cardRef}
                data-spot="flashcard"
                className={'fc-card' + (flipped ? ' is-flipped' : '')}
                role="button"
                tabIndex={0}
                aria-roledescription="flashcard"
                aria-pressed={flipped}
                aria-describedby="fc-swipe-hint"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClick={() => { if (!dragged.current) setFlipped(value => !value); dragged.current = false; }}
              >
                <div className="fc-face fc-front" aria-hidden={flipped}>
                  {card?.guideTitle && <span className="c-meta">{card.guideTitle}</span>}
                  {isCardImage(card?.front_image) && <img src={card.front_image} alt="" />}
                  <p>{card?.front}</p>
                </div>
                <div className="fc-face fc-back" aria-hidden={!flipped}>
                  <p>{card?.back}</p>
                  {isCardImage(card?.image) && <img src={card.image} alt="" />}
                </div>
                {/* Leaning while dragged: green toward Know, amber toward Still learning. */}
                <span className="fc-lean is-know" style={{ opacity: Math.max(0, lean) }} aria-hidden="true">Know</span>
                <span className="fc-lean is-learning" style={{ opacity: Math.max(0, -lean) }} aria-hidden="true">Still learning</span>
              </div>
            </div>
          </div>
          <p id="fc-swipe-hint" className="fc-swipe-hint c-meta">Swipe right if you know it, left to see it again</p>
          <div className="fc-actions" data-tip="keys">
            {flipped ? (
              <>
                <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={() => answer(false)}>Again <kbd>1</kbd></button>
                <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={() => answer(true)}>Got it <kbd>2</kbd></button>
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
        .fc-count { display: inline-flex; align-items: center; gap: 8px; font: 500 var(--fs-13)/1 var(--font-sans); color: var(--muted); }
        .fc-count strong { min-width: 36px; height: 28px; padding: 0 10px; display: inline-grid; place-items: center; border-radius: var(--r-pill); font: 700 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .fc-count.is-learning strong { color: var(--warning); background: var(--warning-bg); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 35%, transparent); }
        .fc-count.is-know strong { color: var(--success); background: var(--success-bg); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent); }
        .fc-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; width: 100%; text-align: left; }
        .fc-deck { position: relative; display: grid; }
        .fc-deck > * { grid-area: 1 / 1; }
        .fc-top { position: relative; z-index: 1; animation: fc-in 180ms ease-out backwards; touch-action: pan-y; }
        @keyframes fc-in { from { opacity: 0; } }
        .fc-card { position: relative; min-height: 340px; perspective: 1400px; cursor: grab; border-radius:var(--r-card); user-select: none; -webkit-user-select: none; }
        .fc-card:active { cursor: grabbing; }
        /* A light sheen sweeps across the card as it turns. */
        .fc-face::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(115deg, transparent 38%, var(--sheen) 50%, transparent 62%) no-repeat; background-size: 260% 100%; background-position: 130% 0; transition: background-position 700ms var(--ease); }
        .is-flipped .fc-face::after { background-position: -40% 0; }
        .fc-lean { position: absolute; top: 18px; z-index: 2; padding: 6px 12px; border-radius: var(--r-pill); font: 700 14px/1 var(--font-sans); letter-spacing: 0.02em; pointer-events: none; transition: opacity 120ms linear; }
        .fc-lean.is-know { right: 18px; color: var(--success); background: var(--success-bg); box-shadow: inset 0 0 0 2px var(--success); }
        .fc-lean.is-learning { left: 18px; color: var(--warning); background: var(--warning-bg); box-shadow: inset 0 0 0 2px var(--warning); }
        .fc-swipe-hint { margin: 4px 0 -8px; text-align: center; }
        @media (hover: hover) and (pointer: fine) { .fc-swipe-hint { display: none; } }
        .fc-count strong.is-bumped { animation: fc-bump 380ms var(--ease); }
        @keyframes fc-bump { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
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
          .fc-count-label { display: none; }
          .fc-results { grid-template-columns: minmax(0, 1fr); }
        }
        @media (prefers-reduced-motion: reduce) {
          .fc-face { transition: none; }
          .fc-top, .fc-count strong.is-bumped { animation: none; }
          .fc-face::after { display: none; }
          .fc-back { transform: none; opacity: 0; }
          .is-flipped .fc-front { transform: none; opacity: 0; }
          .is-flipped .fc-back { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// The cards in one tally on the finish screen, so the student sees exactly which ones.
function ResultList({ tone, label, cards }) {
  return (
    <details className={'c-card fc-result is-' + tone} open={tone === 'learning' && cards.length > 0}>
      <summary><strong>{cards.length}</strong>{label}</summary>
      {cards.length > 0 ? (
        <ul>
          {cards.map((card, index) => (
            <li key={index}><span className="fc-result-front">{card?.front}</span><span className="c-meta">{card?.back}</span></li>
          ))}
        </ul>
      ) : <p className="c-meta">None</p>}
      <style jsx>{`
        .fc-result { padding: 12px 16px; min-width: 0; }
        summary { display: flex; align-items: center; gap: 10px; cursor: pointer; font: 600 15px/1.2 var(--font-sans); list-style: none; }
        summary::-webkit-details-marker { display: none; }
        summary strong { min-width: 32px; height: 26px; padding: 0 8px; display: inline-grid; place-items: center; border-radius: var(--r-pill); font: 700 14px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .is-learning summary strong { color: var(--warning); background: var(--warning-bg); }
        .is-know summary strong { color: var(--success); background: var(--success-bg); }
        ul { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; max-height: 280px; overflow: auto; }
        li { display: grid; gap: 2px; padding-top: 8px; border-top: 1px solid var(--hairline); min-width: 0; overflow-wrap: anywhere; }
        .fc-result-front { font: 600 14px/1.3 var(--font-sans); color: var(--ink); }
        p { margin: 8px 0 0; }
      `}</style>
    </details>
  );
}
