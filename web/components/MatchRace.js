import { useEffect, useMemo, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { conceptAnswer, shuffled } from '../lib/retainEngine.mjs';
import { readUserValue, writeUserValue } from '../lib/userStore';
import SessionFinish from './SessionFinish';

const SECONDS = 60;
const PER_ROUND = 5;

// Match: pair each question with its answer before 60 seconds run out.
export default function MatchRace({ questions, guideId, onRestart, onDone }) {
  const pool = useMemo(() => questions.map((question, index) => ({ id: index, q: question.question, a: conceptAnswer(question) })).filter(item => item.q && item.a), [questions]);
  const [round, setRound] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [picked, setPicked] = useState(null);
  const [cleared, setCleared] = useState(() => new Set());
  const [wrong, setWrong] = useState(null);
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
    if (over || cleared.has(item.id)) return;
    if (side === 'q') { setPicked(item.id); return; }
    if (picked === null) return;
    setAttempts(value => value + 1);
    if (picked === item.id) {
      const next = new Set(cleared);
      next.add(item.id);
      setMatched(value => value + 1);
      setPicked(null);
      if (next.size >= batch.length) { setCleared(new Set()); setRound(value => value + 1); }
      else setCleared(next);
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
        <span className="race-time" role="timer" aria-live="off"><Timer size={20} strokeWidth={1.75} aria-hidden="true" />{left}s</span>
        <div className="c-bar race-progress"><span style={{ width: `${(left / SECONDS) * 100}%` }} /></div>
        <span className="c-meta">{matched}</span>
      </div>
      <div className="race-grid">
        <div className="race-col" role="group" aria-label="Questions">
          {batch.map(item => (
            <button key={'q' + item.id} type="button" className={'race-tile' + (picked === item.id ? ' is-picked' : '') + (cleared.has(item.id) ? ' is-cleared' : '')} aria-pressed={picked === item.id} disabled={cleared.has(item.id)} onClick={() => choose('q', item)}>{item.q}</button>
          ))}
        </div>
        <div className="race-col" role="group" aria-label="Answers">
          {answers.map(item => (
            <button key={'a' + item.id} type="button" className={'race-tile is-answer' + (cleared.has(item.id) ? ' is-cleared' : '') + (wrong === item.id ? ' is-wrong' : '')} disabled={cleared.has(item.id)} onClick={() => choose('a', item)}>{item.a}</button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .race { display: grid; gap: 16px; }
        .race-bar { display: flex; align-items: center; gap: 12px; }
        .race-time { display: inline-flex; align-items: center; gap: 6px; font:600 17px/1 var(--font-sans); font-variant-numeric: tabular-nums; min-width: 64px; }
        .race-progress { flex: 1; }
        .race-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .race-col { display: grid; gap: 8px; align-content: start; }
        .race-tile { min-height: 64px; padding: 12px 14px; border: 1px solid var(--line); border-radius:var(--r-input); background: var(--card); color: var(--ink); font:500 15px/1.5 var(--font-sans); text-align: left; cursor: pointer; transition: opacity var(--dur), border-color var(--dur); }
        .race-tile.is-answer { font-family: var(--font-display); font-size:15px; }
        .race-tile.is-picked { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .race-tile.is-cleared { opacity: .25; cursor: default; }
        .race-tile.is-wrong { border-color: var(--error); }
        @media (max-width: 767px) { .race-tile { min-height: 56px; font-size: 13px; } .race-tile.is-answer { font-size: 15px; } }
      `}</style>
    </section>
  );
}
