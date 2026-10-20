import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { TIMER_MODES } from './TimerEngine';
import { walkthroughEvent } from '../lib/walkthrough';
import PulseDot from './PulseDot';

const MODES = TIMER_MODES;

export default function StudyTimer({ timerState, setTimerState }) {
  const { mode = 'focus', minutes = 25, seconds = 0, isRunning = false } = timerState || {};

  function toggle() {
    if (!isRunning) walkthroughEvent('focus-started');
    setTimerState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  }

  function reset() {
    setTimerState(prev => ({ ...prev, isRunning: false, minutes: MODES[prev.mode || 'focus'].minutes, seconds: 0 }));
  }

  function setMode(next) {
    setTimerState({ mode: next, minutes: MODES[next].minutes, seconds: 0, isRunning: false });
  }

  const pad = value => String(value).padStart(2, '0');

  return (
    <section className="c-card focus-card" aria-labelledby="timer-title">
      <header className="c-row">
        <Timer size={20} strokeWidth={1.75} aria-hidden="true" />
        <h2 id="timer-title" className="c-section-title">Focus</h2>
        <PulseDot feature="focus" />
      </header>
      <div className="focus-face" role="timer" aria-live="off">{pad(minutes)}:{pad(seconds)}</div>
      <div className="c-seg focus-modes" role="tablist" aria-label="Timer length">
        {Object.entries(MODES).map(([key, value]) => (
          <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>{value.label}</button>
        ))}
      </div>
      <div className="c-row">
        <button type="button" className="c-btn c-btn--primary" data-spot="focus-start" onClick={toggle}>
          {isRunning ? <Pause size={20} strokeWidth={1.75} aria-hidden="true" /> : <Play size={20} strokeWidth={1.75} aria-hidden="true" />}
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button type="button" className="c-icon-btn" onClick={reset} aria-label="Reset timer"><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <style jsx>{`
        .focus-card { display: grid; gap: 14px; padding: 20px; align-content: start; }
        .focus-card :global(header .lucide) { color: var(--olive-ink); }
        .focus-face { font:600 40px/1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing:0; }
        .focus-modes { justify-self: start; }
        .focus-modes button { padding: 0 14px; }
      `}</style>
    </section>
  );
}
