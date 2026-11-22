import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import { createPortal } from 'react-dom';
import { cutoutRadii, holePath, placeLabel, placeSkip } from '../lib/spotlightLayout.mjs';

const PAD = 8;

const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
const sameBox = (a, b) => Boolean(a && b) && ['top', 'left', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.5);

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
  // The label's real size, so it can be kept fully on screen (it wraps on narrow screens).
  const labelRef = useRef(null);
  const [labelSize, setLabelSize] = useState({ w: 0, h: 0 });
  // Skip's size too, so it can be placed clear of the control, the label and the Tutor button.
  const skipRef = useRef(null);
  const [skipSize, setSkipSize] = useState({ w: 80, h: 44 });
  useIsoLayoutEffect(() => {
    const node = labelRef.current;
    if (node) {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (Math.abs(w - labelSize.w) > 0.5 || Math.abs(h - labelSize.h) > 0.5) setLabelSize({ w, h });
    }
    const skip = skipRef.current;
    if (skip && (Math.abs(skip.offsetWidth - skipSize.w) > 0.5 || Math.abs(skip.offsetHeight - skipSize.h) > 0.5)) setSkipSize({ w: skip.offsetWidth, h: skip.offsetHeight });
  });
  // The Tutor button (TutorBubble), when it is on screen: neither Skip nor the label may cover it.
  const [tutor, setTutor] = useState(null);
  // The phone tab bar: the label rests above it rather than over it.
  const [tabbar, setTabbar] = useState(null);

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
          // Also scrolls sideways, for a target inside a scrolling row of pills.
          if (box.top < 70 || box.bottom > window.innerHeight - 90 || box.left < 0 || box.right > window.innerWidth) {
            element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
          }
        }
        const box = element.getBoundingClientRect();
        // The control's own corners, read every time: the cut-out follows its shape.
        const style = getComputedStyle(element);
        const corners = CORNERS.map(key => style[key]);
        setRect(current => (sameBox(current, box) && current.corners.join() === corners.join()
          ? current
          : { top: box.top, left: box.left, width: box.width, height: box.height, corners }));
      } else setRect(null);
      const bubble = visibleElement('.c-tutor-bubble');
      const tb = bubble && bubble.getBoundingClientRect();
      setTutor(current => (tb ? (sameBox(current, tb) ? current : { top: tb.top, left: tb.left, width: tb.width, height: tb.height }) : null));
      const bar = visibleElement('.c-tabbar');
      const bb = bar && bar.getBoundingClientRect();
      setTabbar(current => (bb ? (sameBox(current, bb) ? current : { top: bb.top, left: bb.left, width: bb.width, height: bb.height }) : null));
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
  // The cut-out's corners: the control's own radius plus the padding, so a pill gets a pill.
  const radii = hole ? cutoutRadii(rect.corners, { w: rect.width, h: rect.height }, { w: hole.right - hole.left, h: hole.bottom - hole.top }, PAD) : null;
  const edges = r => r && { top: r.top, left: r.left, right: r.left + r.width, bottom: r.top + r.height };
  const inside = (inner, outer) => Boolean(inner && outer) && inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
  const tutorBox = edges(tutor);
  const tabbarBox = edges(tabbar);
  // The Tutor button never sits under the label, unless it is the spotlighted control itself; the
  // label rests above the phone tab bar unless the control is in it.
  const covered = inside(tutorBox, hole);
  const keepClear = [!covered && tutorBox, hole && !inside(hole, tabbarBox) && tabbarBox].filter(Boolean);

  // Label beside the control: below if there is room, else above; arrow points at it. It is
  // measured and kept 16px inside the screen on every side, with the arrow still on the control,
  // and moved off the Tutor button.
  const EDGE = 16;
  let labelStyle = { left: '50%', bottom: 96, transform: 'translateX(-50%)' };
  let arrow = 'none';
  let labelBox = null;
  if (hole) {
    const lw = labelSize.w;
    const lh = labelSize.h || 48;
    const spot = placeLabel({ vw, vh, hole, size: { w: lw, h: lh }, avoid: keepClear, edge: EDGE });
    const targetX = (hole.left + hole.right) / 2;
    const arrowX = Math.max(22, Math.min(lw - 22, targetX - spot.left));
    arrow = spot.arrow;
    labelStyle = { top: spot.top, left: spot.left, '--arrow-x': `${arrowX}px` };
    labelBox = { top: spot.top, left: spot.left, right: spot.left + lw, bottom: spot.top + lh };
  }

  // Skip: bottom-right on desktop, left of the Tutor button; under the top bar on phones. It moves
  // on if it would cover the control, the label or the Tutor button.
  const phone = vw < 768;
  const rootStyle = getComputedStyle(document.documentElement);
  const barH = parseFloat(rootStyle.getPropertyValue('--bar-h')) || 64;
  const tabbarH = parseFloat(rootStyle.getPropertyValue('--tabbar-h')) || 64;
  const skipSpot = placeSkip({ vw, vh, phone, size: skipSize, avoid: [hole, labelBox].filter(Boolean), tutor: covered ? null : tutorBox, barH, tabbarH });

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
          {/* One dim layer with the cut-out clipped from it: clicks reach only the control. */}
          <div className="spot-dim" style={{ inset: 0, clipPath: `path(evenodd, '${holePath(vw, vh, hole, radii)}')` }} />
          <div className="spot-ring" style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top, borderRadius: radii.map(r => `${r}px`).join(' ') }} />
        </>
      ) : !passive && <div className="spot-dim" style={{ inset: 0, background: 'var(--scrim)', pointerEvents: 'none' }} />}

      {label && (
        <div ref={labelRef} className={`spot-label arrow-${arrow}`} style={labelStyle} role="status" aria-live="polite">
          <strong>{label}</strong>
          {dots}
          {finishable && <button type="button" className="c-btn c-btn--quiet spot-finish" onClick={onFinish}>Done</button>}
        </div>
      )}
      <button ref={skipRef} type="button" className="spot-skip" style={{ top: skipSpot.top, left: skipSpot.left }} onClick={onSkip}>Skip</button>

      <style jsx>{`
        .spot { position: fixed; inset: 0; z-index: 400; pointer-events: none; }
        .spot-dim { position: fixed; background: var(--spot-dim); pointer-events: auto; }
        /* The cut-out in the dim layer is not animated, so the ring is not either: it sits on the hole at every frame. */
        .spot-ring { position: fixed; box-shadow: 0 0 0 2px var(--olive), 0 0 0 8px var(--olive-tint); pointer-events: none; }
        .spot-label {
          position: fixed; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 10px 16px; max-width: calc(100vw - 32px); box-sizing: border-box;
          border-radius:22px; pointer-events: auto;
          background: var(--glass); border: 1px solid var(--glass-edge);
          -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
          box-shadow: inset 0 1px 0 var(--glass-edge), var(--shadow);
          color: var(--ink); font:600 1.0625rem/1.25 var(--font-sans); overflow-wrap: anywhere;
          animation: spot-in 220ms var(--ease) both;
        }
        :global(:root:not([data-theme='dark'])) .spot-label { background: var(--surface-card); }
        .spot-label::after { content: ''; position: absolute; left: var(--arrow-x, 50%); width: 14px; height: 14px; transform: translateX(-50%) rotate(45deg); background: inherit; border: inherit; }
        .spot-label.arrow-up::after { top: -8px; border-right: 0; border-bottom: 0; }
        .spot-label.arrow-down::after { bottom: -8px; border-left: 0; border-top: 0; }
        .spot-label.arrow-none::after { display: none; }
        .spot :global(.spot-dots) { display: inline-flex; align-items: center; gap: 4px; }
        .spot :global(.spot-dots i) { width: 6px; height: 6px; border-radius:999px; background: var(--line); }
        .spot :global(.spot-dots i.is-done) { background: var(--olive); opacity: .5; }
        .spot :global(.spot-dots i.is-now) { background: var(--olive); width: 16px; }
        .spot :global(.spot-dots .c-meta) { margin-left: 6px; }
        .spot-skip {
          position: fixed; height: 44px; padding: 0 20px; pointer-events: auto;
          border-radius:999px; border: 1px solid var(--glass-edge);
          background: var(--glass); -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%);
          color: var(--ink); font:600 0.9375rem/1 var(--font-sans); cursor: pointer;
        }
        .spot-finish { height: 36px; min-height: 36px; }
        @keyframes spot-in { from { opacity: 0; } to { opacity: 1; } }
        @media (max-width: 767px) { .spot :global(.spot-dots i) { display: none; } .spot :global(.spot-dots .c-meta) { margin-left: 0; } .spot-label { font-size: 0.9375rem; } }
        @media (prefers-reduced-motion: reduce) { .spot-label { animation: none; } }
      `}</style>
    </div>,
    document.body,
  );
}
