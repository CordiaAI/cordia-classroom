import { useEffect, useMemo, useRef, useState } from 'react';
import { conceptAnswer, shuffled } from '../lib/retainEngine.mjs';
import { readUserValue, writeUserValue } from '../lib/userStore';
import SessionFinish from './SessionFinish';
import { prefersReducedMotion } from '../lib/motion';

// The clock as a ring that empties, olive, then amber under 20 s and red under 10 s.
function TimerRing({ left }) {
  const radius = (RING.size - RING.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = left <= 10 ? 'is-urgent' : left <= 20 ? 'is-low' : '';
  return (
    <span className={'race-ring ' + tone} role="timer" aria-live="off" aria-label={`${left} seconds left`}>
      <svg width={RING.size} height={RING.size} aria-hidden="true">
        <circle className="race-ring-track" cx={RING.size / 2} cy={RING.size / 2} r={radius} fill="none" strokeWidth={RING.stroke} />
        <circle className="race-ring-fill" cx={RING.size / 2} cy={RING.size / 2} r={radius} fill="none" strokeWidth={RING.stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - left / SECONDS)} />
      </svg>
      <span aria-hidden="true">{left}</span>
      <style jsx>{`
        .race-ring { position: relative; width: ${RING.size}px; height: ${RING.size}px; display: inline-grid; place-items: center; font: 600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .race-ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
        .race-ring-track { stroke: var(--hairline); }
        .race-ring-fill { stroke: var(--olive); transition: stroke-dashoffset 1s linear, stroke 300ms ease; }
        .is-low .race-ring-fill { stroke: var(--warning); }
        .is-urgent .race-ring-fill { stroke: var(--error); }
        .is-urgent { color: var(--error); animation: race-tick 1s ease-in-out infinite; }
        @keyframes race-tick { 50% { transform: scale(1.08); } }
        @media (prefers-reduced-motion: reduce) { .race-ring-fill { transition: none; } .is-urgent { animation: none; } }
      `}</style>
    </span>
  );
}

const SECONDS = 60;
const PER_ROUND = 5;
const MERGE_MS = 420;
const RING = { size: 44, stroke: 4 };

// Match: pair each question with its answer before 60 seconds run out.
export default function MatchRace({ questions, guideId, onRestart, onDone }) {
  const pool = useMemo(() => questions.map((question, index) => ({ id: index, q: question.question, a: conceptAnswer(question) })).filter(item => item.q && item.a), [questions]);
  const [round, setRound] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [picked, setPicked] = useState(null);
  const [cleared, setCleared] = useState(() => new Set());
  const [wrong, setWrong] = useState(null);
  // A matched pair slides together and merges before it clears.
  const [merging, setMerging] = useState(null);
  const [matched, setMatched] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [over, setOver] = useState(false);
  const best = useRef(readUserValue('cordiaMatchBest', {})?.[guideId] || 0);

  const batch = useMemo(() => {
    if (!pool.length) return [];
    const start = (round * PER_ROUND) % pool.length;
    return Array.from({ length: Math.min(PER_ROUND, pool.length) }, (_, index) => pool[(start + index) % pool.length]);
  }, [pool, round]);
  const answers = useMemo(() => shuffled(batch.map(item => item.id), round * 7 + 3).map(id => batch.find(item => item.id === id)), [batch, round]);

  useEffect(() => {
    if (over) return undefined;
    const timer = setInterval(() => setLeft(value => {
      if (value <= 1) { clearInterval(timer); setOver(true); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [over]);

  useEffect(() => {
    if (!over) return;
    const all = readUserValue('cordiaMatchBest', {}) || {};
    if (matched > (all[guideId] || 0)) writeUserValue('cordiaMatchBest', { ...all, [guideId]: matched });
  }, [over]);

  function choose(side, item) {
    if (over || cleared.has(item.id) || merging !== null) return;
    if (side === 'q') { setPicked(item.id); return; }
    if (picked === null) return;
    setAttempts(value => value + 1);
    if (picked === item.id) {
      const next = new Set(cleared);
      next.add(item.id);
      setMatched(value => value + 1);
      setPicked(null);
      setMerging(item.id);
      setTimeout(() => {
        setMerging(null);
        if (next.size >= batch.length) { setCleared(new Set()); setRound(value => value + 1); }
        else setCleared(next);
      }, prefersReducedMotion() ? 0 : MERGE_MS);
    } else {
      setWrong(item.id);
      setTimeout(() => setWrong(null), 400);
    }
  }

  if (over) {
    return (
      <SessionFinish guideId={guideId} cards={matched} accuracy={attempts ? (matched / attempts) * 100 : 0} minutes={1} kind="match" onRestart={onRestart} onDone={onDone}>
        <span className="c-meta">Best {Math.max(best.current, matched)}</span>
      </SessionFinish>
    );
  }

  return (
    <section className="race" aria-label="Match">
      <div className="race-bar">
        <TimerRing left={left} />
        <div className="c-bar race-progress"><span style={{ width: `${(left / SECONDS) * 100}%` }} /></div>
        <span className="c-meta">{matched}</span>
      </div>
      <div className="race-grid">
        <div className="race-col" role="group" aria-label="Questions">
          {batch.map(item => (
            <button key={'q' + item.id} type="button" className={'race-tile' + (picked === item.id ? ' is-picked' : '') + (cleared.has(item.id) ? ' is-cleared' : '') + (merging === item.id ? ' is-merging is-q' : '')} aria-pressed={picked === item.id} disabled={cleared.has(item.id)} onClick={() => choose('q', item)}>{item.q}</button>
          ))}
        </div>
        <div className="race-col" role="group" aria-label="Answers">
          {answers.map(item => (
            <button key={'a' + item.id} type="button" className={'race-tile is-answer' + (cleared.has(item.id) ? ' is-cleared' : '') + (wrong === item.id ? ' is-wrong' : '') + (merging === item.id ? ' is-merging is-a' : '')} disabled={cleared.has(item.id)} onClick={() => choose('a', item)}>{item.a}</button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .race { display: grid; gap: 16px; }
        .race-bar { display: flex; align-items: center; gap: 12px; }
        .race-progress { flex: 1; }
        .race-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .race-col { display: grid; gap: 8px; align-content: start; }
        .race-tile { min-height: 64px; padding: 12px 14px; border: 1px solid var(--line); border-radius:var(--r-input); background: var(--card); color: var(--ink); font:500 15px/1.5 var(--font-sans); text-align: left; cursor: pointer; transition: opacity var(--dur), border-color var(--dur); }
        .race-tile.is-answer { font-family: var(--font-sans); font-size:15px; }
        .race-tile.is-picked { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .race-tile.is-cleared { opacity: .25; cursor: default; }
        .race-tile.is-wrong { border-color: var(--error); animation: race-shake 380ms cubic-bezier(.36,.07,.19,.97); }
        .race-tile.is-merging { position: relative; z-index: 1; border-color: var(--success); background: var(--success-bg); color: var(--success); pointer-events: none; }
        .race-tile.is-merging.is-q { animation: race-merge-q ${MERGE_MS}ms var(--ease) forwards; }
        .race-tile.is-merging.is-a { animation: race-merge-a ${MERGE_MS}ms var(--ease) forwards; }
        @keyframes race-merge-q { 40% { transform: translateX(14%) scale(1.03); } 100% { transform: translateX(28%) scale(0.85); opacity: 0.2; } }
        @keyframes race-merge-a { 40% { transform: translateX(-14%) scale(1.03); } 100% { transform: translateX(-28%) scale(0.85); opacity: 0.2; } }
        @keyframes race-shake { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
        @media (prefers-reduced-motion: reduce) { .race-tile.is-merging, .race-tile.is-wrong { animation: none; } }
        @media (max-width: 767px) { .race-tile { min-height: 56px; font-size: 13px; } .race-tile.is-answer { font-size: 15px; } }
      `}</style>
    </section>
  );
}
