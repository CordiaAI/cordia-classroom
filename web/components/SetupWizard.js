import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import LearningStylePicker from './LearningStylePicker';
import { useLearningStyle } from '../lib/learningStyle';
import { loadOnboarding, saveOnboardingStep, smartNotesTourUrl } from '../lib/onboarding';

const STORE_URL = 'https://chromewebstore.google.com/detail/autostudyai/eddmfjcnfjfbaknmeccjbjdgpeipjbaf';
const ORDER = ['style', 'extension', 'extension_use', 'create', 'smartnotes', 'practice'];
const TRANSITION_MS = 260;

function extensionInstalled() {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-asai-extension') === 'ready';
}

function isPhone() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches;
}

// First-run setup, shown once per account (existing accounts included) and resumable.
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
    setStep(steps.includes(progress.step) ? progress.step : steps[0]);
  }, [progress, learningStyle]);

  if (!progress || progress.completed || !step || typeof document === 'undefined') return null;

  // Collapse the window into its center, swap the page, then open it back out.
  function goTo(nextStep) {
    saveOnboardingStep(nextStep);
    setPhase('out');
    timer.current = setTimeout(() => { setStep(nextStep); setPhase('in'); }, TRANSITION_MS);
  }

  function nextStep() {
    const position = steps.indexOf(step);
    goTo(steps[position + 1] || 'practice');
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

  async function startSmartNotesTour() {
    setBusy(true);
    await saveOnboardingStep('smartnotes');
    router.push(await smartNotesTourUrl());
  }

  const phone = isPhone();
  const position = steps.indexOf(step);
  const pages = {
    style: {
      title: 'How do you like to study?',
      body: <>
        <p className="setup-wizard-lead">Pick what feels right. You can change it anytime in Settings.</p>
        <LearningStylePicker value={learningStyle?.style || null} onSelect={style => saveStyle(style)} />
      </>,
      actions: <button type="button" className="btn" onClick={nextStep}>{learningStyle?.style ? 'Continue' : 'Skip for now'}</button>,
    },
    extension: {
      title: 'Add the Chrome extension',
      body: <>
        <p className="setup-wizard-lead">The extension turns any lecture page, slideshow, or PDF into a study guide in one click.</p>
        {phone
          ? <p className="setup-wizard-note">Extensions install from Chrome on a computer. You can add it later from the account menu.</p>
          : installed
            ? <p className="setup-wizard-done">✓ The extension is installed.</p>
            : <a className="btn setup-wizard-store" href={STORE_URL} target="_blank" rel="noreferrer">Open Chrome Web Store <span aria-hidden="true">↗</span></a>}
        <div className="setup-wizard-warning" role="note">
          <p>Some .edu email accounts won&apos;t allow extension installs. No worries:</p>
          <ol>
            <li>Click your Google profile picture in the top right of that page.</li>
            <li>Select your personal account.</li>
            <li>Install the extension!</li>
          </ol>
        </div>
      </>,
      actions: <button type="button" className="btn" onClick={nextStep}>Next</button>,
    },
    extension_use: {
      title: 'Capture any lecture',
      body: <ol className="setup-wizard-steps">
        <li><strong>Pin it.</strong> Click Chrome&apos;s puzzle-piece icon, then the pin next to CordiaClassroom.</li>
        <li><strong>Open your material.</strong> A Canvas page, lecture slides, a PDF, or a reading.</li>
        <li><strong>Click the CordiaClassroom icon</strong>, then <strong>Make study guide</strong>, and save it to Classroom.</li>
      </ol>,
      actions: <>
        <button type="button" className="btn-outline" onClick={() => leaveFor('/install-extension', 'create')} disabled={busy}>Full install guide</button>
        <button type="button" className="btn" onClick={nextStep}>Next</button>
      </>,
    },
    create: {
      title: 'No extension? No problem',
      body: <p className="setup-wizard-lead">Or create a study guide by uploading a file (PDF, slides, or document) or by typing your material in manually.</p>,
      actions: <>
        <button type="button" className="btn-outline" onClick={() => leaveFor('/create', 'smartnotes')} disabled={busy}>Create a study guide</button>
        <button type="button" className="btn" onClick={nextStep}>Next</button>
      </>,
    },
    smartnotes: {
      title: 'Take notes with SmartNotes',
      body: <p className="setup-wizard-lead">A quick tour of the notes editor, the lecture file viewer, and visual diagrams. Click anywhere to move through it.</p>,
      actions: <button type="button" className="btn" onClick={startSmartNotesTour} disabled={busy}>Show me SmartNotes</button>,
    },
    practice: {
      title: 'Practice what you learned',
      body: <p className="setup-wizard-lead">A quick tour of Practice: generating problems, revealing your guide when stuck, and getting help from the Tutor.</p>,
      actions: <button type="button" className="btn" onClick={() => leaveFor('/practice?tour=1', 'practice')} disabled={busy}>Show me Practice</button>,
    },
  };
  const page = pages[step];

  return createPortal(
    <div className="setup-wizard-backdrop">
      <section className="setup-wizard" data-phase={phase} role="dialog" aria-modal="true" aria-labelledby="setup-wizard-title">
        <header className="setup-wizard-header">
          <span className="setup-wizard-progress">Step {position + 1} of {steps.length}</span>
          <button type="button" className="setup-wizard-skip" onClick={finish} disabled={busy}>Skip setup</button>
        </header>
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
