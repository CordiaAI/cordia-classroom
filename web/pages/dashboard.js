import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Brain, ChevronRight, Flame, Layers, NotebookPen, PencilRuler, Play } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { loadStudyQueue } from '../lib/studyQueue';
import { lastGuide, trackVisit } from '../lib/userStore';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { requestTip } from '../lib/tips';
import ProgressRing from '../components/ProgressRing';
import StudyTimer from '../components/StudyTimer';
import StudyInsights from '../components/StudyInsights';
import GettingStarted from '../components/GettingStarted';
import FirstRun from '../components/FirstRun';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [stats, setStats] = useState(null);
  const [streak, setStreak] = useState(null);
  const [queue, setQueue] = useState(null);
  const [insights, setInsights] = useState(null);
  const [notesCount, setNotesCount] = useState(0);
  const [calendar, setCalendar] = useState(null);
  const [onboarding, setOnboarding] = useState(null);

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
      // An account that already has guides is past first run.
      if (onboardingData && !onboardingData.completed && guidesData?.guides?.length) saveOnboardingStep('done');
    } finally {
      setLoading(false);
    }
    loadStudyQueue().then(setQueue);
    apiFetch('/stats/insights').then(setInsights);
    apiFetch('/smart_notes').then(data => setNotesCount(data?.notes?.length || 0));
    apiFetch('/calendar/connection').then(setCalendar);
  }

  // Feature tips, one per session, each at its moment.
  useEffect(() => {
    if (!queue || !stats) return;
    const visit = trackVisit();
    if (visit.sessions >= 2 && queue.cardTotal > 0) requestTip('cards', `${plural(queue.cardTotal, 'card')} due`);
    else if ((stats.minutes_today || 0) >= 25) requestTip('break');
    else if (visit.days >= 3 && calendar && !calendar.connected) requestTip('calendar');
    else if (visit.days >= 7 && insights?.answered) requestTip('insights');
  }, [queue, stats, calendar, insights]);

  if (!ready || legacy) return null;

  if (!loading && onboarding && !onboarding.completed && guides.length === 0) return <FirstRun />;

  const overview = createDashboardOverview(folders, guides);
  const remembered = lastGuide();
  const continueGuide = (remembered && guides.find(guide => guide.id === remembered.id)) || overview.continueGuide;
  const continueHref = continueGuide
    ? `/guide/${continueGuide.id}${remembered?.id === continueGuide.id && remembered.page ? `?page=${remembered.page + 1}` : ''}`
    : null;
  const toolGuide = continueGuide?.id;
  const nothingDue = queue && !queue.cardTotal && !queue.misses.length && !queue.problems;
  const dueItems = calendar?.connected
    ? (calendar.items || []).filter(item => new Date(item.due_at).getTime() >= Date.now() - 86400000).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)).slice(0, 3)
    : [];
  const tools = [
    { label: 'Quiz', icon: Brain, href: toolGuide ? `/quiz/${toolGuide}` : '/library' },
    { label: 'Cards', icon: Layers, href: '/library?tab=cards', tip: 'cards' },
    { label: 'Practice', icon: PencilRuler, href: '/practice' },
    { label: 'Notes', icon: NotebookPen, href: '/smartnotes' },
  ];

  return (
    <div className="c-page today">
      <header className="c-page-head">
        <h1 className="c-title">Today</h1>
        {streak && (
          <span className="today-streak" aria-label={`Streak: ${plural(streak.current_streak || 0, 'day')}`}>
            <Flame size={20} strokeWidth={1.75} aria-hidden="true" />{plural(streak.current_streak || 0, 'day')}
          </span>
        )}
      </header>

      {loadError && (
        <div className="today-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={loadData}>Retry</button>
        </div>
      )}

      <section className="c-glass today-start" aria-label="Start">
        <ul className="today-counts" aria-live="polite">
          <li><strong>{queue ? queue.cardTotal + queue.misses.length : '–'}</strong><span>cards</span></li>
          <li><strong>{queue ? queue.problems : '–'}</strong><span>problems</span></li>
          <li><strong>{queue ? queue.minutes : '–'}</strong><span>min</span></li>
        </ul>
        <button type="button" className="c-btn c-btn--primary c-btn--lg today-start-btn" onClick={() => router.push('/session')} disabled={!queue || nothingDue}>
          <Play size={20} strokeWidth={1.75} aria-hidden="true" />Start
        </button>
      </section>

      {continueGuide && (
        <section className="c-section" aria-labelledby="continue-title">
          <h2 id="continue-title" className="c-section-title">Continue</h2>
          <Link href={continueHref} className="c-card today-continue">
            <ProgressRing value={continueGuide.read_progress} size={44} />
            <span className="today-continue-title c-truncate">{continueGuide.title}</span>
            <span className="c-meta">{Math.round((continueGuide.read_progress || 0) * 100)}%</span>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </section>
      )}

      <nav className="today-tools" aria-label="Tools">
        {tools.map(tool => (
          <Link key={tool.label} href={tool.href} className="c-card today-tool" data-tip={tool.tip}>
            <tool.icon size={28} strokeWidth={1.75} aria-hidden="true" />
            <span>{tool.label}</span>
          </Link>
        ))}
      </nav>

      {dueItems.length > 0 && (
        <section className="c-section" aria-labelledby="due-title">
          <div className="c-row">
            <h2 id="due-title" className="c-section-title">Due soon</h2>
            <span className="c-spacer" />
            <Link href="/calendar" className="c-btn c-btn--quiet">Calendar</Link>
          </div>
          <div className="c-card c-list">
            {dueItems.map(item => (
              <a key={item.id} className="c-list-row" href={item.url || '/calendar'} target={item.url ? '_blank' : undefined} rel={item.url ? 'noreferrer' : undefined}>
                <span className="c-grow c-truncate">{item.title}</span>
                <span className="c-meta">{shortDate(item.due_at)}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="today-pair">
        <StudyTimer timerState={timerState} setTimerState={setTimerState} />
        <StudyInsights compact />
      </div>

      <GettingStarted guides={guides} stats={stats} insights={insights} notesCount={notesCount} calendarConnected={Boolean(calendar?.connected)} navigate={path => router.push(path)} />

      <style jsx>{`
        .today-streak { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: var(--r-pill); background: var(--card); border: 1px solid var(--line); font: 600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-streak :global(.lucide) { color: var(--warning); }
        .today-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius: var(--r-card); background: var(--error-bg); color: var(--error); font-weight: 600; }
        .today-start { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px; border-radius: var(--r-card); flex-wrap: wrap; }
        .today-counts { list-style: none; margin: 0; padding: 0; display: flex; gap: 32px; }
        .today-counts li { display: grid; gap: 2px; }
        .today-counts strong { font: 600 32px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-counts span { font: 500 15px/1 var(--font-sans); }
        .today-start-btn { min-width: 160px; }
        :global(.today-continue) { display: flex; align-items: center; gap: 16px; padding: 14px 18px; color: var(--ink); text-decoration: none; }
        :global(.today-continue:hover) { text-decoration: none; border-color: var(--olive); }
        .today-continue-title { flex: 1 1 auto; min-width: 0; font: 600 17px/1.3 var(--font-display); }
        .today-tools { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        :global(.today-tool) { display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 112px; color: var(--ink); text-decoration: none; font: 600 15px/1 var(--font-sans); }
        :global(.today-tool:hover) { text-decoration: none; border-color: var(--olive); }
        :global(.today-tool .lucide) { color: var(--olive-ink); }
        .today-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 767px) {
          .today-start { padding: 20px; }
          .today-counts { gap: 20px; }
          .today-start-btn { width: 100%; }
          .today-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .today-pair { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
