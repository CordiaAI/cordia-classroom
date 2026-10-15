import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Flame, Play, Snowflake } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { loadStudyQueue } from '../lib/studyQueue';
import { lastGuide } from '../lib/userStore';
import { markUsed, updateProgress, useProgress } from '../lib/progress';
import { activeStep, dayOneFinished, startWalkthrough, walkthroughEvent } from '../lib/walkthrough';
import { streakWithFreeze } from '../lib/activity';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { requestTip } from '../lib/tips';
import StudyTimer from '../components/StudyTimer';
import StudyInsights from '../components/StudyInsights';
import LearnCordia from '../components/LearnCordia';
import AboutYou from '../components/AboutYou';
import GroveCard from '../components/GroveCard';
import DueSoon from '../components/DueSoon';
import StudyDocument from '../components/StudyDocument';
import AIChatWidget from '../components/AIChatWidget';

const LEGACY_VIEWS = { guides: '/library', classes: '/library', calendar: '/calendar', notes: '/smartnotes' };

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default function Today({ timerState, setTimerState }) {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const legacy = LEGACY_VIEWS[router.query.view];
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [stats, setStats] = useState(null);
  const [streak, setStreak] = useState(null);
  const [queue, setQueue] = useState(null);
  const [insights, setInsights] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [streakInfo, setStreakInfo] = useState(null);
  const [studyGuideFull, setStudyGuideFull] = useState(null);
  const progress = useProgress();
  const step = activeStep(progress.wt?.status === 'active' ? progress.wt : null);

  useEffect(() => {
    if (ready && legacy) router.replace(legacy);
  }, [ready, legacy, router]);

  useEffect(() => {
    if (ready && !legacy) loadData();
  }, [ready, legacy]);

  async function loadData() {
    setLoading(true);
    setLoadError('');
    try {
      const tz = -new Date().getTimezoneOffset();
      const results = await Promise.allSettled([
        apiFetch('/folders'),
        apiFetch('/guides?fields=summary&limit=500'),
        apiFetch('/stats/overview'),
        apiFetch('/stats/streak?tz_offset=' + tz),
        loadOnboarding(),
      ]);
      const value = index => (results[index].status === 'fulfilled' ? results[index].value : null);
      const [foldersData, guidesData, statsData, streakData, onboardingData] = [0, 1, 2, 3, 4].map(value);
      const failure = [foldersData, guidesData, statsData].find(data => !data || data.detail);
      if (failure) setLoadError(apiErrorMessage(failure?.detail, 'Some Classroom data could not be refreshed. Your saved work is unchanged.'));
      if (Array.isArray(foldersData?.folders)) setFolders(foldersData.folders);
      if (Array.isArray(guidesData?.guides)) setGuides(guidesData.guides);
      if (statsData && !statsData.detail) setStats(statsData);
      if (streakData && !streakData.detail) setStreak(streakData);
      setOnboarding(onboardingData);
      const guideList = guidesData?.guides || [];
      // New account, nothing made yet: the day-one walkthrough starts with "About you".
      if (onboardingData && !onboardingData.completed && !guideList.length && !progress.wt && !dayOneFinished()) startWalkthrough('day1');
      else if (onboardingData && !onboardingData.completed && guideList.length) saveOnboardingStep('done');
      // Accounts from before the walkthrough skip day one and get the feature dots.
      if ((onboardingData?.completed || guideList.length) && !progress.day1Status) updateProgress(() => ({ day1Status: 'existing' }));
      const remembered = lastGuide();
      const pick = (remembered && guideList.find(guide => guide.id === remembered.id)) || createDashboardOverview(foldersData?.folders, guideList).continueGuide;
      if (pick) apiFetch('/guides/' + pick.id).then(data => { if (data?.guide) setStudyGuideFull(data.guide); });
      if (guideList.length) markUsed('add');
      if (statsData?.cards_studied) markUsed('cards');
    } finally {
      setLoading(false);
    }
    loadStudyQueue().then(setQueue);
    apiFetch('/stats/insights').then(data => { setInsights(data); if (data?.answered) markUsed('quiz'); });
    apiFetch('/smart_notes').then(data => { if (data?.notes?.some(note => String(note.content || '').replace(/<[^>]+>/g, '').trim())) markUsed('note-written'); });
    apiFetch('/calendar/connection').then(data => { setCalendar(data); if (data?.connected) markUsed('calendar-connected'); });
    apiFetch('/onboarding/checklist').then(data => {
      if (data?.practice) markUsed('practice');
      if (data?.learn_your_way) markUsed('explain');
    });
  }

  useEffect(() => { if (ready && !legacy) walkthroughEvent('today-opened'); }, [ready, legacy]);

  // One free freeze per week bridges a single missed day.
  useEffect(() => {
    if (streak) setStreakInfo(streakWithFreeze(streak.week || [], streak.current_streak || 0));
  }, [streak]);

  // Feature tips, one per session, each at its moment.
  useEffect(() => {
    if (!queue || !stats || !progress.first) return;
    const visit = { days: Math.floor((Date.now() - progress.first) / 86400000) + 1 };
    if ((stats.minutes_today || 0) >= 25) requestTip('break');
    else if (visit.days >= 3 && calendar && !calendar.connected) requestTip('calendar');
    else if (visit.days >= 7 && insights?.answered) requestTip('insights');
  }, [queue, stats, calendar, insights, progress.first]);

  if (!ready || legacy) return null;

  if (step?.screen === 'about') return <AboutYou />;

  const overview = createDashboardOverview(folders, guides);
  const remembered = lastGuide();
  const studyGuide = (remembered && guides.find(guide => guide.id === remembered.id)) || overview.continueGuide;
  const counts = queue ? [
    [queue.cardTotal + queue.misses.length, 'card due'],
    [queue.problems, 'problem'],
    [queue.minutes, 'min'],
  ].filter(([count]) => count > 0).map(([count, word]) => (word === 'min' ? `${count} min` : word === 'card due' ? `${plural(count, 'card')} due` : plural(count, word))) : [];
  const hasInsights = Boolean(insights?.strengths?.length || insights?.needs_work?.length);

  return (
    <div className="c-page today">
      <header className="today-head">
        <h1 className="today-title">Today</h1>
        <div className="today-head-right">
          <LearnCordia />
          {streakInfo && streakInfo.days > 0 && (
            <span className="today-streak" aria-label={`Streak: ${plural(streakInfo.days, 'day')}${streakInfo.frozenThisWeek ? ', freeze used this week' : ''}`}>
              <Flame size={20} strokeWidth={1.75} aria-hidden="true" />{plural(streakInfo.days, 'day')}
              {streakInfo.frozenThisWeek && <Snowflake size={16} strokeWidth={1.75} aria-hidden="true" />}
            </span>
          )}
        </div>
      </header>

      {loadError && (
        <div className="today-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={loadData}>Retry</button>
        </div>
      )}

      {counts.length > 0 && (
        <section className="c-card today-start" aria-label="Start">
          <p className="today-counts">{counts.join(' · ')}</p>
          <button type="button" className="c-btn c-btn--primary today-start-btn" data-spot="start" onClick={() => { walkthroughEvent('start'); router.push('/session'); }}>
            <Play size={20} strokeWidth={1.75} aria-hidden="true" />Start
          </button>
        </section>
      )}

      {calendar?.connected && <DueSoon items={calendar.items || []} folders={folders} />}

      {studyGuide && studyGuideFull?.id === studyGuide.id && (
        <section className="today-space" aria-label="Study space">
          <StudyDocument
            compact
            guide={studyGuideFull}
            label={folders.find(folder => folder.id === studyGuide.folder_id)?.name || studyGuideFull.title}
            onOpen={() => router.push('/guide/' + studyGuide.id)}
          />
          <div className="c-card today-tutor">
            <AIChatWidget preferredGuideId={studyGuide.id} compact />
          </div>
        </section>
      )}

      <div className="today-row">
        <GroveCard guides={guides} />
        <StudyTimer timerState={timerState} setTimerState={setTimerState} />
        {hasInsights && <StudyInsights compact />}
      </div>

      <style jsx global>{`
        .today { gap: 24px; }
        .today-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .today-title { margin: 0; font: 500 56px/1 var(--font-display); letter-spacing: -0.025em; }
        .today-head-right { display: flex; align-items: center; gap: 8px; }
        .today-streak { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--glass); border: 1px solid var(--glass-edge); font: 600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius: 20px; background: var(--error-bg); color: var(--error); font-weight: 600; }
        .today-start { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 16px 16px 28px; flex-wrap: wrap; }
        .today-counts { margin: 0; font: 600 17px/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-start-btn { min-width: 140px; }
        .today-space { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr); gap: 16px; height: min(680px, calc(100svh - 300px)); min-height: 520px; }
        .today-tutor { display: flex; min-width: 0; overflow: hidden; }
        .today-tutor .cordia-tutor { flex: 1; min-width: 0; }
        .today-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; align-items: start; }
        @media (max-width: 1023px) {
          .today-space { grid-template-columns: minmax(0, 1fr); height: auto; min-height: 0; }
          .today-space .doc { height: 560px; }
          .today-tutor { height: 520px; }
        }
        @media (max-width: 1023px) {
          .today-title { font-size: 44px; }
          .today-start { padding: 16px; }
          .today-start-btn { width: 100%; }
          .today-space .doc { height: auto; }
        }
      `}</style>
    </div>
  );
}
