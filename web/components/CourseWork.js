import { useState } from 'react';
import { ExternalLink, ListChecks } from 'lucide-react';
import DoneCheck from './DoneCheck';
import { deadlineTitle, safeHref } from '../lib/formatters';

// The Dashboard's course work, like Canvas's: how much is upcoming, missing and completed this
// term (GET /calendar/coursework), each a tab with its list. Lecture to-dos join Upcoming.
const TABS = [
  { key: 'upcoming', label: 'Upcoming', empty: 'Nothing coming up. Enjoy it.' },
  { key: 'missing', label: 'Missing', empty: 'Nothing missing.' },
  { key: 'completed', label: 'Completed', empty: 'Nothing turned in yet this term.' },
];
const SHOWN = 6;

function dueLabel(iso) {
  if (!iso) return 'No due date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return date.toLocaleDateString([], { weekday: days > 0 && days < 7 ? 'short' : undefined, month: 'short', day: 'numeric' });
}

function dayParts(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return { month: date.toLocaleDateString([], { month: 'short' }), day: date.getDate() };
}

// "3 days late" for a missing item.
function lateLabel(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return 'Late';
  return days === 1 ? '1 day late' : `${days} days late`;
}

export default function CourseWork({ data, extraUpcoming = [], onPlan, actions }) {
  const [tab, setTab] = useState(() => (data?.counts?.missing ? 'missing' : 'upcoming'));
  const [all, setAll] = useState(false);
  const [doneNow, setDoneNow] = useState({});
  const lists = {
    upcoming: [...(data?.upcoming || []), ...extraUpcoming].sort((a, b) => String(a.due_at || '9').localeCompare(String(b.due_at || '9'))),
    missing: data?.missing || [],
    completed: data?.completed || [],
  };
  const counts = { upcoming: lists.upcoming.length, missing: data?.counts?.missing ?? lists.missing.length, completed: data?.counts?.completed ?? lists.completed.length };
  const list = lists[tab];
  const shown = all ? list : list.slice(0, SHOWN);

  return (
    <section className="c-section cw" aria-labelledby="cw-title">
      <div className="c-row">
        <h2 id="cw-title" className="c-section-title">Course work</h2>
        <span className="c-spacer" />
        {actions}
      </div>
      <div className="c-card cw-card">
        <div className="c-seg cw-tabs" role="tablist" aria-label="Course work">
          {TABS.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={`cw-tab is-${item.key}`}
              title={item.key === 'missing' ? 'Canvas marked it missing, or it is past due and not turned in' : undefined}
              onClick={() => { setTab(item.key); setAll(false); }}>
              {item.label}<span className="cw-badge">{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <div className="cw-list" role="tabpanel" aria-label={TABS.find(item => item.key === tab).label}>
          {!list.length && <p className="c-meta cw-empty">{TABS.find(item => item.key === tab).empty}</p>}
          {shown.map(item => {
            const done = doneNow[item.id] ?? Boolean(item.done);
            const day = dayParts(item.due_at);
            const late = tab === 'missing' ? lateLabel(item.due_at) : '';
            return (
              <div key={item.id} className={'cw-row' + (done && tab !== 'completed' ? ' is-done' : '')}>
                <DoneCheck id={item.id} title={item.title} done={done} onChange={value => setDoneNow(current => ({ ...current, [item.id]: value }))} />
                <span className={'cw-date' + (tab === 'missing' ? ' is-late' : '')} aria-hidden="true">
                  {day ? <><small>{day.month}</small><strong>{day.day}</strong></> : <small>—</small>}
                </span>
                <span className="cw-main">
                  <a className="cw-title" href={safeHref(item.url, '/calendar')} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>
                    <span className="c-truncate">{deadlineTitle(item)}</span>{item.url && !item.internal && <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />}
                  </a>
                  <span className="c-meta c-truncate">
                    {[dueLabel(item.due_at), item.course, item.points != null && (tab === 'completed' && item.score != null ? `${item.score}/${item.points} pts` : `${item.points} pts`)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {late && <span className="cw-late">{late}</span>}
                {!item.internal && tab !== 'completed' && (
                  <button type="button" className="c-icon-btn cw-plan" aria-label={`Plan ${item.title}`} title="Steps and study time" onClick={() => onPlan?.(item)}>
                    <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          {list.length > SHOWN && (
            <button type="button" className="c-btn c-btn--quiet c-btn--sm cw-more" onClick={() => setAll(value => !value)}>
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </button>
          )}
        </div>
      </div>
      <style jsx>{`
        .cw-card { display: grid; gap: 4px; padding: 8px; }
        .cw-tabs { justify-self: start; margin: 4px 4px 6px; }
        .cw-tab { display: inline-flex; align-items: center; gap: 8px; }
        .cw-badge { min-width: 22px; padding: 2px 7px; border-radius: var(--r-pill); background: var(--surface-raised); color: var(--muted); font: 600 12px/1.3 var(--font-sans); text-align: center; }
        .cw-tab[aria-selected='true'] .cw-badge { background: var(--olive-tint); color: var(--olive-ink); }
        .cw-tab.is-missing .cw-badge { background: var(--error-bg); color: var(--error); }
        .cw-list { display: grid; }
        .cw-row { display: flex; align-items: center; gap: 14px; padding: 10px 12px; border-radius: var(--r-input); }
        .cw-row + .cw-row { border-top: 1px solid var(--border-subtle); }
        .cw-row:hover { background: var(--surface-raised); }
        .cw-date { display: grid; flex: none; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: var(--olive-tint); color: var(--olive-ink); }
        .cw-date small { font: 600 11px/1 var(--font-sans); text-transform: uppercase; letter-spacing: 0.04em; }
        .cw-date strong { font: 600 18px/1 var(--font-sans); }
        .cw-date.is-late { background: var(--error-bg); color: var(--error); }
        .cw-main { display: grid; flex: 1; gap: 3px; min-width: 0; }
        .cw-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--ink); font: 600 15px/1.35 var(--font-sans); text-decoration: none; }
        .cw-title:hover { text-decoration: underline; }
        .cw-title :global(.lucide) { flex: none; color: var(--muted); opacity: 0; transition: opacity var(--dur) var(--ease); }
        .cw-row:hover .cw-title :global(.lucide), .cw-title:focus-visible :global(.lucide) { opacity: 1; }
        .cw-row.is-done .cw-title { color: var(--muted); text-decoration: line-through; }
        .cw-late { flex: none; padding: 3px 9px; border-radius: var(--r-pill); background: var(--error-bg); color: var(--error); font: 600 12px/1.3 var(--font-sans); white-space: nowrap; }
        .cw-empty { margin: 0; padding: 18px 12px; }
        .cw-more { justify-self: start; margin: 4px 8px 6px; }
        @media (max-width: 520px) {
          .cw-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); justify-self: stretch; min-width: 0; }
          .cw-tab { justify-content: center; gap: 5px; min-width: 0; padding-inline: 6px; font-size: 14px; }
          .cw-badge { min-width: 0; padding: 2px 6px; }
          .cw-row { gap: 10px; padding: 10px 6px; }
          .cw-date { width: 40px; height: 40px; }
          .cw-late { display: none; }
        }
      `}</style>
    </section>
  );
}
