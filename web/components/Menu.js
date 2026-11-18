import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import BodyPortal from './BodyPortal';

const GAP = 6;
const EDGE = 8;

// A ⋯ button with a small glass menu. items: [{ label, meta, icon, onSelect, danger, items, current, disabled }]
// trigger and triggerClassName: a different button face (the composer's class picker).
// An item with `items` opens a second level (e.g. Move to class), with a way back (its first row, or ←).
// disabled items stay in the list for the keyboard and screen readers but do nothing; note: one
// plain line under the items (why they are disabled). triggerRef: the ⋯ button, for callers that
// return focus to it. Arrows, Home and End move; Escape steps back out of a second level first
// (focus returns to the row that opened it) and then closes, returning focus to the button; Tab closes
// and carries on from the button; choosing an item also returns focus to the button (the item may then
// move focus somewhere else).
// The menu renders at the end of <body>, placed under its button (above it when there's no room
// below), so a list row or card never covers it.
export default function Menu({ label = 'More', items, align = 'right', trigger, triggerClassName = 'c-icon-btn', note = '', triggerRef = null }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(null);
  const [place, setPlace] = useState(null); // { top, left }
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();
  const opener = useRef(''); // the row that opened the second level, to land back on

  function position() {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = align === 'left' ? anchor.left : anchor.right - width;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE);
    const below = anchor.bottom + GAP;
    const fitsBelow = below + height <= window.innerHeight - EDGE;
    const top = fitsBelow || anchor.top - GAP - height < EDGE ? below : anchor.top - GAP - height;
    setPlace({ top: Math.max(EDGE, top), left });
  }

  useLayoutEffect(() => { if (open) position(); }, [open, sub]);

  useEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    const back = !sub && opener.current ? [...menu.querySelectorAll('[role="menuitem"]')].find(item => item.dataset.item === opener.current) : null;
    opener.current = '';
    (back || menu?.querySelector('[role="menuitem"][aria-current="true"]') || menu?.querySelector(sub ? '[role="menuitem"]:not(.c-menu-back)' : '[role="menuitem"]'))?.focus();
    const inside = target => rootRef.current?.contains(target) || menuRef.current?.contains(target);
    const onDown = event => { if (!inside(event.target)) close(false); };
    const onScroll = event => { if (!menuRef.current?.contains(event.target)) close(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', position);
    };
  }, [open, sub]);

  function close(focus = true) {
    opener.current = '';
    setOpen(false);
    setSub(null);
    setPlace(null);
    if (focus) buttonRef.current?.focus();
  }

  function onKeyDown(event) {
    event.stopPropagation();
    const list = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const index = list.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); if (sub) { opener.current = sub.key || ''; setSub(null); } else close(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
    if (event.key === 'Home') { event.preventDefault(); list[0]?.focus(); }
    if (event.key === 'End') { event.preventDefault(); list[list.length - 1]?.focus(); }
    if (event.key === 'ArrowLeft' && sub) { event.preventDefault(); opener.current = sub.key || ''; setSub(null); }
    if (event.key === 'Tab') close(true);
  }

  const shown = sub ? sub.items : items;

  return (
    <div className="c-menu-wrap" ref={rootRef} onClick={event => event.stopPropagation()}>
      <button ref={element => { buttonRef.current = element; if (triggerRef) triggerRef.current = element; }} type="button" className={triggerClassName} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => (open ? close(false) : setOpen(true))}>
        {trigger || <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {open && (
        <BodyPortal>
          <div
            ref={menuRef}
            id={menuId}
            className={'c-menu is-floating' + (sub ? ' is-sub' : '')}
            role="menu"
            aria-label={sub ? sub.label : label}
            onKeyDown={onKeyDown}
            onClick={event => event.stopPropagation()}
            style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
          >
            {sub && (
              <button type="button" role="menuitem" className="c-menu-back" onClick={() => { opener.current = sub.key || ''; setSub(null); }}>
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />{sub.label}
              </button>
            )}
            {shown.map(item => (
              <button
                key={item.key || item.label}
                type="button"
                role="menuitem"
                className={(item.danger ? 'is-danger' : '') + (item.meta ? ' has-meta' : '')}
                data-item={item.key || undefined}
                aria-current={item.current ? 'true' : undefined}
                aria-disabled={item.disabled ? 'true' : undefined}
                onClick={() => {
                  if (item.disabled) return;
                  if (item.items) { setSub(item); return; }
                  close(true);
                  item.onSelect?.();
                }}
              >
                {item.icon && <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />}
                <span className="c-menu-text">
                  <span className="c-menu-label">{item.label}</span>
                  {item.meta && <span className="c-menu-meta">{item.meta}</span>}
                </span>
              </button>
            ))}
            {note && !sub && <p className="c-menu-note">{note}</p>}
          </div>
        </BodyPortal>
      )}
    </div>
  );
}
