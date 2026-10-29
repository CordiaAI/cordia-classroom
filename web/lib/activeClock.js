import { useEffect, useRef } from 'react';

// Study time counts only while the page is visible and the student is doing something. A hidden
// tab, or no input for IDLE_MS, pauses the clock (pages used to log wall-clock time, so a tab
// left open overnight logged 24 hours of study). The IDLE_MS after the last input still count:
// reading a screen without touching anything is studying, for a while.
export const IDLE_MS = 2 * 60 * 1000;
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];
// Input closer together than this doesn't need the clock brought up to date.
const SETTLE_GAP_MS = 15000;

export function activeClock() {
  if (typeof document === 'undefined') return { seconds: () => 0, reset() {}, stop() {} };
  let total = 0;
  let last = Date.now();
  let lastInput = last;
  let visible = !document.hidden;

  // Adds the time since `last`, up to IDLE_MS after the last input, if the page was visible.
  function settle() {
    const now = Date.now();
    const until = Math.min(now, lastInput + IDLE_MS);
    if (visible && until > last) total += until - last;
    last = now;
  }
  function onInput() {
    const now = Date.now();
    if (now - lastInput > SETTLE_GAP_MS) settle();
    lastInput = now;
  }
  function onVisibility() {
    settle();
    visible = !document.hidden;
    if (visible) lastInput = Date.now();
  }
  document.addEventListener('visibilitychange', onVisibility);
  INPUT_EVENTS.forEach(name => window.addEventListener(name, onInput, { passive: true, capture: true }));

  return {
    seconds() { settle(); return Math.round(total / 1000); },
    reset() { total = 0; last = Date.now(); lastInput = last; },
    stop() {
      document.removeEventListener('visibilitychange', onVisibility);
      INPUT_EVENTS.forEach(name => window.removeEventListener(name, onInput, { capture: true }));
    },
  };
}

// The clock for one study screen, started on mount: ref.current.seconds(), .reset().
export function useActiveClock() {
  const ref = useRef(null);
  useEffect(() => {
    ref.current = activeClock();
    return () => ref.current.stop();
  }, []);
  return ref;
}
