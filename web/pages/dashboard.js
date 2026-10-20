import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronRight, Flame, Play, Snowflake, Timer, TreeDeciduous } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { loadStudyQueue } from '../lib/studyQueue';
import { lastGuide } from '../lib/userStore';
import { markUsed, unmarkUsed, useProgress } from '../lib/progress';
import { activeStep, dayOneFinished, startWalkthrough, walkthroughEvent } from '../lib/walkthrough';
import { readActivity, dayKey, streakWithFreeze } from '../lib/activity';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { requestTip } from '../lib/tips';
import ProgressRing from '../components/ProgressRing';
import LearnCordia from '../components/LearnCordia';
import AboutYou from '../components/AboutYou';
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

export default function Today() {
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
    const [foldersData, guidesData, statsData, streakData, onboardingData, queueData, insightsData, notesData, checklistData, calendarData, lectureTodos] = await Promise.all([
      safe(apiFetch('/folders')),
      safe(apiFetch('/guides?fields=summary&limit=500')),
      safe(apiFetch('/stats/overview')),
      safe(apiFetch('/stats/streak?tz_offset=' + tz)),
      safe(loadOnboarding()),
      safe(loadStudyQueue()),
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
      // A slim copy of the review queue (the full one carries every card's text).
      queue: queueData ? { cards: queueData.cardTotal, misses: queueData.misses.length, problems: queueData.problems, minutes: queueData.minutes } : null,
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
  const queue = data?.queue || null;
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
  // Canvas deadlines plus to-dos confirmed from lectures, soonest first.
  const dueItems = mergeCalendarItems(calendar?.connected ? calendar.items || [] : [], data?.lectureItems || [])
    .filter(item => new Date(item.due_at).getTime() >= Date.now() - 86400000)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 3);
  const due = queue ? queue.cards + queue.misses + queue.problems : 0;
  const reviewParts = queue ? [
    queue.cards && plural(queue.cards, 'card'),
    queue.misses && plural(queue.misses, 'missed question'),
    queue.problems && plural(queue.problems, 'problem'),
    `about ${queue.minutes} min`,
  ].filter(Boolean) : [];
  // Focus and study minutes over the last 7 days, from this browser's study log.
  const activity = readActivity();
  const weekMinutes = Math.round(Array.from({ length: 7 }, (_, back) => activity[dayKey(Date.now() - back * 86400000)]?.m || 0).reduce((sum, value) => sum + value, 0));
  const firstWeek = !progress.first || Date.now() - progress.first < 7 * 86400000;

  return (
    <LoadGate ready={loaded} label="Loading Today">
    <div className="c-page today">
      <header className="c-page-head">
        <h1 className="c-title">Today</h1>
      </header>

      {loadError && (
        <div className="today-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={refresh}>Retry</button>
        </div>
      )}

      <section className="c-glass today-review" aria-labelledby="review-title" data-spot="start">
        <div className="today-review-text">
          <h2 id="review-title" className="c-section-title">{queue && !due ? 'All caught up' : 'Daily review'}</h2>
          <span className="c-meta" aria-live="polite">
            {!queue ? 'Checking what’s due…' : due ? reviewParts.join(' · ') : 'Nothing is due. Add material or quiz yourself to keep it fresh.'}
          </span>
        </div>
        {queue && !due ? (
          continueGuide && <Link href={`/quiz/${continueGuide.id}`} className="c-btn c-btn--secondary today-review-btn">Quiz yourself on {continueGuide.title}</Link>
        ) : (
          <button type="button" className="c-btn c-btn--primary c-btn--lg today-review-btn" onClick={() => { walkthroughEvent('start'); router.push('/session'); }} disabled={!queue}>
            <Play size={20} strokeWidth={1.75} aria-hidden="true" />Start review
          </button>
        )}
      </section>

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

      <section className="c-section" aria-labelledby="due-title">
        <div className="c-row">
          <h2 id="due-title" className="c-section-title">Due soon</h2>
          <span className="c-spacer" />
          <Link href="/calendar" className="c-btn c-btn--quiet">See calendar</Link>
        </div>
        {(dueItems.length > 0 || calendarSlow) ? (
          <div className="c-card c-list">
            {calendarSlow && <SectionLoader height={3 * 61} label="Loading deadlines" />}
            {dueItems.map(item => (
              <a key={item.id} className="c-list-row" href={item.url || '/calendar'} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>
                <span className="c-grow c-truncate">{item.title}</span>
                <span className="c-meta">{shortDate(item.due_at)}</span>
              </a>
            ))}
          </div>
        ) : calendar?.connected ? (
          <p className="c-meta today-none">Nothing due in the next few days.</p>
        ) : (
          <CanvasConnectButton card className="c-btn c-btn--secondary" spot="canvas-connect" />
        )}
      </section>

      <Link href="/progress" className="c-card today-progress" aria-label="Your progress" data-tip="insights" data-spot="insights">
        {streakInfo && (
          <span className="today-stat">
            <Flame size={20} strokeWidth={1.75} aria-hidden="true" />
            <strong>{plural(streakInfo.days, 'day')}</strong>
            {streakInfo.frozenThisWeek && <Snowflake size={16} strokeWidth={1.75} aria-label="Freeze used this week" className="today-freeze" />}
          </span>
        )}
        <span className="today-stat"><TreeDeciduous size={20} strokeWidth={1.75} aria-hidden="true" /><strong>{plural(guides.length, 'tree')}</strong></span>
        <span className="today-stat"><Timer size={20} strokeWidth={1.75} aria-hidden="true" /><strong>{weekMinutes} min</strong><span className="c-meta">this week</span></span>
        <span className="c-spacer" />
        <span className="c-meta today-progress-more">Progress</span>
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>

      {firstWeek && (dayOneFinished(progress) || !progress.wt) ? <LearnCordia hideWhenComplete /> : null}

      <style jsx>{`
        .today-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        .today-review { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px; border-radius:var(--r-card); flex-wrap: wrap; }
        .today-review-text { display: grid; gap: 4px; min-width: 0; }
        .today-review-text .c-meta { font-size: 15px; }
        :global(.today-review-btn) { min-width: 180px; justify-content: center; }
        .today-none { margin: 0; }
        :global(.today-continue) { display: flex; align-items: center; gap: 16px; padding: 14px 18px; color: var(--ink); text-decoration: none; }
        :global(.today-continue:hover), :global(.today-progress:hover) { text-decoration: none; border-color: var(--olive); }
        .today-continue-title { flex: 1 1 auto; min-width: 0; font:600 17px/1.15 var(--font-display); }
        :global(.today-progress) { display: flex; align-items: center; gap: 20px; padding: 14px 18px; color: var(--ink); text-decoration: none; flex-wrap: wrap; }
        .today-stat { display: inline-flex; align-items: center; gap: 6px; font:600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-stat :global(.today-freeze) { color: var(--olive-ink); }
        @media (max-width: 767px) {
          .today-review { padding: 20px; }
          :global(.today-review-btn) { width: 100%; }
          :global(.today-progress) { gap: 14px; }
          .today-progress-more { display: none; }
        }
      `}</style>
    </div>
    </LoadGate>
  );
}
