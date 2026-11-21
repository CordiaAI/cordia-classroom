import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { DAY_END_HOUR, DAY_START_HOUR, GRID_MINUTES, clock, endsInTime, gridBox, lanes, nowLine, offGrid, sameDay, sameSpan, shiftBlock, span, startsInGrid, weekDays } from '../../lib/calendarViews.mjs';
import { dayKey } from '../../lib/learnEngine.mjs';
import { DueChip, EdgeMenu, MenuButton, ReadyRing, toneStyle } from './parts';

const STRIP_CHIPS = 2;
const KEY_SETTLE_MS = 800;
const REFUSAL_REPEAT_MS = 3000; // a key held against the deadline says why once, not on every press
const EXAM_MINUTES = 90;
// A block narrower than this (in rem, so Larger text counts) drops its time line; an exam's
// readiness shows as the ring alone.
const NARROW_REM = 6.5;
const TINY_REM = 4; // narrower still: one line of title, ending in an ellipsis
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const examSpan = entry => ({ start: entry.at, end: new Date(entry.at.getTime() + EXAM_MINUTES * 60000) });
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i); // 8 AM at the top line to 9 PM
const hourLabel = hour => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
const dayName = day => day.toLocaleDateString('en-US', { weekday: 'short' });
const longDay = day => day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// Week (A): a time grid from 8 AM to 10 PM with a Due strip over each day, study blocks as glass
// in their class's tint, timed exams as solid olive blocks, today's column tinted and an olive now
// line. A study block moves by dragging it (or its bottom edge, to change its length) or with the
// keyboard: arrows move it 15 minutes or a day, Shift with Up or Down changes its length. Nothing is
// lost outside 8 AM-10 PM: an exam starting there joins the Due strip, a block there is counted in a
// band above or below the grid ("1 earlier", "1 later", never over a block) and opens from that menu.
// A move the deadline won't allow stops, and onRefuse says why (the page's toast).
export default function WeekView({ deadlines, blocks, readiness, now, weekStart, saving, onOpen, onMove, onRefuse = () => {} }) {
  const days = weekDays(weekStart);
  const body = useRef(null);
  const drag = useRef(null);
  const keyed = useRef(null); // { timer } while arrow keys are moving a block
  const suppressClick = useRef('');
  const [draft, setDraft] = useState(null); // { id, start, end } shown in place of the saved time
  const [said, setSaid] = useState('');
  const [columnRem, setColumnRem] = useState(null); // a day column's width in rem, once measured

  const refused = useRef({ text: '', at: 0 });
  useEffect(() => () => { clearTimeout(keyed.current?.timer); document.documentElement.classList.remove('cal-refusing'); }, []);
  // Measured before paint, so blocks never redraw narrower after they first show.
  useBrowserLayoutEffect(() => {
    const element = body.current;
    if (!element) return undefined;
    const measure = () => {
      const column = element.querySelector('.wk-col');
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      if (column) setColumnRem(column.getBoundingClientRect().width / rem);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const weekDue = deadlines.filter(entry => days.some(day => sameDay(day, entry.at)));
  // Timed exams sit in the grid when they start inside it; the rest join the Due strip.
  const gridExam = entry => entry.exam && !entry.allDay && startsInGrid(entry.at);
  const timedExams = weekDue.filter(gridExam);
  const strip = weekDue.filter(entry => !gridExam(entry));
  const saved = id => blocks.find(item => item.id === id);
  const where = ({ start, end }) => `${start.toLocaleDateString('en-US', { weekday: 'long' })}, ${span(start, end)}`;
  const line = days.some(day => sameDay(day, now)) ? nowLine(now) : null;
  // Study time wholly outside the grid's hours, by side and day: the bands above and below the grid.
  const off = side => days.map(day => blocks.filter(block => sameDay(block.start, day) && offGrid(block.start, block.end) === side));
  const bands = { earlier: off('earlier'), later: off('later') };

  function refuse(text) {
    const at = Date.now();
    if (refused.current.text === text && at - refused.current.at < REFUSAL_REPEAT_MS) return;
    refused.current = { text, at };
    onRefuse(text);
  }

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
      const next = state.resize
        ? shiftBlock(state.block, { minutes, resize: true })
        : shiftBlock(state.block, { days: dayShift(state.block, Math.round(dx / state.columnPx)), minutes });
      // Past the deadline it stops: study time has to end before it's due. The pointer and the
      // toast say so while it's held there.
      if (!endsInTime(next, state.block.deadline)) {
        if (!state.late) { state.late = true; document.documentElement.classList.add('cal-refusing'); refuse(lateText(state.block)); }
        return;
      }
      if (state.late) { state.late = false; document.documentElement.classList.remove('cal-refusing'); }
      state.next = next;
      setDraft({ id: state.block.id, ...state.next });
    };
    const end = cancelled => () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      drag.current = null;
      document.documentElement.classList.remove('cal-refusing');
      if (!state.moved) return;
      suppressClick.current = state.block.id; // the click that ends a drag doesn't open the block
      setDraft(null);
      if (!cancelled && state.next && !sameSpan(state.next, state.block)) {
        setSaid(`Moved to ${where(state.next)}`);
        onMove(state.block, state.next);
      } else if (!cancelled && state.late) {
        refuse(lateText(state.block)); // Still on screen from the drag; said again if it timed out.
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
    if (!endsInTime(next, block.deadline)) { refuse(lateText(block)); return; }
    setDraft({ id: block.id, ...next });
    setSaid(`${resize ? 'Length' : 'Time'}: ${where(next)}. Saves when you stop.`);
    clearTimeout(keyed.current?.timer);
    keyed.current = { block, next, timer: setTimeout(settle, KEY_SETTLE_MS) };
  }

  function lateText(block) {
    return `${block.title} has to end before ${block.deadline.title} is due, ${block.deadline.allDay ? longDay(block.deadline.at) : `${longDay(block.deadline.at)} at ${clock(block.deadline.at)}`}.`;
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
              {due.slice(0, STRIP_CHIPS).map(entry => <DueChip key={entry.key} entry={entry} onOpen={entry.exam ? onOpen : undefined} readiness={readiness[entry.id]} />)}
              {rest.length > 0 && (
                <MenuButton className="wk-more" label={`+${rest.length} more`} menuLabel={`More due ${longDay(day)}`}
                  items={rest.map(entry => ({
                    key: entry.key, label: entry.title,
                    detail: `${entry.cls ? entry.cls.code + ' · ' : ''}${entry.allDay ? 'All day' : clock(entry.at)}${entry.done ? ' · done' : ''}`,
                    disabled: !entry.url && !entry.exam,
                    onSelect: () => {
                      if (entry.exam) onOpen(entry);
                      else if (entry.internal) window.location.assign(entry.url);
                      else window.open(entry.url, '_blank', 'noopener');
                    },
                  }))} />
              )}
            </div>
          );
        })}
      </div>

      {bands.earlier.some(list => list.length) && <EdgeBand side="earlier" days={days} lists={bands.earlier} onOpen={onOpen} />}

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
              const exams = timedExams.filter(entry => sameDay(entry.at, day)).map(entry => ({ ...entry, ...examSpan(entry) }));
              const inGrid = dayBlocks.filter(block => !offGrid(block.start, block.end));
              const placed = lanes([...inGrid, ...exams]);
              const laneOf = key => placed[key] || { lane: 0, lanes: 1 };
              const place = (key, box) => {
                const lane = laneOf(key);
                return {
                  top: `${box.top * 100}%`, height: `${box.height * 100}%`,
                  left: `calc(${((index + lane.lane / lane.lanes) / 7) * 100}% + 0.25rem)`,
                  width: `calc(${100 / 7 / lane.lanes}% - 0.5rem)`,
                };
              };
              const width = key => (columnRem === null ? Infinity : columnRem / laneOf(key).lanes - 0.5);
              const narrow = key => width(key) < NARROW_REM;
              return [...exams, ...inGrid].sort((a, b) => a.start - b.start).map(entry => {
                const box = gridBox(entry.start, entry.end);
                if (entry.kind === 'due') {
                  const ready = readiness[entry.id];
                  const slim = narrow(entry.key);
                  return (
                    <li key={entry.key} className="wk-item" style={place(entry.key, box)}>
                      <button type="button" className={`wk-block wk-exam${entry.done ? ' is-done' : ''}`} onClick={() => onOpen(entry)}
                        aria-label={`Exam: ${entry.cls ? entry.cls.code + ' ' : ''}${entry.title}, ${longDay(entry.at)}, ${clock(entry.at)}${ready ? `, ${ready.percent}% ready` : ''}. Opens your review.`}>
                        <span className="wk-exam-top">
                          <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
                          <span className="wk-exam-name">{entry.title}</span>
                          {ready && !slim && <span className="wk-ready"><ReadyRing percent={ready.percent} size={16} label={entry.title} />{ready.percent}%</span>}
                        </span>
                        <span className="wk-block-time">
                          {entry.cls && !slim ? `${entry.cls.code} · ` : ''}{clock(entry.at)}
                          {ready && slim && <span className="wk-ready"><ReadyRing percent={ready.percent} size={16} label={entry.title} /></span>}
                        </span>
                      </button>
                    </li>
                  );
                }
                const block = entry;
                const minutes = box.height * GRID_MINUTES;
                const short = minutes < 50;
                const mid = !short && minutes < 100;
                const slim = narrow(block.key);
                const tiny = width(block.key) < TINY_REM;
                const busy = saving.has(block.id);
                const moving = draft && draft.id === block.id;
                const original = saved(block.id) || block;
                return (
                  <li key={block.key} className={`wk-item${moving ? ' is-moving' : ''}`} style={place(block.key, box)}>
                    <button type="button" data-block={block.id}
                      className={`wk-block${block.done ? ' is-done' : ''}${short ? ' is-short' : ''}${mid ? ' is-mid' : ''}${slim ? ' is-slim' : ''}${tiny ? ' is-tiny' : ''}${moving ? ' is-moving' : ''}${busy ? ' is-saving' : ''}`}
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
                      {!short && !slim && <span className="wk-block-time">{span(block.start, block.end)}</span>}
                      {!block.done && <span className="wk-resize" data-resize="" aria-hidden="true" />}
                    </button>
                  </li>
                );
              });
            })}
          </ul>
        </div>
      </div>

      {bands.later.some(list => list.length) && <EdgeBand side="later" days={days} lists={bands.later} onOpen={onOpen} />}
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
        .wk-block-title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font: 600 0.875rem/1.2 var(--font-sans); }
        /* One line ends in an ellipsis, never a word cut off at the edge. */
        .wk-block:is(.is-short, .is-tiny, .is-mid:not(.is-slim)) .wk-block-title { display: block; flex-shrink: 1; min-width: 0; white-space: nowrap; text-overflow: ellipsis; overflow-wrap: normal; }
        .wk-block.is-slim { padding-inline: 0.375rem; }
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
        .wk-exam-top { display: flex; align-items: center; gap: 0.25rem; min-width: 0; font: 600 0.875rem/1.2 var(--font-sans); }
        .wk-exam :global(.lucide) { flex: 0 0 auto; width: 0.875rem; height: 0.875rem; color: currentColor; }
        .wk-exam-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .wk-exam .wk-block-time { display: flex; overflow: hidden; color: var(--on-olive); }
        .wk-ready { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 0.25rem; font: 600 0.8125rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .wk-exam :global(.c-ring-track) { stroke: var(--on-olive); opacity: 0.3; }
        .wk-exam :global(.c-ring-fill) { stroke: var(--on-olive); }
        @media (hover: hover) { .wk-exam:hover { box-shadow: var(--olive-glass-shadow-hover); } }
        /* Over the now line (z-index 1), on raised glass so the line doesn't run through the words. */
        .wk-empty { position: absolute; top: 1.5rem; left: 50%; z-index: 3; max-width: 24rem; margin: 0; padding: 0.75rem 1rem; transform: translateX(-50%); border-radius: var(--r-row); background: var(--surface-raised); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); color: var(--muted); font: 500 0.9375rem/1.45 var(--font-sans); text-align: center; }
        .wk-sr { position: absolute; width: 0.0625rem; height: 0.0625rem; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        @media (prefers-reduced-motion: reduce) {
          .wk-block, .wk-resize::after { transition: none; }
          .wk-block:hover, .wk-block.is-moving { transform: none; }
        }
      `}</style>
    </section>
  );
}

// A band above or below the hour grid, in the grid's columns: each day's study time outside 8 AM to
// 10 PM as "N earlier" or "N later". Its own row, so it never sits over a block.
function EdgeBand({ side, days, lists, onOpen }) {
  return (
    <div className={`wk-band wk-band--${side}`}>
      <span aria-hidden="true" />
      {days.map((day, index) => (
        <div key={dayKey(day)} className="wk-band-day">
          {lists[index].length > 0 && <EdgeMenu side={side} blocks={lists[index]} day={day} onOpen={onOpen} align={index > 3 ? 'end' : 'start'} />}
        </div>
      ))}
      <style jsx>{`
        .wk-band { display: grid; grid-template-columns: var(--wk-gutter) repeat(7, minmax(0, 1fr)); align-items: center; min-height: 2.25rem; }
        .wk-band--earlier { padding-bottom: 0.375rem; }
        .wk-band--later { padding-top: 0.375rem; }
        .wk-band-day { display: flex; justify-content: center; min-width: 0; padding: 0 0.25rem; }
      `}</style>
    </div>
  );
}
