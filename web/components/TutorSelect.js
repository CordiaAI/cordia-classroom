import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import BodyPortal from './BodyPortal';

// The list floats at the end of <body>, pinned to the trigger. Inline, it was clipped by the
// Tutor header, which scrolls inside the pane, so classes past the first few were unreachable.
function placeList(trigger) {
  const rect = trigger.getBoundingClientRect();
  const gap = 6, edge = 12, height = window.innerHeight;
  const below = height - rect.bottom - gap - edge;
  const above = rect.top - gap - edge;
  const place = { left: rect.left, width: rect.width };
  if (below >= 240 || below >= above) return { ...place, top: rect.bottom + gap, maxHeight: Math.min(360, below) };
  return { ...place, bottom: height - rect.top + gap, maxHeight: Math.min(360, above) };
}

export default function TutorSelect({ label, value, options, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const [place, setPlace] = useState(null);
  const listId = useId();
  const placed = Boolean(place);
  const selected = options.find(option => option.value === value);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => triggerRef.current && setPlace(placeList(triggerRef.current));
    update();
    // Scrolling the pane behind the list moves the trigger; the list follows it.
    const onScroll = event => { if (!listRef.current?.contains(event.target)) update(); };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => { setPlace(null); window.removeEventListener('resize', update); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  useEffect(() => {
    if (!open || !placed) return;
    const root = listRef.current;
    const preferred = root.querySelector('[role="option"][aria-selected="true"]:not(:disabled)');
    (preferred || root.querySelector('[role="option"]:not(:disabled)'))?.focus({ preventScroll: true });
    const dismiss = event => { if (!root.contains(event.target) && !rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, placed]);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  function navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...listRef.current.querySelectorAll('[role="option"]:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return (
    <div className="tutor-select" ref={rootRef}>
      <button ref={triggerRef} className="tutor-select-trigger" type="button" aria-label={selected?.label ? `${selected.label}, ${label}` : label} aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={listId} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
        <span>{selected?.label || label}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && !disabled && place && <BodyPortal><div ref={listRef} id={listId} className="tutor-select-options is-floating" role="listbox" aria-label={label} onKeyDown={navigate} style={place}>
        {options.map((option, index) => <button type="button" className="tutor-select-option" role="option" key={option.value} aria-selected={option.value === value} disabled={option.disabled} style={{ '--option-delay': `${Math.min(index, 24) * 35}ms` }} onClick={() => { onChange(option.value); close(); }}>
          {option.group && <small>{option.group}</small>}<span>{option.label}</span>{option.value === value && <Check className="tutor-select-check" aria-hidden="true" />}
        </button>)}
      </div></BodyPortal>}
    </div>
  );
}
