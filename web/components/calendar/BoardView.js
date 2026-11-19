import { useState } from 'react';
import { CalendarCheck, Flag, GripVertical, Plus } from 'lucide-react';
import { clock, dayEntries, dueBy, dueSoon, dueWhen, hoursLabel, plannedHours, roomOn, sameDay, span, startOfDay, weekDays } from '../../lib/calendarViews.mjs';
import { dayKey } from '../../lib/learnEngine.mjs';
import { ClassTag, EmptyRing, ICON, MenuButton, ReadyRing, SMALL_ICON, toneStyle } from './parts';

const DRAG_TYPE = 'application/x-cordia-deadline';
const NO_SET = 'No review set yet';
const longDay = day => day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// Board (D): seven day columns with their cards in time order, each day's planned study hours as a
// small bar, the exam card with its readiness ring and "Add study time" per day. "Needs a time" sits
// on top: drag an item onto a day (or pick the day from its menu) to make a study block there, or
// let Find time place them all with Plan my week's own scheduling.
export default function BoardView({ deadlines, blocks, needs, readiness, readinessIn, now, weekStart, saving, onOpen, onFind, finding, onAdd }) {
  const days = weekDays(weekStart);
  const [over, setOver] = useState('');
  const [dragging, setDragging] = useState('');
  const today = startOfDay(now);
  const open = day => startOfDay(day) >= today;

  const weekDue = deadlines.filter(entry => days.some(day => sameDay(day, entry.at)));
  const doneCount = weekDue.filter(entry => entry.done).length;
  const hours = days.map(day => plannedHours(day, blocks));
  const totalHours = hours.reduce((sum, value) => sum + value, 0);
  const scale = Math.max(4, ...hours);
  const exams = weekDue.filter(entry => entry.exam && !entry.done);

  // Deadlines a day's study time can go to: not done, not a lecture to-do, with room that day
  // before they're due (on the due day itself, only when there is time left before the deadline).
  const forDay = day => deadlines.filter(entry => !entry.done && !entry.internal && dueBy(entry) > now && roomOn(day, entry, now))
    .slice(0, 12);
  const dayChoices = entry => days.filter(day => open(day) && roomOn(day, entry, now));
  const draggedEntry = deadlines.find(entry => entry.id === dragging);
  const takes = day => open(day) && (!draggedEntry || roomOn(day, draggedEntry, now));

  function drop(event, day) {
    event.preventDefault();
    setOver('');
    setDragging('');
    const id = event.dataTransfer.getData(DRAG_TYPE);
    const entry = deadlines.find(item => item.id === id);
    if (entry && open(day) && roomOn(day, entry, now)) onAdd(entry, day);
  }

  function card(entry) {
    if (entry.kind === 'study') {
      return (
        <li key={entry.key}>
          <button type="button" data-block={entry.id} className={`bd-card bd-study${entry.done ? ' is-done' : ''}${saving.has(entry.id) ? ' is-saving' : ''}`} style={toneStyle(entry.cls)} onClick={() => onOpen(entry)}
            aria-label={`${entry.fullTitle}${entry.cls ? `, ${entry.cls.code}` : ''}, ${span(entry.start, entry.end)}${entry.done ? ', done' : ''}`}>
            <span className="bd-when">{span(entry.start, entry.end)}</span>
            <span className="bd-title">{entry.title}</span>
          </button>
        </li>
      );
    }
    if (entry.exam) {
      const ready = readiness[entry.id];
      return (
        <li key={entry.key}>
          <button type="button" className={`bd-card bd-exam${entry.done ? ' is-done' : ''}`} onClick={() => onOpen(entry)}
            aria-label={`Exam: ${entry.cls ? entry.cls.code + ' ' : ''}${entry.title}, ${entry.allDay ? 'all day' : clock(entry.at)}${ready ? `, ${ready.percent}% ready` : ''}. Opens your review.`}>
            <span className="bd-exam-when"><Flag size={16} strokeWidth={1.75} aria-hidden="true" />Exam{entry.allDay ? '' : ` · ${clock(entry.at)}`}</span>
            <span className="bd-exam-title">{entry.cls ? `${entry.cls.code} ` : ''}{entry.title}</span>
            {/* The words sit over a hidden copy of the longest they can be, so the card is as tall
                before readiness arrives as after, at any width or text size. */}
            <span className={`bd-exam-ready${ready ? '' : ' bd-exam-ready--none'}`}>
              {ready ? <ReadyRing percent={ready.percent} size={36} label={entry.title} /> : <EmptyRing size={36} />}
              <span className="bd-exam-ready-text">
                <span className="bd-exam-ready-room" aria-hidden="true">{NO_SET}</span>
                <span>{ready ? `${ready.percent}% ready` : readinessIn ? NO_SET : ''}</span>
              </span>
            </span>
          </button>
        </li>
      );
    }
    const body = (
      <>
        <ClassTag cls={entry.cls} from={entry.from} />
        <span className="bd-due-when">{entry.done ? 'Done' : entry.allDay ? 'Due, all day' : `Due ${clock(entry.at)}`}</span>
        <span className="bd-title">{entry.title}</span>
      </>
    );
    const className = `bd-card bd-due${entry.done ? ' is-done' : ''}`;
    return (
      <li key={entry.key} style={toneStyle(entry.cls)}>
        {entry.url
          ? <a className={className} href={entry.url} target={entry.internal ? undefined : '_blank'} rel={entry.internal ? undefined : 'noreferrer'}>{body}</a>
          : <div className={className}>{body}</div>}
      </li>
    );
  }

  return (
    <div className="bd">
      <p className="bd-summary">
        <span><strong>{weekDue.length}</strong> due this week · <strong>{doneCount}</strong> done</span>
        <span><strong>{hoursLabel(totalHours)}</strong> of study planned</span>
        {exams.length > 0 && <span>Exam: {exams.map(entry => `${entry.cls ? entry.cls.code + ' ' : ''}${entry.at.toLocaleDateString('en-US', { weekday: 'long' })}`).join(', ')}</span>}
      </p>

      <section className="c-card bd-tray" aria-labelledby="bd-tray-title">
        <div className="bd-tray-text">
          <h2 id="bd-tray-title" className="bd-tray-title">Needs a time</h2>
          <p className="bd-tray-help">{needs.length ? 'Drag onto a day, or let Cordia find time.' : dueSoon(deadlines, now).length ? 'Everything due in the next 7 days has study time.' : 'Nothing due in the next 7 days.'}</p>
        </div>
        {needs.length > 0 && (
          <ul className="bd-tray-items">
            {needs.map(entry => (
              <li key={entry.key} style={toneStyle(entry.cls)}>
                <MenuButton
                  className={`bd-tray-item${dragging === entry.id ? ' is-dragging' : ''}${saving.has(entry.id) ? ' is-saving' : ''}`}
                  label={<><GripVertical size={16} strokeWidth={1.75} aria-hidden="true" /><ClassTag cls={entry.cls} /><span className="bd-tray-name">{entry.title}</span><span className="bd-tray-when">{dueWhen(entry.at, now)}</span></>}
                  menuLabel={`Plan study time for ${entry.title}`}
                  heading="Plan on"
                  empty="No day left before it's due"
                  disabled={saving.has(entry.id)}
                  items={dayChoices(entry).map(day => ({ key: dayKey(day), label: sameDay(day, now) ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'long' }), detail: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), onSelect: () => onAdd(entry, day) }))}
                  triggerProps={{
                    draggable: true,
                    'aria-label': `${entry.title}${entry.cls ? `, ${entry.cls.code}` : ''}, due ${dueWhen(entry.at, now)}. Drag onto a day, or open to pick one.`,
                    onDragStart: event => { event.dataTransfer.setData(DRAG_TYPE, entry.id); event.dataTransfer.setData('text/plain', entry.title); event.dataTransfer.effectAllowed = 'copy'; setDragging(entry.id); },
                    onDragEnd: () => { setDragging(''); setOver(''); },
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {needs.length > 0 && (
          <button type="button" className="c-btn c-btn--secondary bd-find" onClick={() => onFind(needs)} disabled={finding}>
            <CalendarCheck {...ICON} />{finding ? 'Finding time…' : 'Find time'}
          </button>
        )}
      </section>

      <div className="bd-cols">
        {days.map((day, index) => {
          const isToday = sameDay(day, now);
          const entries = dayEntries(day, deadlines, blocks);
          const canDrop = takes(day);
          return (
            <section key={dayKey(day)} className={`bd-col${isToday ? ' is-today' : ''}${over === dayKey(day) ? ' is-over' : ''}${dragging && canDrop ? ' is-target' : ''}${open(day) ? '' : ' is-past'}`}
              aria-label={`${isToday ? 'Today, ' : ''}${longDay(day)}: ${hoursLabel(hours[index])} of study planned`}
              onDragOver={event => { if (canDrop && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
              onDragEnter={event => { if (canDrop && event.dataTransfer.types.includes(DRAG_TYPE)) setOver(dayKey(day)); }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(current => (current === dayKey(day) ? '' : current)); }}
              onDrop={event => drop(event, day)}>
              <header className="bd-head">
                <h3 className="bd-day"><span className="bd-day-name">{isToday ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' })}</span><span className="bd-day-num">{day.getDate()}</span></h3>
                <span className="bd-bar" aria-hidden="true"><span className="bd-bar-fill" style={{ width: `${(hours[index] / scale) * 100}%` }} /></span>
                <span className="bd-hours">{hoursLabel(hours[index])}</span>
              </header>
              {entries.length > 0 && <ul className="bd-cards">{entries.map(card)}</ul>}
              {open(day) && (
                <MenuButton className="bd-add" icon={<Plus {...SMALL_ICON} />} label="Add study time" menuLabel={`Add study time on ${longDay(day)}`} heading="Study for"
                  empty="Nothing left to study for that day" align={index > 3 ? 'end' : 'start'}
                  items={forDay(day).map(entry => ({ key: entry.key, label: entry.title, detail: `${entry.cls ? entry.cls.code + ' · ' : ''}due ${dueWhen(entry.at, now)}`, disabled: saving.has(entry.id), onSelect: () => onAdd(entry, day) }))} />
              )}
            </section>
          );
        })}
      </div>

      <style jsx>{`
        .bd { display: grid; gap: 0.875rem; min-width: 0; }
        .bd-summary { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; margin: 0; color: var(--muted); font: 500 0.9375rem/1.4 var(--font-sans); font-variant-numeric: tabular-nums; }
        .bd-summary strong { color: var(--ink); font-weight: 600; }
        .bd-tray { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.25rem; padding: 0.875rem 1rem 0.875rem 1.25rem; }
        .bd-tray-text { display: grid; gap: 0.125rem; }
        .bd-tray-title { margin: 0; color: var(--ink); font: 600 1.0625rem/1.3 var(--font-sans); }
        .bd-tray-help { margin: 0; color: var(--muted); font: 500 0.875rem/1.4 var(--font-sans); }
        .bd-tray-items { display: flex; flex: 1; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0; list-style: none; min-width: 0; }
        .bd-tray :global(.bd-tray-item) {
          display: inline-flex; align-items: center; gap: 0.5rem; max-width: 100%; min-height: 2.75rem; padding: 0 0.875rem 0 0.5rem;
          border: 0; border-radius: var(--r-pill); color: var(--ink); cursor: grab; background: var(--glass-inner);
          box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); font: 600 0.9375rem/1 var(--font-sans);
          transition: transform 180ms var(--ease), box-shadow 180ms var(--ease), opacity 180ms var(--ease);
        }
        .bd-tray :global(.bd-tray-item .lucide) { color: var(--muted); flex: 0 0 auto; }
        @media (hover: hover) { .bd-tray :global(.bd-tray-item:hover) { transform: translateY(-0.0625rem); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-lift); } }
        .bd-tray :global(.bd-tray-item:active) { transform: scale(0.97); cursor: grabbing; }
        .bd-tray :global(.bd-tray-item.is-dragging) { opacity: 0.5; }
        .bd-tray :global(.bd-tray-item.is-saving) { opacity: 0.72; cursor: progress; }
        .bd-tray :global(.bd-tray-name) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bd-tray :global(.bd-tray-when) { color: var(--muted); font-weight: 500; font-size: 0.875rem; white-space: nowrap; }
        .bd-tray :global(.bd-find) { margin-left: auto; min-height: 2.75rem; }

        .bd-cols { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.625rem; align-items: start; }
        .bd-col { display: grid; gap: 0.5rem; min-width: 0; padding: 0.625rem 0.5rem 0.5rem; border-radius: var(--r-card); background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline); transition: box-shadow 180ms var(--ease), background-color 180ms var(--ease); }
        .bd-col.is-today { background: var(--selected-glass); box-shadow: inset 0 0 0 0.125rem var(--olive), var(--selected-glass-shadow); }
        .bd-col.is-target { box-shadow: inset 0 0 0 0.0625rem var(--olive); }
        .bd-col.is-over { box-shadow: inset 0 0 0 0.1875rem var(--olive), var(--glass-shadow-lift); }
        .bd-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.375rem 0.5rem; align-items: center; padding: 0 0.25rem; }
        .bd-day { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 0.375rem; margin: 0; }
        .bd-day-name { color: var(--muted); font: 600 0.9375rem/1 var(--font-sans); }
        .bd-col.is-today .bd-day-name { color: var(--olive-ink); }
        .bd-day-num { color: var(--ink); font: 600 1.25rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .bd-bar { position: relative; height: 0.25rem; overflow: hidden; border-radius: var(--r-pill); background: var(--ring-track); }
        .bd-bar-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--olive); }
        .bd-hours { color: var(--muted); font: 600 0.8125rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .bd-cards { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
        .bd-cards :global(.bd-card) {
          display: grid; gap: 0.25rem; width: 100%; min-width: 0; padding: 0.625rem 0.75rem; border: 0; border-radius: var(--r-row);
          text-align: left; color: var(--ink); text-decoration: none; cursor: pointer;
          transition: transform 180ms var(--ease), box-shadow 180ms var(--ease);
        }
        .bd-cards :global(div.bd-card) { cursor: default; }
        @media (hover: hover) { .bd-cards :global(:is(a, button).bd-card:hover) { transform: translateY(-0.0625rem); } }
        .bd-cards :global(:is(a, button).bd-card:active) { transform: scale(0.97); }
        .bd-cards :global(.bd-study) { background: var(--glass-sheen), color-mix(in srgb, var(--tone, var(--glass-inner)) 82%, transparent); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); }
        .bd-cards :global(.bd-due) { background: var(--surface-raised); box-shadow: inset 0 0 0 0.0625rem var(--hairline), var(--glass-shadow-edge); }
        .bd-cards :global(.bd-when) { color: var(--tone-ink, var(--muted)); font: 600 0.8125rem/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
        .bd-cards :global(.bd-due-when) { color: var(--muted); font: 500 0.8125rem/1.2 var(--font-sans); }
        .bd-cards :global(.bd-title) { font: 600 0.9375rem/1.3 var(--font-sans); overflow-wrap: break-word; }
        .bd-cards :global(.bd-card.is-done) { background: color-mix(in srgb, var(--surface-raised) 50%, transparent); box-shadow: inset 0 0 0 0.0625rem var(--hairline); }
        .bd-cards :global(.bd-card.is-done .bd-when) { color: var(--muted); }
        .bd-cards :global(.bd-card.is-done .bd-title) { color: var(--muted); text-decoration: line-through; }
        .bd-cards :global(.bd-card.is-saving) { opacity: 0.72; cursor: progress; }
        .bd-cards :global(.bd-exam) { gap: 0.375rem; color: var(--on-olive); background: var(--olive-glass-sheen), var(--olive); box-shadow: var(--olive-glass-shadow); }
        @media (hover: hover) { .bd-cards :global(.bd-exam:hover) { box-shadow: var(--olive-glass-shadow-hover); } }
        .bd-cards :global(.bd-exam-when) { display: flex; align-items: center; gap: 0.375rem; font: 600 0.8125rem/1.2 var(--font-sans); }
        .bd-cards :global(.bd-exam .lucide) { width: 1rem; height: 1rem; color: currentColor; }
        .bd-cards :global(.bd-exam-title) { font: 600 1.0625rem/1.3 var(--font-sans); overflow-wrap: break-word; }
        .bd-cards :global(.bd-exam-ready) { display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; font: 600 0.875rem/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
        .bd-cards :global(.bd-exam-ready--none) { font-weight: 500; }
        .bd-cards :global(.bd-exam-ready-text) { display: grid; min-width: 0; }
        .bd-cards :global(.bd-exam-ready-text > span) { grid-area: 1 / 1; }
        .bd-cards :global(.bd-exam-ready-room) { visibility: hidden; font-weight: 600; }
        .bd-cards :global(.bd-exam .c-ring-track) { stroke: var(--on-olive); opacity: 0.3; }
        .bd-cards :global(.bd-exam .c-ring-fill) { stroke: var(--on-olive); }
        .bd-col :global(.bd-add) {
          display: inline-flex; align-items: center; gap: 0.25rem; width: 100%; min-height: 2.75rem; padding: 0 0.375rem; border: 0; border-radius: var(--r-input);
          background: transparent; color: var(--muted); font: 600 0.8125rem/1.2 var(--font-sans); cursor: pointer; text-align: left;
          transition: transform 180ms var(--ease), background-color 180ms var(--ease);
        }
        .bd-col :global(.cal-menu-wrap) { display: flex; }
        @media (hover: hover) { .bd-col :global(.bd-add:hover) { background: var(--glass-inner); } }
        .bd-col :global(.bd-add:active) { transform: scale(0.97); }
        @media (max-width: 1279px) {
          .bd-cols { gap: 0.375rem; }
          .bd-col { padding: 0.5rem 0.3125rem 0.375rem; }
          .bd-cards :global(.bd-card) { padding: 0.5rem 0.5rem; }
          .bd-cards :global(.bd-title) { font-size: 0.875rem; }
          .bd-cards :global(.bd-exam-title) { font-size: 0.9375rem; }
          .bd-head { padding: 0 0.125rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bd-col, .bd-tray :global(.bd-tray-item), .bd-cards :global(.bd-card), .bd-col :global(.bd-add) { transition: none; }
          .bd-tray :global(.bd-tray-item:hover), .bd-cards :global(.bd-card:hover) { transform: none; }
        }
      `}</style>
    </div>
  );
}
