import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const CALLOUT_WIDTH = 320;
const CALLOUT_HEIGHT = 190; // generous estimate; the callout is placed so this box never meets the outline
const GAP = 18;
const MARGIN = 12;

function findTarget(target) {
  for (const selector of [].concat(target)) {
    const element = document.querySelector(selector);
    if (element && element.getBoundingClientRect().width > 0) return element;
  }
  return null;
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Candidate spots, in order of preference: the side the step asks for first, then the screen
// corners, then above/below. The first one that fits on screen and stays clear of the outline wins.
function placeCallout(rect, side, viewport) {
  const width = Math.min(CALLOUT_WIDTH, viewport.width - MARGIN * 2);
  const clampTop = top => Math.max(MARGIN, Math.min(top, viewport.height - CALLOUT_HEIGHT - MARGIN));
  const right = { left: rect.right + GAP, top: clampTop(rect.top) };
  const left = { left: rect.left - GAP - width, top: clampTop(rect.top) };
  const topRight = { left: viewport.width - width - MARGIN, top: MARGIN + 64 };
  const topLeft = { left: MARGIN, top: MARGIN + 64 };
  const below = { left: Math.max(MARGIN, Math.min(rect.left, viewport.width - width - MARGIN)), top: rect.bottom + GAP };
  const above = { left: below.left, top: rect.top - GAP - CALLOUT_HEIGHT };
  const order = side === 'left' ? [left, topLeft, below, above, right, topRight] : [right, topRight, below, above, left, topLeft];
  const outline = { left: rect.left - GAP, right: rect.right + GAP, top: rect.top - GAP, bottom: rect.bottom + GAP };
  for (const spot of order) {
    const box = { left: spot.left, right: spot.left + width, top: spot.top, bottom: spot.top + CALLOUT_HEIGHT };
    const onScreen = box.left >= MARGIN - 1 && box.right <= viewport.width - MARGIN + 1 && box.top >= MARGIN - 1 && box.bottom <= viewport.height - MARGIN + 1;
    if (onScreen && !overlaps(box, outline)) return { ...spot, width };
  }
  // A target that fills the screen: pin the callout to the bottom edge, over the least content.
  return { left: (viewport.width - width) / 2, top: viewport.height - CALLOUT_HEIGHT - MARGIN, width };
}

// A spotlight tour over the real page: an olive, glowing outline around each target and a short
// explanation beside it. Clicking anywhere (or Enter/Space) moves on; Escape skips the tour.
export default function GuidedTour({ steps, onFinish }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    if (last) onFinish('done');
    else setIndex(value => value + 1);
  }, [last, onFinish]);

  // Targets can mount late (data loading), so look for them for a few seconds.
  useLayoutEffect(() => {
    let frame = 0;
    let tries = 0;
    let element = null;
    function measure() {
      element = element || findTarget(step.target);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      if (element) {
        const box = element.getBoundingClientRect();
        setRect({ left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height });
      } else if (tries++ < 60) {
        frame = requestAnimationFrame(measure);
      } else {
        setRect(null);
      }
    }
    setRect(null);
    const first = findTarget(step.target);
    if (first) {
      // Bring the target fully into view below the sticky navigation, scrolling only when needed.
      const box = first.getBoundingClientRect();
      const top = 96;
      if (box.top < top || box.bottom > window.innerHeight - MARGIN) {
        const fits = box.height <= window.innerHeight - top - MARGIN;
        window.scrollBy({ top: fits ? box.top - top - (window.innerHeight - top - box.height) / 2 + MARGIN : box.top - top, behavior: 'instant' });
      }
    }
    measure();
    const update = () => { cancelAnimationFrame(frame); measure(); };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onFinish('skipped');
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); next(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onFinish]);

  if (!viewport.width) return null;
  const callout = rect
    ? placeCallout(rect, step.side, viewport)
    : { left: (viewport.width - Math.min(CALLOUT_WIDTH, viewport.width - 24)) / 2, top: viewport.height / 3, width: Math.min(CALLOUT_WIDTH, viewport.width - 24) };

  return createPortal(
    <div className="guided-tour" onClick={next} role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
      {rect ? (
        <div className="guided-tour-outline" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} />
      ) : (
        <div className="guided-tour-scrim" />
      )}
      <div className="guided-tour-callout" style={{ left: callout.left, top: callout.top, width: callout.width }} key={index}>
        <span className="guided-tour-count">{index + 1} of {steps.length}</span>
        <h2 id="guided-tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="guided-tour-footer">
          <small>{last ? 'Click anywhere to finish' : 'Click anywhere to continue'}</small>
          <button type="button" className="guided-tour-skip" onClick={event => { event.stopPropagation(); onFinish('skipped'); }}>Skip tour</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
