import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { DAY_END_HOUR, DAY_START_HOUR, GRID_MINUTES, clock, gridBox, lanes, nowLine, sameDay, sameSpan, shiftBlock, span, weekDays } from '../../lib/calendarViews.mjs';
import { dayKey } from '../../lib/learnEngine.mjs';
import { DueChip, MenuButton, ReadyRing, toneStyle } from './parts';

const STRIP_CHIPS = 2;
const KEY_SETTLE_MS = 800;
const EXAM_MINUTES = 90;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR - 1 }, (_, i) => DAY_START_HOUR + 1 + i);
const hourLabel = hour => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
const dayName = day => day.toLocaleDateString('en-US', { weekday: 'short' });
const longDay = day => day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// Week (A): a time grid from 8 AM to 10 PM with a Due strip over each day, study blocks as glass
// in their class's tint, timed exams as solid olive blocks, today's column tinted and an olive now
// line. A study block moves by dragging it (or its bottom edge, to change its length) or with the
// keyboard: arrows move it 15 minutes or a day, Shift with Up or Down changes its length.
export default function WeekView({ deadlines, blocks, readiness, now, weekStart, saving, onOpen, onMove }) {
  const days = weekDays(weekStart);
  const body = useRef(null);
  const drag = useRef(null);
  const keyed = useRef(null); // { timer } while arrow keys are moving a block
  const suppressClick = useRef('');
  const [draft, setDraft] = useState(null); // { id, start, end } shown in place of the saved time
  const [said, setSaid] = useState('');

  useEffect(() => () => clearTimeout(keyed.current?.timer), []);

  const weekDue = deadlines.filter(entry => days.some(day => sameDay(day, entry.at)));
  const timedExams = weekDue.filter(entry => entry.exam && !entry.allDay);
  const strip = weekDue.filter(entry => !(entry.exam && !entry.allDay));
  const saved = id => blocks.find(item => item.id === id);
  const where = ({ start, end }) => `${start.toLocaleDateString('en-US', { weekday: 'long' })}, ${span(start, end)}`;
  const line = days.some(day => sameDay(day, now)) ? nowLine(now) : null;

  function metrics() {
    const rect = body.current.getBoundingClientRect();
    const column = body.current.querySelector('.wk-col');
    return { minutePx: rect.height / GRID_MINUTES, columnPx: column ? column.getBoundingClientRect().width : rect.width / 7 };
  }

  // Keep a move inside the shown week.
  function dayShift(block, wanted) {
    const index = days.findIndex(day => sameDay(day, block.start));
    return Math.max(-index, Math.min(6 - index, wanted));
  }

  // A drag follows the pointer on the window, so it carries on wherever the pointer goes.
  function onPointerDown(event, block) {
    if (event.button !== 0 || block.done || saving.has(block.id)) return;
    const resize = Boolean(event.target.closest('[data-resize]'));
    const state = { block, resize, x: event.clientX, y: event.clientY, moved: false, next: null, ...metrics() };
    drag.current = state;
    const move = moveEvent => {
      const dx = moveEvent.clientX - state.x;
      const dy = moveEvent.clientY - state.y;
      if (!state.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      state.moved = true;
      const minutes = dy / state.minutePx;
      state.next = state.resize
        ? shiftBlock(state.block, { minutes, resize: true })
        : shiftBlock(state.block, { days: dayShift(state.block, Math.round(dx / state.columnPx)), minutes });
      setDraft({ id: state.block.id, ...state.next });
    };
    const end = cancelled => () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      drag.current = null;
      if (!state.moved) return;
      suppressClick.current = state.block.id; // the click that ends a drag doesn't open the block
      setDraft(null);
      if (!cancelled && state.next && !sameSpan(state.next, state.block)) {
        setSaid(`Moved to ${where(state.next)}`);
        onMove(state.block, state.next);
      }
    };
    const up = end(false);
    const cancel = end(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  // Arrow keys: the block moves at once and saves once the keys stop (or focus leaves it).
  function settle() {
    if (!keyed.current) return;
    clearTimeout(keyed.current.timer);
    const { block, next } = keyed.current;
    keyed.current = null;
    setDraft(null);
    if (next && !sameSpan(next, block)) onMove(block, next);
  }

  function onKeyDown(event, block) {
    if (block.done || saving.has(block.id)) return;
    if (event.key === 'Escape' && keyed.current) {
      event.preventDefault();
      clearTimeout(keyed.current.timer);
      keyed.current = null;
      setDraft(null);
      setSaid(`Move cancelled. ${block.title} stays at ${where(block)}`);
      return;
    }
    const step = { ArrowUp: [0, -15], ArrowDown: [0, 15], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
    if (!step || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const base = keyed.current?.next || block;
    const resize = event.shiftKey && step[0] === 0;
    const next = resize
      ? shiftBlock(base, { minutes: step[1], resize: true })
      : shiftBlock(base, { days: dayShift(base, step[0]), minutes: step[1] });
    setDraft({ id: block.id, ...next });
    setSaid(`${resize ? 'Length' : 'Time'}: ${where(next)}. Saves when you stop.`);
    clearTimeout(keyed.current?.timer);
    keyed.current = { block, next, timer: setTimeout(settle, KEY_SETTLE_MS) };
  }

  function onClick(block) {
    if (suppressClick.current === block.id) { suppressClick.current = ''; return; }
    onOpen(block);
  }

  const shown = block => (draft && draft.id === block.id ? { ...block, start: draft.start, end: draft.end } : block);

  return (
    <section className="c-card wk" aria-label="Week">
      <div className="wk-head">
        <span />
        {days.map(day => {
          const today = sameDay(day, now);
          return (
            <h2 key={dayKey(day)} className={`wk-day${today ? ' is-today' : ''}`} aria-label={`${today ? 'Today, ' : ''}${longDay(day)}`}>
              <span className="wk-day-name" aria-hidden="true">{dayName(day)}</span>
              <span className="wk-day-num" aria-hidden="true">{day.getDate()}</span>
            </h2>
          );
        })}
      </div>

      <div className="wk-strip">
        <span className="wk-strip-label"><Flag size={14} strokeWidth={1.75} aria-hidden="true" />Due</span>
        {days.map(day => {
          const due = strip.filter(entry => sameDay(entry.at, day));
          const rest = due.slice(STRIP_CHIPS);
          return (
            <div key={dayKey(day)} className="wk-strip-day">
              {due.slice(0, STRIP_CHIPS).map(entry => <DueChip key={entry.key} entry={entry} />)}
              {rest.length > 0 && (
                <MenuButton className="wk-more" label={`+${rest.length} more`} menuLabel={`More due ${longDay(day)}`}
                  items={rest.map(entry => ({
                    key: entry.key, label: entry.title,
                    detail: `${entry.cls ? entry.cls.code + ' · ' : ''}${entry.allDay ? 'All day' : clock(entry.at)}${entry.done ? ' · done' : ''}`,
                    disabled: !entry.url,
                    onSelect: () => { if (entry.internal) window.location.assign(entry.url); else window.open(entry.url, '_blank', 'noopener'); },
                  }))} />
              )}
            </div>
          );
        })}
      </div>

      <div className="wk-grid">
        <div className="wk-gutter" aria-hidden="true">
          {HOURS.map(hour => <span key={hour} style={{ top: `${((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}>{hourLabel(hour)}</span>)}
        </div>
        <div className="wk-body" ref={body}>
          {days.map(day => {
            const today = sameDay(day, now);
            return (
              <div key={dayKey(day)} className={`wk-col${today ? ' is-today' : ''}`} aria-hidden="true">
                {today && line !== null && <span className="wk-now" style={{ top: `${line * 100}%` }} />}
              </div>
            );
          })}
          {/* One layer over the seven columns: a block moving to another day keeps its element,
              so a drag keeps its pointer and the keyboard keeps its focus. */}
          {!weekDue.length && !blocks.some(block => days.some(day => sameDay(day, block.start))) && (
            <p className="wk-empty">Nothing due or planned this week. Plan my week fits what's due into your free time.</p>
          )}
          <ul className="wk-layer" aria-label="Study time and exams this week">
            {days.flatMap((day, index) => {
              const dayBlocks = blocks.map(shown).filter(block => sameDay(block.start, day));
              const exams = timedExams.filter(entry => sameDay(entry.at, day)).map(entry => ({ ...entry, start: entry.at, end: new Date(entry.at.getTime() + EXAM_MINUTES * 60000) }));
              const placed = lanes([...dayBlocks, ...exams]);
              const place = (key, box) => {
                const lane = placed[key] || { lane: 0, lanes: 1 };
                return {
                  top: `${box.top * 100}%`, height: `${box.height * 100}%`,
                  left: `calc(${((index + lane.lane / lane.lanes) / 7) * 100}% + 0.25rem)`,
                  width: `calc(${100 / 7 / lane.lanes}% - 0.5rem)`,
                };
              };
              return [...exams, ...dayBlocks].sort((a, b) => a.start - b.start).map(entry => {
                const box = gridBox(entry.start, entry.end);
                if (box.hidden) return null;
                if (entry.kind === 'due') {
                  const ready = readiness[entry.id];
                  return (
                    <li key={entry.key} className="wk-item" style={place(entry.key, box)}>
                      <button type="button" className={`wk-block wk-exam${entry.done ? ' is-done' : ''}`} onClick={() => onOpen(entry)}
                        aria-label={`Exam: ${entry.cls ? entry.cls.code + ' ' : ''}${entry.title}, ${longDay(entry.at)}, ${clock(entry.at)}${ready ? `, ${ready.percent}% ready` : ''}. Opens your review.`}>
                        <span className="wk-block-title"><Flag size={14} strokeWidth={1.75} aria-hidden="true" />{entry.cls ? `${entry.cls.code} ` : ''}{entry.title}</span>
                        <span className="wk-block-time">{clock(entry.at)}{ready ? <span className="wk-ready"><ReadyRing percent={ready.percent} size={16} label={entry.title} />{ready.percent}%</span> : null}</span>
                      </button>
                    </li>
                  );
                }
                const block = entry;
                const minutes = box.height * GRID_MINUTES;
                const short = minutes < 50;
                const mid = !short && minutes < 100;
                const busy = saving.has(block.id);
                const moving = draft && draft.id === block.id;
                const original = saved(block.id) || block;
                return (
                  <li key={block.key} className={`wk-item${moving ? ' is-moving' : ''}`} style={place(block.key, box)}>
                    <button type="button"
                      className={`wk-block${block.done ? ' is-done' : ''}${short ? ' is-short' : ''}${mid ? ' is-mid' : ''}${moving ? ' is-moving' : ''}${busy ? ' is-saving' : ''}`}
                      style={toneStyle(block.cls)}
                      aria-roledescription={block.done ? undefined : 'movable study time'}
                      aria-describedby={block.done ? undefined : 'wk-help'}
                      aria-busy={busy || undefined}
                      aria-label={`${block.fullTitle}${block.cls ? `, ${block.cls.code}` : ''}, ${where(block)}${block.done ? ', done' : ''}`}
                      onPointerDown={event => onPointerDown(event, original)}
                      onKeyDown={event => onKeyDown(event, original)}
                      onBlur={settle}
                      onClick={() => onClick(original)}>
                      <span className="wk-block-title">{block.title}</span>
                      {!short && <span className="wk-block-time">{span(block.start, block.end)}</span>}
                      {!block.done && <span className="wk-resize" data-resize="" aria-hidden="true" />}
                    </button>
                  </li>
                );
              });
            })}
          </ul>
        </div>
      </div>
      <p id="wk-help" className="wk-sr">Drag to move it, or drag its bottom edge to change its length. With the keyboard, arrow keys move it by 15 minutes or a day, Shift with Up or Down changes its length, and Escape cancels. Enter opens it.</p>
      <p className="wk-sr" aria-live="polite">{said}</p>

      <style jsx>{`
        .wk { --wk-hour: 2.75rem; --wk-gutter: 3.75rem; display: grid; min-width: 0; padding: 1rem 1rem 1.25rem; }
        .wk-head, .wk-strip { display: grid; grid-template-columns: var(--wk-gutter) repeat(7, minmax(0, 1fr)); }
        .wk-head { padding-bottom: 0.5rem; }
        .wk-day { display: flex; align-items: center; justify-content: center; gap: 0.375rem; margin: 0; min-height: 2.5rem; }
        .wk-day-name { color: var(--muted); font: 600 0.9375rem/1 var(--font-sans); }
        .wk-day-num { display: grid; place-items: center; min-width: 2.125rem; height: 2.125rem; padding: 0 0.25rem; border-radius: var(--r-pill); color: var(--ink); font: 600 1.25rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .wk-day.is-today .wk-day-name { color: var(--ink); }
        .wk-day.is-today .wk-day-num { background: var(--olive-glass-sheen), var(--olive); color: var(--on-olive); box-shadow: var(--olive-glass-shadow); }
        .wk-strip { align-items: start; padding-bottom: 0.75rem; }
        .wk-strip-label { display: flex; align-items: center; gap: 0.25rem; align-self: start; min-height: 1.75rem; color: var(--muted); font: 600 0.875rem/1 var(--font-sans); }
        .wk-strip-day { display: grid; gap: 0.25rem; min-width: 0; padding: 0 0.25rem; }
        .wk-strip-day :global(.wk-more) { min-height: 1.75rem; padding: 0 0.5rem; border: 0; border-radius: var(--r-input); background: transparent; color: var(--olive-ink); font: 600 0.8125rem/1 var(--font-sans); cursor: pointer; text-align: left; }
        @media (hover: hover) { .wk-strip-day :global(.wk-more:hover) { background: var(--glass-inner); } }
        .wk-grid { display: grid; grid-template-columns: var(--wk-gutter) minmax(0, 1fr); }
        .wk-gutter { position: relative; height: calc(var(--wk-hour) * ${DAY_END_HOUR - DAY_START_HOUR}); }
        .wk-gutter span { position: absolute; right: 0.625rem; transform: translateY(-50%); color: var(--muted); font: 500 0.8125rem/1 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .wk-body { position: relative; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); height: calc(var(--wk-hour) * ${DAY_END_HOUR - DAY_START_HOUR}); border-top: 0.0625rem solid var(--hairline); border-bottom: 0.0625rem solid var(--hairline); }
        .wk-col {
          position: relative; min-width: 0; border-left: 0.0625rem solid var(--hairline);
          background-image: linear-gradient(to bottom, var(--hairline) 0.0625rem, transparent 0.0625rem);
          background-size: 100% var(--wk-hour);
        }
        .wk-col:last-child { border-right: 0.0625rem solid var(--hairline); }
        .wk-col.is-today { background-color: color-mix(in srgb, var(--olive-tint) 55%, transparent); }
        .wk-now { position: absolute; left: 0; right: 0; z-index: 1; height: 0.125rem; margin-top: -0.0625rem; background: var(--olive); pointer-events: none; }
        .wk-now::before { content: ''; position: absolute; left: -0.3125rem; top: -0.25rem; width: 0.625rem; height: 0.625rem; border-radius: 50%; background: var(--olive); }
        .wk-layer { position: absolute; inset: 0; margin: 0; padding: 0; list-style: none; pointer-events: none; }
        .wk-item { position: absolute; z-index: 2; pointer-events: auto; display: flex; min-height: 1.5rem; padding-bottom: 0.125rem; }
        .wk-item.is-moving { z-index: 4; }
        .wk-block {
          position: relative; flex: 1; display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; overflow: hidden;
          padding: 0.375rem 0.5rem; border: 0; border-radius: var(--r-input); text-align: left; color: var(--ink); cursor: grab; touch-action: none;
          background: var(--glass-sheen), color-mix(in srgb, var(--tone, var(--glass-inner)) 82%, transparent);
          box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge);
          transition: transform 180ms var(--ease), box-shadow 180ms var(--ease), opacity 180ms var(--ease);
        }
        .wk-block.is-short { flex-direction: row; align-items: center; padding-block: 0.125rem; }
        .wk-block.is-mid { gap: 0; padding-block: 0.25rem; }
        .wk-block-title, .wk-block-time { flex-shrink: 0; }
        .wk-block-time { flex-wrap: wrap; }
        .wk-block-title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font: 600 0.875rem/1.2 var(--font-sans); }
        .wk-block:is(.is-short, .is-mid) .wk-block-title { -webkit-line-clamp: 1; }
        .wk-block-time { display: flex; align-items: center; gap: 0.5rem; color: var(--tone-ink, var(--muted)); font: 600 0.8125rem/1.2 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .wk-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 0.625rem; cursor: ns-resize; }
        .wk-resize::after { content: ''; position: absolute; left: 50%; bottom: 0.1875rem; width: 1.25rem; height: 0.1875rem; margin-left: -0.625rem; border-radius: 0.125rem; background: var(--tone-ink, var(--muted)); opacity: 0; transition: opacity 180ms var(--ease); }
        @media (hover: hover) {
          .wk-block:hover { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-lift); }
          .wk-block:hover .wk-resize::after { opacity: 0.6; }
        }
        .wk-block:active { cursor: grabbing; }
        .wk-block:focus-visible .wk-resize::after { opacity: 0.6; }
        .wk-block.is-moving { transform: scale(1.02); box-shadow: inset 0 0 0 0.125rem var(--olive), var(--shadow-float); transition: none; }
        .wk-block.is-saving { opacity: 0.72; cursor: progress; }
        .wk-block.is-done { cursor: pointer; touch-action: auto; background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline); }
        .wk-block.is-done .wk-block-time { color: var(--muted); }
        .wk-block.is-done .wk-block-title { text-decoration: line-through; color: var(--muted); }
        .wk-exam { cursor: pointer; touch-action: auto; color: var(--on-olive); background: var(--olive-glass-sheen), var(--olive); box-shadow: var(--olive-glass-shadow); }
                .wk-exam .wk-block-title { font-size: 0.8125rem; }
        .wk-exam .wk-block-title :global(.lucide) { margin-right: 0.25rem; vertical-align: -0.125rem; }
        .wk-exam .wk-block-time { color: var(--on-olive); }
        .wk-ready { display: inline-flex; align-items: center; gap: 0.25rem; }
        .wk-exam :global(.c-ring-track) { stroke: var(--on-olive); opacity: 0.3; }
        .wk-exam :global(.c-ring-fill) { stroke: var(--on-olive); }
        @media (hover: hover) { .wk-exam:hover { box-shadow: var(--olive-glass-shadow-hover); } }
        .wk-empty { position: absolute; top: 1.5rem; left: 50%; z-index: 2; max-width: 24rem; margin: 0; padding: 0.75rem 1rem; transform: translateX(-50%); border-radius: var(--r-row); background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline); color: var(--muted); font: 500 0.9375rem/1.45 var(--font-sans); text-align: center; }
        .wk-sr { position: absolute; width: 0.0625rem; height: 0.0625rem; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) { .wk-block, .wk-resize::after { transition: none; } .wk-block:hover, .wk-block.is-moving { transform: none; } }
      `}</style>
    </section>
  );
}
