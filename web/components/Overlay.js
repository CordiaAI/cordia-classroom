import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One behaviour for every sheet, modal and popover: rendered on <body> (so no blurred or
// transformed ancestor can clip it), the same scrim (40% dim + 8px blur), Escape and
// outside click close it, and focus returns to whatever opened it.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack = [];

function useOverlay(open, onClose, panelRef, { autoFocus = true } = {}) {
  const opener = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const token = {};
    stack.push(token);
    const onKey = event => {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current?.(); return; }
      if (event.key === 'Tab' && panelRef.current) {
        const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    if (autoFocus) {
      requestAnimationFrame(() => {
        if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
          const target = panelRef.current.querySelector('[autofocus], [data-autofocus]') || panelRef.current.querySelector(FOCUSABLE) || panelRef.current;
          target.focus?.({ preventScroll: true });
        }
      });
    }
    return () => {
      document.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(token), 1);
      const back = opener.current;
      if (back && document.contains(back)) setTimeout(() => back.focus?.({ preventScroll: true }), 0);
    };
  }, [open]);
}

// Overlays only open after a user action (or a client-side event), so document exists.
function Portal({ children }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body);
}

// Modal sheet. Children are the sheet's contents.
export function Sheet({ open = true, onClose, labelledBy, label, className = '', scrimClassName = '', children, dismissible = true, role = 'dialog' }) {
  const panelRef = useRef(null);
  useOverlay(open, dismissible ? onClose : () => {}, panelRef);
  if (!open) return null;
  return (
    <Portal>
      <div className={'c-scrim ' + scrimClassName} onMouseDown={event => { if (dismissible && event.target === event.currentTarget) onClose?.(); }}>
        <section ref={panelRef} tabIndex={-1} className={'c-sheet ' + className} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
          {children}
        </section>
      </div>
    </Portal>
  );
}

// Anchored popover (menus, selects). Positioned under the anchor, kept inside the viewport.
export function Popover({ open, onClose, anchorRef, align = 'right', className = '', role = 'menu', label, id, onKeyDown, children, matchWidth = false }) {
  const panelRef = useRef(null);
  const [style, setStyle] = useState({ visibility: 'hidden' });
  useOverlay(open, onClose, panelRef, { autoFocus: false });

  useIsoLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = matchWidth ? anchor.width : panel.offsetWidth;
      const height = panel.offsetHeight;
      const gap = 8;
      let left = align === 'left' ? anchor.left : anchor.right - width;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = anchor.bottom + gap;
      if (top + height > window.innerHeight - 8 && anchor.top - gap - height > 8) top = anchor.top - gap - height;
      setStyle({ top, left, ...(matchWidth ? { width } : {}), maxHeight: Math.max(160, window.innerHeight - top - 16) });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, align, matchWidth]);

  if (!open) return null;
  return (
    <Portal>
      <div className="c-scrim c-scrim--popover" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }} />
      <div ref={panelRef} id={id} className={'c-menu c-popover ' + className} role={role} aria-label={label} style={style} onKeyDown={onKeyDown}>
        {children}
      </div>
    </Portal>
  );
}
