import { useMemo, useState } from 'react';
import { dayKey, readActivity } from '../lib/activity';


function level(minutes) {
  if (!minutes) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 60) return 3;
  return 4;
}

// A year of study days, olive-shaded by minutes. Tap a day to see what was studied. Minutes come
// from the server's log (every device); this browser's log adds which guides and cards.
export default function Heatmap({ serverWeek = [], serverDays = [] }) {
  const log = useMemo(() => readActivity(), []);
  const [picked, setPicked] = useState(null);
  const serverActive = new Set(serverWeek.filter(day => day.active).map(day => day.date));
  const server = new Map(serverDays.map(day => [day.date, day]));
  // The past 12 months, ending today (columns start on Sunday). It opens scrolled to today.
  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  start.setDate(start.getDate() - start.getDay());
  const days = [];
  for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor);
    const entry = log[key];
    const fromServer = server.get(key);
    const minutes = Math.max(entry?.m || 0, fromServer?.minutes || 0);
    days.push({ key, date: new Date(cursor), minutes, cards: Math.max(entry?.c || 0, fromServer?.cards || 0), entry,
      active: Boolean(minutes || entry?.c || fromServer || serverActive.has(key)) });
  }
  const total = days.filter(day => day.active).length;
  const pickedDay = days.find(day => day.key === picked);
  // Month names over the first column of each month.
  const months = [];
  days.forEach((day, index) => {
    if (day.date.getDate() <= 7 && day.date.getDay() === 0) months.push({ column: Math.floor(index / 7) + 1, label: day.date.toLocaleDateString([], { month: 'short' }) });
  });

  return (
    <section className="c-card heat" aria-labelledby="heat-title">
      <header className="c-row">
        <h2 id="heat-title" className="c-section-title">Year</h2>
        <span className="c-meta">{total} day{total === 1 ? '' : 's'} studied</span>
      </header>
      <p className="c-meta heat-hint">Tap a day to see what you studied.</p>
      <div className="heat-scroll" ref={node => { if (node) node.scrollLeft = node.scrollWidth; }}>
        <div className="heat-months" aria-hidden="true">{months.map(month => <span key={month.column} style={{ gridColumn: month.column }}>{month.label}</span>)}</div>
        <div className="heat-grid" role="group" aria-label="Study days this year">
          {days.map(day => {
            const shade = day.active ? Math.max(1, level(day.minutes)) : 0;
            const label = `${day.date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}: ${day.minutes ? `${Math.round(day.minutes)} min` : day.active ? 'studied' : 'no study'}`;
            return (
              <button
                key={day.key}
                type="button"
                className={`heat-cell l${shade}${picked === day.key ? ' is-picked' : ''}`}
                aria-label={label}
                title={label}
                tabIndex={day.active ? 0 : -1}
                onClick={() => setPicked(picked === day.key ? null : day.key)}
              />
            );
          })}
        </div>
      </div>
      {pickedDay && (
        <div className="heat-day" role="status">
          <strong>{pickedDay.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong>
          <span className="c-meta">{Math.round(pickedDay.minutes)} min{pickedDay.cards ? ` · ${pickedDay.cards} cards` : ''}</span>
          {pickedDay.entry?.g && Object.values(pickedDay.entry.g).length > 0 ? (
            <ul>{Object.entries(pickedDay.entry.g).map(([key, guide]) => <li key={key}><span className="c-truncate">{guide.n || 'Guide'}</span><span className="c-meta">{Math.round(guide.m)} min</span></li>)}</ul>
          ) : <span className="c-meta">{pickedDay.active ? 'Studied' : '0 min'}</span>}
        </div>
      )}
      <div className="heat-legend c-meta" aria-hidden="true">Less<i className="heat-cell l0" /><i className="heat-cell l1" /><i className="heat-cell l2" /><i className="heat-cell l3" /><i className="heat-cell l4" />More</div>
      <style jsx>{`
        .heat { display: grid; gap: 12px; padding: 20px; }
        .heat-hint { margin: 0; }
        .heat-scroll { overflow-x: auto; padding: 2px; }
        .heat-months { display: grid; grid-auto-flow: column; grid-auto-columns: 12px; gap: 3px; width: max-content; height: 16px; color: var(--muted); font: 500 12px/1 var(--font-sans); }
        .heat-months span { white-space: nowrap; }
        .heat-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px); grid-auto-columns: 12px; gap: 3px; width: max-content; }
        /* One olive ramp, light to dark by minutes (tokens.css --heat-0..4, both themes). */
        .heat-cell { display: inline-block; width: 12px; height: 12px; padding: 0; border: 0; border-radius: 3px; background: var(--heat-0); cursor: pointer; }
        .heat-cell.l1 { background: var(--heat-1); }
        .heat-cell.l2 { background: var(--heat-2); }
        .heat-cell.l3 { background: var(--heat-3); }
        .heat-cell.l4 { background: var(--heat-4); }
        .heat-legend { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin: 0; }
        .heat-legend .heat-cell { cursor: default; }
        .heat-cell.is-picked { outline: 2px solid var(--ink); outline-offset: 1px; }
        .heat-day { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); }
        .heat-day ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .heat-day li { display: flex; justify-content: space-between; gap: 12px; }
      `}</style>
    </section>
  );
}
