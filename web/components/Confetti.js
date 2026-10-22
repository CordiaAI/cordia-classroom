import { useEffect, useRef } from 'react';
import { prefersReducedMotion, tokenColor } from '../lib/motion';

// A short burst of confetti in Cordia's own colours, drawn on one canvas and then removed.
export default function Confetti({ pieces = 120, ms = 2400 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReducedMotion()) return undefined;
    const context = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    const colors = ['--olive', '--success', '--warning', '--confetti-1', '--confetti-2'].map(name => tokenColor(name, 'gray'));
    const bits = Array.from({ length: pieces }, () => ({
      x: width / 2 + (Math.random() - 0.5) * 120,
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 6,
      size: 6 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const started = performance.now();
    let frame;
    const draw = now => {
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - elapsed / ms);
      for (const bit of bits) {
        bit.vy += 0.35;
        bit.vx *= 0.99;
        bit.x += bit.vx;
        bit.y += bit.vy;
        bit.angle += bit.spin;
        context.save();
        context.translate(bit.x, bit.y);
        context.rotate(bit.angle);
        context.fillStyle = bit.color;
        context.fillRect(-bit.size / 2, -bit.size / 4, bit.size, bit.size / 2);
        context.restore();
      }
      if (elapsed < ms) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [pieces, ms]);
  return <canvas ref={ref} className="c-confetti" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 200 }} />;
}
