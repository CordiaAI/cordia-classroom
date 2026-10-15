import { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { Popover } from './Overlay';

// A ⋯ button with a glass menu. items: [{ label, icon, onSelect, danger, items, current, disabled }]
// An item with `items` opens a second level (e.g. Move to class).
export default function Menu({ label = 'More', items, align = 'right', trigger, triggerClassName = 'c-icon-btn' }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => document.getElementById(menuId)?.querySelector('[role="menuitem"]:not([disabled])')?.focus());
  }, [open, sub]);

  function close() {
    setOpen(false);
    setSub(null);
  }

  function onKeyDown(event) {
    const list = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not([disabled])')];
    const index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
    if (event.key === 'ArrowLeft' && sub) { event.preventDefault(); setSub(null); }
  }

  const shown = sub ? sub.items : items;

  return (
    <div className="c-menu-wrap" onClick={event => event.stopPropagation()}>
      <button ref={buttonRef} type="button" className={triggerClassName} aria-label={label} title={trigger ? undefined : label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
        {trigger || <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      <Popover open={open} onClose={close} anchorRef={buttonRef} align={align} id={menuId} label={sub ? sub.label : label} onKeyDown={onKeyDown}>
        {shown?.map((item, index) => (
          <button
            key={`${item.label}-${index}`}
            type="button"
            role="menuitem"
            className={item.danger ? 'is-danger' : undefined}
            aria-current={item.current ? 'true' : undefined}
            disabled={item.disabled}
            onClick={() => {
              if (item.items) { setSub(item); return; }
              close();
              item.onSelect?.();
            }}
          >
            {item.icon && <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />}
            {item.label}
          </button>
        ))}
      </Popover>
    </div>
  );
}
