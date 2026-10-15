import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Popover } from './Overlay';

// A select with a glass list. Closes on Escape, outside click and selection.
export default function TutorSelect({ label, value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const root = document.getElementById(listId);
      (root?.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') || root?.querySelector('[role="option"]:not(:disabled)'))?.focus({ preventScroll: true });
    });
  }, [open]);

  function navigate(event) {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  let lastGroup = null;
  return (
    <div className="tutor-select">
      <button ref={triggerRef} className="tutor-select-trigger" type="button" aria-label={selected?.label ? `${selected.label}, ${label}` : label} aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? listId : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
        <span>{selected?.label || label}</span><ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Popover open={open && !disabled} onClose={() => setOpen(false)} anchorRef={triggerRef} align="left" matchWidth role="listbox" label={label} id={listId} className="tutor-select-options" onKeyDown={navigate}>
        {options.map(option => {
          const header = option.group && option.group !== lastGroup ? option.group : null;
          lastGroup = option.group || lastGroup;
          return (
            <div key={option.value} className="tutor-select-item">
              {header && <div className="tutor-select-group" role="presentation">{header}</div>}
              <button type="button" className="tutor-select-option" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => { onChange(option.value); setOpen(false); }}>
                <span>{option.label}</span>{option.value === value && <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </Popover>
    </div>
  );
}
