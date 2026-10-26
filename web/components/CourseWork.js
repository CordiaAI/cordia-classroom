import { useState } from 'react';
import Link from 'next/link';
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
      <div className="cw-counts" role="tablist" aria-label="Course work">
        {TABS.map(item => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={`c-card cw-count is-${item.key}`}
            onClick={() => { setTab(item.key); setAll(false); }}>
            <strong>{counts[item.key]}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="c-card c-list cw-list" role="tabpanel" aria-label={TABS.find(item => item.key === tab).label}>
        {!list.length && <p className="c-meta cw-empty">{TABS.find(item => item.key === tab).empty}</p>}
        {shown.map(item => {
          const done = doneNow[item.id] ?? Boolean(item.done);
          return (
            <div key={item.id} className={'c-list-row cw-row' + (done && tab !== 'completed' ? ' is-done' : '')}>
              <DoneCheck id={item.id} title={item.title} done={done} onChange={value => setDoneNow(current => ({ ...current, [item.id]: value }))} />
              <span className="c-grow cw-main">
                <a className="c-truncate cw-title" href={safeHref(item.url, '/canvas?tab=calendar')} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>
                  {deadlineTitle(item)}{item.url && !item.internal && <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />}
                </a>
                <span className="c-meta c-truncate">
                  <span className={'cw-due-sm' + (tab === 'missing' ? ' is-late' : '')}>{dueLabel(item.due_at)} · </span>
                  {[item.course, item.points != null && (tab === 'completed' && item.score != null ? `${item.score}/${item.points} pts` : `${item.points} pts`)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className={'cw-due' + (tab === 'missing' ? ' is-late' : '')}>{dueLabel(item.due_at)}</span>
              {!item.internal && tab !== 'completed' && (
                <button type="button" className="c-icon-btn" aria-label={`Plan ${item.title}`} title="Steps and study time" onClick={() => onPlan?.(item)}>
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
      {tab === 'missing' && list.length > 0 && <p className="c-meta cw-note">Missing means Canvas marked it missing, or it's past due and not turned in. <Link href="/canvas?tab=calendar">See calendar</Link></p>}
      <style jsx>{`
        .cw-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .cw-count { display: grid; justify-items: center; gap: 6px; padding: 18px 12px; border: 1px solid transparent; cursor: pointer; text-align: center; color: var(--ink); }
        .cw-count strong { font: 600 32px/1 var(--font-sans); }
        .cw-count span { font: 600 15px/1.2 var(--font-sans); color: var(--muted); }
        .cw-count.is-missing strong { color: var(--error); }
        .cw-count.is-completed strong { color: var(--olive-ink); }
        .cw-count[aria-selected='true'] { border-color: var(--olive) !important; box-shadow: 0 0 0 1px var(--olive), var(--lg-highlight), var(--lg-shadow) !important; }
        .cw-count[aria-selected='true'] span { color: var(--ink); }
        .cw-count:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
        .cw-list { margin-top: 12px; }
        .cw-row { gap: 12px; }
        .cw-main { display: grid; gap: 2px; min-width: 0; }
        .cw-title { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; color: var(--ink); font: 600 16px/1.35 var(--font-sans); text-decoration: none; }
        .cw-title:hover { text-decoration: underline; }
        .cw-title :global(.lucide) { flex: none; color: var(--muted); }
        .cw-row.is-done .cw-title { color: var(--muted); text-decoration: line-through; }
        .cw-due { flex: none; color: var(--muted); font: 500 14px/1.2 var(--font-sans); white-space: nowrap; }
        .cw-due.is-late, .cw-due-sm.is-late { color: var(--error); }
        .cw-due-sm { display: none; }
        .cw-empty { margin: 0; padding: 18px 20px; }
        .cw-more { justify-self: start; margin: 6px 12px 10px; }
        .cw-note { margin: 8px 4px 0; }
        @media (max-width: 520px) {
          .cw-count { padding: 14px 6px; }
          .cw-count strong { font-size: 26px; }
          .cw-row { gap: 10px; }
          .cw-due { display: none; }
          .cw-due-sm { display: inline; }
        }
      `}</style>
    </section>
  );
}
