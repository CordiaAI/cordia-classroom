import { useEffect, useRef, useState } from 'react';
import { Check, Flag, GraduationCap } from 'lucide-react';
import ProgressRing from '../ProgressRing';
import { dueClock } from '../../lib/calendarViews.mjs';

// Pieces the four Calendar views share: class colours, the flag for anything due, the exam
// readiness ring, a deadline chip, and a small menu (Add study time, Plan on…, +N more).

export const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
export const SMALL_ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true };

// A class's colours as custom properties: --tone (the cover tint) and --tone-ink (its ink).
// Without a class (a lecture to-do), the neutral glass and muted ink.
export function toneStyle(cls, extra) {
  return cls ? { '--tone': `var(--cover-${cls.tone})`, '--tone-ink': `var(--cover-ink-${cls.tone})`, ...extra } : extra;
}

export function ClassTag({ cls, from, children }) {
  if (!cls) return from ? <span className="cal-tag cal-tag--plain">{from}</span> : null;
  return (
    <span className="cal-tag" style={toneStyle(cls)}>
      <span className="cal-dot" aria-hidden="true" />
      <span className="cal-tag-code">{cls.code}</span>
      {children}
    </span>
  );
}

export function DueIcon({ entry, size = 16 }) {
  const props = { size, strokeWidth: 1.75, 'aria-hidden': true };
  return entry.done ? <Check {...props} /> : <Flag {...props} />;
}

export function StudyIcon({ size = 16 }) {
  return <GraduationCap size={size} strokeWidth={1.75} aria-hidden="true" />;
}

// The readiness ring (DESIGN-SPEC 3.3): Learn's own number for the exam's review set.
export function ReadyRing({ percent, size = 36, stroke, label = 'the exam' }) {
  return <ProgressRing value={percent / 100} size={size} stroke={stroke || (size >= 100 ? 8 : size >= 30 ? 3 : 2.25)} label={false} title={`${percent}% ready for ${label}`} />;
}

// What a screen reader hears for a deadline.
export function dueLabel(entry) {
  const what = entry.exam ? 'Exam' : entry.type === 'quiz' ? 'Quiz' : 'Due';
  return `${what}: ${entry.title}${entry.cls ? `, ${entry.cls.code}` : ''}, ${dueClock(entry)}${entry.done ? ', done' : ''}`;
}

// A deadline as a chip (Week's Due strip, Month cells): the flag in the class's ink, the title,
// struck through and faded once done. Canvas items open in Canvas, lecture to-dos in Cordia.
export function DueChip({ entry, compact = false }) {
  const className = `cal-chip${entry.done ? ' is-done' : ''}${compact ? ' cal-chip--compact' : ''}`;
  const body = (
    <>
      {compact ? <span className="cal-dot" aria-hidden="true" /> : <DueIcon entry={entry} size={14} />}
      <span className="cal-chip-text">{entry.title}</span>
    </>
  );
  const common = { className, style: toneStyle(entry.cls), title: dueLabel(entry), 'aria-label': dueLabel(entry) };
  if (entry.url && entry.internal) return <a href={entry.url} {...common}>{body}</a>;
  if (entry.url) return <a href={entry.url} target="_blank" rel="noreferrer" {...common}>{body}</a>;
  return <span {...common} role="note">{body}</span>;
}

// A small menu under its button: role="menu", arrow keys move, Escape closes and puts focus back.
// items: [{ key, label, detail?, onSelect, disabled? }]
export function MenuButton({ label, className = 'c-btn c-btn--quiet', icon = null, items, heading, empty = 'Nothing to pick', disabled = false, align = 'start', menuLabel, triggerProps = {} }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const first = list.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const away = event => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  function onKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...(list.current?.querySelectorAll('[role="menuitem"]') || [])];
    const at = all.indexOf(document.activeElement);
    all[(at + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  }
  return (
    <span className="cal-menu-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className={className} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)} {...triggerProps}>
        {icon}{label}
      </button>
      {open && (
        <div ref={list} className={`c-menu cal-menu cal-menu--${align}`} role="menu" aria-label={menuLabel || (typeof label === 'string' ? label : undefined)}>
          {heading && <p className="cal-menu-head">{heading}</p>}
          {items.length ? items.map(item => (
            <button key={item.key} type="button" role="menuitem" tabIndex={-1} aria-disabled={item.disabled || undefined}
              onClick={() => { if (item.disabled) return; setOpen(false); trigger.current?.focus(); item.onSelect(); }}>
              <span className="cal-menu-label">{item.label}</span>
              {item.detail && <span className="cal-menu-detail">{item.detail}</span>}
            </button>
          )) : <p className="cal-menu-head">{empty}</p>}
        </div>
      )}
    </span>
  );
}

// Styles every view uses (global: the pieces above render inside each view's own markup).
export function SharedStyles() {
  return (
    <style jsx global>{`
      .cal-dot { flex: 0 0 auto; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--tone-ink, var(--muted)); }
      .cal-tag { display: inline-flex; align-items: center; gap: 0.375rem; min-width: 0; color: var(--tone-ink, var(--muted)); font: 600 0.8125rem/1.3 var(--font-sans); }
      .cal-tag--plain { color: var(--muted); font-weight: 500; }
      .cal-tag-code { white-space: nowrap; }
      .cal-chip {
        display: flex; align-items: center; gap: 0.375rem; min-width: 0; min-height: 1.75rem; padding: 0.25rem 0.5rem;
        border-radius: var(--r-input); color: var(--ink); text-decoration: none;
        background: color-mix(in srgb, var(--tone, var(--glass-inner)) 72%, transparent);
        box-shadow: inset 0 0 0 0.0625rem var(--hairline);
        font: 600 0.8125rem/1.3 var(--font-sans);
        transition: transform 180ms var(--ease), box-shadow 180ms var(--ease);
      }
      .cal-chip .lucide { flex: 0 0 auto; color: var(--tone-ink, var(--muted)); }
      .cal-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cal-chip.is-done { opacity: 0.62; }
      .cal-chip.is-done .cal-chip-text { text-decoration: line-through; color: var(--muted); }
      .cal-chip--compact { min-height: 1.5rem; padding: 0.125rem 0.4375rem; font-weight: 500; }
      @media (hover: hover) { a.cal-chip:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); } }
      a.cal-chip:active { transform: scale(0.97); }
      .cal-menu-wrap { position: relative; display: inline-flex; min-width: 0; }
      .cal-menu { position: absolute; top: calc(100% + 0.375rem); z-index: 40; display: grid; min-width: 15rem; max-width: min(20rem, calc(100vw - 2rem)); max-height: 20rem; overflow-y: auto; padding: 0.375rem; }
      .cal-menu--start { left: 0; }
      .cal-menu--end { right: 0; }
      .cal-menu [role='menuitem'] { display: grid; gap: 0.125rem; min-height: 2.75rem; padding: 0.5rem 0.75rem; text-align: left; }
      .cal-menu-label { font: 600 0.875rem/1.3 var(--font-sans); color: var(--ink); }
      .cal-menu-detail { font: 500 0.8125rem/1.3 var(--font-sans); color: var(--muted); }
      .cal-menu-head { margin: 0; padding: 0.5rem 0.75rem 0.25rem; font: 600 0.8125rem/1.3 var(--font-sans); color: var(--muted); }
      @media (prefers-reduced-motion: reduce) { .cal-chip { transition: none; } }
    `}</style>
  );
}
