import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PAD = 8;

function visibleElement(selector) {
  const nodes = [...document.querySelectorAll(selector)];
  return nodes.find(node => {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }) || null;
}

// Dims the app to 40% except one real control, rings it in olive and labels it.
// Clicks only reach the control; the student's real action moves the walkthrough on.
export default function Spotlight({ target, label, index, total, onSkip, passive = false, finishable = false, onFinish }) {
  const [rect, setRect] = useState(null);
  const frame = useRef(0);

  useEffect(() => {
    let alive = true;
    let scrolled = false;
    function measure() {
      if (!alive) return;
      const element = target ? visibleElement(target) : null;
      if (element) {
        if (!scrolled) {
          scrolled = true;
          const box = element.getBoundingClientRect();
          if (box.top < 70 || box.bottom > window.innerHeight - 90) element.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        const box = element.getBoundingClientRect();
        setRect(current => (current && Math.abs(current.top - box.top) < 0.5 && Math.abs(current.left - box.left) < 0.5 && Math.abs(current.width - box.width) < 0.5 && Math.abs(current.height - box.height) < 0.5
          ? current
          : { top: box.top, left: box.left, width: box.width, height: box.height }));
      } else setRect(null);
      frame.current = window.setTimeout(measure, 120);
    }
    measure();
    return () => { alive = false; clearTimeout(frame.current); };
  }, [target]);

  if (typeof document === 'undefined') return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = rect && {
    top: Math.max(0, rect.top - PAD),
    left: Math.max(0, rect.left - PAD),
    right: Math.min(vw, rect.left + rect.width + PAD),
    bottom: Math.min(vh, rect.top + rect.height + PAD),
  };

  // Label beside the control: below if there is room, else above; arrow points at it.
  let labelStyle = { left: '50%', bottom: 96, transform: 'translateX(-50%)' };
  let arrow = 'none';
  if (hole) {
    const centerX = Math.min(vw - 120, Math.max(120, (hole.left + hole.right) / 2));
    if (vh - hole.bottom > 90) { labelStyle = { top: hole.bottom + 14, left: centerX, transform: 'translateX(-50%)' }; arrow = 'up'; }
    else { labelStyle = { top: hole.top - 14, left: centerX, transform: 'translate(-50%, -100%)' }; arrow = 'down'; }
  }

  const dots = (
    <span className="spot-dots" aria-label={`${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, dot) => <i key={dot} className={dot < index ? 'is-done' : dot === index ? 'is-now' : ''} />)}
      <span className="c-meta">{index + 1} of {total}</span>
    </span>
  );

  return createPortal(
    <div className="spot" role="dialog" aria-modal="false" aria-label={`Walkthrough: ${label}`}>
      {hole ? (
        <>
          <div className="spot-dim" style={{ top: 0, left: 0, right: 0, height: hole.top }} />
          <div className="spot-dim" style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className="spot-dim" style={{ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }} />
          <div className="spot-dim" style={{ top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }} />
          <div className="spot-ring" style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }} />
        </>
      ) : !passive && <div className="spot-dim" style={{ inset: 0, background: 'rgba(23,27,24,.12)', pointerEvents: 'none' }} />}

      {label && (
        <div className={`spot-label arrow-${arrow}`} style={labelStyle} role="status" aria-live="polite">
          <strong>{label}</strong>
          {dots}
          {finishable && <button type="button" className="c-btn c-btn--quiet spot-finish" onClick={onFinish}>Done</button>}
        </div>
      )}
      <button type="button" className="spot-skip" onClick={onSkip}>Skip</button>

      <style jsx>{`
        .spot { position: fixed; inset: 0; z-index: 400; pointer-events: none; }
        .spot-dim { position: fixed; background: rgba(23, 27, 24, 0.4); pointer-events: auto; }
        .spot-ring { position: fixed; border-radius: 12px; box-shadow: 0 0 0 2px #536149, 0 0 0 8px rgba(83, 97, 73, 0.28), 0 0 32px 8px rgba(83, 97, 73, 0.35); pointer-events: none; transition: top 200ms var(--ease), left 200ms var(--ease), width 200ms var(--ease), height 200ms var(--ease); }
        .spot-label {
          position: fixed; display: flex; align-items: center; gap: 12px; padding: 10px 16px; max-width: calc(100vw - 32px);
          border-radius: 999px; pointer-events: auto;
          background: var(--glass); border: 1px solid var(--glass-edge);
          -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
          box-shadow: inset 0 1px 0 var(--glass-edge), var(--shadow);
          color: var(--ink); font: 600 17px/1.2 var(--font-sans); white-space: nowrap;
          animation: spot-in 220ms var(--ease) both;
        }
        :global(:root:not([data-theme='dark'])) .spot-label { background: rgba(255, 255, 252, 0.92); }
        .spot-label::after { content: ''; position: absolute; left: 50%; width: 14px; height: 14px; transform: translateX(-50%) rotate(45deg); background: inherit; border: inherit; }
        .spot-label.arrow-up::after { top: -8px; border-right: 0; border-bottom: 0; }
        .spot-label.arrow-down::after { bottom: -8px; border-left: 0; border-top: 0; }
        .spot-label.arrow-none::after { display: none; }
        .spot-dots { display: inline-flex; align-items: center; gap: 4px; }
        .spot-dots i { width: 6px; height: 6px; border-radius: 999px; background: var(--line); }
        .spot-dots i.is-done { background: var(--olive); opacity: .5; }
        .spot-dots i.is-now { background: var(--olive); width: 16px; }
        .spot-dots .c-meta { margin-left: 6px; }
        .spot-skip {
          position: fixed; top: 12px; right: 12px; height: 44px; padding: 0 20px; pointer-events: auto;
          border-radius: 999px; border: 1px solid var(--glass-edge);
          background: var(--glass); -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
          color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer;
        }
        .spot-finish { height: 36px; min-height: 36px; }
        @keyframes spot-in { from { opacity: 0; } to { opacity: 1; } }
        @media (max-width: 767px) { .spot-dots i { display: none; } .spot-dots .c-meta { margin-left: 0; } .spot-label { font-size: 15px; } }
        @media (prefers-reduced-motion: reduce) { .spot-ring { transition: none; } .spot-label { animation: none; } }
      `}</style>
    </div>,
    document.body,
  );
}
