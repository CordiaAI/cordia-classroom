import { useMemo } from 'react';
import { dayKey, readActivity } from '../lib/activity';

const DAYS = 364;

function level(minutes) {
  if (!minutes) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 60) return 3;
  return 4;
}

// The past 12 months of study, today in the right-most column, month labels on top.
export default function Heatmap({ serverWeek = [] }) {
  const { columns, months, total } = useMemo(() => {
    const log = readActivity();
    const serverActive = new Set(serverWeek.filter(day => day.active).map(day => day.date));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - DAYS);
    start.setDate(start.getDate() - start.getDay()); // the week's Sunday
    const cols = [];
    const labels = [];
    let active = 0;
    for (let cursor = new Date(start); cursor <= today;) {
      const week = [];
      for (let weekday = 0; weekday < 7; weekday += 1) {
        if (cursor > today) { week.push(null); continue; }
        const key = dayKey(cursor);
        const entry = log[key];
        const on = Boolean(entry?.m || entry?.c || serverActive.has(key));
        if (on) active += 1;
        week.push({ key, label: cursor.toLocaleDateString([], { month: 'short', day: 'numeric' }), minutes: entry?.m || 0, on });
        if (cursor.getDate() === 1 || (cols.length === 0 && weekday === 0)) labels.push({ column: cols.length, name: cursor.toLocaleDateString([], { month: 'short' }) });
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(week);
    }
    // Drop a first label that would collide with the next month's.
    const clean = labels.filter((item, index) => !(index === 0 && labels[1] && labels[1].column - item.column < 3));
    return { columns: cols, months: clean, total: active };
  }, [serverWeek]);

  return (
    <section className="c-card heat" aria-labelledby="heat-title">
      <header className="c-row">
        <h2 id="heat-title" className="c-section-title">Past year</h2>
        <span className="c-meta">{total} days</span>
      </header>
      <div className="heat-scroll" ref={node => { if (node) node.scrollLeft = node.scrollWidth; }}>
        <div className="heat-board" style={{ '--cols': columns.length }}>
          <div className="heat-months" aria-hidden="true">
            {months.map(item => <span key={`${item.column}-${item.name}`} style={{ gridColumn: `${item.column + 1} / span 3` }}>{item.name}</span>)}
          </div>
          <div className="heat-grid" role="img" aria-label={`Studied on ${total} days in the past year`}>
            {columns.map((week, column) => week.map((day, row) => (
              day
                ? <span key={day.key} className={`heat-cell l${day.on ? Math.max(1, level(day.minutes)) : 0}`} style={{ gridColumn: column + 1, gridRow: row + 1 }} title={`${day.label}: ${day.minutes ? `${Math.round(day.minutes)} min` : day.on ? 'studied' : 'no study'}`} />
                : <span key={`empty-${column}-${row}`} className="heat-cell is-future" style={{ gridColumn: column + 1, gridRow: row + 1 }} />
            )))}
          </div>
        </div>
      </div>
      <style jsx>{`
        .heat { display: grid; gap: 12px; padding: 20px; min-width: 0; }
        .heat header h2 { margin: 0; }
        .heat-scroll { overflow-x: auto; padding: 2px 2px 6px; }
        .heat-board { display: grid; gap: 6px; width: max-content; }
        .heat-months, .heat-grid { display: grid; grid-template-columns: repeat(var(--cols), 12px); column-gap: 3px; }
        .heat-grid { grid-template-rows: repeat(7, 12px); row-gap: 3px; }
        .heat-months span { font: 600 13px/1 var(--font-sans); color: var(--ink); white-space: nowrap; }
        .heat-cell { width: 12px; height: 12px; border-radius: 3px; background: var(--card-sunk); border: 1px solid var(--line); box-sizing: border-box; }
        .heat-cell.is-future { visibility: hidden; }
        .heat-cell.l1 { background: color-mix(in srgb, var(--olive-ink) 30%, transparent); }
        .heat-cell.l2 { background: color-mix(in srgb, var(--olive-ink) 55%, transparent); }
        .heat-cell.l3 { background: color-mix(in srgb, var(--olive-ink) 78%, transparent); }
        .heat-cell.l4 { background: var(--olive-ink); }
      `}</style>
    </section>
  );
}
