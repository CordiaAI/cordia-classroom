import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ListChecks } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import { LoadGate, SectionLoader } from '../components/CordiaLoader';
import AssignmentSheet from '../components/AssignmentSheet';
import { acceptWeek, getAnnouncements, getWeek, minutesLabel } from '../lib/studyPlans';

function dueLabel(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The weekly review: what's due in the next 7 days and how much of it has study time, grades,
// last week's planned vs. done, and the announcements digest. "Plan my week" schedules the picks.
export default function WeekPage() {
  const { ready } = useRequireAuth();
  const [week, setWeek] = useState(null);
  const [news, setNews] = useState(null);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [planning, setPlanning] = useState(null);

  async function load() {
    const [weekData, newsData] = await Promise.all([getWeek(), getAnnouncements()]);
    if (!weekData || weekData.detail) { setError(weekData?.detail || "Your week couldn't load. Try again."); setWeek({ due: [], grades: [], last_week: {} }); }
    else {
      setWeek(weekData);
      // Pre-pick what has no study time yet.
      setPicked(Object.fromEntries(weekData.due.filter(item => !item.scheduled_minutes).map(item => [item.id, true])));
    }
    setNews(Array.isArray(newsData?.announcements) ? newsData.announcements : []);
  }
  useEffect(() => { if (ready) load(); }, [ready]);

  async function plan() {
    const keys = Object.keys(picked).filter(key => picked[key]);
    if (!keys.length) return;
    setBusy(true); setError(''); setNotice('');
    const result = await acceptWeek(keys);
    setBusy(false);
    if (typeof result?.added !== 'number') { setError(result?.detail || "That didn't plan. Try again."); return; }
    setNotice(result.added ? `Added ${result.added} study block${result.added === 1 ? '' : 's'}. They're on your Cordia calendar if Google Calendar sync is on.` : 'Everything picked already has study time.');
    load();
  }

  if (!ready) return null;
  const last = week?.last_week || {};
  return (
    <LoadGate ready={Boolean(week)}>
      <div className="c-page week">
        <Link href="/dashboard" className="c-btn c-btn--quiet c-btn--sm week-back"><ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />Dashboard</Link>
        <header className="c-page-head">
          <h1 className="c-title">Your week</h1>
        </header>

        <section className="c-section" aria-labelledby="week-due">
          <h2 id="week-due" className="c-section-title">Due in the next 7 days</h2>
          {week?.due?.length ? (
            <div className="c-card c-list">
              {week.due.map(item => (
                <div key={item.id} className="c-list-row week-row">
                  <input type="checkbox" className="week-pick" checked={Boolean(picked[item.id])} aria-label={`Plan ${item.title}`}
                    onChange={event => setPicked(current => ({ ...current, [item.id]: event.target.checked }))} />
                  <span className="c-grow">
                    <span className="week-title">{item.title}</span>
                    <span className="c-meta">{[item.course, dueLabel(item.due_at), item.effort_minutes && `about ${minutesLabel(item.effort_minutes)}`,
                      item.scheduled_minutes ? `${minutesLabel(item.scheduled_minutes)} scheduled` : 'no study time yet'].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" className="c-icon-btn" aria-label={`Steps for ${item.title}`} onClick={() => setPlanning(item)}><ListChecks size={18} strokeWidth={1.75} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
          ) : <p className="c-meta">Nothing due in the next 7 days.</p>}
          {week?.due?.length > 0 && (
            <div className="week-actions">
              <button type="button" className="c-btn c-btn--primary" onClick={plan} disabled={busy || !Object.values(picked).some(Boolean)}>{busy ? 'Planning…' : 'Plan my week'}</button>
              <span className="c-meta">Breaks each pick into steps and fits study time into your free time.</span>
            </div>
          )}
          {notice && <p className="cn-notice" role="status">{notice}</p>}
          {error && <p className="cn-error" role="alert">{error}</p>}
        </section>

        <section className="c-section week-stats" aria-label="Study time and grades">
          <div className="c-card week-stat">
            <span className="c-meta">Last week</span>
            <strong>{minutesLabel(last.done_minutes)} done</strong>
            <span className="c-meta">of {minutesLabel(last.planned_minutes)} planned</span>
          </div>
          <div className="c-card week-stat">
            <span className="c-meta">This week</span>
            <strong>{minutesLabel(week?.next_week_minutes)}</strong>
            <span className="c-meta">scheduled</span>
          </div>
          {(week?.grades || []).map(grade => (
            <div key={grade.course} className="c-card week-stat">
              <span className="c-meta c-truncate">{grade.course}</span>
              <strong>{grade.grade || `${Math.round(grade.score)}%`}</strong>
              <span className="c-meta">{grade.grade ? `${Math.round(grade.score)}%` : 'current grade'}</span>
            </div>
          ))}
        </section>

        <section className="c-section" aria-labelledby="week-news">
          <h2 id="week-news" className="c-section-title">Announcements</h2>
          {news === null ? <SectionLoader height={120} label="Loading announcements" /> : news.length ? (
            <div className="c-card c-list">
              {news.slice(0, 12).map(row => (
                <div key={row.canvas_announcement_id} className="c-list-row week-news">
                  <span className="c-grow">
                    <span className="week-title">{row.title}{row.changes !== 'none' && <span className="week-flag">{row.changes === 'deadline' ? 'Date change' : 'New work'}</span>}</span>
                    <span className="c-meta">{[row.course, row.summary].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="c-meta">No announcements in the last two weeks.</p>}
        </section>

        {planning && <AssignmentSheet item={planning} onClose={() => { setPlanning(null); load(); }} />}
        <style jsx>{`
          .week :global(.week-back) { justify-self: start; margin-bottom: 4px; }
          .week-row, .week-news { gap: 14px; }
          .week-row .c-grow, .week-news .c-grow { display: grid; gap: 2px; min-width: 0; }
          .week-title { font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
          .week-pick { width: 20px; height: 20px; accent-color: var(--olive); flex: none; }
          .week-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; }
          .week-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
          .week-stat { display: grid; gap: 2px; padding: 14px 18px; min-width: 0; }
          .week-stat strong { font: 600 20px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
          .week-flag { margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: var(--olive-tint); color: var(--olive-ink); font: 600 12px/1.4 var(--font-sans); }
        `}</style>
      </div>
    </LoadGate>
  );
}
