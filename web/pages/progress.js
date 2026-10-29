import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { loadFolders } from '../lib/folders';
import { useRequireAuth } from '../lib/auth';
import { semesterStart, streakWithFreeze } from '../lib/activity';
import Heatmap from '../components/Heatmap';
import RecapCard from '../components/RecapCard';
import StudyInsights from '../components/StudyInsights';
import KnowledgeMap from '../components/KnowledgeMap';
import { CHART_CSS, ClassBars, KindBars, QuizTrend, StatTiles, StudyHours, StudyTimeChart } from '../components/ProgressCharts';
import { markUsed } from '../lib/progress';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';

// Everything about how studying is going: headline numbers, study time, how and when you study,
// quiz scores, the year, the knowledge map, weak spots and the recap.
export default function Progress() {
  const { ready } = useRequireAuth();
  // Everything loads together behind the Cordia mark, then the whole page appears at once
  // (no charts popping in one by one).
  const [data, setData] = useState({});
  const KEYS = ['guides', 'folders', 'streak', 'overview', 'activity', 'insights'];

  useEffect(() => { markUsed('insights'); }, []);

  useEffect(() => {
    if (!ready) return;
    const tz = -new Date().getTimezoneOffset();
    const keep = (key, read) => promise => promise.catch(() => null).then(value => setData(current => ({ ...current, [key]: read(value) })));
    keep('guides', value => value?.guides || [])(apiFetch('/guides?fields=summary&limit=500'));
    keep('folders', value => value?.folders || [])(loadFolders());
    keep('streak', value => (value && !value.detail ? value : null))(apiFetch('/stats/streak?tz_offset=' + tz));
    keep('overview', value => (value && !value.detail ? value : null))(apiFetch('/stats/overview'));
    keep('activity', value => (value && Array.isArray(value.recent) ? value : null))(apiFetch('/stats/activity?tz_offset=' + tz));
    keep('insights', value => value || null)(apiFetch('/stats/insights'));
  }, [ready]);
  const gate = useLoadGate(KEYS.every(key => key in data));

  if (!ready) return null;
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading your progress" />;
  const since = semesterStart();
  const streak = data.streak ? streakWithFreeze(data.streak.week || [], data.streak.current_streak || 0) : null;

  return (
    <Reveal phase={gate}>
    <div className="c-page progress-page">
      <header className="c-page-head"><h1 className="c-title">Progress</h1></header>
      <StatTiles activity={data.activity} streak={streak} />
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
      <Heatmap serverWeek={data.streak?.week || []} serverDays={data.activity?.days || []} />
      {data.guides && <KnowledgeMap guides={data.guides} />}
      <StudyInsights data={data.insights} />
      <RecapCard guides={data.guides} folders={data.folders} since={since} cardsStudied={data.overview?.cards_studied || 0} serverDays={data.activity?.days || []} />
      <style jsx>{`
        .progress-page { width: min(var(--page-max), 100%); margin: 0 auto; }
      `}</style>
      <style jsx>{CHART_CSS}</style>
    </div>
    </Reveal>
  );
}
