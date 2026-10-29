import { prefersReducedMotion } from './motion';

// App-wide motion that needs no markup: the backdrop drifts a little with the mouse or the
// phone's tilt, and a soft blurred glow (body::after, motion.css) trails the mouse. Cards never
// move. Returns a cleanup function.
const DRIFT_PX = 14;
// How far the glow closes the gap to the pointer each frame: low, so it trails and settles.
const GLOW_EASE = 0.08;

export function installAmbientMotion() {
  if (typeof window === 'undefined' || prefersReducedMotion()) return () => {};
  const root = document.documentElement;
  let frame = 0;
  let pending = null;
  // The glow eases from where it is toward the pointer, one frame at a time, then stops.
  const glow = { x: 0, y: 0, tx: 0, ty: 0, frame: 0, shown: false };

  function stepGlow() {
    glow.x += (glow.tx - glow.x) * GLOW_EASE;
    glow.y += (glow.ty - glow.y) * GLOW_EASE;
    root.style.setProperty('--glow-x', `${glow.x.toFixed(1)}px`);
    root.style.setProperty('--glow-y', `${glow.y.toFixed(1)}px`);
    const settled = Math.abs(glow.tx - glow.x) < 0.5 && Math.abs(glow.ty - glow.y) < 0.5;
    glow.frame = settled ? 0 : requestAnimationFrame(stepGlow);
  }

  function moveGlow(x, y) {
    glow.tx = x;
    glow.ty = y;
    if (!glow.shown) {
      // First move: start under the pointer instead of sliding in from a corner.
      glow.x = x;
      glow.y = y;
      glow.shown = true;
      root.dataset.glow = 'on';
    }
    if (!glow.frame) glow.frame = requestAnimationFrame(stepGlow);
  }

  function hideGlow() {
    delete root.dataset.glow;
    glow.shown = false;
  }

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
    moveGlow(event.clientX, event.clientY);
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

  // The glow fades out while the mouse is outside the window.
  function onLeave(event) { if (!event.relatedTarget) hideGlow(); }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  document.addEventListener('mouseout', onLeave);
  return () => {
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('deviceorientation', onOrientation);
    document.removeEventListener('mouseout', onLeave);
    if (frame) cancelAnimationFrame(frame);
    if (glow.frame) cancelAnimationFrame(glow.frame);
    hideGlow();
  };
}
