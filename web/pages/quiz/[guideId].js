import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, openUpgrade } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { PRO_TYPES, TYPE_LABELS } from '../../lib/retainEngine.mjs';
import { ArrowLeft, Lock, ListChecks, PenLine, Play, RefreshCw, Repeat, TextCursorInput, Shuffle as MatchIcon } from 'lucide-react';
import QuizMode from '../../components/QuizMode';

// Short tile names; TYPE_LABELS stays the engine's own naming.
const MODES = {
  mc: { label: 'Choice', icon: ListChecks },
  written: { label: 'Written', icon: PenLine },
  fill: { label: 'Fill in', icon: TextCursorInput },
  matching: { label: 'Match', icon: MatchIcon },
};
const STORAGE_KEY = 'retainTypes';

function rememberedTypes() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const valid = Array.isArray(saved) ? saved.filter(type => TYPE_LABELS[type]) : [];
    return valid.length ? valid : ['mc'];
  } catch {
    return ['mc'];
  }
}

export default function QuizPage() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [types, setTypes] = useState(['mc']);
  const [plan, setPlan] = useState(null);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!ready) return;
    setTypes(rememberedTypes());
    apiFetch(`/quiz/${guideId}/history`).then(data => setHistory(data?.attempts || []));
    apiFetch(`/guides/${guideId}`).then(data => setTitle(data?.guide?.title || ''));
    apiFetch('/billing/status').then(data => {
      if (data?.features) setPlan({ pro: data.plan === 'classroom_plus' || data.unlimited, left: data.features.retain_types?.remaining ?? 0 });
    });
  }, [ready, guideId]);

  const proLocked = plan && !plan.pro && plan.left <= 0;

  // A remembered Pro type the account can no longer use is turned off rather than failing on Start.
  useEffect(() => {
    if (proLocked) setTypes(current => (current.some(type => !PRO_TYPES.includes(type)) ? current.filter(type => !PRO_TYPES.includes(type)) : ['mc']));
  }, [proLocked]);

  function toggle(type) {
    if (PRO_TYPES.includes(type) && proLocked && !types.includes(type)) {
      openUpgrade({ feature: 'retain_types' });
      return;
    }
    const next = types.includes(type) ? types.filter(item => item !== type) : [...types, type];
    setTypes(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* remembering is optional */ }
  }

  async function start() {
    setStarting(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/session`, { method: 'POST', body: JSON.stringify({ types }) });
    setStarting(false);
    if (data?.cards?.length) setSession({ ...data, selected: types, version: Date.now() });
    else setError(data?.detail || 'Retain could not start. Make sure this guide has questions and answers.');
  }

  async function regenerate() {
    setRegenerating(true);
    setError('');
    const data = await apiFetch(`/quiz/${guideId}/regenerate`, { method: 'POST' });
    setRegenerating(false);
    if (data?.questions) setSession(null);
    else setError(data?.detail || 'Could not regenerate the questions.');
  }

  return (
    <div className="c-page quiz-page">
      <header className="c-page-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push('/guide/' + guideId)} aria-label="Back to guide"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <h1 className="c-title">Quiz</h1>
        </div>
        <button type="button" className="c-btn c-btn--quiet" onClick={regenerate} disabled={regenerating || starting}>
          <RefreshCw size={20} strokeWidth={1.75} aria-hidden="true" />{regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </header>
      {title && <p className="c-section-title quiz-guide">{title}</p>}
      {error && <div className="retain-action-error" role="alert">{error}</div>}

      {session ? (
        <QuizMode
          key={session.version}
          questions={session.questions}
          cards={session.cards}
          types={session.selected}
          guideId={guideId}
          onRestart={() => setSession(null)}
        />
      ) : (
        <>
          <div className="quiz-modes" role="group" aria-label="Question types">
            {Object.keys(TYPE_LABELS).map(type => {
              const mode = MODES[type];
              const locked = PRO_TYPES.includes(type) && plan && !plan.pro && plan.left <= 0;
              const on = types.includes(type);
              return (
                <button key={type} type="button" className={'quiz-mode' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => toggle(type)} aria-label={`${mode.label}${locked ? ', Pro' : ''}`}>
                  <mode.icon size={28} strokeWidth={1.75} aria-hidden="true" />
                  <span>{mode.label}</span>
                  {PRO_TYPES.includes(type) && plan && !plan.pro && <Lock className="quiz-lock" size={16} strokeWidth={1.75} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <p className="quiz-note"><Repeat size={20} strokeWidth={1.75} aria-hidden="true" />Misses repeat</p>
          <button type="button" className="c-btn c-btn--primary c-btn--lg quiz-start" onClick={start} disabled={starting || !types.length || !guideId}>
            <Play size={20} strokeWidth={1.75} aria-hidden="true" />{starting ? 'Preparing…' : 'Start'}
          </button>
          {history.length > 0 && (
            <section className="c-section" aria-labelledby="quiz-history">
              <h2 id="quiz-history" className="c-section-title">Past</h2>
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
        </>
      )}
      <style jsx>{`
        .quiz-page { width: min(760px, 100%); margin: 0 auto; }
        .quiz-guide { margin: -12px 0 0; font-family: var(--font-display); }
        .quiz-modes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .quiz-mode { position: relative; display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 120px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; box-shadow: var(--shadow); }
        .quiz-mode :global(.lucide) { color: var(--olive-ink); }
        .quiz-mode.is-on { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .quiz-mode :global(.quiz-lock) { position: absolute; top: 12px; right: 12px; color: var(--muted); }
        .quiz-note { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 600; }
        .quiz-note :global(.lucide) { color: var(--olive-ink); }
        .quiz-start { justify-self: start; min-width: 180px; }
        .quiz-past-score { font-weight: 600; font-variant-numeric: tabular-nums; }
        @media (max-width: 767px) { .quiz-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); } .quiz-start { width: 100%; } }
      `}</style>
    </div>
  );
}
