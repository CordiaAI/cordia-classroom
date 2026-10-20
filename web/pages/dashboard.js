import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Brain, ChevronRight, Flame, Layers, NotebookPen, PencilRuler, Snowflake } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { lastGuide } from '../lib/userStore';
import { markUsed, unmarkUsed, useProgress } from '../lib/progress';
import { activeStep, dayOneFinished, startWalkthrough, walkthroughEvent } from '../lib/walkthrough';
import { streakWithFreeze } from '../lib/activity';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { requestTip } from '../lib/tips';
import ProgressRing from '../components/ProgressRing';
import StudyTimer from '../components/StudyTimer';
import StudyInsights from '../components/StudyInsights';
import LearnCordia from '../components/LearnCordia';
import AboutYou from '../components/AboutYou';
import GroveCard from '../components/GroveCard';
import PulseDot from '../components/PulseDot';
import CanvasConnectButton from '../components/CanvasConnectButton';
import { LoadGate, SectionLoader } from '../components/CordiaLoader';
import { useCachedPage } from '../lib/pageCache';
import { readCalendarCache, rememberCalendar } from '../lib/calendarCache';
import { confirmedTodos, lectureCalendarItems, mergeCalendarItems } from '../lib/lectures';

const SLOW = Symbol('slow');
const SLOW_MS = 4000;

const LEGACY_VIEWS = { guides: '/library', classes: '/library', calendar: '/calendar', notes: '/smartnotes' };

function shortDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default function Today({ timerState, setTimerState }) {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const legacy = LEGACY_VIEWS[router.query.view];
  const progress = useProgress();
  const step = activeStep(progress.wt?.status === 'active' ? progress.wt : null);

  useEffect(() => {
    if (ready && legacy) router.replace(legacy);
  }, [ready, legacy, router]);

  // Every source loads together and the page appears once, from cache when returning.
  // The calendar feed can be slow: past 4 s the page shows and Due soon fills in on its own.
  const { data, ready: loaded, update, refresh } = useCachedPage('today', async () => {
    const tz = -new Date().getTimezoneOffset();
    const safe = promise => promise.catch(() => null);
    const calendarRequest = safe(apiFetch('/calendar/connection'));
    const calendarOrSlow = Promise.race([calendarRequest, new Promise(resolve => setTimeout(() => resolve(SLOW), SLOW_MS))]);
    const [foldersData, guidesData, statsData, streakData, onboardingData, insightsData, notesData, checklistData, calendarData, lectureTodos] = await Promise.all([
      safe(apiFetch('/folders')),
      safe(apiFetch('/guides?fields=summary&limit=500')),
      safe(apiFetch('/stats/overview')),
      safe(apiFetch('/stats/streak?tz_offset=' + tz)),
      safe(loadOnboarding()),
      safe(apiFetch('/stats/insights')),
      safe(apiFetch('/smart_notes')),
      safe(apiFetch('/onboarding/checklist')),
      calendarOrSlow,
      safe(confirmedTodos()),
    ]);
    const failure = [foldersData, guidesData, statsData].find(item => !item || item.detail);
    const guideList = Array.isArray(guidesData?.guides) ? guidesData.guides : [];
    // New account, nothing made yet: the day-one walkthrough starts with "About you".
    if (onboardingData && !onboardingData.completed && !guideList.length && !progress.wt && !dayOneFinished()) startWalkthrough('day1');
    else if (onboardingData && !onboardingData.completed && guideList.length) saveOnboardingStep('done');
    if (guideList.length) markUsed('add');
    if (statsData?.cards_studied) markUsed('cards');
    if (insightsData?.answered) markUsed('quiz');
    if (notesData?.notes?.length) markUsed('notes');
    if (checklistData?.practice) markUsed('practice');
    if (checklistData?.learn_your_way) markUsed('explain');
    const applyCalendar = calendar => {
      rememberCalendar(calendar);
      if (calendar?.connected) markUsed('calendar');
      else if (calendar && !calendar.detail && calendar.connected === false) unmarkUsed('calendar');
    };
    if (calendarData === SLOW) calendarRequest.then(calendar => { applyCalendar(calendar); update(current => ({ ...current, calendar, calendarSlow: false })); });
    else applyCalendar(calendarData);
    return {
      loadError: failure ? apiErrorMessage(failure?.detail, 'Some Classroom data could not be refreshed. Your saved work is unchanged.') : '',
      folders: Array.isArray(foldersData?.folders) ? foldersData.folders : [],
      guides: guideList,
      stats: statsData && !statsData.detail ? statsData : null,
      streak: streakData && !streakData.detail ? streakData : null,
      onboarding: onboardingData,
      insights: insightsData,
      // Slow feed: show the calendar this device last saw; the fresh one replaces it in place.
      calendar: calendarData === SLOW ? readCalendarCache() : calendarData,
      calendarSlow: calendarData === SLOW && !readCalendarCache(),
      lectureItems: lectureCalendarItems(lectureTodos?.todos),
    };
  }, { enabled: ready && !legacy });
  const loadError = data?.loadError || '';
  const folders = data?.folders || [];
  const guides = data?.guides || [];
  const stats = data?.stats || null;
  const streak = data?.streak || null;
  const insights = data?.insights || null;
  const calendar = data?.calendar || null;
  const calendarSlow = Boolean(data?.calendarSlow);
  const streakInfo = streak ? streakWithFreeze(streak.week || [], streak.current_streak || 0) : null;

  useEffect(() => { if (ready && !legacy) walkthroughEvent('today-opened'); }, [ready, legacy]);

  // Feature tips, one per session, each at its moment.
  useEffect(() => {
    if (!stats || !progress.first) return;
    const visit = { days: Math.floor((Date.now() - progress.first) / 86400000) + 1 };
    if (visit.days >= 3 && calendar && !calendar.connected) requestTip('calendar');
    else if (visit.days >= 7 && insights?.answered) requestTip('insights');
  }, [stats, calendar, insights, progress.first]);

  if (!ready || legacy) return null;

  if (step?.screen === 'about') return <AboutYou />;

  const overview = createDashboardOverview(folders, guides);
  const remembered = lastGuide();
  const continueGuide = (remembered && guides.find(guide => guide.id === remembered.id)) || overview.continueGuide;
  const continueHref = continueGuide
    ? `/guide/${continueGuide.id}${remembered?.id === continueGuide.id && remembered.page ? `?page=${remembered.page + 1}` : ''}`
    : null;
  const toolGuide = continueGuide?.id;
  // Canvas deadlines plus to-dos confirmed from lectures, soonest first.
  const dueItems = mergeCalendarItems(calendar?.connected ? calendar.items || [] : [], data?.lectureItems || [])
    .filter(item => new Date(item.due_at).getTime() >= Date.now() - 86400000)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 3);
  const tools = [
    { label: 'Quiz', icon: Brain, href: toolGuide ? `/quiz/${toolGuide}` : '/library' },
    { label: 'Cards', icon: Layers, href: '/library?tab=cards', tip: 'cards' },
    { label: 'Practice', icon: PencilRuler, href: '/practice', spot: 'tool-practice', dot: 'practice' },
    { label: 'Notes', icon: NotebookPen, href: '/smartnotes', dot: 'notes' },
  ];

  return (
    <LoadGate ready={loaded} label="Loading Today">
    <div className="c-page today">
      <header className="c-page-head">
        <h1 className="c-title">Today</h1>
        {streakInfo && (
          <span className="today-streak" aria-label={`Streak: ${plural(streakInfo.days, 'day')}${streakInfo.frozenThisWeek ? ', freeze used this week' : ''}`}>
            <Flame size={20} strokeWidth={1.75} aria-hidden="true" />{plural(streakInfo.days, 'day')}
            {streakInfo.frozenThisWeek && <Snowflake size={16} strokeWidth={1.75} aria-hidden="true" className="today-freeze" />}
          </span>
        )}
      </header>

      {loadError && (
        <div className="today-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={refresh}>Retry</button>
        </div>
      )}

      <CanvasConnectButton card className="c-btn c-btn--primary" spot="canvas-connect" />

      {continueGuide && (
        <section className="c-section" aria-labelledby="continue-title">
          <h2 id="continue-title" className="c-section-title">Continue</h2>
          <Link href={continueHref} className="c-card today-continue">
            <ProgressRing value={continueGuide.read_progress} size={40} label={false} />
            <span className="today-continue-title c-truncate">{continueGuide.title}</span>
            <span className="c-meta">{Math.round((continueGuide.read_progress || 0) * 100)}%</span>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </section>
      )}

      <nav className="today-tools" aria-label="Tools">
        {tools.map(tool => (
          <div key={tool.label} className="today-tool-wrap">
            <Link href={tool.href} className="c-card today-tool" data-tip={tool.tip} data-spot={tool.spot}>
              <tool.icon size={28} strokeWidth={1.75} aria-hidden="true" />
              <span>{tool.label}</span>
            </Link>
            {tool.dot && <span className="today-dot"><PulseDot feature={tool.dot} /></span>}
          </div>
        ))}
      </nav>

      {(dueItems.length > 0 || calendarSlow) && (
        <section className="c-section" aria-labelledby="due-title">
          <div className="c-row">
            <h2 id="due-title" className="c-section-title">Due soon</h2>
            <span className="c-spacer" />
            <Link href="/calendar" className="c-btn c-btn--quiet">Calendar</Link>
          </div>
          <div className="c-card c-list">
            {calendarSlow && <SectionLoader height={3 * 61} label="Loading deadlines" />}
            {dueItems.map(item => (
              <a key={item.id} className="c-list-row" href={item.url || '/calendar'} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>
                <span className="c-grow c-truncate">{item.title}</span>
                <span className="c-meta">{shortDate(item.due_at)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <GroveCard guides={guides} planting={step?.id === 'today'} />

      <div className="today-pair">
        <StudyTimer timerState={timerState} setTimerState={setTimerState} />
        <StudyInsights compact data={insights} />
      </div>

      {dayOneFinished(progress) || !progress.wt ? <LearnCordia hideWhenComplete /> : null}

      <style jsx>{`
        .today-streak { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius:var(--r-pill); background: var(--card); border: 1px solid var(--line); font:600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-streak :global(.lucide) { color: var(--ink); }
        .today-streak :global(.today-freeze) { color: var(--olive-ink); }
        .today-tool-wrap { position: relative; display: grid; }
        .today-dot { position: absolute; top: 8px; right: 8px; }
        .today-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        :global(.today-continue) { display: flex; align-items: center; gap: 16px; padding: 14px 18px; color: var(--ink); text-decoration: none; }
        :global(.today-continue:hover) { text-decoration: none; border-color: var(--olive); }
        .today-continue-title { flex: 1 1 auto; min-width: 0; font:600 17px/1.15 var(--font-display); }
        .today-tools { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        :global(.today-tool) { display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 112px; color: var(--ink); text-decoration: none; font:600 15px/1 var(--font-sans); }
        :global(.today-tool:hover) { text-decoration: none; border-color: var(--olive); }
        :global(.today-tool .lucide) { color: var(--olive-ink); }
        .today-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 767px) {
                .today-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .today-pair { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
    </LoadGate>
  );
}
