import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Play } from 'lucide-react';
import Spotlight from './Spotlight';
import AboutYou from './AboutYou';
import FirstReview from './FirstReview';
import { useGuideJobs } from '../lib/guideJobs';
import { useProgress } from '../lib/progress';
import { DAY_ONE, MINI, WT_EVENT, activeStep, endWalkthrough, setWalkthrough } from '../lib/walkthrough';
import { saveOnboardingStep } from '../lib/onboarding';
import { lastGuide } from '../lib/userStore';

const OPTIONAL_WAIT_MS = 1500;

function stepsOf(wt) {
  return wt.id === 'day1' ? DAY_ONE : MINI[wt.id].steps.map(step => [step]);
}

function next(wt) {
  const steps = stepsOf(wt);
  const sub = (wt.sub || 0) + 1;
  if (steps[wt.step] && sub < steps[wt.step].length) return { ...wt, sub };
  return wt.step + 1 < steps.length ? { ...wt, step: wt.step + 1, sub: 0 } : null;
}

// Runs the active walkthrough: one spotlight at a time, advanced by real actions.
export default function Walkthrough() {
  const router = useRouter();
  const progress = useProgress();
  const wt = progress.wt?.status === 'active' ? progress.wt : null;
  const step = activeStep(wt);
  const wtRef = useRef(wt);
  wtRef.current = wt;
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && window.innerWidth < 768));
  }, []);

  function finish(status) {
    const current = wtRef.current;
    endWalkthrough(status);
    if (current?.id === 'day1') saveOnboardingStep('done');
  }

  function advance(from) {
    const following = next(from);
    if (following) setWalkthrough(following);
    else finish('done');
  }

  useEffect(() => {
    function onEvent(event) {
      const current = wtRef.current;
      const active = activeStep(current);
      if (!current || !active) return;
      if (event.detail?.name === active.on) advance(current);
    }
    window.addEventListener(WT_EVENT, onEvent);
    return () => window.removeEventListener(WT_EVENT, onEvent);
  }, []);

  // A step whose control may not exist (e.g. the Tutor never opened) moves on by itself.
  useEffect(() => {
    if (!step?.optionalTarget) return undefined;
    const timer = setTimeout(() => {
      if (!document.querySelector(step.target) && wtRef.current) advance(wtRef.current);
    }, OPTIONAL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [step?.id, step?.target, wt?.step, wt?.sub]);

  // Building: it moves on once the first guide is open. If it finished while the profile
  // questions were up, open it.
  const jobs = useGuideJobs();
  const built = jobs.find(job => job.status === 'done' && job.guideId);
  useEffect(() => {
    if (step?.id !== 'build') return;
    if (router.pathname === '/guide/[id]') advance(wtRef.current);
    else if (built) router.push('/guide/' + built.guideId);
  }, [step?.id, built?.guideId, router.pathname]);

  if (!wt || !step) return null;
  if (step.screen === 'about') return <AboutYou index={step.index} total={step.total} />;
  if (step.screen === 'first-review') return <FirstReview onDone={() => { finish('done'); router.push('/dashboard'); }} />;

  // The student wandered off the step's screen: one pill brings them back.
  if (step.where && !step.where(router.pathname)) {
    const guide = lastGuide();
    const route = step.where('/guide/[id]') ? (guide ? `/guide/${guide.id}` : '/library')
      : step.where('/dashboard') ? '/dashboard'
        : step.where('/quiz/[guideId]') && guide ? `/quiz/${guide.id}`
          : step.where('/practice') ? '/practice'
            : step.where('/canvas') ? '/canvas?tab=calendar'
              : step.where('/smartnotes') ? '/smartnotes'
                : guide ? `/guide/${guide.id}` : '/dashboard';
    return (
      <div className="wt-resume">
        <button type="button" className="c-btn c-btn--primary" onClick={() => router.push(route)}><Play size={20} strokeWidth={1.75} aria-hidden="true" />Resume</button>
        <button type="button" className="c-btn c-btn--secondary" onClick={() => finish('skipped')}>Skip</button>
        <style jsx>{`
          .wt-resume { position: fixed; z-index: 380; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; gap: 8px; padding: 6px; border-radius:999px; background: var(--glass); border: 1px solid var(--glass-edge); backdrop-filter: blur(24px) saturate(160%); box-shadow: var(--shadow); }
          @media (max-width: 767px) { .wt-resume { bottom: calc(var(--tabbar-h) + 84px); } }
        `}</style>
      </div>
    );
  }

  const label = step.label === 'flip' ? (coarse ? 'Tap to flip' : 'Press Space') : step.label;
  return (
    <Spotlight
      key={`${wt.id}:${wt.step}:${wt.sub || 0}`}
      target={step.target}
      label={label}
      index={step.index}
      total={step.total}
      passive={step.passive}
      finishable={step.finishable}
      onFinish={() => finish('done')}
      onSkip={() => finish('skipped')}
    />
  );
}
