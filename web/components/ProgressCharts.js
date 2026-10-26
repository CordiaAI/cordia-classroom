import { useState } from 'react';
import css from 'styled-jsx/css';
import Link from 'next/link';
import { minutesLabel } from '../lib/studyPlans';
import { classLabel } from '../lib/classLabel';

// The Progress charts, drawn from GET /stats/activity (the server's study log in local days).
// One series each, in the olive mark color; values and labels stay in text colors. Every mark
// has a hover/focus tooltip, and every chart has a screen-reader table with the same numbers.

const KINDS = [
  { key: 'read', label: 'Reading guides' },
  { key: 'flashcard', label: 'Flashcards' },
  { key: 'quiz', label: 'Quizzes' },
  { key: 'timer', label: 'Focus timer' },
  { key: 'browse', label: 'Other' },
];

function shortDay(iso) {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// A clean axis top: 15, 30, 60, 90, 120 min, then whole hours.
function niceMax(value) {
  const steps = [15, 30, 60, 90, 120, 180, 240, 360, 480, 600, 720];
  return steps.find(step => step >= value) || Math.ceil(value / 120) * 120;
}

function hourLabel(hour) {
  const h = hour % 12 || 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

// One tooltip per chart, placed over the mark that has the pointer or focus.
function useTip() {
  const [tip, setTip] = useState(null);
  const bind = text => ({
    onPointerEnter: event => setTip({ text, el: event.currentTarget }),
    onPointerLeave: () => setTip(null),
    onFocus: event => setTip({ text, el: event.currentTarget }),
    onBlur: () => setTip(null),
  });
  function render(container) {
    if (!tip || !container) return null;
    const box = container.getBoundingClientRect();
    const mark = tip.el.getBoundingClientRect();
    const left = Math.min(Math.max(mark.left + mark.width / 2 - box.left, 60), box.width - 60);
    return <div className="pc-tip" role="status" style={{ left, top: mark.top - box.top - 8 }}>{tip.text}</div>;
  }
  return [bind, render];
}

function ChartCard({ id, title, meta, children, className = '' }) {
  return (
    <section className={'c-card pc-card ' + className} aria-labelledby={id}>
      <header className="pc-head">
        <h2 id={id} className="c-section-title">{title}</h2>
        {meta && <span className="c-meta">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function SrTable({ caption, head, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr>{head.map(cell => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

export function StatTiles({ activity, streak }) {
  const recent = activity?.recent || [];
  const week = recent.slice(-7).reduce((sum, day) => sum + day.minutes, 0);
  const lastWeek = recent.slice(-14, -7).reduce((sum, day) => sum + day.minutes, 0);
  const delta = week - lastWeek;
  const cards = recent.reduce((sum, day) => sum + (day.cards || 0), 0);
  const quizzes = activity?.quizzes || [];
  const average = quizzes.length ? Math.round(quizzes.reduce((sum, quiz) => sum + quiz.score, 0) / quizzes.length) : null;
  const tiles = [
    { label: 'Streak', value: streak ? `${streak.days} day${streak.days === 1 ? '' : 's'}` : '—', note: streak?.frozenThisWeek ? 'Freeze used this week' : 'One missed day a week won’t break it' },
    { label: 'This week', value: minutesLabel(week), note: activity ? (delta === 0 ? 'Same as last week' : `${delta > 0 ? '↑' : '↓'} ${minutesLabel(Math.abs(delta))} vs last week`) : '' },
    { label: 'Cards reviewed', value: cards.toLocaleString(), note: 'Last 30 days' },
    { label: 'Quiz average', value: average === null ? '—' : `${average}%`, note: quizzes.length ? `Last ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}` : 'No quizzes yet' },
  ];
  return (
    <div className="pc-tiles">
      {tiles.map(tile => (
        <div key={tile.label} className="c-card pc-tile">
          <span className="c-meta">{tile.label}</span>
          <strong>{tile.value}</strong>
          {tile.note && <span className="c-meta pc-note">{tile.note}</span>}
        </div>
      ))}
    </div>
  );
}

export function StudyTimeChart({ recent = [] }) {
  const [bind, renderTip] = useTip();
  const [box, setBox] = useState(null);
  const total = recent.reduce((sum, day) => sum + day.minutes, 0);
  const top = niceMax(Math.max(...recent.map(day => day.minutes), 15));
  const peak = recent.reduce((best, day) => (day.minutes > (best?.minutes || 0) ? day : best), null);
  return (
    <ChartCard id="pc-time" title="Study time" meta={`Last 30 days · ${minutesLabel(total)}`}>
      {!total ? <p className="c-meta pc-empty">Read a guide, review flashcards or take a quiz, and your time shows up here.</p> : (
        <div className="pc-plot-wrap" ref={setBox}>
          <div className="pc-axis-y" aria-hidden="true"><span>{minutesLabel(top)}</span><span>{minutesLabel(top / 2)}</span><span>0</span></div>
          <div className="pc-plot">
            <div className="pc-grid" aria-hidden="true"><i /><i /><i /></div>
            <div className="pc-cols" role="group" aria-label="Minutes studied per day">
              {recent.map(day => {
                const text = `${shortDay(day.date)}: ${minutesLabel(day.minutes)}${day.cards ? ` · ${day.cards} cards` : ''}`;
                return (
                  <div key={day.date} className="pc-col" tabIndex={0} aria-label={text} {...bind(text)}>
                    {day === peak && <span className="pc-peak" style={{ bottom: `calc(${(day.minutes / top) * 100}% + 6px)` }}>{minutesLabel(day.minutes)}</span>}
                    <span className="pc-bar" style={{ height: `${(day.minutes / top) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="pc-axis-x" aria-hidden="true">
              {recent.map((day, index) => <span key={day.date}>{index === recent.length - 1 ? 'Today' : index % 7 === 1 ? shortDay(day.date) : ''}</span>)}
            </div>
          </div>
          {renderTip(box)}
        </div>
      )}
      <SrTable caption="Minutes studied per day, last 30 days" head={['Day', 'Minutes', 'Cards']} rows={recent.map(day => [day.date, day.minutes, day.cards])} />
    </ChartCard>
  );
}

function BarList({ id, title, meta, rows, empty, caption }) {
  const [bind, renderTip] = useTip();
  const [box, setBox] = useState(null);
  const top = Math.max(...rows.map(row => row.minutes), 1);
  return (
    <ChartCard id={id} title={title} meta={meta}>
      {!rows.length ? <p className="c-meta pc-empty">{empty}</p> : (
        <ul className="pc-bars" ref={setBox}>
          {rows.map(row => {
            const text = `${row.label}: ${minutesLabel(row.minutes)}`;
            return (
              <li key={row.key} tabIndex={0} aria-label={text} {...bind(text)}>
                <span className="pc-bar-label c-truncate">{row.href ? <Link href={row.href}>{row.label}</Link> : row.label}</span>
                <span className="pc-bar-track"><span className="pc-hbar" style={{ width: `${Math.max(2, (row.minutes / top) * 100)}%` }} /></span>
                <span className="pc-bar-value">{minutesLabel(row.minutes)}</span>
              </li>
            );
          })}
          {renderTip(box)}
        </ul>
      )}
      <SrTable caption={caption} head={['', 'Minutes']} rows={rows.map(row => [row.label, row.minutes])} />
    </ChartCard>
  );
}

export function KindBars({ byKind = {} }) {
  const rows = KINDS.map(kind => ({ key: kind.key, label: kind.label, minutes: byKind[kind.key] || 0 }))
    .filter(row => row.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  return <BarList id="pc-kind" title="How you study" meta="Last 30 days" rows={rows} caption="Minutes by kind of study, last 30 days"
    empty="Nothing logged in the last 30 days yet." />;
}

export function ClassBars({ classes = [] }) {
  const rows = classes.map(item => ({ key: item.id, label: classLabel(item.name).title || 'Class', minutes: item.minutes, href: `/folder/${item.id}` }));
  return <BarList id="pc-class" title="By class" meta="Last 30 days" rows={rows} caption="Minutes by class, last 30 days"
    empty="Study a guide that's in a class and your time per class shows up here." />;
}

export function QuizTrend({ quizzes = [] }) {
  const [bind, renderTip] = useTip();
  const [box, setBox] = useState(null);
  const n = quizzes.length;
  const x = index => (n === 1 ? 50 : 4 + (index / (n - 1)) * 92);
  const points = quizzes.map((quiz, index) => [x(index), 100 - quiz.score]);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px},${py}`).join(' ');
  const last = quizzes[n - 1];
  const first = quizzes[0];
  return (
    <ChartCard id="pc-quiz" title="Quiz scores" meta={n > 1 ? `${last.score - first.score >= 0 ? '↑' : '↓'} ${Math.abs(last.score - first.score)} points since your first here` : n ? 'Your latest quiz' : ''}>
      {!n ? <p className="c-meta pc-empty">Take a quiz on any guide and your scores chart here. <Link href="/library">Open Library</Link></p> : (
        <div className="pc-plot-wrap" ref={setBox}>
          <div className="pc-axis-y" aria-hidden="true"><span>100%</span><span>50%</span><span>0</span></div>
          <div className="pc-plot">
            <div className="pc-grid" aria-hidden="true"><i /><i /><i /></div>
            <div className="pc-line-area">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {n > 1 && <path d={`${line} L${points[n - 1][0]},100 L${points[0][0]},100 Z`} className="pc-wash" />}
                {n > 1 && <path d={line} className="pc-line" vectorEffect="non-scaling-stroke" />}
              </svg>
              {quizzes.map((quiz, index) => {
                const text = `${quiz.title} · ${shortDay(quiz.date)}: ${quiz.score}%`;
                return (
                  <span key={index} className="pc-dot" tabIndex={0} aria-label={text} style={{ left: `${points[index][0]}%`, top: `${points[index][1]}%` }} {...bind(text)}>
                    {index === n - 1 && <span className="pc-dot-label">{quiz.score}%</span>}
                  </span>
                );
              })}
            </div>
            <div className="pc-axis-x pc-axis-ends" aria-hidden="true"><span>{shortDay(first.date)}</span><span>{n > 1 ? shortDay(last.date) : ''}</span></div>
          </div>
          {renderTip(box)}
        </div>
      )}
      <SrTable caption="Quiz scores, oldest first" head={['Date', 'Quiz', 'Score']} rows={quizzes.map(quiz => [quiz.date, quiz.title, `${quiz.score}%`])} />
    </ChartCard>
  );
}

export function StudyHours({ hours = [] }) {
  const [bind, renderTip] = useTip();
  const [box, setBox] = useState(null);
  const top = Math.max(...hours, 1);
  const total = hours.reduce((sum, value) => sum + value, 0);
  const peak = hours.indexOf(Math.max(...hours));
  return (
    <ChartCard id="pc-hours" title="When you study" meta={total ? `Most around ${hourLabel(peak)}` : 'Last 90 days'}>
      {!total ? <p className="c-meta pc-empty">Your study hours show up here after a few sessions.</p> : (
        <div className="pc-plot-wrap pc-hours" ref={setBox}>
          <div className="pc-plot">
            <div className="pc-grid" aria-hidden="true"><i /><i /></div>
            <div className="pc-cols" role="group" aria-label="Minutes studied by hour of day, last 90 days">
              {hours.map((minutes, hour) => {
                const text = `${hourLabel(hour)}: ${minutesLabel(minutes)}`;
                return (
                  <div key={hour} className={'pc-col' + (hour === peak ? ' is-peak' : '')} tabIndex={0} aria-label={text} {...bind(text)}>
                    <span className="pc-bar" style={{ height: `${(minutes / top) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="pc-axis-x" aria-hidden="true">{hours.map((_, hour) => <span key={hour}>{hour % 6 === 0 ? hourLabel(hour) : ''}</span>)}</div>
          </div>
          {renderTip(box)}
        </div>
      )}
      <SrTable caption="Minutes by hour of day, last 90 days" head={['Hour', 'Minutes']} rows={hours.map((minutes, hour) => [hourLabel(hour), minutes])} />
    </ChartCard>
  );
}

// Global: the marks are spread over several components. Drawn with tokens only (tokens.css).
export const CHART_CSS = css.global`
  .pc-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .pc-tile { display: grid; gap: 6px; align-content: start; padding: 18px 20px; }
  .pc-tile strong { font: 600 28px/1.1 var(--font-sans); color: var(--ink); }
  .pc-tile .c-meta { margin: 0; }
  .pc-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .pc-card { position: relative; display: grid; gap: 14px; align-content: start; padding: 20px; min-width: 0; }
  .pc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .pc-head .c-section-title, .pc-head .c-meta, .pc-empty { margin: 0; }
  .pc-plot-wrap { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; }
  .pc-plot-wrap.pc-hours { grid-template-columns: minmax(0, 1fr); }
  .pc-axis-y { display: flex; flex-direction: column; justify-content: space-between; height: 160px; color: var(--muted); font: 500 12px/1 var(--font-sans); text-align: right; font-variant-numeric: tabular-nums; }
  .pc-axis-y span { transform: translateY(-50%); }
  .pc-axis-y span:last-child { transform: translateY(50%); }
  .pc-plot { position: relative; display: grid; grid-template-rows: 160px auto; gap: 8px; min-width: 0; }
  .pc-hours .pc-plot { grid-template-rows: 120px auto; }
  .pc-grid { grid-area: 1 / 1; display: flex; flex-direction: column; justify-content: space-between; pointer-events: none; }
  .pc-grid i { display: block; height: 1px; background: var(--chart-grid); }
  .pc-cols { grid-area: 1 / 1; display: flex; align-items: flex-end; gap: 2px; height: 100%; }
  .pc-col { position: relative; flex: 1 1 0; display: flex; justify-content: center; align-items: flex-end; height: 100%; min-width: 0; cursor: default; outline: none; }
  .pc-col:focus-visible { box-shadow: inset 0 0 0 2px var(--olive); border-radius: 4px; }
  .pc-bar { display: block; width: 100%; max-width: 24px; min-height: 0; border-radius: 4px 4px 0 0; background: var(--chart-mark); transition: opacity var(--dur) var(--ease); }
  .pc-col:hover .pc-bar, .pc-col:focus-visible .pc-bar { opacity: .8; }
  .pc-hours .pc-col:not(.is-peak) .pc-bar { background: var(--chart-mark-soft); }
  .pc-peak { position: absolute; font: 600 12px/1 var(--font-sans); color: var(--ink); white-space: nowrap; pointer-events: none; }
  .pc-axis-x { display: flex; gap: 2px; color: var(--muted); font: 500 12px/1 var(--font-sans); }
  .pc-axis-x span { flex: 1 1 0; min-width: 0; overflow: visible; white-space: nowrap; }
  .pc-axis-x span:last-child { text-align: right; }
  .pc-axis-ends { justify-content: space-between; }
  .pc-axis-ends span { flex: 0 0 auto; }
  .pc-line-area { grid-area: 1 / 1; position: relative; }
  .pc-line-area svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .pc-line { fill: none; stroke: var(--chart-mark); stroke-width: 2px; stroke-linejoin: round; stroke-linecap: round; }
  .pc-wash { fill: var(--chart-mark); opacity: .1; }
  .pc-dot { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--chart-mark); box-shadow: 0 0 0 2px var(--chart-surface); outline: none; cursor: default; }
  .pc-dot::before { content: ''; position: absolute; inset: -8px; border-radius: 50%; }
  .pc-dot:focus-visible { box-shadow: 0 0 0 2px var(--chart-surface), 0 0 0 4px var(--olive); }
  .pc-dot-label { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); font: 600 12px/1 var(--font-sans); color: var(--ink); white-space: nowrap; }
  .pc-bars { position: relative; list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .pc-bars li { display: grid; grid-template-columns: minmax(88px, 34%) minmax(0, 1fr) auto; align-items: center; gap: 10px; outline: none; border-radius: 6px; }
  .pc-bars li:focus-visible { box-shadow: 0 0 0 2px var(--olive); }
  .pc-bar-label { font: 500 14px/1.3 var(--font-sans); color: var(--ink); }
  .pc-bar-label a { color: inherit; }
  .pc-bar-track { display: block; height: 14px; }
  .pc-hbar { display: block; height: 100%; border-radius: 0 4px 4px 0; background: var(--chart-mark); }
  .pc-bar-value { font: 500 13px/1 var(--font-sans); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pc-tip { position: absolute; z-index: 5; transform: translate(-50%, -100%); padding: 6px 10px; border-radius: 10px; background: var(--lg-menu); border: 1px solid var(--lg-edge); box-shadow: var(--lg-highlight), var(--lg-depth-float); color: var(--ink); font: 600 13px/1.3 var(--font-sans); white-space: nowrap; pointer-events: none; }
  @media (max-width: 900px) { .pc-row { grid-template-columns: minmax(0, 1fr); } .pc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .pc-tile strong { font-size: 22px; } .pc-axis-x span { font-size: 11px; } }
`;
