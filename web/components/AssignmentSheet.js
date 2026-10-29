import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpenCheck, CalendarClock, ListChecks, MessageCircle, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import DoneCheck from './DoneCheck';
import DraftLink from './DraftLink';
import RepoLink from './RepoLink';
import { SectionLoader } from './CordiaLoader';
import { buildExamReview, getPlan, makePlan, minutesLabel, removePlan, schedulePlan, setStepDone } from '../lib/studyPlans';
import { useRouter } from 'next/router';
import { dayKey } from '../lib/learnEngine.mjs';
import { deadlineTitle } from '../lib/formatters';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };

function when(value, withTime = false) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], withTime ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric' });
}

// One assignment: how long it should take, its steps (each due before the deadline), study time
// placed in free time, the rubric, and a way into the Tutor with all of it loaded.
export default function AssignmentSheet({ item, onClose }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRubric, setShowRubric] = useState(false);
  const plan = data?.plan;

  useEffect(() => {
    let live = true;
    getPlan(item.id).then(result => { if (live) setData(result && !result.detail ? result : { plan: null }); });
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { live = false; window.removeEventListener('keydown', onKey); };
  }, [item.id, onClose]);

  async function run(kind, action, success) {
    setBusy(kind); setError(''); setNotice('');
    const result = await action();
    setBusy('');
    if (!result || result.detail) { setError(result?.detail || "That didn't work. Try again."); return; }
    setData(current => ({ ...current, plan: result.plan ?? null }));
    if (success) setNotice(success(result));
  }

  const breakDown = () => run('plan', () => makePlan(item.id));
  const schedule = () => run('schedule', () => schedulePlan(item.id), result => (result.added
    ? `Added ${result.added} study block${result.added === 1 ? '' : 's'} before it's due.`
    : 'Your study time already covers this.'));
  const startOver = () => run('reset', async () => ((await removePlan(item.id))?.ok ? { plan: null } : null));
  const router = useRouter();
  // Exams: gather the class's material into one review set, then learn it paced to the exam date.
  async function reviewSet() {
    setBusy('review'); setError(''); setNotice('');
    const result = await buildExamReview(item.id);
    setBusy('');
    if (result?.guide?.id) router.push(`/learn/${result.guide.id}?test=${dayKey(result.due_at || item.due_at)}`);
    else setError(result?.detail || "That didn't work. Try again.");
  }

  const tutorHref = `/tutor?assignment=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title || '')}`;
  const scheduled = (plan?.blocks || []).reduce((sum, block) => sum + (new Date(block.ends_at) - new Date(block.starts_at)) / 60000, 0);

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <div className="c-sheet as-sheet" role="dialog" aria-modal="true" aria-labelledby="as-title" onClick={event => event.stopPropagation()}>
          <div className="c-sheet-head">
            <div className="as-head">
              <h2 id="as-title" className="c-section-title">{deadlineTitle(item)}</h2>
              <p className="c-meta">{[item.course, item.due_at && `Due ${when(item.due_at, true)}`, data?.points != null && `${data.points} points`].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
          {data?.missing && <p className="as-warn" role="status">Canvas shows this as missing.</p>}

          {data === null ? <SectionLoader label="Loading plan" /> : !plan ? (
            <div className="as-empty">
              <p className="c-meta">Break it into steps with their own due dates, then put study time on your calendar.</p>
              <button type="button" className="c-btn c-btn--primary" onClick={breakDown} disabled={Boolean(busy)}>
                <ListChecks {...ICON} />{busy === 'plan' ? 'Breaking it down…' : 'Break it down'}
              </button>
              {item.type === 'exam' && (
                <button type="button" className="c-btn c-btn--secondary" onClick={reviewSet} disabled={Boolean(busy)}>
                  <BookOpenCheck {...ICON} />{busy === 'review' ? 'Gathering…' : 'Build review set'}
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="as-effort"><strong>About {minutesLabel(plan.effort_minutes)}</strong><span className="c-meta">{plan.effort_basis}</span></p>
              <ol className="as-steps">
                {plan.steps.map(step => (
                  <li key={step.id} className={'as-step' + (step.done ? ' is-done' : '')}>
                    <DoneCheck id={step.id} title={step.title} done={step.done} save={(id, done) => setStepDone(item.id, id, done)}
                      onChange={done => setData(current => ({ ...current, plan: { ...current.plan, steps: current.plan.steps.map(s => (s.id === step.id ? { ...s, done } : s)) } }))} />
                    <span className="c-grow">
                      <span className="as-step-title">{step.title}</span>
                      <span className="c-meta">{[minutesLabel(step.minutes), step.due_at && `by ${when(step.due_at)}`].filter(Boolean).join(' · ')}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {plan.blocks.length > 0 && (
                <div className="as-blocks">
                  <h3 className="as-subtitle">Study time · {minutesLabel(scheduled)}</h3>
                  <ul>{plan.blocks.map(block => (
                    <li key={block.id} className="c-meta">{when(block.starts_at, true)} · {minutesLabel((new Date(block.ends_at) - new Date(block.starts_at)) / 60000)}{block.status === 'moved' ? ' · moved by you' : ''}</li>
                  ))}</ul>
                </div>
              )}
              <div className="as-actions">
                <button type="button" className="c-btn c-btn--primary" onClick={schedule} disabled={Boolean(busy)}>
                  <CalendarClock {...ICON} />{busy === 'schedule' ? 'Finding time…' : plan.blocks.length ? 'Find more time' : 'Schedule study time'}
                </button>
                {item.type === 'exam' && (
                  <button type="button" className="c-btn c-btn--secondary" onClick={reviewSet} disabled={Boolean(busy)}>
                    <BookOpenCheck {...ICON} />{busy === 'review' ? 'Gathering…' : 'Build review set'}
                  </button>
                )}
                <Link href={tutorHref} className="c-btn c-btn--secondary"><MessageCircle {...ICON} />Ask Tutor</Link>
                <button type="button" className="c-btn c-btn--quiet" onClick={startOver} disabled={Boolean(busy)}>Start over</button>
              </div>
            </>
          )}
          {!plan && data !== null && <Link href={tutorHref} className="c-btn c-btn--quiet as-tutor"><MessageCircle {...ICON} />Ask Tutor about it</Link>}

          {data !== null && item.type !== 'exam' && <DraftLink item={item} draft={data?.draft} />}
          {data !== null && item.type !== 'exam' && <RepoLink item={item} repo={data?.repo} />}

          {Array.isArray(data?.rubric) && data.rubric.length > 0 && (
            <div className="as-rubric">
              <button type="button" className="c-btn c-btn--quiet c-btn--sm" aria-expanded={showRubric} onClick={() => setShowRubric(open => !open)}>
                {showRubric ? 'Hide rubric' : `Rubric · ${data.rubric.length} criteria`}
              </button>
              {showRubric && (
                <ol>{data.rubric.map((criterion, index) => (
                  <li key={index}><strong>{criterion.description}</strong>{criterion.points != null && <span className="c-meta"> · {criterion.points} pts</span>}
                    {criterion.long_description && <p className="c-meta">{criterion.long_description}</p>}</li>
                ))}</ol>
              )}
            </div>
          )}
          {notice && <p className="cn-notice" role="status">{notice}</p>}
          {error && <p className="cn-error" role="alert">{error}</p>}
        </div>
      </div>
      <style jsx>{`
        .as-sheet { width: min(560px, 100%); display: grid; gap: 16px; }
        .as-sheet .c-sheet-head { margin-bottom: 0; align-items: flex-start; }
        .as-head { display: grid; gap: 4px; min-width: 0; }
        .as-head .c-section-title, .as-head .c-meta { margin: 0; }
        .as-warn { margin: 0; padding: 10px 14px; border-radius: var(--r-row, 16px); background: var(--error-bg); color: var(--error); font-weight: 600; }
        .as-empty { display: grid; justify-items: start; gap: 12px; }
        .as-empty .c-meta { margin: 0; }
        .as-effort { display: grid; gap: 2px; margin: 0; }
        .as-steps { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
        .as-step { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; }
        .as-step .c-grow { display: grid; gap: 2px; }
        .as-step-title { font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
        .as-step.is-done .as-step-title { color: var(--muted); text-decoration: line-through; }
        .as-subtitle { margin: 0 0 4px; font: 600 14px/1.4 var(--font-sans); color: var(--muted); }
        .as-blocks ul, .as-rubric ol { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
        .as-rubric ol { margin-top: 8px; gap: 10px; }
        .as-rubric p { margin: 2px 0 0; }
        .as-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .as-sheet :global(.as-tutor) { justify-self: start; }
      `}</style>
    </BodyPortal>
  );
}
