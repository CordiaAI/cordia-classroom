import { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

// A ⋯ button with a small glass menu. items: [{ label, icon, onSelect, danger, items }]
// An item with `items` opens a second level (e.g. Move to class).
export default function Menu({ label = 'More', items, align = 'right', trigger }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    rootRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onDown = event => { if (!rootRef.current?.contains(event.target)) close(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, sub]);

  function close(focus = true) {
    setOpen(false);
    setSub(null);
    if (focus) buttonRef.current?.focus();
  }

  function onKeyDown(event) {
    event.stopPropagation();
    const list = [...rootRef.current.querySelectorAll('[role="menuitem"]')];
    const index = list.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); if (sub) setSub(null); else close(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
  }

  const shown = sub ? sub.items : items;

  return (
    <div className="c-menu-wrap" ref={rootRef} onClick={event => event.stopPropagation()}>
      <button ref={buttonRef} type="button" className="c-icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
        {trigger || <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      {open && (
        <div id={menuId} className="c-menu" role="menu" aria-label={sub ? sub.label : label} onKeyDown={onKeyDown} style={{ [align]: 0, top: 44 }}>
          {shown.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'is-danger' : undefined}
              aria-current={item.current ? 'true' : undefined}
              disabled={item.disabled}
              onClick={() => {
                if (item.items) { setSub(item); return; }
                close(false);
                item.onSelect?.();
              }}
            >
              {item.icon && <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
