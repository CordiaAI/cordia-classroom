import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, getToken } from '../lib/api';
import { loadOnboarding } from '../lib/onboarding';
import { pendingSteps } from '../lib/featureOnboarding.mjs';
import { claimSurface, dismissFeature, releaseSurface, useWhatsNew } from '../lib/whatsNew';
import { FEEDBACK, prefKey } from '../lib/submitQuiz.mjs';
import { setPref } from '../lib/progress';
import { MEMORY_STYLES } from './AboutYou';

// One feature step at a time for students who onboarded before that feature shipped
// (lib/featureOnboarding.mjs). "Not now" dismisses it for good, like finishing it. Finished steps are
// kept with What's new's seen lists, and a step takes What's new's one announcement surface, so a
// step and a What's new card or tip never show together.
const HIDDEN_ON = ['/learn/[guideId]', '/quiz/[guideId]', '/session', '/flashcards/study', '/nclex/[guideId]', '/practice/[guideId]'];

function MemoryStyle({ onDone }) {
  const [value, setValue] = useState('');
  async function save() {
    await apiFetch('/onboarding/answers', { method: 'POST', body: JSON.stringify({ answers: [{ question_id: 'memory_style', version: 1, answer: { value }, source: 'settings' }] }) });
    onDone();
  }
  return (
    <>
      <p className="fo-body">After a miss, Help me remember gives you a memory trick. Pick the kind that sticks for you.</p>
      <div className="fo-choices" role="radiogroup" aria-label="Memory trick style">
        {MEMORY_STYLES.map(style => (
          <button key={style.value} type="button" role="radio" aria-checked={value === style.value} className={'c-chip' + (value === style.value ? ' is-on' : '')} onClick={() => setValue(style.value)}>{style.label}</button>
        ))}
      </div>
      <div className="fo-actions"><button type="button" className="c-btn c-btn--primary" disabled={!value} onClick={save}>Save</button></div>
    </>
  );
}

function FeedbackTiming({ onDone }) {
  const [value, setValue] = useState('each');
  return (
    <>
      <p className="fo-body">Quiz can tell you after each question, or hold every answer until you submit, like a real test. You can change this on the quiz screen any time.</p>
      <div className="fo-choices" role="radiogroup" aria-label="Show if I'm right">
        {Object.entries(FEEDBACK).map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} className={'c-chip' + (value === key ? ' is-on' : '')} onClick={() => setValue(key)}>{label}</button>
        ))}
      </div>
      <div className="fo-actions"><button type="button" className="c-btn c-btn--primary" onClick={() => { setPref(prefKey('quiz'), value); onDone(); }}>Save</button></div>
    </>
  );
}

const BODIES = { 'step-memory-style': MemoryStyle, 'step-feedback-timing': FeedbackTiming };

export default function FeatureOnboarding() {
  const router = useRouter();
  const whatsNew = useWhatsNew();
  const [onboarding, setOnboarding] = useState(null);
  const [shown, setShown] = useState(false); // holds the shared announcement surface

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    loadOnboarding().then(data => { if (alive) setOnboarding(data); });
    return () => { alive = false; };
  }, []);

  const queue = whatsNew.ready ? pendingSteps(onboarding, whatsNew.seen).filter(item => BODIES[item.id]) : [];
  const step = HIDDEN_ON.includes(router.pathname) ? null : queue[0];

  useEffect(() => {
    if (step && !shown) setShown(claimSurface('feature-step'));
    if (!step && shown) { releaseSurface('feature-step'); setShown(false); }
  }, [step?.id, shown]);
  useEffect(() => () => releaseSurface('feature-step'), []);

  if (!step || !shown) return null;
  const Body = BODIES[step.id];

  function finish() {
    dismissFeature(step.id);
  }

  return (
    <section className="c-card fo" role="dialog" aria-labelledby="fo-title" aria-live="polite">
      <div className="fo-head">
        <span className="fo-kicker">New{queue.length > 1 ? ` · 1 of ${queue.length}` : ''}</span>
        <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={finish}>Not now</button>
      </div>
      <h2 id="fo-title" className="fo-title">{step.title}</h2>
      <Body onDone={finish} />
      <style jsx>{`
        .fo { position: fixed; z-index: 60; right: max(var(--space-4), env(safe-area-inset-right, 0px)); bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px)); width: min(400px, calc(100vw - 2 * var(--space-4))); display: grid; gap: var(--space-3); padding: var(--space-5); }
        .fo-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
        .fo-kicker { color: var(--olive-ink); font: 700 var(--fs-13)/1 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; }
        .fo-title { margin: 0; font: 500 var(--fs-20)/1.25 var(--font-display); color: var(--ink); }
        .fo :global(.fo-body) { margin: 0; color: var(--muted); font: 500 var(--fs-15)/1.45 var(--font-sans); }
        .fo :global(.fo-choices) { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .fo :global(.fo-choices .is-on) { background: var(--olive-tint); border-color: var(--olive); color: var(--olive-ink); }
        .fo :global(.fo-actions) { display: flex; justify-content: flex-end; }
        @media (max-width: 767px) { .fo { bottom: calc(var(--tabbar-h, 64px) + var(--space-3) + env(safe-area-inset-bottom, 0px)); } }
      `}</style>
    </section>
  );
}
