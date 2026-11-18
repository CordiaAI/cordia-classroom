import { useEffect, useRef, useState } from 'react';

const SHOW_AFTER = 200; // never flash a loader for fast loads
const MIN_VISIBLE = 400; // once shown, keep it long enough to read as intentional

// The Cordia mark, breathing (opacity 0.4 → 1, 1.2 s). The only loading indicator in the app.
export default function CordiaLoader({ size = 48, label = 'Loading', className = '' }) {
  return (
    <span className={`c-loader ${className}`} role="status" aria-label={label} style={{ '--loader-size': `${size}px` }}>
      <img className="c-loader-mark" src="/academic-butterfly-open-book.png" alt="" />
      <style jsx global>{`
        .c-loader { display: inline-grid; place-items: center; width: var(--loader-size); height: var(--loader-size); flex: 0 0 auto; }
        .c-loader-mark { width: 100%; height: auto; animation: c-breathe 1.2s var(--ease) infinite; }
        [data-theme='dark'] .c-loader-mark, :is(.c-btn--primary, .btn) .c-loader-mark { filter: brightness(0) invert(1); }
        @keyframes c-breathe { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .c-loader-mark { animation: none; opacity: .6; } }
      `}</style>
    </span>
  );
}

// Whole-page gate: nothing renders piece by piece. If data takes over 200 ms the mark shows,
// centered in the content area (never over the nav), for at least 400 ms; then everything
// appears at once in one 200 ms fade. Pages that are already cached render instantly.
export function useLoadGate(ready) {
  const [phase, setPhase] = useState(ready ? 'instant' : 'waiting'); // waiting | loader | shown | instant
  const shownAt = useRef(0);
  useEffect(() => {
    if (phase === 'shown' || phase === 'instant') return undefined;
    if (ready) {
      const wait = phase === 'loader' ? Math.max(0, MIN_VISIBLE - (Date.now() - shownAt.current)) : 0;
      const timer = setTimeout(() => setPhase('shown'), wait);
      return () => clearTimeout(timer);
    }
    if (phase === 'waiting') {
      const timer = setTimeout(() => { shownAt.current = Date.now(); setPhase('loader'); }, SHOW_AFTER);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [ready, phase]);
  return phase;
}

// A button's working mark: shown only after 300 ms (a quick answer never flashes it) and, once shown, kept
// at least 500 ms (a slow one never flickers). Timers, not animation delays, so it still shows when the
// device asks for reduced motion.
const MARK_AFTER = 300;
const MARK_HOLD = 500;
export function useWorkingMark(active) {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (active && !shown) {
      const timer = setTimeout(() => { shownAt.current = Date.now(); setShown(true); }, MARK_AFTER);
      return () => clearTimeout(timer);
    }
    if (!active && shown) {
      const timer = setTimeout(() => setShown(false), Math.max(0, MARK_HOLD - (Date.now() - shownAt.current)));
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [active, shown]);
  return shown;
}

export function LoadGate({ ready, children, label = 'Loading' }) {
  const phase = useLoadGate(ready);
  if (phase === 'instant' || phase === 'shown') {
    const content = typeof children === 'function' ? children() : children;
    return phase === 'instant' ? content : <div className="c-reveal">{content}<RevealStyle /></div>;
  }
  return <LoadingArea phase={phase} label={label} />;
}

// The empty content area while waiting; the mark appears only in the 'loader' phase.
export function LoadingArea({ phase = 'loader', label = 'Loading' }) {
  return (
    <div className="c-loader-area" aria-busy="true">
      {phase === 'loader' && <CordiaLoader label={label} />}
      <RevealStyle />
    </div>
  );
}

// Wraps a page's content so it fades in once when it arrives after a wait.
export function Reveal({ phase, children }) {
  if (phase !== 'shown') return children;
  return <div className="c-reveal">{children}<RevealStyle /></div>;
}

// A section whose source is slow: a 20 px mark inside fixed-height space, so nothing moves when it fills.
export function SectionLoader({ height, label = 'Loading' }) {
  return (
    <div className="c-section-loader" style={{ height }} aria-busy="true">
      <CordiaLoader size={20} label={label} />
      <style jsx>{`.c-section-loader { display: grid; place-items: center; }`}</style>
    </div>
  );
}

function RevealStyle() {
  return (
    <style jsx global>{`
      .c-loader-area { display: grid; place-items: center; min-height: calc(100vh - var(--bar-h) - 160px); }
      .c-reveal { animation: c-reveal 200ms var(--ease) both; }
      .c-reveal > * { min-width: 0; }
      @keyframes c-reveal { from { opacity: 0; } to { opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .c-reveal { animation: none; } }
    `}</style>
  );
}
