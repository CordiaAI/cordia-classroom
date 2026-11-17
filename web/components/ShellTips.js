import { useCallback, useEffect, useRef, useState } from 'react';
import BodyPortal from './BodyPortal';

const HOVER_DELAY = 300; // DESIGN-SPEC 6.2: sweeping down the rail doesn't flash every popover
const WARM_MS = 400;     // moving straight to the next button shows the next one at once
const GAP = 14;          // popover to rail (or sidebar) edge

// Hover and focus popovers for the shell: the tool rail's (left of the rail, name and one line) and
// the folded sidebar's (right of it, the name). Hover shows after 300ms, or at once when another one
// was just showing; keyboard focus shows at once with no transition (6.1); Escape, scrolling and
// leaving hide it. Tips render on <body>, so the scrolling rail never clips them.
export function useShellTips() {
  const [tip, setTip] = useState(null); // { key, rect, instant }
  const tipRef = useRef(null);
  const timer = useRef(null);
  const lastHidden = useRef(0);
  tipRef.current = tip;

  const show = useCallback((key, element, instant) => {
    clearTimeout(timer.current);
    const rect = element.getBoundingClientRect();
    // 14px from the pane's edge (the rail or the sidebar), centred on the control.
    const pane = element.closest('.c-rail, .c-side')?.getBoundingClientRect() || rect;
    setTip({ key, rect: { top: rect.top, height: rect.height, left: pane.left, right: pane.right }, instant });
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    if (tipRef.current) lastHidden.current = Date.now();
    setTip(null);
  }, []);

  useEffect(() => {
    if (!tip) return undefined;
    const onKey = event => { if (event.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [tip, hide]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Props for one control. Touch never shows a popover (a tap is a click).
  const bind = useCallback(key => ({
    onPointerEnter: event => {
      if (event.pointerType === 'touch') return;
      const element = event.currentTarget;
      clearTimeout(timer.current);
      if (tipRef.current || Date.now() - lastHidden.current < WARM_MS) show(key, element, false);
      else timer.current = setTimeout(() => show(key, element, false), HOVER_DELAY);
    },
    onPointerLeave: () => { if (!tipRef.current || tipRef.current.key === key) hide(); else clearTimeout(timer.current); },
    onPointerDown: hide,
    onFocus: event => { if (event.currentTarget.matches(':focus-visible')) show(key, event.currentTarget, true); },
    onBlur: () => { if (tipRef.current?.key === key) hide(); },
  }), [show, hide]);

  return { tip, bind, hide };
}

// items: [{ key, id, title, line }]. side 'left' sits left of its control (the rail), 'right' right
// of it (the folded sidebar). With `describes`, every tip stays in the page as a role="tooltip" its
// control points at (aria-describedby), so screen readers announce the line; without it the tip only
// repeats the control's own name, so it's hidden from them.
export function ShellTipLayer({ tip, items, side = 'left', describes = false }) {
  const places = useRef({});
  // After hydration: the server renders no portal, so the first client render mustn't either.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (tip?.rect) {
    const { rect } = tip;
    places.current[tip.key] = side === 'left'
      ? { top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + GAP, left: 'auto' }
      : { top: rect.top + rect.height / 2, left: rect.right + GAP };
  }
  const shown = describes ? items : items.filter(item => places.current[item.key]);
  if (!mounted || !shown.length) return null;
  return (
    <BodyPortal>
      {shown.map(item => {
        const on = tip?.key === item.key;
        return (
          <div key={item.key} id={item.id} role={describes ? 'tooltip' : undefined} aria-hidden={describes ? undefined : 'true'}
            className={`c-shell-tip is-${side}${on ? ' is-shown' : ''}${on && tip.instant ? ' is-instant' : ''}${item.line ? '' : ' is-name'}`}
            style={places.current[item.key] || undefined}>
            <b>{item.title}</b>
            {item.line && <span>{item.line}</span>}
          </div>
        );
      })}
    </BodyPortal>
  );
}
