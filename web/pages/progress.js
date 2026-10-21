import { useEffect, useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { semesterStart, streakWithFreeze } from '../lib/activity';
import Heatmap from '../components/Heatmap';
import RecapCard from '../components/RecapCard';
import StudyInsights from '../components/StudyInsights';
import { LoadGate } from '../components/CordiaLoader';
import { markUsed } from '../lib/progress';

// Everything about how studying is going, in one place: streak, grove, year, weak spots, recap.
export default function Progress() {
  const { ready } = useRequireAuth();
  const [data, setData] = useState(null);

  useEffect(() => { markUsed('insights'); }, []);

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      apiFetch('/guides?fields=summary&limit=500'),
      apiFetch('/folders'),
      apiFetch('/stats/streak?tz_offset=' + -new Date().getTimezoneOffset()),
      apiFetch('/stats/overview'),
    ]).then(([guides, folders, streak, overview]) => setData({
      guides: guides?.guides || [],
      folders: folders?.folders || [],
      streak: streak && !streak.detail ? streak : null,
      overview: overview && !overview.detail ? overview : null,
    }));
  }, [ready]);

  if (!ready) return null;
  const since = semesterStart();
  const streak = data?.streak ? streakWithFreeze(data.streak.week || [], data.streak.current_streak || 0) : null;

  return (
    <LoadGate ready={Boolean(data)} label="Loading progress">
      <div className="c-page progress-page">
        <header className="c-page-head"><h1 className="c-title">Progress</h1></header>
        {streak && (
          <section className="c-card progress-streak" aria-label="Streak">
            <Flame size={28} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <strong>{streak.days} day{streak.days === 1 ? '' : 's'}</strong>
              <span className="c-meta">
                {streak.frozenThisWeek
                  ? <><Snowflake size={14} strokeWidth={1.75} aria-hidden="true" /> Freeze used this week</>
                  : 'One missed day a week won’t break it.'}
              </span>
            </div>
          </section>
        )}
        {data && <Heatmap serverWeek={data.streak?.week || []} />}
        <StudyInsights />
        {data && <RecapCard guides={data.guides} folders={data.folders} since={since} cardsStudied={data.overview?.cards_studied || 0} />}
        <style jsx>{`
          .progress-page { width: min(var(--page-max), 100%); margin: 0 auto; }
          .progress-streak { display: flex; align-items: center; gap: 16px; padding: 20px; }
          .progress-streak > :global(.lucide) { color: var(--olive-ink); }
          .progress-streak div { display: grid; gap: 4px; }
          .progress-streak strong { font: 600 28px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
          .progress-streak .c-meta { display: inline-flex; align-items: center; gap: 4px; }
        `}</style>
      </div>
    </LoadGate>
  );
}
