import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { semesterStart, streakWithFreeze } from '../lib/activity';
import Heatmap from '../components/Heatmap';
import RecapCard from '../components/RecapCard';
import StudyInsights from '../components/StudyInsights';
import KnowledgeMap from '../components/KnowledgeMap';
import { CHART_CSS, ClassBars, KindBars, QuizTrend, StatTiles, StudyHours, StudyTimeChart } from '../components/ProgressCharts';
import { markUsed } from '../lib/progress';

// Everything about how studying is going: headline numbers, study time, how and when you study,
// quiz scores, the year, the knowledge map, weak spots and the recap.
export default function Progress() {
  const { ready } = useRequireAuth();
  // Each part fills in as its own request answers, so the fast numbers don't wait on the year of
  // study history (the page used to show only a spinner until everything arrived).
  const [data, setData] = useState({});

  useEffect(() => { markUsed('insights'); }, []);

  useEffect(() => {
    if (!ready) return;
    const tz = -new Date().getTimezoneOffset();
    const keep = (key, read) => promise => promise.then(value => setData(current => ({ ...current, [key]: read(value) })));
    keep('guides', value => value?.guides || [])(apiFetch('/guides?fields=summary&limit=500'));
    keep('folders', value => value?.folders || [])(apiFetch('/folders'));
    keep('streak', value => (value && !value.detail ? value : null))(apiFetch('/stats/streak?tz_offset=' + tz));
    keep('overview', value => (value && !value.detail ? value : null))(apiFetch('/stats/overview'));
    keep('activity', value => (value && Array.isArray(value.recent) ? value : null))(apiFetch('/stats/activity?tz_offset=' + tz));
  }, [ready]);

  if (!ready) return null;
  const since = semesterStart();
  const streak = data.streak ? streakWithFreeze(data.streak.week || [], data.streak.current_streak || 0) : null;
  const activityReady = 'activity' in data;

  return (
    <div className="c-page progress-page">
      <header className="c-page-head"><h1 className="c-title">Progress</h1></header>
      {activityReady && 'streak' in data ? <StatTiles activity={data.activity} streak={streak} /> : (
        <div className="pc-tiles" aria-busy="true" aria-label="Loading your numbers">
          {[0, 1, 2, 3].map(index => <div key={index} className="c-skeleton progress-skeleton-tile" />)}
        </div>
      )}
      {!activityReady && <div className="c-skeleton progress-skeleton-chart" aria-hidden="true" />}
      {data.activity && (
        <>
          <StudyTimeChart recent={data.activity.recent} />
          <div className="pc-row">
            <KindBars byKind={data.activity.by_kind} />
            <ClassBars classes={data.activity.classes} />
          </div>
          <div className="pc-row">
            <QuizTrend quizzes={data.activity.quizzes} />
            <StudyHours hours={data.activity.hours} />
          </div>
        </>
      )}
      {activityReady && 'streak' in data && <Heatmap serverWeek={data.streak?.week || []} serverDays={data.activity?.days || []} />}
      {data.guides && <KnowledgeMap guides={data.guides} />}
      <StudyInsights />
      {data.guides && data.folders && activityReady && 'overview' in data && <RecapCard guides={data.guides} folders={data.folders} since={since} cardsStudied={data.overview?.cards_studied || 0} serverDays={data.activity?.days || []} />}
      <style jsx>{`
        .progress-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        .progress-skeleton-tile { height: 112px; border-radius: var(--r-card); }
        .progress-skeleton-chart { height: 260px; border-radius: var(--r-card); }
      `}</style>
      <style jsx>{CHART_CSS}</style>
    </div>
  );
}
