import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarCheck, GraduationCap } from 'lucide-react';
import { agendaDays, clock, dueBy, dueSoon, dueWhen, monthGrid, nextExam, rowAction, sameDay, span, startOfWeek } from '../../lib/calendarViews.mjs';
import { dayKey } from '../../lib/learnEngine.mjs';
import { ClassTag, DueIcon, EmptyRing, ICON, ReadyRing, SMALL_ICON, StudyIcon, toneStyle } from './parts';

const longDate = day => day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

function timeText(entry) {
  if (entry.kind === 'study') return span(entry.start, entry.end);
  if (entry.exam && !entry.allDay) return clock(entry.at);
  return entry.allDay ? 'Due, all day' : `Due ${clock(entry.at)}`;
}

function kindText(entry) {
  if (entry.kind === 'study') return 'Study time';
  return entry.exam ? 'Exam' : 'Due';
}

// Agenda (B): Yesterday, Today, Tomorrow and later as one list, each row with one action; beside
// it the next exam's readiness, a mini month and Needs study time. On a phone, the only view.
export default function AgendaView({ deadlines, blocks, needs, readiness, readinessIn, now, weekStart, saving, onOpen, onFind, finding, wide, onJump }) {
  const days = agendaDays(weekStart, deadlines, blocks, now);
  const empty = !days.some(({ entries }) => entries.length);
  const exam = nextExam(deadlines, now);
  const ready = exam && readiness[exam.id];

  function action(entry) {
    const kind = rowAction(entry, blocks, now);
    const label = `${entry.title}${entry.cls ? `, ${entry.cls.code}` : ''}`;
    if (kind === 'start') return <button type="button" className="c-btn c-btn--secondary ag-act" onClick={() => onOpen(entry)} aria-label={`Start: ${label}`}><GraduationCap {...SMALL_ICON} />Start</button>;
    if (kind === 'review') return <button type="button" className="c-btn c-btn--primary ag-act" onClick={() => onOpen(entry)} aria-label={`Review now: ${label}`}>Review now</button>;
    if (kind === 'find') return <button type="button" className="c-btn c-btn--secondary ag-act" onClick={() => onFind([entry])} disabled={finding || saving.has(entry.id)} aria-label={`Find time for ${label}`}><CalendarCheck {...SMALL_ICON} />{finding ? 'Finding…' : 'Find time'}</button>;
    if (kind === 'planned') return <span className="ag-planned">Planned</span>;
    return null;
  }

  function title(entry) {
    if (entry.kind === 'due' && entry.url) {
      return entry.internal
        ? <a className="ag-title" href={entry.url}>{entry.title}</a>
        : <a className="ag-title" href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a>;
    }
    return <span className="ag-title">{entry.title}</span>;
  }

  return (
    <div className={`ag${wide ? ' ag--wide' : ''}`}>
      <section className="c-card ag-list" aria-label="Agenda">
        {empty && (
          <div className="ag-none">
            <p className="ag-none-text">Nothing due or planned this week.</p>
            <Link href="/week" className="c-btn c-btn--secondary ag-none-plan"><CalendarCheck {...SMALL_ICON} />Plan my week</Link>
          </div>
        )}
        {!empty && days.map(({ day, entries }) => (
          <section key={dayKey(day)} className="ag-day" aria-labelledby={`ag-${dayKey(day)}`}>
            <h2 id={`ag-${dayKey(day)}`} className="ag-day-head">
              <span className={`ag-day-name${sameDay(day, now) ? ' is-today' : ''}`}>{relative(day, now)}</span>
              <span className="ag-day-date">{longDate(day)}</span>
            </h2>
            {entries.length ? (
              <ul className="ag-rows">
                {entries.map(entry => {
                  const finished = entry.done;
                  const past = entry.kind === 'study' ? entry.end < now : dueBy(entry) < now;
                  const examReady = entry.kind === 'due' && entry.exam && readiness[entry.id];
                  return (
                    <li key={entry.key} className={`ag-row${finished ? ' is-done' : ''}${past && !finished ? ' is-past' : ''}${entry.exam ? ' is-exam' : ''}`} style={toneStyle(entry.cls)}>
                      <span className="ag-time">{timeText(entry)}</span>
                      <span className="ag-icon">{entry.kind === 'study' ? <StudyIcon size={20} /> : <DueIcon entry={entry} size={20} />}</span>
                      <span className="ag-main">
                        {title(entry)}
                        <span className="ag-meta">
                          <ClassTag cls={entry.cls} from={entry.from} />
                          <span>{kindText(entry)}{finished ? ' · done' : ''}</span>
                          {examReady && <span className="ag-ready"><ReadyRing percent={examReady.percent} size={16} label={entry.title} />{examReady.percent}% ready</span>}
                        </span>
                      </span>
                      <span className="ag-action">{action(entry)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="ag-empty">Nothing planned today.</p>}
          </section>
        ))}
      </section>

      <aside className="ag-side" aria-label="This week at a glance">
        {exam && (
          <section className="c-card ag-exam" aria-label="Next exam">
            {/* The ring's place is kept while readiness loads and when there is no review set yet,
                so nothing beside or below it moves when it fills. Its number reads once, beside it. */}
            <span className="ag-exam-ring">
              {ready ? <ReadyRing percent={ready.percent} size={112} label={exam.title} /> : <EmptyRing size={112} />}
            </span>
            <div className="ag-exam-text">
              <p className="ag-exam-what">{exam.cls ? `${exam.cls.code} · ` : ''}{exam.at.toLocaleDateString('en-US', { weekday: 'long' })}{exam.allDay ? '' : ` ${clock(exam.at)}`}</p>
              <h2 className="ag-exam-title">{exam.title}</h2>
              {ready ? (
                <>
                  <p className="ag-exam-ready">{ready.percent}% ready</p>
                  <p className="ag-exam-pace">{ready.left ? `${ready.left} ${ready.left === 1 ? 'idea' : 'ideas'} left.${ready.perDay ? ` ${ready.perDay} a day keeps you on pace.` : ''}` : 'Every idea mastered.'}</p>
                </>
              ) : readinessIn ? (
                <>
                  <p className="ag-exam-pace">No review set yet. Make one to see how ready you are.</p>
                  <button type="button" className="c-btn c-btn--secondary ag-act" onClick={() => onOpen(exam)}>Make a review set</button>
                </>
              ) : <p className="ag-exam-pace">Checking how ready you are…</p>}
            </div>
          </section>
        )}
        {wide && <MiniMonth weekStart={weekStart} deadlines={deadlines} now={now} onJump={onJump} />}
        <section className="c-card ag-needs" aria-labelledby="ag-needs-title">
          <h2 id="ag-needs-title" className="ag-side-title">Needs study time</h2>
          {needs.length ? (
            <>
              <p className="ag-side-help">Due soon with nothing planned yet.</p>
              <ul className="ag-needs-rows">
                {needs.map(entry => (
                  <li key={entry.key} style={toneStyle(entry.cls)}>
                    <ClassTag cls={entry.cls} />
                    <span className="ag-needs-title">{entry.title}</span>
                    <span className="ag-needs-when">{dueWhen(entry.at, now)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="c-btn c-btn--secondary ag-find" onClick={() => onFind(needs)} disabled={finding}>
                <CalendarCheck {...ICON} />{finding ? 'Finding time…' : needs.length === 1 ? 'Find time' : needs.length === 2 ? 'Find time for both' : `Find time for all ${needs.length}`}
              </button>
            </>
          ) : <p className="ag-side-help">{dueSoon(deadlines, now).length ? 'Everything due in the next 7 days has study time.' : 'Nothing due in the next 7 days.'}</p>}
        </section>
      </aside>

      <style jsx>{`
        .ag { display: grid; gap: 1rem; align-items: start; min-width: 0; }
        .ag--wide { grid-template-columns: minmax(0, 1fr) minmax(17rem, 21rem); }
        .ag-list { display: grid; gap: 1.25rem; min-width: 0; padding: 1.25rem 1.5rem 1.5rem; }
        .ag-day { display: grid; gap: 0.25rem; min-width: 0; }
        .ag-day-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin: 0 0 0.25rem; }
        .ag-day-name { font: 600 1.5rem/1.2 var(--font-display); color: var(--ink); letter-spacing: -0.01em; }
        .ag-day-name.is-today { color: var(--olive-ink); }
        .ag-day-date { font: 500 0.9375rem/1.3 var(--font-sans); color: var(--muted); }
        .ag-rows { display: grid; gap: 0.125rem; margin: 0; padding: 0; list-style: none; }
        .ag-row { display: grid; grid-template-columns: 9rem 2.75rem minmax(0, 1fr) auto; align-items: center; gap: 0.875rem; min-height: 3.75rem; padding: 0.375rem 0; }
        .ag-time { color: var(--muted); font: 600 0.9375rem/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }
        .ag-row:not(.is-done):not(.is-past) .ag-time { color: var(--ink); }
        .ag-icon { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: var(--r-input); color: var(--tone-ink, var(--muted)); background: color-mix(in srgb, var(--tone, var(--glass-inner)) 78%, transparent); box-shadow: inset 0 0 0 0.0625rem var(--hairline); }
        /* The icon takes its row's class ink (the global icon rule would make it muted). */
        .ag-icon :global(.lucide) { color: currentColor; }
        .ag-row.is-exam .ag-icon { background: var(--glass-inner); color: var(--ink); }
        .ag-main { display: grid; gap: 0.125rem; min-width: 0; }
        .ag-main :global(.ag-title) { min-width: 0; overflow: hidden; color: var(--ink); font: 600 1.0625rem/1.35 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
        /* The title link is 44px tall (2.75rem) without moving the row: padding out, margin back in. */
        .ag-main :global(a.ag-title) { display: block; padding-block: 0.6875rem; margin-block: -0.6875rem; border-radius: 0.25rem; }
        @media (hover: hover) { .ag-main :global(a.ag-title:hover) { text-decoration: underline; text-underline-offset: 0.2em; } }
        .ag-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; color: var(--muted); font: 500 0.875rem/1.3 var(--font-sans); }
        .ag-ready { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--ink); font-variant-numeric: tabular-nums; }
        .ag-action { display: flex; justify-content: flex-end; min-width: 6.5rem; }
        .ag-row :global(.ag-act) { min-height: 2.75rem; white-space: nowrap; }
        .ag-action :global(.ag-planned) { padding: 0 0.75rem; color: var(--muted); font: 600 0.9375rem/1 var(--font-sans); }
        .ag-row.is-done .ag-icon { background: var(--glass-inner); color: var(--muted); }
        .ag-row.is-done :global(.ag-title) { text-decoration: line-through; color: var(--muted); }
        .ag-row.is-past :global(.ag-title) { color: var(--muted); }
        .ag-empty { margin: 0; padding: 0.5rem 0; color: var(--muted); font: 500 0.9375rem/1.4 var(--font-sans); }
        .ag-none { display: grid; justify-items: start; gap: 0.75rem; padding: 0.5rem 0; }
        .ag-none-text { margin: 0; color: var(--ink); font: 600 1.0625rem/1.4 var(--font-sans); }
        .ag-none :global(.ag-none-plan) { min-height: 2.75rem; }

        .ag-side { display: grid; gap: 1rem; min-width: 0; }
        .ag-exam { display: flex; align-items: center; gap: 1.125rem; padding: 1.25rem; }
        .ag-exam-ring { position: relative; display: grid; place-items: center; flex: 0 0 auto; }
        .ag-exam-ready { color: var(--ink); font: 600 1rem/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }
        /* As tall as the text is once readiness is in (kicker, title, "% ready", two lines of pace), so the
           card doesn't grow when it arrives. */
        .ag-exam-text { display: grid; gap: 0.25rem; align-content: start; min-width: 0; min-height: 7.625rem; justify-items: start; }
        .ag-exam-text p { margin: 0; }
        .ag-exam-what { color: var(--muted); font: 600 0.875rem/1.35 var(--font-sans); }
        .ag-exam-title { margin: 0; color: var(--ink); font: 600 1.5rem/1.2 var(--font-display); letter-spacing: -0.01em; }
        .ag-exam-pace { color: var(--muted); font: 500 0.875rem/1.45 var(--font-sans); }
        .ag-needs { display: grid; gap: 0.625rem; padding: 1.25rem; }
        .ag-side-title { margin: 0; color: var(--ink); font: 600 1.1875rem/1.3 var(--font-sans); }
        .ag-side-help { margin: 0; color: var(--muted); font: 500 0.875rem/1.45 var(--font-sans); }
        .ag-needs-rows { display: grid; gap: 0.375rem; margin: 0.25rem 0; padding: 0; list-style: none; }
        .ag-needs-rows li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.625rem; min-height: 2.25rem; }
        .ag-needs-title { overflow: hidden; color: var(--ink); font: 600 0.9375rem/1.3 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
        .ag-needs-when { color: var(--muted); font: 500 0.875rem/1.3 var(--font-sans); }
        .ag-needs :global(.ag-find) { width: 100%; justify-content: center; min-height: 2.75rem; }
        @media (max-width: 767px) {
          .ag-list { padding: 1rem; }
          .ag-row { grid-template-columns: 2.75rem minmax(0, 1fr); grid-template-areas: 'icon main' 'icon time' '. action'; gap: 0.125rem 0.75rem; padding: 0.5rem 0; }
          .ag-icon { grid-area: icon; align-self: start; }
          .ag-main { grid-area: main; }
          .ag-time { grid-area: time; font-size: 0.875rem; color: var(--muted); }
          .ag-action { grid-area: action; justify-content: flex-start; min-width: 0; }
          .ag-action:empty { display: none; }
          .ag-action :global(.ag-planned) { padding: 0; font-size: 0.875rem; }
          .ag-main :global(.ag-title) { white-space: normal; }
          .ag-exam { padding: 1rem; }
        }
      `}</style>
    </div>
  );
}

function relative(day, now) {
  const diff = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return day.toLocaleDateString('en-US', { weekday: 'long' });
}

// The mini month: the shown week stands out, today is olive, and each day with something due has
// up to three dots in its classes' colours. Picking a day shows its week.
function MiniMonth({ weekStart, deadlines, now, onJump }) {
  const [month, setMonth] = useState(() => new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));
  useEffect(() => { setMonth(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1)); }, [weekStart.getFullYear(), weekStart.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = monthGrid(month);
  const rows = cells.length / 7;
  const shown = dayKey(weekStart);
  const label = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dotsFor = day => {
    const key = dayKey(day);
    return deadlines.filter(entry => dayKey(entry.at) === key).slice(0, 3);
  };
  return (
    <section className="c-card mm" aria-label={`${label}, pick a day to show its week`}>
      <header className="mm-head">
        <h2 className="mm-title">{label}</h2>
        <span className="mm-nav">
          <button type="button" className="c-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ArrowLeft {...SMALL_ICON} /></button>
          <button type="button" className="c-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ArrowRight {...SMALL_ICON} /></button>
        </span>
      </header>
      <div className="mm-grid" role="grid" aria-label={label}>
        <div className="mm-row" role="row">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((name, i) => <span key={i} className="mm-dow" role="columnheader" aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}>{name}</span>)}
        </div>
        {Array.from({ length: rows }, (_, row) => {
          const week = cells.slice(row * 7, row * 7 + 7);
          const current = dayKey(startOfWeek(week[0])) === shown;
          return (
            <div key={row} className={`mm-row${current ? ' is-week' : ''}`} role="row">
              {week.map(day => {
                const inMonth = day.getMonth() === month.getMonth();
                const today = sameDay(day, now);
                const dots = inMonth ? dotsFor(day) : [];
                return (
                  <span key={dayKey(day)} role="gridcell" className="mm-cell">
                    {inMonth && (
                      <button type="button" className={`mm-day${today ? ' is-today' : ''}`} onClick={() => onJump(day)} aria-current={today ? 'date' : undefined}
                        aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${dots.length ? `, ${dots.length} due` : ''}`}>
                        <span>{day.getDate()}</span>
                        <span className="mm-dots" aria-hidden="true">{dots.map(entry => <i key={entry.key} style={toneStyle(entry.cls)} />)}</span>
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <style jsx>{`
        .mm { display: grid; gap: 0.625rem; padding: 1.125rem 1.125rem 1.25rem; }
        .mm-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
        .mm-title { margin: 0; color: var(--ink); font: 600 1.1875rem/1.3 var(--font-sans); }
        .mm-nav { display: flex; gap: 0.125rem; }
        .mm-nav :global(.c-icon-btn) { color: var(--ink); }
        .mm-grid { display: grid; gap: 0.25rem; }
        .mm-row { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.25rem; border-radius: var(--r-input); }
        .mm-row.is-week { background: var(--glass-inner); box-shadow: inset 0 0 0 0.0625rem var(--hairline); }
        .mm-dow { display: grid; place-items: center; height: 1.75rem; color: var(--muted); font: 600 0.8125rem/1 var(--font-sans); }
        .mm-cell { display: grid; min-width: 0; }
        .mm-day { display: grid; justify-items: center; align-content: center; gap: 0.125rem; width: 100%; min-height: 2.75rem; padding: 0; border: 0; border-radius: var(--r-input); background: transparent; color: var(--ink); font: 600 0.9375rem/1 var(--font-sans); font-variant-numeric: tabular-nums; cursor: pointer; transition: transform 180ms var(--ease), background-color 180ms var(--ease); }
        @media (hover: hover) { .mm-day:hover { background: var(--glass-inner); } }
        .mm-day:active { transform: scale(0.97); }
        .mm-day.is-today { background: var(--olive); color: var(--on-olive); }
        .mm-dots { display: flex; gap: 0.1875rem; height: 0.3125rem; }
        .mm-dots i { width: 0.3125rem; height: 0.3125rem; border-radius: 50%; background: var(--tone-ink, var(--muted)); }
        .mm-day.is-today .mm-dots i { background: var(--on-olive); }
        @media (prefers-reduced-motion: reduce) { .mm-day { transition: none; } }
      `}</style>
    </section>
  );
}
