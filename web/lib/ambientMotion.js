import { prefersReducedMotion } from './motion';

// App-wide motion that needs no markup: the backdrop drifts a little with the mouse or the
// phone's tilt. Cards never move. Returns a cleanup function.
const DRIFT_PX = 14;

export function installAmbientMotion() {
  if (typeof window === 'undefined' || prefersReducedMotion()) return () => {};
  const root = document.documentElement;
  let frame = 0;
  let pending = null;

  function flush() {
    frame = 0;
    if (!pending) return;
    const { x, y } = pending;
    pending = null;
    root.style.setProperty('--bg-x', `${(x - 0.5) * -DRIFT_PX}px`);
    root.style.setProperty('--bg-y', `${(y - 0.5) * -DRIFT_PX}px`);
  }

  function onPointer(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    pending = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
    if (!frame) frame = requestAnimationFrame(flush);
  }

  // Phones: tilting the device moves the backdrop (where the browser allows it without asking).
  function onOrientation(event) {
    if (event.beta == null || event.gamma == null) return;
    const x = Math.max(0, Math.min(1, 0.5 + event.gamma / 60));
    const y = Math.max(0, Math.min(1, 0.5 + (event.beta - 45) / 60));
    pending = { x, y };
    if (!frame) frame = requestAnimationFrame(flush);
  }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
    if (frame) cancelAnimationFrame(frame);
  };
}
