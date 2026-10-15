import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import LearningStylePicker from './LearningStylePicker';
import { useLearningStyle } from '../lib/learningStyle';
import { loadOnboarding, practiceTourUrl, saveOnboardingStep, smartNotesTourUrl } from '../lib/onboarding';
import { STYLE_OPTIONS } from '../lib/learningStyle';
import { EXTENSION_STORE_URL } from '../lib/extension';
import AcademicInfinityMark from './AcademicInfinityMark';

// Three screens: pick a style, make a first guide (extension first), see what most students miss.
const ORDER = ['style', 'first_guide', 'unlocked'];
// Accounts saved mid-way through the old six-step wizard resume at the closest new screen.
const LEGACY = { extension: 'first_guide', extension_use: 'first_guide', create: 'first_guide', smartnotes: 'unlocked', practice: 'unlocked' };
const TRANSITION_MS = 260;

function extensionInstalled() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-asai-extension') === 'ready';
}

function isPhone() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;
}

// First-run setup, shown once per account (existing accounts included) and resumable.
// Users who finish or skip it keep a dashboard checklist (GettingStarted) for the same features.
// Rendered at the document root so no transformed page layout can move it off-center.
export default function SetupWizard() {
  const router = useRouter();
  const { learningStyle, saveStyle } = useLearningStyle();
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState(null);
  const [phase, setPhase] = useState('in');
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let active = true;
    loadOnboarding().then(data => { if (active) setProgress(data); });
    setInstalled(extensionInstalled());
    const onMessage = event => { if (event.data?.type === 'ASAI_EXTENSION_READY') setInstalled(true); };
    window.addEventListener('message', onMessage);
    return () => { active = false; window.removeEventListener('message', onMessage); clearTimeout(timer.current); };
  }, []);

  const stylesOn = Boolean(learningStyle?.enabled);
  const steps = ORDER.filter(id => id !== 'style' || stylesOn);

  useEffect(() => {
    if (!progress || progress.completed || !learningStyle || step) return;
    const saved = LEGACY[progress.step] || progress.step;
    setStep(steps.includes(saved) ? saved : steps[0]);
  }, [progress, learningStyle]);

  if (!progress || progress.completed || !step || typeof document === 'undefined') return null;

  // Ease the current step away, then reveal the next within the same glass window.
  function goTo(nextStep) {
    saveOnboardingStep(nextStep);
    setPhase('out');
    timer.current = setTimeout(() => { setStep(nextStep); setPhase('in'); }, TRANSITION_MS);
  }

  function nextStep() {
    const position = steps.indexOf(step);
    goTo(steps[position + 1] || 'unlocked');
  }

  async function finish() {
    setBusy(true);
    await saveOnboardingStep('done');
    setProgress({ step: 'done', completed: true });
  }

  async function leaveFor(path, savedStep) {
    setBusy(true);
    await saveOnboardingStep(savedStep);
    router.push(path);
  }

  async function startPracticeTour() {
    setBusy(true);
    await saveOnboardingStep('done');
    router.push(await practiceTourUrl());
  }

  async function startSmartNotesTour() {
    setBusy(true);
    await saveOnboardingStep('done');
    router.push(await smartNotesTourUrl());
  }

  const phone = isPhone();
  const position = steps.indexOf(step);
  const chosen = STYLE_OPTIONS.find(option => option.id === learningStyle?.style);
  const pages = {
    style: {
      title: 'How do you like to study?',
      body: <>
        <p className="setup-wizard-lead">Every study guide question gets a <strong>Learn it your way</strong> button that teaches it in this style. Change it anytime in Settings.</p>
        <LearningStylePicker value={learningStyle?.style || null} onSelect={style => saveStyle(style)} />
      </>,
      actions: <button type="button" className="btn" onClick={nextStep}>{learningStyle?.style ? 'Continue' : 'Skip for now'}</button>,
    },
    first_guide: phone ? {
      title: 'Make your first study guide',
      body: <p className="setup-wizard-lead">Upload lecture slides, a PDF, or a doc. On a computer, the Chrome extension does this in one click from any Canvas page.</p>,
      actions: <button type="button" className="btn" onClick={() => leaveFor('/create', 'unlocked')} disabled={busy}>Upload a file</button>,
    } : {
      title: 'Make guides in one click',
      body: <>
        <p className="setup-wizard-lead">Skip downloading and uploading. The extension reads the Canvas page, slides, or PDF you already have open.</p>
        <ol className="setup-wizard-quick">
          <li className={installed ? 'done' : ''}>
            <span className="setup-wizard-num">{installed ? '✓' : '1'}</span>
            <div>
              <strong>{installed ? 'Extension added' : 'Add it to Chrome'}</strong>
              {installed
                ? <span>Pin it: puzzle-piece icon → pin CordiaClassroom.</span>
                : <a className="btn setup-wizard-store" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">Add to Chrome, free <span aria-hidden="true">↗</span></a>}
            </div>
          </li>
          <li><span className="setup-wizard-num">2</span><div><strong>Open any lecture</strong><span>A Canvas page, slides, or a PDF in your browser.</span></div></li>
          <li><span className="setup-wizard-num">3</span><div><strong>Click the Cordia icon → Make study guide</strong><span>It saves straight to your Classroom.</span></div></li>
        </ol>
        {!installed && <details className="setup-wizard-help">
          <summary>Some .edu email accounts won&apos;t allow extension installs</summary>
          <p>On the Chrome Web Store, click your profile picture (top right), switch to your personal Google account, then add it.</p>
          <button type="button" className="setup-wizard-link" onClick={() => leaveFor('/install-extension', 'first_guide')} disabled={busy}>Full install guide</button>
        </details>}
      </>,
      actions: <>
        <button type="button" className="setup-wizard-link" onClick={() => leaveFor('/create', 'unlocked')} disabled={busy}>Upload a file instead</button>
        <button type="button" className="btn" onClick={nextStep}>{installed ? 'Next' : 'I added it'}</button>
      </>,
    },
    unlocked: {
      title: '3 things most students miss',
      body: <div className="setup-wizard-features">
        <article>
          <span className="setup-wizard-tag">Learn it your way</span>
          <strong>Stuck on a question? It re-teaches it {chosen ? `as ${chosen.label.toLowerCase()}` : 'your way'}.</strong>
          <p>{chosen ? chosen.uses[chosen.uses.length - 1] + '.' : 'Diagrams, audio, notes, or real-life examples.'} Look for <em>Learn it your way →</em> under every guide question.</p>
        </article>
        <article>
          <span className="setup-wizard-tag">Practice</span>
          <strong>Math and problem sets, written from your class.</strong>
          <p>New problems from your own material. Check each answer, reveal the guide when stuck, ask the Tutor why.</p>
          <button type="button" className="setup-wizard-link" onClick={startPracticeTour} disabled={busy}>Show me →</button>
        </article>
        <article>
          <span className="setup-wizard-tag">SmartNotes</span>
          <strong>Type messy notes in lecture. Get a clean guide.</strong>
          <p>One click turns your notes into a study guide, with diagrams and your lecture file side by side.</p>
          <button type="button" className="setup-wizard-link" onClick={startSmartNotesTour} disabled={busy}>Show me →</button>
        </article>
      </div>,
      actions: <button type="button" className="btn" onClick={finish} disabled={busy}>Go to my Classroom</button>,
    },
  };
  const page = pages[step];

  return createPortal(
    <div className="setup-wizard-backdrop">
      <section className="setup-wizard" data-phase={phase} role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
        <header className="setup-wizard-header">
          <div className="setup-wizard-brand"><AcademicInfinityMark /><span>cordia</span></div>
          {position > 0 && <button type="button" className="setup-wizard-skip" onClick={finish} disabled={busy}>Do this later</button>}
        </header>
        <span className="setup-wizard-progress">Your classroom · Step {position + 1} of {steps.length}</span>
        <h2 id="setup-wizard-title">{page.title}</h2>
        <div className="setup-wizard-body">{page.body}</div>
        <footer className="setup-wizard-footer">
          <div className="setup-wizard-dots" aria-hidden="true">
            {steps.map((id, index) => <span key={id} className={index === position ? 'active' : index < position ? 'done' : ''} />)}
          </div>
          <div className="setup-wizard-actions">
            {position > 0 && <button type="button" className="setup-wizard-back" onClick={() => goTo(steps[position - 1])}>Back</button>}
            {page.actions}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
