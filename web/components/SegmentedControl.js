import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Every tab bar and segmented switch in the app (feedback 14): one pill of glass slides to the
// chosen segment. The children stay plain buttons (or links) that mark the chosen one the usual
// way (aria-selected, aria-checked, aria-pressed or .is-active), so each place keeps its own
// labels, badges and panels.
//
//   kind  'tabs'  -> role="tablist" (children are role="tab"): arrow keys move and select
//         'radio' -> role="radiogroup" (children role="radio"): the same keys
//         'group' -> role="group" (toggle buttons with aria-pressed): arrows move focus only
//
// The pill moves with a transform (no layout work) on a spring-like curve; with reduced motion it
// jumps. Keys: Left/Right (Up/Down too), Home, End. Only the chosen segment is in the tab order.
const CHOSEN = "[aria-selected='true'], [aria-checked='true'], [aria-pressed='true'], .is-active";
const ROLES = { tabs: 'tablist', radio: 'radiogroup', group: 'group' };
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function SegmentedControl({ kind = 'tabs', label, labelledBy, className = '', scroller = false, children, innerRef, ...rest }) {
  const ref = useRef(null);
  const [pill, setPill] = useState(null); // { x, y, w, h } of the chosen segment, null when none
  const [ready, setReady] = useState(false); // no slide on the first placement

  const setRefs = useCallback(node => {
    ref.current = node;
    if (typeof innerRef === 'function') innerRef(node);
    else if (innerRef) innerRef.current = node;
  }, [innerRef]);

  const segments = () => [...(ref.current?.children || [])].filter(node => node.matches('button, a') && !node.classList.contains('c-seg-pill'));

  const place = useCallback(() => {
    const chosen = segments().find(node => node.matches(CHOSEN));
    if (!chosen) { setPill(null); return; }
    const next = { x: chosen.offsetLeft, y: chosen.offsetTop, w: chosen.offsetWidth, h: chosen.offsetHeight };
    setPill(current => (current && current.x === next.x && current.y === next.y && current.w === next.w && current.h === next.h ? current : next));
  }, []);

  // After every render: the chosen segment may have changed. Roving tabindex for tabs and radios.
  useIsoLayoutEffect(() => {
    place();
    if (kind !== 'group') {
      const all = segments();
      const chosen = all.find(node => node.matches(CHOSEN)) || all[0];
      all.forEach(node => node.setAttribute('tabindex', node === chosen ? '0' : '-1'));
    }
  });

  useEffect(() => {
    if (pill && !ready) {
      const frame = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [pill, ready]);

  // Fonts loading, a resize, or a label changing width moves the segments.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
    const observer = new ResizeObserver(() => place());
    observer.observe(ref.current);
    segments().forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [place]);

  function onKeyDown(event) {
    rest.onKeyDown?.(event);
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
    const all = segments().filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true');
    const at = all.indexOf(document.activeElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = null;
    if (step) next = all[(at + step + all.length) % all.length];
    else if (event.key === 'Home') next = all[0];
    else if (event.key === 'End') next = all[all.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (kind !== 'group') next.click();
  }

  const { onKeyDown: _ignored, ...attrs } = rest;
  return (
    <div
      ref={setRefs}
      role={ROLES[kind] || 'group'}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={['c-seg', 'has-pill', scroller ? 'is-scroller' : '', ready ? 'is-ready' : '', className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
      {...attrs}
    >
      {pill && (
        <span
          className="c-seg-pill"
          aria-hidden="true"
          style={{ width: pill.w, height: pill.h, transform: `translate3d(${pill.x}px, ${pill.y}px, 0)` }}
        />
      )}
      {children}
    </div>
  );
}
