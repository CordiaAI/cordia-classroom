import { useEffect, useId, useRef, useState } from 'react';

export default function TutorSelect({ label, value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const preferred = root.querySelector('[role="option"][aria-selected="true"]:not(:disabled)');
    (preferred || root.querySelector('[role="option"]:not(:disabled)'))?.focus({ preventScroll: true });
    const dismiss = event => { if (!root.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  function navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...rootRef.current.querySelectorAll('[role="option"]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return (
    <div className="tutor-select" ref={rootRef}>
      <button ref={triggerRef} className="tutor-select-trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={listId} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
        <span>{selected?.label || label}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && !disabled && <div id={listId} className="tutor-select-options" role="listbox" aria-label={label} onKeyDown={navigate}>
        {options.map((option, index) => <button type="button" className="tutor-select-option" role="option" key={option.value} aria-selected={option.value === value} disabled={option.disabled} style={{ '--option-delay': `${Math.min(index, 24) * 35}ms` }} onClick={() => { onChange(option.value); close(); }}>
          {option.group && <small>{option.group}</small>}<span>{option.label}</span>{option.value === value && <span className="tutor-select-check" aria-hidden="true">✓</span>}
        </button>)}
      </div>}
    </div>
  );
}
