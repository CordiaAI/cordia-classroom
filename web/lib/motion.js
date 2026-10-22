import { useEffect, useState } from 'react';

// Shared motion helpers. Everything here does nothing when the device asks for less motion.
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// A number that counts up from 0 to `target` over `ms`, easing out.
export function useCountUp(target, ms = 900) {
  const end = Number(target) || 0;
  const [value, setValue] = useState(() => (prefersReducedMotion() ? end : 0));
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(end); return undefined; }
    let frame;
    const started = performance.now();
    const step = now => {
      const t = Math.min(1, (now - started) / ms);
      setValue(end * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [end, ms]);
  return value;
}

// A theme colour token (e.g. '--olive') as the browser resolved it.
export function tokenColor(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
