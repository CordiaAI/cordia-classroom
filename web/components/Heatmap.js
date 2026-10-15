import { useMemo, useState } from 'react';
import { dayKey, readActivity } from '../lib/activity';

const WEEKS = 53;

function level(minutes) {
  if (!minutes) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 60) return 3;
  return 4;
}

// A year of study days, olive-shaded by minutes. Tap a day to see what was studied.
export default function Heatmap({ serverWeek = [] }) {
  const log = useMemo(() => readActivity(), []);
  const [picked, setPicked] = useState(null);
  const serverActive = new Set(serverWeek.filter(day => day.active).map(day => day.date));
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS - 1) * 7 - today.getDay());
  const days = [];
  for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const key = dayKey(cursor);
    const entry = log[key];
    days.push({ key, date: new Date(cursor), minutes: entry?.m || 0, entry, active: Boolean(entry?.m || entry?.c || serverActive.has(key)) });
  }
  const total = days.filter(day => day.active).length;
  const pickedDay = days.find(day => day.key === picked);

  return (
    <section className="c-card heat" aria-labelledby="heat-title">
      <header className="c-row">
        <h2 id="heat-title" className="c-section-title">Year</h2>
        <span className="c-meta">{total} days</span>
      </header>
      <div className="heat-scroll">
        <div className="heat-grid" role="group" aria-label="Study days this year">
          {days.map(day => {
            const shade = day.active ? Math.max(1, level(day.minutes)) : 0;
            const label = `${day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${day.minutes ? `${Math.round(day.minutes)} min` : day.active ? 'studied' : 'no study'}`;
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
          <strong>{pickedDay.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          <span className="c-meta">{Math.round(pickedDay.minutes)} min{pickedDay.entry?.c ? ` · ${pickedDay.entry.c} cards` : ''}</span>
          {pickedDay.entry?.g && Object.values(pickedDay.entry.g).length > 0 ? (
            <ul>{Object.entries(pickedDay.entry.g).map(([key, guide]) => <li key={key}><span className="c-truncate">{guide.n || 'Guide'}</span><span className="c-meta">{Math.round(guide.m)} min</span></li>)}</ul>
          ) : <span className="c-meta">{pickedDay.active ? 'Studied' : '0 min'}</span>}
        </div>
      )}
      <style jsx>{`
        .heat { display: grid; gap: 12px; padding: 20px; }
        .heat-scroll { overflow-x: auto; padding: 2px; }
        .heat-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 12px); grid-auto-columns: 12px; gap: 3px; width: max-content; }
        .heat-cell { width: 12px; height: 12px; padding: 0; border: 0; border-radius: 3px; background: var(--card-sunk); cursor: pointer; }
        .heat-cell.l1 { background: rgba(83, 97, 73, .3); }
        .heat-cell.l2 { background: rgba(83, 97, 73, .5); }
        .heat-cell.l3 { background: rgba(83, 97, 73, .75); }
        .heat-cell.l4 { background: var(--olive); }
        :global([data-theme='dark']) .heat-cell.l1 { background: rgba(195, 207, 182, .3); }
        :global([data-theme='dark']) .heat-cell.l2 { background: rgba(195, 207, 182, .5); }
        :global([data-theme='dark']) .heat-cell.l3 { background: rgba(195, 207, 182, .75); }
        :global([data-theme='dark']) .heat-cell.l4 { background: var(--olive-ink); }
        .heat-cell.is-picked { outline: 2px solid var(--ink); outline-offset: 1px; }
        .heat-day { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); }
        .heat-day ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .heat-day li { display: flex; justify-content: space-between; gap: 12px; }
      `}</style>
    </section>
  );
}
