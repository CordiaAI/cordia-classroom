import { prefersReducedMotion } from './motion';

// App-wide motion that needs no markup: cards lean toward the cursor (desktop only) and the
// backdrop drifts a little with the mouse or the phone's tilt. Returns a cleanup function.
const TILT = '.today-continue, .today-progress, .plan-card, .lecture-card, .c-tilt';
const TILT_DEG = 4;
const DRIFT_PX = 14;

export function installAmbientMotion() {
  if (typeof window === 'undefined' || prefersReducedMotion()) return () => {};
  const root = document.documentElement;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let frame = 0;
  let pending = null;
  let tilted = null;

  function flush() {
    frame = 0;
    if (!pending) return;
    const { x, y, target, clientX, clientY } = pending;
    pending = null;
    root.style.setProperty('--bg-x', `${(x - 0.5) * -DRIFT_PX}px`);
    root.style.setProperty('--bg-y', `${(y - 0.5) * -DRIFT_PX}px`);
    if (!finePointer || clientX == null) return;
    const card = target?.closest?.(TILT) || null;
    if (tilted && tilted !== card) {
      tilted.style.removeProperty('--tilt-x');
      tilted.style.removeProperty('--tilt-y');
      tilted.classList.remove('is-tilting');
    }
    tilted = card;
    if (!card) return;
    const box = card.getBoundingClientRect();
    const px = (clientX - box.left) / box.width;
    const py = (clientY - box.top) / box.height;
    card.classList.add('is-tilting');
    card.style.setProperty('--tilt-x', `${((0.5 - py) * TILT_DEG).toFixed(2)}deg`);
    card.style.setProperty('--tilt-y', `${((px - 0.5) * TILT_DEG).toFixed(2)}deg`);
  }

  function onPointer(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    pending = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight, target: event.target, clientX: event.clientX, clientY: event.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  }

  // Phones: tilting the device moves the backdrop (where the browser allows it without asking).
  function onOrientation(event) {
    if (event.beta == null || event.gamma == null) return;
    const x = Math.max(0, Math.min(1, 0.5 + event.gamma / 60));
    const y = Math.max(0, Math.min(1, 0.5 + (event.beta - 45) / 60));
    pending = { x, y, target: null };
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
