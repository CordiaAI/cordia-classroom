import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { loadStudyQueue } from '../lib/studyQueue';
import { rememberRetainMisses, retainMisses } from '../lib/userStore';
import { askAboutCard } from '../components/FlashcardViewer';
import PracticeProblem from '../components/PracticeProblem';
import SessionFinish from '../components/SessionFinish';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Today's Start: one session, one progress bar. Due cards, then quiz misses, then open
// practice problems. Missed cards come back at the end of the card stretch.
export default function StudySession() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [queue, setQueue] = useState(null);
  const [steps, setSteps] = useState([]);
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState({});
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!ready) return;
    loadStudyQueue().then(data => {
      setQueue(data);
      setSteps([...data.cards, ...data.misses, ...data.practiceItems].map((item, index) => ({ ...item, key: index })));
    });
  }, [ready]);

  const step = steps[position];
  const total = new Set(steps.map(item => item.key)).size;
  const finished = Object.values(results).filter(value => value === 'known' || value === 'correct' || value === 'retry').length;

  const save = useCallback(async () => {
    const byGuide = new Map();
    for (const item of steps) {
      if (item.kind !== 'card') continue;
      const entry = byGuide.get(item.guideId) || { known: [], unknown: [] };
      if (results[item.key] === 'known') entry.known.push(item.index);
      else if (results[item.key]) entry.unknown.push(item.index);
      byGuide.set(item.guideId, entry);
    }
    const requests = [...byGuide.entries()].map(([guideId, entry]) => {
      const guide = queue.guides.find(item => item.id === guideId);
      const before = guide?.flashcard_progress || {};
      const known = [...new Set([...(before.known || []), ...entry.known])];
      const unknown = [...new Set([...(before.unknown || []), ...entry.unknown])].filter(index => !known.includes(index));
      return apiFetch(`/guides/${guideId}/flashcard-progress`, { method: 'PATCH', body: JSON.stringify({ known, unknown, last_studied: new Date().toISOString() }) });
    });
    const stored = retainMisses();
    const cleared = {};
    steps.forEach(item => { if (item.kind === 'miss' && results[item.key] === 'known') (cleared[item.guideId] ||= new Set()).add(item.position); });
    Object.entries(cleared).forEach(([guideId, positions]) => rememberRetainMisses(guideId, (stored[guideId] || []).filter((_, index) => !positions.has(index))));
    const practiceByGuide = new Map();
    steps.forEach(item => {
      if (item.kind !== 'practice' || !results[item.key]) return;
      const entry = practiceByGuide.get(item.guideId) || { ...item.progress, evaluations: { ...(item.progress.evaluations || {}) } };
      entry.evaluations[item.problemIndex] = { status: results[item.key] };
      practiceByGuide.set(item.guideId, entry);
    });
    practiceByGuide.forEach((progress, guideId) => requests.push(apiFetch(`/practice/${guideId}/state`, { method: 'PUT', body: JSON.stringify({ progress }) })));
    const cards = steps.filter(item => item.kind !== 'practice');
    requests.push(apiFetch('/stats/log-session', {
      method: 'POST',
      body: JSON.stringify({ session_type: 'flashcard', duration_seconds: Math.round((Date.now() - started.current) / 1000), metadata: { cards_studied: cards.length, cards_correct: cards.filter(item => results[item.key] === 'known').length, mixed: true } }),
    }));
    await Promise.all(requests);
  }, [steps, results, queue]);

  function next() {
    setFlipped(false);
    if (position + 1 >= steps.length) { setDone(true); save(); return; }
    setPosition(value => value + 1);
  }

  function rate(known) {
    if (!flipped) return;
    setResults(all => ({ ...all, [step.key]: known ? 'known' : all[step.key] === 'known' ? 'known' : 'again' }));
    if (!known) setSteps(list => [...list.slice(0, position + 1), ...list.slice(position + 1).filter(item => item.kind !== 'practice'), { ...step }, ...list.slice(position + 1).filter(item => item.kind === 'practice')]);
    next();
  }

  useEffect(() => {
    function onKey(event) {
      if (!step || step.kind === 'practice' || done || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (event.key === ' ') { event.preventDefault(); setFlipped(value => !value); }
      else if (event.key === '1') rate(false);
      else if (event.key === '2') rate(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!ready) return null;
  if (!queue) {
    return (
      <div className="c-page" aria-busy="true" aria-label="Loading">
        <div className="c-skeleton" style={{ height: 8, borderRadius: 999 }} />
        <div className="c-skeleton" style={{ height: 340, borderRadius: 20 }} />
      </div>
    );
  }

  if (!steps.length) {
    return (
      <div className="c-page">
        <h1 className="c-title">All done</h1>
        <div><button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/dashboard')}>Back to Today</button></div>
      </div>
    );
  }

  if (done) {
    const cards = steps.filter(item => item.kind !== 'practice');
    const known = Object.entries(results).filter(([, value]) => value === 'known' || value === 'correct').length;
    return (
      <div className="c-page">
        <SessionFinish cards={new Set(cards.map(item => item.key)).size} accuracy={(known / Math.max(1, total)) * 100} minutes={(Date.now() - started.current) / 60000} kind="mixed" onDone={() => router.push('/dashboard')} />
      </div>
    );
  }

  return (
    <div className="c-page mix">
      <header className="mix-head">
        <button type="button" className="c-icon-btn" onClick={() => router.push('/dashboard')} aria-label="Back to Today" title="Back to Today"><ArrowLeft {...ICON} /></button>
        <div className="c-bar mix-bar" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}><span style={{ width: `${(finished / Math.max(1, total)) * 100}%` }} /></div>
        <span className="c-meta mix-count">{Math.min(total, finished + 1)} / {total}</span>
      </header>

      {step.kind === 'practice' ? (
        <PracticeProblem
          key={step.key}
          problem={step.problem}
          index={step.problemIndex}
          total={step.progress?.total || 10}
          guideId={step.guideId}
          answer={answers[step.key] || ''}
          onAnswer={value => setAnswers(all => ({ ...all, [step.key]: value }))}
          evaluation={results[step.key] ? { status: results[step.key] } : undefined}
          onEvaluate={value => setResults(all => ({ ...all, [step.key]: value.status === 'correct' ? 'correct' : value.status === 'retry' ? 'retry' : all[step.key] }))}
          onNext={next}
          nextLabel={position + 1 >= steps.length ? 'Finish' : 'Next'}
        />
      ) : (
        <>
          <div className={'mix-card' + (flipped ? ' is-flipped' : '')} role="button" tabIndex={0} aria-pressed={flipped} aria-roledescription="flashcard" onClick={() => setFlipped(value => !value)}>
            <span className="c-meta">{step.guideTitle}</span>
            <p>{flipped ? step.back : step.front}</p>
          </div>
          <div className="mix-actions">
            {flipped ? (
              <>
                <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={() => rate(false)}>Again <kbd>1</kbd></button>
                <button type="button" className="c-btn c-btn--primary c-btn--lg" onClick={() => rate(true)}>Got it <kbd>2</kbd></button>
              </>
            ) : (
              <button type="button" className="c-btn c-btn--secondary c-btn--lg" onClick={() => setFlipped(true)}>Flip <kbd>Space</kbd></button>
            )}
            <button type="button" className="c-btn c-btn--quiet" onClick={() => askAboutCard(step, step.guideId)}><MessageCircle {...ICON} />Ask</button>
          </div>
        </>
      )}

      <style jsx global>{`
        .mix-head { display: flex; align-items: center; gap: 12px; }
        .mix-bar { flex: 1; }
        .mix-bar span { transition: width 200ms ease-out; }
        .mix-count { font-variant-numeric: tabular-nums; }
        .mix-card { display: grid; align-content: center; justify-items: center; gap: 12px; min-height: 340px; padding: 32px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); box-shadow: var(--shadow); text-align: center; cursor: pointer; }
        .mix-card p { margin: 0; max-width: 40ch; font: 500 24px/1.4 var(--font-display); color: var(--ink); }
        .mix-card.is-flipped { border-color: var(--olive-ink); }
        .mix-actions { display: flex; justify-content: center; align-items: center; gap: 12px; flex-wrap: wrap; }
        .mix-actions .c-btn--lg { min-width: 150px; }
        @media (max-width: 639px) { .mix-card { min-height: 280px; } .mix-actions .c-btn--lg { flex: 1; min-width: 0; } }
      `}</style>
    </div>
  );
}
