import { useEffect, useRef, useState } from 'react';
import { DAY_END_HOUR, DAY_START_HOUR, addDays, clock, dayEntries, gridBox, lanes, monthCell, monthGrid, nowLine, sameDay, span } from '../../lib/calendarViews.mjs';
import { dayKey } from '../../lib/learnEngine.mjs';
import { ClassTag, DueIcon, ReadyRing, StudyIcon, toneStyle } from './parts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
const hourLabel = hour => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
const longDay = day => day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

function firstPick(anchor, now) {
  return anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear() ? now : new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}

// Month (C): the month as a grid, each day with up to two deadline chips, "+N more" and its study
// count; today outlined. Picking a day (click, or arrow keys) shows its deadlines and its timeline
// in the panel at the right.
export default function MonthView({ deadlines, blocks, readiness, now, anchor, onOpen, onPickMonth }) {
  const [picked, setPicked] = useState(() => firstPick(anchor, now));
  const grid = useRef(null);
  const focusNext = useRef(false);
  useEffect(() => {
    setPicked(current => (current.getMonth() === anchor.getMonth() && current.getFullYear() === anchor.getFullYear() ? current : firstPick(anchor, now)));
  }, [anchor.getFullYear(), anchor.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    grid.current?.querySelector('.mo-cell[tabindex="0"]')?.focus();
  });

  const cells = monthGrid(anchor);
  const month = anchor.getMonth();

  function pick(day, { focus = false } = {}) {
    focusNext.current = focus;
    setPicked(day);
    if (day.getMonth() !== month || day.getFullYear() !== anchor.getFullYear()) onPickMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  function onKeyDown(event, day) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    let next = step ? addDays(day, step) : null;
    if (event.key === 'Home') next = addDays(day, -((day.getDay() + 6) % 7));
    if (event.key === 'End') next = addDays(day, 6 - ((day.getDay() + 6) % 7));
    if (!next) return;
    event.preventDefault();
    pick(next, { focus: true });
  }

  const today = sameDay(picked, now);
  const entries = dayEntries(picked, deadlines, blocks);
  const due = entries.filter(entry => entry.kind === 'due');
  const study = entries.filter(entry => entry.kind === 'study');
  const placed = lanes(study);
  const line = today ? nowLine(now) : null;

  return (
    <div className="mo">
      <section className="c-card mo-grid-card" aria-label={anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}>
        <div className="mo-grid" role="grid" ref={grid} aria-label="Pick a day to see it beside the month">
          <div className="mo-row mo-head" role="row">
            {WEEKDAYS.map(name => <span key={name} role="columnheader" className="mo-dow">{name}</span>)}
          </div>
          {Array.from({ length: 6 }, (_, row) => (
            <div key={row} className="mo-row" role="row">
              {cells.slice(row * 7, row * 7 + 7).map(day => {
                const inMonth = day.getMonth() === month;
                const cell = monthCell(day, deadlines, blocks);
                const isToday = sameDay(day, now);
                const isPicked = sameDay(day, picked);
                const label = `${longDay(day)}${isToday ? ', today' : ''}: ${cell.due.length + cell.more ? `${cell.due.length + cell.more} due` : 'nothing due'}${cell.study ? `, ${cell.study} study` : ''}`;
                return (
                  <div key={dayKey(day)} role="gridcell" aria-selected={isPicked} className="mo-gridcell">
                    <button type="button" tabIndex={isPicked ? 0 : -1} aria-label={label} aria-current={isToday ? 'date' : undefined}
                      className={`mo-cell${inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}${isPicked ? ' is-picked' : ''}`}
                      onClick={() => pick(day)} onKeyDown={event => onKeyDown(event, day)}>
                      <span className="mo-top" aria-hidden="true">
                        <span className="mo-num">{day.getDate()}</span>
                        {cell.study > 0 && <span className="mo-study"><StudyIcon size={14} />{cell.study}</span>}
                      </span>
                      <span className="mo-chips" aria-hidden="true">
                        {cell.due.map(entry => (
                          <span key={entry.key} className={`mo-chip${entry.done ? ' is-done' : ''}`} style={toneStyle(entry.cls)}>
                            <span className="cal-dot" /><span className="mo-chip-text">{entry.title}</span>
                          </span>
                        ))}
                        {cell.more > 0 && <span className="mo-more">+{cell.more} more</span>}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <aside className="c-card mo-panel" aria-labelledby="mo-panel-date">
        <p className="mo-panel-kicker">{today ? 'Today' : picked.toLocaleDateString('en-US', { weekday: 'long' })}</p>
        <h2 id="mo-panel-date" className="mo-panel-date" aria-live="polite">{picked.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
        {due.length > 0 && (
          <ul className="mo-due">
            {due.map(entry => {
              const ready = entry.exam && readiness[entry.id];
              const body = (
                <>
                  <span className="mo-due-icon"><DueIcon entry={entry} size={18} /></span>
                  <span className="mo-due-main">
                    <span className="mo-due-title">{entry.title}</span>
                    <span className="mo-due-meta"><ClassTag cls={entry.cls} from={entry.from} />{ready ? <span className="mo-ready"><ReadyRing percent={ready.percent} size={16} label={entry.title} />{ready.percent}% ready</span> : null}</span>
                  </span>
                  <span className="mo-due-time">{entry.exam && !entry.allDay ? clock(entry.at) : entry.allDay ? 'All day' : `Due ${clock(entry.at)}`}</span>
                </>
              );
              const className = `mo-due-row${entry.done ? ' is-done' : ''}`;
              return (
                <li key={entry.key} style={toneStyle(entry.cls)}>
                  {entry.exam
                    ? <button type="button" className={className} onClick={() => onOpen(entry)}>{body}</button>
                    : entry.url
                      ? <a className={className} href={entry.url} target={entry.internal ? undefined : '_blank'} rel={entry.internal ? undefined : 'noreferrer'}>{body}</a>
                      : <div className={className}>{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mo-line" aria-label={`Study time ${today ? 'today' : `on ${longDay(picked)}`}`} role="list">
          <div className="mo-hours" aria-hidden="true">
            {HOURS.map(hour => <span key={hour} style={{ top: `${((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}>{hourLabel(hour)}</span>)}
          </div>
          <div className="mo-track">
            {line !== null && <span className="mo-now" style={{ top: `${line * 100}%` }} aria-hidden="true" />}
            {study.map(block => {
              const box = gridBox(block.start, block.end);
              if (box.hidden) return null;
              const lane = placed[block.key] || { lane: 0, lanes: 1 };
              return (
                <span key={block.key} role="listitem" className="mo-slot" style={{ top: `${box.top * 100}%`, height: `${box.height * 100}%`, left: `${(lane.lane / lane.lanes) * 100}%`, width: `${100 / lane.lanes}%` }}>
                  <button type="button" className={`mo-block${block.done ? ' is-done' : ''}`} style={toneStyle(block.cls)} onClick={() => onOpen(block)}
                    aria-label={`${block.fullTitle}${block.cls ? `, ${block.cls.code}` : ''}, ${span(block.start, block.end)}${block.done ? ', done' : ''}`}>
                    <span className="mo-block-title">{block.title}</span>
                    <span className="mo-block-time">{span(block.start, block.end)}{block.cls ? ` · ${block.cls.code}` : ''}</span>
                  </button>
                </span>
              );
            })}
          </div>
          {!study.length && <p className="mo-free">No study time planned.</p>}
        </div>
      </aside>

      <style jsx>{`
        .mo { display: grid; gap: 1rem; align-items: start; min-width: 0; }
        @media (min-width: 1200px) { .mo { grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem); } }
        .mo-grid-card { min-width: 0; padding: 0.75rem 1rem 1rem; }
        .mo-grid { display: grid; gap: 0.375rem; }
        .mo-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.375rem; }
        .mo-dow { display: grid; place-items: center; height: 1.75rem; color: var(--muted); font: 600 0.875rem/1 var(--font-sans); }
        .mo-gridcell { display: grid; min-width: 0; }
        .mo-cell {
          display: flex; flex-direction: column; gap: 0.3125rem; min-width: 0; min-height: 6.5rem; padding: 0.5rem 0.5rem 0.4375rem;
          border: 0; border-radius: var(--r-input); text-align: left; color: var(--ink); cursor: pointer;
          background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline);
          transition: transform 180ms var(--ease), box-shadow 180ms var(--ease);
        }
        .mo-cell.is-out { background: transparent; box-shadow: none; }
        .mo-cell.is-out .mo-num { color: var(--muted); font-weight: 500; }
        @media (hover: hover) { .mo-cell:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); } }
        .mo-cell:active { transform: scale(0.98); }
        .mo-cell.is-picked { background: var(--selected-glass); box-shadow: var(--selected-glass-shadow); }
        .mo-cell.is-today { box-shadow: inset 0 0 0 0.125rem var(--olive); }
        .mo-cell.is-today.is-picked { box-shadow: inset 0 0 0 0.125rem var(--olive), var(--selected-glass-shadow); }
        .mo-top { display: flex; align-items: center; justify-content: space-between; gap: 0.25rem; min-width: 0; }
        .mo-num { font: 600 1rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .mo-cell.is-today .mo-num { color: var(--olive-ink); }
        .mo-study { display: inline-flex; align-items: center; gap: 0.25rem; min-width: 0; overflow: hidden; color: var(--muted); font: 500 0.8125rem/1 var(--font-sans); white-space: nowrap; }
        .mo-chips { display: grid; gap: 0.25rem; min-width: 0; }
        .mo-chip { display: flex; align-items: center; gap: 0.3125rem; min-width: 0; min-height: 1.5rem; padding: 0.125rem 0.375rem; border-radius: 0.5rem; background: color-mix(in srgb, var(--tone, var(--glass-inner)) 78%, transparent); font: 600 0.8125rem/1.2 var(--font-sans); }
        .mo-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mo-chip.is-done { opacity: 0.62; }
        .mo-chip.is-done .mo-chip-text { text-decoration: line-through; color: var(--muted); }
        .mo-more { padding: 0 0.375rem; color: var(--olive-ink); font: 600 0.8125rem/1.2 var(--font-sans); }

        .mo-panel { display: grid; gap: 0.75rem; min-width: 0; padding: 1.25rem; }
        .mo-panel-kicker { margin: 0; color: var(--muted); font: 600 0.9375rem/1.2 var(--font-sans); }
        .mo-panel-date { margin: -0.375rem 0 0; color: var(--ink); font: 600 1.875rem/1.15 var(--font-display); letter-spacing: -0.01em; }
        .mo-due { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
        .mo-due-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; width: 100%; min-height: 3.5rem; padding: 0.625rem 0.875rem; border: 0; border-radius: var(--r-row); text-align: left; color: var(--ink); text-decoration: none; background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline); cursor: pointer; transition: transform 180ms var(--ease), box-shadow 180ms var(--ease); }
        div.mo-due-row { cursor: default; }
        @media (hover: hover) { :is(a, button).mo-due-row:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); } }
        :is(a, button).mo-due-row:active { transform: scale(0.98); }
        .mo-due-icon { display: grid; color: var(--tone-ink, var(--muted)); }
        .mo-due-main { display: grid; gap: 0.125rem; min-width: 0; }
        .mo-due-title { overflow: hidden; font: 600 1rem/1.3 var(--font-sans); text-overflow: ellipsis; }
        .mo-due-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 0.625rem; align-items: center; }
        .mo-ready { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--ink); font: 600 0.8125rem/1 var(--font-sans); }
        .mo-due-time { color: var(--muted); font: 600 0.875rem/1.2 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .mo-due-row.is-done { opacity: 0.62; }
        .mo-due-row.is-done .mo-due-title { text-decoration: line-through; color: var(--muted); }
        .mo-line { position: relative; display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); height: calc(2.25rem * ${DAY_END_HOUR - DAY_START_HOUR}); margin: 0.75rem 0 0.5rem; }
        .mo-hours { position: relative; }
        .mo-hours span { position: absolute; right: 0.625rem; transform: translateY(-50%); color: var(--muted); font: 500 0.8125rem/1 var(--font-sans); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .mo-track { position: relative; background-image: linear-gradient(to bottom, var(--hairline) 0.0625rem, transparent 0.0625rem); background-size: 100% 2.25rem; border-bottom: 0.0625rem solid var(--hairline); }
        .mo-now { position: absolute; left: 0; right: 0; z-index: 3; height: 0.125rem; margin-top: -0.0625rem; background: var(--olive); pointer-events: none; }
        .mo-now::before { content: ''; position: absolute; left: -0.3125rem; top: -0.25rem; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--olive); }
        .mo-slot { position: absolute; z-index: 2; display: flex; padding: 0.0625rem 0 0.125rem 0.25rem; }
        .mo-block { flex: 1; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 0 0.5rem; min-width: 0; overflow: hidden; padding: 0.3125rem 0.625rem; border: 0; border-radius: var(--r-input); text-align: left; color: var(--ink); cursor: pointer;
          background: var(--glass-sheen), color-mix(in srgb, var(--tone, var(--glass-inner)) 82%, transparent); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); transition: transform 180ms var(--ease), box-shadow 180ms var(--ease); }
        @media (hover: hover) { .mo-block:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-lift); } }
        .mo-block:active { transform: scale(0.98); }
        .mo-block-title { min-width: 0; max-width: 100%; overflow: hidden; font: 600 0.9375rem/1.4 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
        .mo-block-time { overflow: hidden; color: var(--tone-ink, var(--muted)); font: 600 0.8125rem/1.6 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
        .mo-block.is-done { opacity: 0.6; }
        .mo-block.is-done .mo-block-title { text-decoration: line-through; color: var(--muted); }
        .mo-free { position: absolute; left: 4rem; top: 0.5rem; margin: 0; color: var(--muted); font: 500 0.875rem/1.3 var(--font-sans); }
        @media (prefers-reduced-motion: reduce) { .mo-cell, .mo-due-row, .mo-block { transition: none; } .mo-cell:hover, .mo-block:hover { transform: none; } }
      `}</style>
    </div>
  );
}
