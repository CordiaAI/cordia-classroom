import { useEffect, useRef, useState } from 'react';
import { ListChecks, Lock, PenLine, Play, RefreshCw, Repeat, TextCursorInput, Timer } from 'lucide-react';
import { apiErrorMessage, apiFetch, openUpgrade } from '../lib/api';
import { PRO_TYPES } from '../lib/retainEngine.mjs';
import { inDayOne, walkthroughEvent } from '../lib/walkthrough';
import MatchRace from './MatchRace';
import QuizMode from './QuizMode';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
// Pairs and the 60-second race are one mode: Match.
const MODES = [
  { key: 'mc', label: 'Choice', icon: ListChecks },
  { key: 'written', label: 'Written', icon: PenLine },
  { key: 'fill', label: 'Fill in', icon: TextCursorInput },
  { key: 'match', label: 'Match', icon: Timer },
];
const STORAGE_KEY = 'quizMode';

// Quiz inside the guide shell: pick a mode, Start, misses repeat.
export default function QuizPanel({ guideId, onDone }) {
  const [mode, setMode] = useState('mc');
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); if (MODES.some(item => item.key === saved)) setMode(saved); } catch { /* optional */ }
    apiFetch(`/quiz/${guideId}/history`).then(data => setHistory(data?.attempts || []));
    apiFetch('/billing/status').then(data => {
      if (data?.features) setPlan({ pro: data.plan === 'classroom_plus' || data.unlimited, left: data.features.retain_types?.remaining ?? 0 });
    });
    walkthroughEvent('quiz-opened');
    return () => clearInterval(timer.current);
  }, [guideId]);

  const proLocked = plan && !plan.pro && plan.left <= 0;

  function choose(key) {
    if (PRO_TYPES.includes(key) && proLocked) { openUpgrade({ feature: 'retain_types' }); return; }
    setMode(key);
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* optional */ }
  }

  async function start() {
    setPreparing(true);
    setProgress(0.08);
    setError('');
    clearInterval(timer.current);
    // Questions take a few seconds the first time; the bar moves toward 90% until they arrive.
    timer.current = setInterval(() => setProgress(value => Math.min(0.9, value + (0.9 - value) * 0.12)), 400);
    const short = inDayOne('quiz-start');
    const types = short || mode === 'match' ? ['mc'] : [mode];
    const data = await apiFetch(`/quiz/${guideId}/session`, { method: 'POST', body: JSON.stringify({ types }) });
    clearInterval(timer.current);
    setProgress(1);
    setPreparing(false);
    if (data?.cards?.length) {
      setSession({ ...data, cards: short ? data.cards.slice(0, 3) : data.cards, selected: types, race: mode === 'match' && !short, version: Date.now() });
      walkthroughEvent('quiz-started');
    } else {
      setError(apiErrorMessage(data?.detail, "Couldn't make a quiz from this guide."));
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/regenerate`, { method: 'POST' });
    setRegenerating(false);
    if (data?.questions) setSession(null);
    else setError(apiErrorMessage(data?.detail, "Couldn't make new questions."));
  }

  if (session?.race) return <MatchRace key={session.version} questions={session.questions} guideId={guideId} onRestart={() => setSession(null)} onDone={() => { setSession(null); onDone?.(); }} />;
  if (session) {
    return (
      <QuizMode key={session.version} questions={session.questions} cards={session.cards} types={session.selected} guideId={guideId}
        onRestart={() => setSession(null)} onDone={() => { walkthroughEvent('guide-open'); setSession(null); onDone?.(); }} />
    );
  }

  return (
    <section className="quiz-panel" aria-label="Quiz">
      {error && <p className="quiz-error" role="alert">{error}</p>}
      <div className="quiz-modes" role="radiogroup" aria-label="Mode">
        {MODES.map(item => {
          const locked = PRO_TYPES.includes(item.key) && plan && !plan.pro;
          return (
            <button key={item.key} type="button" role="radio" aria-checked={mode === item.key} className={'quiz-mode' + (mode === item.key ? ' is-on' : '')} onClick={() => choose(item.key)} aria-label={`${item.label}${locked ? ', Pro' : ''}`}>
              <item.icon size={28} strokeWidth={1.75} aria-hidden="true" />
              <span>{item.label}</span>
              {locked && <Lock className="quiz-lock" size={16} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <p className="quiz-note">{mode === 'match' ? <><Timer {...ICON} />60 seconds</> : <><Repeat {...ICON} />Misses repeat</>}</p>
      {preparing ? (
        <div className="quiz-preparing" role="status" aria-live="polite">
          <div className="c-bar" role="progressbar" aria-label="Preparing questions" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
          <span className="c-meta">Preparing questions</span>
        </div>
      ) : (
        <div className="quiz-actions">
          <button type="button" className="c-btn c-btn--primary c-btn--lg" data-spot="quiz-start" onClick={start}><Play {...ICON} />Start</button>
          <button type="button" className="c-btn c-btn--quiet" onClick={regenerate} disabled={regenerating}><RefreshCw {...ICON} />{regenerating ? 'Making…' : 'New questions'}</button>
        </div>
      )}
      {history.length > 0 && (
        <section className="quiz-history" aria-labelledby="quiz-history">
          <h2 id="quiz-history" className="c-section-title">History</h2>
          <div className="c-card c-list">
            {history.map(attempt => (
              <div key={attempt.id} className="c-list-row">
                <span className="c-grow quiz-past-score">{attempt.score}%</span>
                <span className="c-meta">{attempt.correct_answers}/{attempt.total_questions}</span>
                <span className="c-meta">{new Date(attempt.completed_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <style jsx global>{`
        .quiz-panel { display: grid; gap: 16px; }
        .quiz-error { margin: 0; padding: 12px 16px; border-radius: 12px; background: var(--error-bg); color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .quiz-modes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .quiz-mode { position: relative; display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 112px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; }
        .quiz-mode.is-on { border-color: var(--olive-ink); box-shadow: 0 0 0 2px var(--olive-ink); }
        .quiz-lock { position: absolute; top: 12px; right: 12px; color: var(--muted); }
        .quiz-note { display: flex; align-items: center; gap: 8px; margin: 0; font: 600 15px/1.2 var(--font-sans); color: var(--ink); }
        .quiz-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .quiz-actions .c-btn--lg { min-width: 180px; }
        .quiz-preparing { display: grid; gap: 8px; max-width: 420px; }
        .quiz-preparing .c-bar span { transition: width 380ms ease-out; }
        .quiz-history { display: grid; gap: 8px; }
        .quiz-history h2 { margin: 0; }
        .quiz-past-score { font-weight: 600; font-variant-numeric: tabular-nums; }
        @media (max-width: 639px) { .quiz-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); } .quiz-actions .c-btn--lg { flex: 1; } }
      `}</style>
    </section>
  );
}
