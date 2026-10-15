import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, History, PencilRuler, Play, RefreshCw, Sparkles } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';
import PracticeProblem from './PracticeProblem';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const historyKey = guideId => `practiceHistory:${guideId}`;

function readableText(value) {
  return String(value || '')
    .replace(/<\/?(?:p|div|li|h[1-6]|blockquote|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .trim();
}

function readHistory(guideId) {
  try { return JSON.parse(localStorage.getItem(historyKey(guideId)) || '[]'); } catch { return []; }
}

function writeHistory(guideId, list) {
  try { localStorage.setItem(historyKey(guideId), JSON.stringify(list.slice(0, 20))); } catch { /* storage blocked */ }
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Practice: pick a guide, then a fresh run through its 10 problems. Past runs are in History.
export default function PracticeWorkspace({ guideId: guideIdProp, embedded = false }) {
  const router = useRouter();
  const guideId = guideIdProp || router.query.guideId || null;
  const { ready } = useRequireAuth();
  const [guide, setGuide] = useState(null);
  const [guideOptions, setGuideOptions] = useState(null);
  const [saved, setSaved] = useState(undefined);
  const [problems, setProblems] = useState([]);
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [evaluations, setEvaluations] = useState({});
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready || guideId) return;
    apiFetch('/guides?fields=summary&limit=500').then(data => setGuideOptions(Array.isArray(data?.guides) ? data.guides : []));
  }, [ready, guideId]);

  useEffect(() => {
    if (!ready || !guideId) return;
    setRunning(false);
    setHistory(readHistory(guideId));
    apiFetch('/guides/' + guideId).then(data => {
      if (data?.guide) setGuide(data.guide);
      else setError(apiErrorMessage(data?.detail, "Couldn't open this guide."));
    });
    apiFetch('/practice/' + guideId + '/state').then(data => {
      const practice = data?.practice;
      setSaved(Array.isArray(practice?.problems) && practice.problems.length ? practice : null);
    });
    walkthroughEvent('practice-opened');
  }, [ready, guideId]);

  // Progress is saved so Today knows which problems are still open.
  useEffect(() => {
    if (!running || !guideId || !problems.length) return undefined;
    const timer = setTimeout(() => {
      apiFetch('/practice/' + guideId + '/state', { method: 'PUT', body: JSON.stringify({ progress: { problemIndex: index, answers, evaluations } }) });
    }, 1000);
    return () => clearTimeout(timer);
  }, [running, index, answers, evaluations, problems, guideId]);

  function archive(practice) {
    const evals = practice?.progress?.evaluations || {};
    const done = Object.values(evals).filter(item => item?.status === 'correct' || item?.status === 'retry');
    if (!done.length) return;
    const entry = { at: practice.updated_at || new Date().toISOString(), correct: done.filter(item => item.status === 'correct').length, total: practice.problems.length };
    const next = [entry, ...readHistory(guideId)];
    writeHistory(guideId, next);
    setHistory(next);
  }

  function begin(list) {
    setProblems(list);
    setIndex(0);
    setAnswers({});
    setEvaluations({});
    setRunning(true);
  }

  function start() {
    archive(saved);
    begin(saved.problems);
  }

  async function newSet() {
    if (saved) archive(saved);
    setLoading(true);
    setError('');
    const data = await apiFetch('/practice', { method: 'POST', timeoutMs: 120000, body: JSON.stringify({ guide_id: guideId }) });
    setLoading(false);
    if (Array.isArray(data?.problems) && data.problems.length) {
      setSaved({ problems: data.problems });
      begin(data.problems);
    } else {
      setError(apiErrorMessage(data?.detail, "Couldn't make a practice set. Try again."));
    }
  }

  function finish() {
    const correct = Object.values(evaluations).filter(item => item?.status === 'correct').length;
    const next = [{ at: new Date().toISOString(), correct, total: problems.length }, ...history];
    writeHistory(guideId, next);
    setHistory(next);
    setSaved(current => current && { ...current, progress: {} });
    setRunning(false);
  }

  const sourceBlocks = useMemo(() => readableText(guide?.study_guide || guide?.notes).split(/\n\s*\n/).filter(block => block.trim()), [guide]);

  if (!ready) return null;

  // Pick a guide first.
  if (!guideId) {
    return (
      <div className="c-page practice-pick">
        <header className="c-page-head"><h1 className="c-title">Practice</h1></header>
        {!guideOptions ? (
          <div className="practice-grid">{[0, 1, 2, 3].map(key => <div key={key} className="c-skeleton" style={{ height: 112, borderRadius: 20 }} />)}</div>
        ) : guideOptions.length ? (
          <div className="practice-grid" data-spot="practice-picker">
            {guideOptions.map(option => (
              <Link key={option.id} href={'/guide/' + option.id + '?tab=practice'} className="c-card practice-guide">
                <PencilRuler {...ICON} />
                <span>{option.title || 'Untitled guide'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="c-empty"><button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}>Add material</button></div>
        )}
        <style jsx global>{`
          .practice-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
          .practice-guide { display: grid; align-content: space-between; gap: 16px; min-height: 112px; padding: 18px; color: var(--ink); text-decoration: none; font: 500 17px/1.3 var(--font-display); }
          .practice-guide:hover { text-decoration: none; border-color: var(--olive); }
        `}</style>
      </div>
    );
  }

  const current = problems[index];
  const last = index >= problems.length - 1;

  return (
    <div className={'practice' + (embedded ? ' is-embedded' : ' c-page')}>
      {!embedded && (
        <header className="practice-head">
          <button type="button" className="c-icon-btn" onClick={() => router.push('/guide/' + guideId)} aria-label="Back to guide" title="Back to guide"><ArrowLeft {...ICON} /></button>
          <h1 className="c-title c-truncate">{guide?.title || 'Practice'}</h1>
        </header>
      )}
      {error && <p className="practice-error" role="alert">{error}</p>}

      {running && current ? (
        <div className="practice-layout">
          <div className="practice-main">
            <div className="c-bar practice-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={problems.length} aria-valuenow={index + 1}>
              <span style={{ width: `${((index + (evaluations[index] ? 1 : 0)) / problems.length) * 100}%` }} />
            </div>
            <PracticeProblem
              key={index}
              problem={current}
              index={index}
              total={problems.length}
              guideId={guideId}
              answer={answers[index] || ''}
              onAnswer={value => setAnswers(all => ({ ...all, [index]: value }))}
              evaluation={evaluations[index]}
              onEvaluate={value => setEvaluations(all => ({ ...all, [index]: value }))}
              onNext={last ? finish : () => setIndex(value => value + 1)}
              nextLabel={last ? 'Finish' : 'Next'}
            />
          </div>
          <aside className="c-card practice-source" aria-label="Source">
            <h2 className="c-section-title">Source</h2>
            <div className="practice-source-copy">
              {sourceBlocks.map((block, key) => <p key={key}>{block}</p>)}
            </div>
          </aside>
        </div>
      ) : (
        <section className="c-card practice-start" aria-label="Practice">
          {saved === undefined ? (
            <div className="c-skeleton" style={{ height: 52, borderRadius: 999 }} />
          ) : (
            <div className="practice-start-actions">
              {saved && <button type="button" className="c-btn c-btn--primary" onClick={start}><Play {...ICON} />Start</button>}
              <button type="button" className={'c-btn ' + (saved ? 'c-btn--secondary' : 'c-btn--primary')} onClick={newSet} disabled={loading}>
                {saved ? <RefreshCw {...ICON} /> : <Sparkles {...ICON} />}{loading ? 'Making…' : 'New set'}
              </button>
            </div>
          )}
          {history.length > 0 && (
            <div className="practice-history">
              <h2 className="c-section-title"><History {...ICON} />History</h2>
              <ul>
                {history.map((item, key) => (
                  <li key={key}><span>{shortDate(item.at)}</span><span className="practice-score">{item.correct} / {item.total}</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <style jsx global>{`
        .practice { display: grid; gap: 16px; }
        .practice-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .practice-error { margin: 0; padding: 12px 16px; border-radius: 12px; background: var(--error-bg); color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .practice-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 16px; align-items: start; }
        .practice-main { display: grid; gap: 12px; min-width: 0; }
        .practice-progress span { transition: width 200ms ease-out; }
        .practice-source { position: sticky; top: calc(var(--bar-h) + 16px); max-height: calc(100vh - var(--bar-h) - 32px); overflow: auto; display: grid; align-content: start; gap: 8px; padding: 20px; }
        .practice-source h2 { margin: 0; }
        .practice-source-copy p { margin: 0 0 12px; font: 400 16px/1.6 var(--font-display); color: var(--ink); white-space: pre-wrap; }
        .practice-start { display: grid; gap: 24px; padding: 24px; }
        .practice-start-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .practice-history h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
        .practice-history ul { list-style: none; margin: 0; padding: 0; display: grid; }
        .practice-history li { display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); font: 500 15px/1.3 var(--font-sans); color: var(--ink); }
        .practice-score { font-variant-numeric: tabular-nums; font-weight: 700; }
        @media (max-width: 1023px) {
          .practice-layout { grid-template-columns: minmax(0, 1fr); }
          .practice-source { position: static; max-height: none; }
        }
      `}</style>
    </div>
  );
}
