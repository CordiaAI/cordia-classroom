import { useEffect, useRef, useState } from 'react';
import CordiaLoader from './CordiaLoader';
import { FALLBACK_LINE, firstLine, holdFor, LINE_MS, nextLine, pendingSteps } from '../lib/tutorStatus.mjs';

// While the Tutor works: one breathing Cordia mark and one status line in the Tutor's text style, with a
// shimmer and no second icon. The line cross-fades to the next every LINE_MS (lib/tutorStatus.mjs says which);
// a real step shows as soon as it arrives, but never less than MIN_HOLD_MS after the last change. It is on screen
// only until the first answer text, so nothing here is read once there is an answer. Reduced motion: no shimmer, and lines swap without a fade.
// A screen reader hears only the first line (the live region is set once); the changing lines are for the eyes.
// avatar: the chat home's thinking row, where the mark sits in the Tutor's avatar place (DESIGN-SPEC 4.3).
export default function TutorThinking({ steps = [], lines = [], avatar = false }) {
  const [view, setView] = useState(() => ({ text: firstLine(steps), prev: '', n: 0 }));
  const [announced, setAnnounced] = useState('');
  const latest = useRef({ steps, lines });
  latest.current = { steps, lines };
  // What is on screen, when it last changed, and how many real steps have been shown (the list only ever grows).
  const shown = useRef(view.text);
  const changedAt = useRef(0);
  const consumed = useRef(pendingSteps({ steps }).length);

  const show = text => {
    const prev = shown.current;
    shown.current = text;
    changedAt.current = performance.now();
    setView(current => ({ text, prev: text === prev ? '' : prev, n: current.n + 1 }));
  };

  // The first line is announced once, after the live region is on the page; the hold counts from it too.
  useEffect(() => {
    changedAt.current = performance.now();
    setAnnounced(view.text);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A real step shows as soon as it arrives, but never less than MIN_HOLD_MS after the last change; one that
  // arrives sooner waits its turn, and each step that was waiting is shown in order (none is dropped).
  const stepCount = steps.length;
  useEffect(() => {
    let timer;
    const tick = () => {
      const [next] = pendingSteps({ steps: latest.current.steps, consumed: consumed.current });
      if (!next) return;
      const wait = holdFor({ changedAt: changedAt.current, now: performance.now() });
      if (wait > 0) { timer = setTimeout(tick, wait); return; }
      consumed.current += 1;
      show(next);
      tick();
    };
    tick();
    return () => clearTimeout(timer);
  }, [stepCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every LINE_MS the next line; each change (or a line that stays) starts a fresh wait. A step that is still
  // waiting for its turn takes the place of the next line.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (pendingSteps({ steps: latest.current.steps, consumed: consumed.current }).length) return;
      show(nextLine({ current: shown.current, ...latest.current }));
    }, LINE_MS);
    return () => clearTimeout(timer);
  }, [view.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {avatar
        ? <span className="cordia-tutor-avatar"><CordiaLoader size={22} silent /></span>
        : <CordiaLoader size={20} silent />}
      <span className="tutor-line-stack" aria-hidden="true">
        {/* Every line this row can show, unseen and stacked in one place: the row is as tall as the tallest, so a line that
            wraps in a narrow Tutor never makes the row jump as the lines change. */}
        {[...new Set([FALLBACK_LINE, ...steps, ...lines])].map(text => <span key={`size-${text}`} className="tutor-line-size">{text}</span>)}
        {view.prev && <span key={`out-${view.prev}`} className="tutor-line is-out">{view.prev}</span>}
        <span key={view.text} className={`tutor-line ${view.n ? 'is-in' : 'is-first'}`}>{view.text}</span>
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{announced}</span>
      <style jsx global>{`
        /* Up to two lines, wrapped, never clipped by a narrow Tutor. */
        .tutor-line-stack { display: grid; flex: 1 1 auto; min-width: 0; }
        .tutor-line-stack > span { grid-area: 1 / 1; align-self: center; min-width: 0; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        .tutor-line-stack > .tutor-line-size { visibility: hidden; pointer-events: none; }
        .tutor-line-stack > .tutor-line { color: var(--muted-strong); }
        /* The shimmer: ink sweeping across the muted line. Both are the text colours, so the line reads 4.5:1 or better at every point of the sweep. */
        @supports ((-webkit-background-clip: text) or (background-clip: text)) {
          .tutor-line {
            background: linear-gradient(100deg, var(--muted-strong) 38%, var(--ink) 50%, var(--muted-strong) 62%) 100% 0 / 260% 100% no-repeat;
            -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          }
        }
        /* The first line is there from the first frame: it only shimmers. A next line: the old one fades out in --dur-swap and the
           new one starts when it has gone, so the two are never on screen near half opacity together. */
        .tutor-line.is-first { animation: tutor-line-shimmer 2.2s linear infinite; }
        .tutor-line.is-in { animation: tutor-line-in var(--dur-enter) var(--ease) var(--dur-swap) both, tutor-line-shimmer 2.2s linear infinite; }
        .tutor-line.is-out { animation: tutor-line-out var(--dur-swap) var(--ease-exit) both, tutor-line-shimmer 2.2s linear infinite; pointer-events: none; }
        @keyframes tutor-line-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tutor-line-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes tutor-line-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
        @media (prefers-reduced-motion: reduce) {
          .tutor-line, .tutor-line.is-in, .tutor-line.is-first { animation: none; background: none; -webkit-text-fill-color: currentColor; }
          .tutor-line.is-out { display: none; }
        }
      `}</style>
    </>
  );
}
