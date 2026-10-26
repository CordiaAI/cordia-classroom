import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { semesterStart, streakWithFreeze } from '../lib/activity';
import Heatmap from '../components/Heatmap';
import RecapCard from '../components/RecapCard';
import StudyInsights from '../components/StudyInsights';
import KnowledgeMap from '../components/KnowledgeMap';
import { LoadGate } from '../components/CordiaLoader';
import { CHART_CSS, ClassBars, KindBars, QuizTrend, StatTiles, StudyHours, StudyTimeChart } from '../components/ProgressCharts';
import { markUsed } from '../lib/progress';

// Everything about how studying is going: headline numbers, study time, how and when you study,
// quiz scores, the year, the knowledge map, weak spots and the recap.
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
      apiFetch('/stats/activity?tz_offset=' + -new Date().getTimezoneOffset()),
    ]).then(([guides, folders, streak, overview, activity]) => setData({
      guides: guides?.guides || [],
      folders: folders?.folders || [],
      streak: streak && !streak.detail ? streak : null,
      overview: overview && !overview.detail ? overview : null,
      activity: activity && Array.isArray(activity.recent) ? activity : null,
    }));
  }, [ready]);

  if (!ready) return null;
  const since = semesterStart();
  const streak = data?.streak ? streakWithFreeze(data.streak.week || [], data.streak.current_streak || 0) : null;

  return (
    <LoadGate ready={Boolean(data)} label="Loading progress">
      <div className="c-page progress-page">
        <header className="c-page-head"><h1 className="c-title">Progress</h1></header>
        {data && <StatTiles activity={data.activity} streak={streak} />}
        {data?.activity && (
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
        {data && <Heatmap serverWeek={data.streak?.week || []} serverDays={data.activity?.days || []} />}
        {data && <KnowledgeMap guides={data.guides} />}
        <StudyInsights />
        {data && <RecapCard guides={data.guides} folders={data.folders} since={since} cardsStudied={data.overview?.cards_studied || 0} serverDays={data.activity?.days || []} />}
        <style jsx>{`
          .progress-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        `}</style>
        <style jsx>{CHART_CSS}</style>
      </div>
    </LoadGate>
  );
}
