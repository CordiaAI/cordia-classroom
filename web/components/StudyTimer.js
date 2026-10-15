import { useEffect, useRef } from 'react';
import { Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { apiFetch } from '../lib/api';

const MODES = {
  focus: { label: 'Focus', minutes: 25 },
  shortBreak: { label: 'Break', minutes: 5 },
  longBreak: { label: 'Long', minutes: 15 },
};

export default function StudyTimer({ timerState, setTimerState }) {
  const intervalRef = useRef(null);
  const { mode = 'focus', minutes = 25, seconds = 0, isRunning = false } = timerState || {};

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimerState(prev => {
          if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
          if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
          clearInterval(intervalRef.current);
          if (prev.mode === 'focus') {
            apiFetch('/stats/log-session', {
              method: 'POST',
              body: JSON.stringify({ session_type: 'timer', duration_seconds: MODES.focus.minutes * 60, metadata: { mode: 'pomodoro' } }),
            });
          }
          return { ...prev, isRunning: false, minutes: 0, seconds: 0 };
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  function toggle() {
    setTimerState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  }

  function reset() {
    clearInterval(intervalRef.current);
    setTimerState(prev => ({ ...prev, isRunning: false, minutes: MODES[prev.mode || 'focus'].minutes, seconds: 0 }));
  }

  function setMode(next) {
    clearInterval(intervalRef.current);
    setTimerState({ mode: next, minutes: MODES[next].minutes, seconds: 0, isRunning: false });
  }

  const pad = value => String(value).padStart(2, '0');

  return (
    <section className="c-card timer-card" aria-labelledby="timer-title" data-tip="break">
      <header className="c-row">
        <Timer size={20} strokeWidth={1.75} aria-hidden="true" />
        <h2 id="timer-title" className="c-section-title">Focus</h2>
      </header>
      <div className="timer-face" role="timer" aria-live="off">{pad(minutes)}:{pad(seconds)}</div>
      <div className="c-seg timer-modes" role="tablist" aria-label="Timer length">
        {Object.entries(MODES).map(([key, value]) => (
          <button key={key} type="button" role="tab" aria-selected={mode === key} onClick={() => setMode(key)}>{value.label}</button>
        ))}
      </div>
      <div className="c-row">
        <button type="button" className="c-btn c-btn--primary" onClick={toggle}>
          {isRunning ? <Pause size={20} strokeWidth={1.75} aria-hidden="true" /> : <Play size={20} strokeWidth={1.75} aria-hidden="true" />}
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button type="button" className="c-icon-btn" onClick={reset} aria-label="Reset timer"><RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <style jsx>{`
        .timer-card { display: grid; gap: 14px; padding: 20px; align-content: start; }
        .timer-card :global(header .lucide) { color: var(--olive-ink); }
        .timer-face { font: 600 44px/1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .timer-modes { justify-self: start; }
        .timer-modes button { padding: 0 14px; }
      `}</style>
    </section>
  );
}
