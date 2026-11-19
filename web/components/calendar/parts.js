import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Flag, GraduationCap } from 'lucide-react';
import ProgressRing from '../ProgressRing';
import { DAY_END_HOUR, DAY_START_HOUR, dueClock, span } from '../../lib/calendarViews.mjs';

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

// The ring's track alone, in the same place and size: while readiness is still loading, and for an
// exam with no review set yet (the exam card keeps its shape either way).
export function EmptyRing({ size = 36, stroke }) {
  const width = stroke || (size >= 100 ? 8 : size >= 30 ? 3 : 2.25);
  const radius = (size - width) / 2;
  return (
    <span className="c-ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size}><circle className="c-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={width} /></svg>
    </span>
  );
}

// What a screen reader hears for a deadline.
export function dueLabel(entry) {
  const what = entry.exam ? 'Exam' : entry.type === 'quiz' ? 'Quiz' : 'Due';
  return `${what}: ${entry.title}${entry.cls ? `, ${entry.cls.code}` : ''}, ${dueClock(entry)}${entry.done ? ', done' : ''}`;
}

// A deadline as a chip (Week's Due strip, Month cells): the flag in the class's ink, the title,
// struck through and faded once done. Canvas items open in Canvas, lecture to-dos in Cordia. An
// exam (onOpen given) is olive, like the grid's, and opens its review.
export function DueChip({ entry, compact = false, onOpen, readiness }) {
  const exam = Boolean(onOpen);
  const className = `cal-chip${entry.done ? ' is-done' : ''}${compact ? ' cal-chip--compact' : ''}${exam ? ' is-exam' : ''}`;
  const body = (
    <>
      {compact ? <span className="cal-dot" aria-hidden="true" /> : <DueIcon entry={entry} size={14} />}
      <span className="cal-chip-text">{entry.title}</span>
    </>
  );
  const label = `${dueLabel(entry)}${readiness ? `, ${readiness.percent}% ready` : ''}`;
  const common = { className, style: exam ? undefined : toneStyle(entry.cls), title: label, 'aria-label': label };
  if (exam) return <button type="button" {...common} onClick={() => onOpen(entry)}>{body}</button>;
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

// Study time wholly before 8 AM or after 10 PM, outside the time grid (Week's bands above and below
// the grid, the Month panel's timeline): "2 earlier" or "1 later", a menu that opens each block.
const hourText = hour => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
export function EdgeMenu({ side, blocks, day, onOpen, align = 'start' }) {
  const when = side === 'earlier' ? `before ${hourText(DAY_START_HOUR)}` : `after ${hourText(DAY_END_HOUR)}`;
  const date = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const Arrow = side === 'earlier' ? ArrowUp : ArrowDown;
  return (
    <MenuButton className="cal-edge-btn" align={align} icon={<Arrow size={14} strokeWidth={1.75} aria-hidden="true" />}
      label={`${blocks.length} ${side}`} menuLabel={`Study time ${when}, ${date}`}
      triggerProps={{ 'aria-label': `${blocks.length} study ${blocks.length === 1 ? 'time' : 'times'} ${when}, ${date}` }}
      items={blocks.map(block => ({
        key: block.key, label: block.title,
        detail: `${span(block.start, block.end)}${block.cls ? ` · ${block.cls.code}` : ''}${block.done ? ' · done' : ''}`,
        onSelect: () => onOpen(block),
      }))} />
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
      .cal-chip.is-done { background: var(--glass-inner); }
      .cal-chip.is-done .lucide { color: var(--muted); }
      .cal-chip.is-done .cal-chip-text { text-decoration: line-through; color: var(--muted); }
      .cal-chip--compact { min-height: 1.5rem; padding: 0.125rem 0.5rem; font-weight: 500; }
      button.cal-chip { width: 100%; border: 0; text-align: left; cursor: pointer; }
      .cal-chip.is-exam { color: var(--on-olive); background: var(--olive-glass-sheen), var(--olive); box-shadow: var(--olive-glass-shadow); }
      .cal-chip.is-exam .lucide { color: currentColor; }
      @media (hover: hover) {
        :is(a, button).cal-chip:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); }
        .cal-chip.is-exam:hover { box-shadow: var(--olive-glass-shadow-hover); }
      }
:is(a, button).cal-chip:active { transform: scale(0.97); }
      .cal-menu-wrap { position: relative; display: inline-flex; min-width: 0; }
      .cal-menu { position: absolute; top: calc(100% + 0.375rem); z-index: 40; display: grid; min-width: 15rem; max-width: min(20rem, calc(100vw - 2rem)); max-height: 20rem; overflow-y: auto; padding: 0.375rem; }
      .cal-menu--start { left: 0; }
      .cal-menu--end { right: 0; }
      .cal-menu [role='menuitem'] { display: grid; gap: 0.125rem; min-height: 2.75rem; padding: 0.5rem 0.75rem; text-align: left; }
      .cal-menu-label { font: 600 0.875rem/1.3 var(--font-sans); color: var(--ink); }
      .cal-menu-detail { font: 500 0.8125rem/1.3 var(--font-sans); color: var(--muted); }
      .cal-menu-head { margin: 0; padding: 0.5rem 0.75rem 0.25rem; font: 600 0.8125rem/1.3 var(--font-sans); color: var(--muted); }
      .cal-edge-btn {
        display: inline-flex; align-items: center; gap: 0.25rem; min-height: 1.75rem; padding: 0 0.625rem; border: 0; border-radius: var(--r-pill);
        background: var(--surface-raised); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge);
        color: var(--ink); font: 600 0.8125rem/1 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer;
        transition: transform 180ms var(--ease), box-shadow 180ms var(--ease);
      }
      .cal-edge-btn .lucide { width: 0.875rem; height: 0.875rem; color: currentColor; }
      @media (hover: hover) { .cal-edge-btn:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-lift); } }
      .cal-edge-btn:active { transform: scale(0.97); }
      .cal-edge-btn[aria-expanded='true'] { box-shadow: inset 0 0 0 0.125rem var(--olive), var(--glass-shadow-edge); }
      /* A drag held past the deadline: the pointer says it won't go there (the toast says why). */
      html.cal-refusing, html.cal-refusing * { cursor: not-allowed !important; }
      @media (prefers-reduced-motion: reduce) { .cal-chip, .cal-edge-btn { transition: none; } .cal-edge-btn:hover, .cal-edge-btn:active { transform: none; } }
    `}</style>
  );
}
