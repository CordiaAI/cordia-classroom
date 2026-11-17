import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BodyPortal from './BodyPortal';

const GAP = 14;
const EDGE = 8;
const EXIT_MS = 100;

// A menu that opens beside the shell: More tools to the left of the rail, Recent chats to the right
// of the folded sidebar. Its bottom lines up with its button and it never covers the pane it came
// from. Opens with a 150ms fade from 6px out (none when opened from the keyboard, DESIGN-SPEC 6.1),
// closes with a 100ms fade. Arrow keys, Home and End move, Escape closes and returns focus.
// items: [{ key, label, meta, icon, href, onSelect, current }]
export default function ShellMenu({ open, onClose, anchorRef, side = 'left', label, items, instant = false }) {
  const [phase, setPhase] = useState(open ? 'open' : 'closed'); // open | closing | closed
  const [place, setPlace] = useState(null);
  const listRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) setPhase('open');
    else setPhase(current => {
      if (current === 'closed') return current;
      timer.current = setTimeout(() => setPhase('closed'), EXIT_MS);
      return 'closing';
    });
    return () => clearTimeout(timer.current);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function position() {
      const button = anchorRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const pane = button.closest('.c-rail, .c-side')?.getBoundingClientRect() || rect;
      const bottom = Math.max(EDGE, window.innerHeight - rect.bottom - 6);
      setPlace(side === 'left' ? { bottom, right: window.innerWidth - pane.left + GAP } : { bottom, left: pane.right + GAP });
    }
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open, anchorRef, side]);

  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => listRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true }));
    const onKey = event => { if (event.key === 'Escape') { event.preventDefault(); onClose(true); } };
    const onPointer = event => {
      if (listRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, anchorRef]);

  function onKeyDown(event) {
    const list = [...listRef.current.querySelectorAll('[role="menuitem"]')];
    const index = list.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) { event.preventDefault(); list[(index + move + list.length) % list.length]?.focus(); }
    if (event.key === 'Home') { event.preventDefault(); list[0]?.focus(); }
    if (event.key === 'End') { event.preventDefault(); list[list.length - 1]?.focus(); }
    if (event.key === 'Tab') onClose(false);
  }

  if (phase === 'closed' || !place) return null;
  return (
    <BodyPortal>
      <div ref={listRef} role="menu" aria-label={label} onKeyDown={onKeyDown} style={place}
        className={`c-menu c-shell-menu is-${side} is-${phase}${instant ? ' is-instant' : ''}`}>
        {items.map(item => {
          const body = (
            <>
              {item.icon && <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />}
              <span className="c-menu-text">
                <span className="c-menu-label">{item.label}</span>
                {item.meta && <span className="c-menu-meta">{item.meta}</span>}
              </span>
            </>
          );
          const className = item.meta ? 'has-meta' : undefined;
          const current = item.current ? 'page' : undefined;
          return item.href ? (
            <Link key={item.key} href={item.href} role="menuitem" tabIndex={-1} className={className} aria-current={current}
              onClick={() => { onClose(false); item.onSelect?.(); }}>{body}</Link>
          ) : (
            <button key={item.key} type="button" role="menuitem" tabIndex={-1} className={className} aria-current={current}
              onClick={() => { onClose(true); item.onSelect?.(); }}>{body}</button>
          );
        })}
      </div>
    </BodyPortal>
  );
}
