import { useRef, useState } from 'react';
import Link from 'next/link';
import { Hammer, Link2, Paperclip, Play } from 'lucide-react';
import { apiFetch } from '../lib/api';
import CordiaLoader, { useWorkingMark } from './CordiaLoader';

// The buttons under a Tutor study plan (backend services/study_helper.plan_reply): start the check-in
// in Learn, ask the Tutor to build the Learn set, build an exam's review set from Canvas, or attach notes.
// The first button is the next step (primary); the rest are secondary. tutor: lib/useTutorChat.js.
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };
const ICONS = { checkin: Play, build: Hammer, canvas_review: Hammer, attach: Paperclip, link: Link2 };
const insideApp = href => typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');

export function learnLink(guideId, testDate) {
  const query = new URLSearchParams();
  if (testDate) query.set('test', testDate);
  query.set('checkin', '1');
  return `/learn/${encodeURIComponent(guideId)}?${query}`;
}

export default function StudyPlanActions({ plan, tutor, latest }) {
  const [working, setWorking] = useState('');
  const [problem, setProblem] = useState('');
  // The working mark replaces the label after 300ms and stays at least 500ms (useWorkingMark), on the
  // button that was pressed.
  const marked = useWorkingMark(Boolean(working));
  const pressed = useRef('');
  if (working) pressed.current = working;
  const actions = (plan?.actions || []).filter(action => action.kind !== 'link' || insideApp(action.href));
  if (!actions.length) return null;

  // Builds the exam's review set from the class's Canvas material (POST /plans/{key}/review-set), then opens its check-in.
  async function buildFromCanvas(action) {
    setWorking(action.kind);
    setProblem('');
    let timeZone = '';
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* the server's zone */ }
    const made = await apiFetch(`/plans/${encodeURIComponent(action.item_key)}/review-set`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone }) });
    if (made?.guide?.id) {
      tutor.router.push(learnLink(made.guide.id, plan.test_date || String(made.due_at || '').slice(0, 10)));
      return;
    }
    setWorking('');
    setProblem(typeof made?.detail === 'string' ? made.detail : 'The review set could not be built. Try again, or attach your notes instead.');
  }

  function run(action) {
    if (action.kind === 'build') window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { prompt: action.prompt, send: true } }));
    if (action.kind === 'attach') tutor.fileRef.current?.click();
    if (action.kind === 'canvas_review') buildFromCanvas(action);
  }

  return (
    <div className="plan-actions">
      <div className="plan-row">
        {actions.map((action, index) => {
          const Icon = ICONS[action.kind] || Play;
          // One olive button per view: only the latest plan's next step is primary.
          const tone = index === 0 && latest ? 'c-btn--primary' : 'c-btn--secondary';
          const body = <><Icon {...ICON} /><span>{action.label}</span></>;
          if (action.kind === 'checkin' || action.kind === 'link') {
            return insideApp(action.href) && <Link key={action.kind + index} href={action.href} className={`c-btn c-btn--sm ${tone} plan-btn`}>{body}</Link>;
          }
          // Asking the Tutor or opening the file picker only makes sense from the latest reply.
          // The working button keeps its look (aria-disabled, ignored clicks) so its mark stays readable; the rest disable.
          const busy = working === action.kind;
          const showMark = marked && pressed.current === action.kind;
          const off = !busy && (Boolean(working) || tutor.busy || (!latest && action.kind !== 'canvas_review'));
          return (
            <button key={action.kind + index} type="button" className={`c-btn c-btn--sm ${tone} plan-btn${busy ? ' is-busy' : ''}${showMark ? ' is-marked' : ''}`}
              onClick={() => { if (!working && !marked) run(action); }} disabled={off} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
              <span className="plan-face">{body}</span>
              {(busy || showMark) && <span className="plan-spinner"><CordiaLoader size={18} label={`${action.label}: working`} /></span>}
            </button>
          );
        })}
      </div>
      {problem && <p className="plan-problem" role="alert">{problem}</p>}
      <style jsx>{`
        .plan-actions { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0.625rem; }
        .plan-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .plan-actions :global(.plan-btn.is-busy) { cursor: progress; }
        .plan-actions :global(.plan-btn) { position: relative; padding: 0 var(--space-4); font-family: var(--font-sans); font-size: 0.875rem; }
        /* Phones and touch screens: a 44px tap target. */
        @media (max-width: 767px), (pointer: coarse) { .plan-actions :global(.plan-btn) { height: 2.75rem !important; min-height: 2.75rem !important; } }
        .plan-face { display: inline-flex; align-items: center; gap: var(--space-2); }
        /* Pressed: disabled at once. After 300ms (is-marked) the mark replaces the label, which keeps its
           width, so nothing moves while it works. With reduced motion it shows without the fade. */
        .is-marked .plan-face { visibility: hidden; }
        .plan-spinner { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; }
        .is-marked .plan-spinner { opacity: 1; animation: plan-show 150ms var(--ease); }
        @keyframes plan-show { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .is-marked .plan-spinner { animation: none; } }
        .plan-problem { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--r-input); background: var(--error-bg); color: var(--error); font: 500 0.8125rem/1.45 var(--font-sans); }
      `}</style>
    </div>
  );
}
