import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronRight, Flame, GraduationCap, Layers, ListChecks, Snowflake, Timer, X } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { createDashboardOverview } from '../lib/dashboardOrganization';
import { lastGuide, readUserValue, writeUserValue } from '../lib/userStore';
import { markUsed, unmarkUsed, useProgress } from '../lib/progress';
import { dayOneFinished, startWalkthrough, walkthroughEvent } from '../lib/walkthrough';
import { readActivity, dayKey, streakWithFreeze } from '../lib/activity';
import { loadOnboarding, saveOnboardingStep } from '../lib/onboarding';
import { requestTip } from '../lib/tips';
import ProgressRing from '../components/ProgressRing';
import LearnCordia from '../components/LearnCordia';
import AppSetup from '../components/AppSetup';
import CanvasConnectButton from '../components/CanvasConnectButton';
import DoneCheck from '../components/DoneCheck';
import AssignmentSheet from '../components/AssignmentSheet';
import CourseWork from '../components/CourseWork';
import { canvasStatus } from '../lib/canvas';
import { acceptChange, buildExamReview, buildReview, dismissAlert, getAlerts, minutesLabel } from '../lib/studyPlans';
import { LoadGate, SectionLoader } from '../components/CordiaLoader';
import { useCachedPage } from '../lib/pageCache';
import { readCalendarCache, rememberCalendar } from '../lib/calendarCache';
import { confirmedTodos, lectureCalendarItems, mergeCalendarItems } from '../lib/lectures';
import { deadlineTitle, parseQAPairs, safeHref } from '../lib/formatters';
import { examReadiness, nearestExam } from '../lib/examCountdown.mjs';
import FirstGuide from '../components/FirstGuide';

const SLOW = Symbol('slow');
// A slow source holds the page (with the loader) this long, then the page shows and it fills in.
const SLOW_MS = 8000;

const FIRST_GUIDE_KEY = 'cordiaFirstGuideDismissed';

// Learn's questions for a guide (the saved quiz), or its own questions before Learn first opens.
function learnQuestions(guide) {
  if (Array.isArray(guide?.quiz_questions) && guide.quiz_questions.length) return guide.quiz_questions;
  return parseQAPairs(guide?.study_guide).map(pair => ({ question: pair.question, options: [pair.answer], correct_index: 0 }));
}

const LEGACY_VIEWS = { guides: '/library', classes: '/library', calendar: '/calendar', notes: '/smartnotes' };

function shortDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// What each Dashboard alert says (from GET /alerts).
const ALERT_TEXT = {
  grade_drop: alert => `Grade dropped: ${alert.from}% → ${alert.to}%`,
  missing: alert => `Missing: ${alert.title}`,
  deadline: alert => `Date change: ${alert.title}`,
  new_work: alert => `New work: ${alert.title}`,
  exam_prep: alert => `${alert.title} in ${alert.days} day${alert.days === 1 ? '' : 's'}`,
  module_done: alert => `Finished: ${alert.module}`,
  draft_stalled: alert => `${alert.title}: draft hasn't grown in 2 days`,
  repo_quiet: alert => `${alert.title}: no commits in 2 days`,
  slack_post: alert => `#${alert.channel}: ${alert.title}`,
  date_change: alert => (alert.change === 'cancelled'
    ? `Cancelled: ${alert.title}`
    : `${alert.title}: ${shortDate(alert.old_due)} → ${shortDate(alert.new_due)}`),
};

// "Prof. Lee" from "Prof. Lee <lee@school.edu>"; the address when there's no name.
function senderName(sender) {
  const text = String(sender || '');
  const open = text.indexOf('<');
  if (open < 0) return text.trim();
  const close = text.indexOf('>', open);
  return text.slice(0, open).trim() || text.slice(open + 1, close < 0 ? undefined : close).trim();
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default function Today() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  // Deadlines checked off here stay listed, struck through, until the next load.
  const [doneNow, setDoneNow] = useState({});
  const [planning, setPlanning] = useState(null);
  const [reviewing, setReviewing] = useState('');
  const [examReady, setExamReady] = useState(null); // { guideId, percent }
  const [firstGuideHidden, setFirstGuideHidden] = useState(() => Boolean(readUserValue(FIRST_GUIDE_KEY, false)));
  useSessionTracker('browse');
  const legacy = LEGACY_VIEWS[router.query.view];
  const progress = useProgress();

  useEffect(() => {
    if (ready && legacy) router.replace(legacy);
  }, [ready, legacy, router]);

  // Every source loads together and the page appears once, from cache when returning.
  // The calendar feed can be slow: past 8 s the page shows and Due soon fills in on its own.
  const { data, ready: loaded, update, refresh } = useCachedPage('today', async () => {
    const tz = -new Date().getTimezoneOffset();
    const safe = promise => promise.catch(() => null);
    const calendarRequest = safe(apiFetch('/calendar/connection'));
    const orSlow = request => Promise.race([request, new Promise(resolve => setTimeout(() => resolve(SLOW), SLOW_MS))]);
    const calendarOrSlow = orSlow(calendarRequest);
    // Course work (upcoming / missing / completed) is part of the first view, not a card that pops in.
    const courseworkRequest = safe(apiFetch('/calendar/coursework'));
    const [foldersData, guidesData, statsData, streakData, onboardingData, insightsData, notesData, checklistData, calendarData, lectureTodos, alertsData, studyWeek, courseworkData, appsData, canvasData] = await Promise.all([
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
      safe(getAlerts()),
      safe(apiFetch('/stats/week?tz_offset=' + tz)),
      orSlow(courseworkRequest),
      safe(apiFetch('/connectors')),
      safe(canvasStatus()),
    ]);
    const usableCoursework = result => (result && result !== SLOW && !result.detail ? result : null);
    if (courseworkData === SLOW) courseworkRequest.then(result => update(current => ({ ...current, coursework: usableCoursework(result) })));
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
      alerts: Array.isArray(alertsData?.alerts) ? alertsData.alerts : [],
      studyWeek: Number.isFinite(studyWeek?.minutes) ? studyWeek.minutes : null,
      coursework: usableCoursework(courseworkData),
      apps: appsData || null,
      canvas: canvasData || null,
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

  // Course work (upcoming / missing / completed this term); without a Canvas token Due soon shows.
  const coursework = data?.coursework || null;

  // Feature tips, one per session, each at its moment.
  useEffect(() => {
    if (!stats || !progress.first) return;
    const visit = { days: Math.floor((Date.now() - progress.first) / 86400000) + 1 };
    if (visit.days >= 3 && calendar && !calendar.connected) requestTip('calendar');
    else if (visit.days >= 7 && insights?.answered) requestTip('insights');
  }, [stats, calendar, insights, progress.first]);

  // Exam countdown: the nearest exam in two weeks with a Learn guide (its review set, or any
  // guide with a Learn test date). Readiness needs that one guide's questions.
  const exams = [...(coursework?.upcoming || []), ...(calendar?.connected ? calendar.items || [] : [])].filter(item => item.type === 'exam');
  const exam = data ? nearestExam(data.guides || [], exams) : null;
  useEffect(() => {
    if (!exam?.guideId || examReady?.guideId === exam.guideId) return;
    apiFetch('/guides/' + exam.guideId).then(result => {
      if (result?.guide) setExamReady({ guideId: exam.guideId, percent: examReadiness(learnQuestions(result.guide), result.guide.flashcard_progress?.learn) });
    });
  }, [exam?.guideId]);

  if (!ready || legacy) return null;

  const overview = createDashboardOverview(folders, guides);
  const remembered = lastGuide();
  const continueGuide = (remembered && guides.find(guide => guide.id === remembered.id)) || overview.continueGuide;
  const continueHref = continueGuide
    ? `/guide/${continueGuide.id}${remembered?.id === continueGuide.id && remembered.page ? `?page=${remembered.page + 1}` : ''}`
    : null;
  // Canvas deadlines plus to-dos confirmed from lectures, soonest first.
  const dueItems = mergeCalendarItems(calendar?.connected ? calendar.items || [] : [], data?.lectureItems || [])
    .filter(item => new Date(item.due_at).getTime() >= Date.now() - 86400000 && !item.done)
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 3);
  // Study time over the last 7 days, counted by the server the same way as Progress (this
  // browser's own log only until the server answers).
  const activity = readActivity();
  const weekMinutes = data?.studyWeek ?? Math.round(Array.from({ length: 7 }, (_, back) => activity[dayKey(Date.now() - back * 86400000)]?.m || 0).reduce((sum, value) => sum + value, 0));
  // Missing work lives in Course work's Missing tab once Canvas is connected, so it isn't repeated here.
  const alerts = (data?.alerts || []).filter(raw => !(coursework?.connected && raw.kind === 'missing'));
  const sunday = new Date().getDay() === 0;
  // Exam prep: gather the class's material into a review set and open Learn on it, paced to the
  // exam date (Learn makes the questions). A finished module's review set opens as a guide.
  async function review(alert) {
    setReviewing(alert.id);
    const data = alert.kind === 'exam_prep'
      ? await buildExamReview(alert.item_key)
      : await buildReview({ folderId: alert.folder_id, prefix: alert.prefix, title: `${alert.module}: review` });
    setReviewing('');
    if (data?.guide?.id) {
      if (alert.kind === 'module_done') { dismissAlert(alert.id); router.push(`/guide/${data.guide.id}`); }
      else router.push(`/learn/${data.guide.id}?test=${dayKey(data.due_at || alert.at)}`);
    } else update(current => ({ ...current, alerts: (current.alerts || []).map(item => (item.id === alert.id ? { ...item, summary: data?.detail || "That didn't work. Try again." } : item)) }));
  }
  // A date change from email or an announcement: one confirm moves the deadline, its steps,
  // study time and Google Task.
  async function accept(alert) {
    setReviewing(alert.id);
    const data = await acceptChange(alert.change_id);
    setReviewing('');
    if (data?.ok) refresh();
    else update(current => ({ ...current, alerts: (current.alerts || []).map(item => (item.id === alert.id ? { ...item, summary: data?.detail || "That didn't work. Try again." } : item)) }));
  }
  async function dismiss(alert) {
    update(current => ({ ...current, alerts: (current.alerts || []).filter(item => item.id !== alert.id) }));
    await dismissAlert(alert.id);
  }
  const firstWeek = !progress.first || Date.now() - progress.first < 7 * 86400000;
  // The day-one walkthrough makes a first guide its own way; the first-guide card waits for it.
  const walking = progress.wt?.status === 'active';

  return (
    <LoadGate ready={loaded} label="Loading your dashboard">
    <div className="c-page today">
      <header className="c-page-head">
        <h1 className="c-title">Dashboard</h1>
      </header>

      {loadError && (
        <div className="today-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="c-btn c-btn--secondary" onClick={refresh}>Retry</button>
        </div>
      )}

      {!guides.length && !loadError && !firstGuideHidden && !walking && (
        <FirstGuide canvas={data?.canvas} coursework={coursework} onDismiss={() => { setFirstGuideHidden(true); writeUserValue(FIRST_GUIDE_KEY, true); }} />
      )}

      {exam && (
        <section className="c-section" aria-labelledby="exam-title">
          <h2 id="exam-title" className="c-section-title">Exam countdown</h2>
          <div className="c-card today-exam">
            <span className="today-exam-days">
              <strong>{exam.daysLeft === 0 ? 'Today' : exam.daysLeft}</strong>
              {exam.daysLeft > 0 && <span className="c-meta">{exam.daysLeft === 1 ? 'day left' : 'days left'}</span>}
            </span>
            <span className="today-exam-text">
              <span className="today-continue-title c-truncate">{exam.title}</span>
              <span className="c-meta">{examReady?.guideId === exam.guideId ? `${examReady.percent}% ready` : 'Readiness loading'} · {shortDate(exam.date + 'T12:00:00')}</span>
            </span>
            <Link href={`/learn/${exam.guideId}?test=${exam.date}`} className="c-btn c-btn--primary c-btn--sm"><GraduationCap size={18} strokeWidth={1.75} aria-hidden="true" />Study now</Link>
          </div>
        </section>
      )}

      {continueGuide && (
        <section className="c-section" aria-labelledby="continue-title">
          <h2 id="continue-title" className="c-section-title">Continue</h2>
          <div className="c-card today-continue">
            <Link href={continueHref} className="today-continue-main">
              <ProgressRing value={continueGuide.read_progress} size={40} label={false} />
              <span className="today-continue-title c-truncate">{continueGuide.title}</span>
              <span className="c-meta">{Math.round((continueGuide.read_progress || 0) * 100)}%</span>
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <span className="today-continue-study">
              <Link href={'/learn/' + continueGuide.id} className="c-btn c-btn--secondary c-btn--sm"><GraduationCap size={18} strokeWidth={1.75} aria-hidden="true" />Learn</Link>
              <Link href={'/flashcards/study?guideId=' + continueGuide.id} className="c-btn c-btn--secondary c-btn--sm"><Layers size={18} strokeWidth={1.75} aria-hidden="true" />Cards</Link>
            </span>
          </div>
        </section>
      )}

      {alerts.length > 0 && (
        <section className="c-section" aria-labelledby="updates-title">
          <div className="c-row today-updates-head">
            <h2 id="updates-title" className="c-section-title">Class updates</h2>
            <span className="c-meta">Changes and new work from your classes and apps</span>
          </div>
          <div className="c-card c-list">
            {alerts.slice(0, 4).map(raw => (raw.kind === 'slack_post' ? raw : { ...raw, title: deadlineTitle(raw) })).map(alert => (
              <div key={alert.id} className={'c-list-row today-alert is-' + alert.kind}>
                <span className="c-grow">
                  <span className="today-alert-title">{ALERT_TEXT[alert.kind]?.(alert) || alert.title}</span>
                  <span className="c-meta">{[alert.kind === 'date_change' ? senderName(alert.sender) : alert.course, alert.summary,
                    (alert.kind === 'draft_stalled' || alert.kind === 'repo_quiet') && `due in ${alert.days} day${alert.days === 1 ? '' : 's'}`,
                    alert.kind === 'slack_post' && 'Slack'].filter(Boolean).join(' · ')}</span>
                </span>
                {alert.url && <a className="c-btn c-btn--quiet c-btn--sm" href={safeHref(alert.url, '#')} target="_blank" rel="noreferrer">Open</a>}
                {alert.kind === 'draft_stalled' && (
                  <Link className="c-btn c-btn--secondary c-btn--sm" href={`/tutor?assignment=${encodeURIComponent(alert.item_key)}&title=${encodeURIComponent(alert.title || '')}&ask=${encodeURIComponent('Help me get unstuck on my draft: what should I write next, based on the rubric?')}`}>Get unstuck</Link>
                )}
                {alert.kind === 'repo_quiet' && (
                  <Link className="c-btn c-btn--secondary c-btn--sm" href={`/tutor?assignment=${encodeURIComponent(alert.item_key)}&title=${encodeURIComponent(alert.title || '')}&ask=${encodeURIComponent('Read my code against the instructions and help me pick the next thing to build.')}`}>Get unstuck</Link>
                )}
                {alert.kind === 'date_change' && (
                  <button type="button" className="c-btn c-btn--primary c-btn--sm" disabled={Boolean(reviewing)} onClick={() => accept(alert)}>
                    {reviewing === alert.id ? 'Updating…' : alert.change === 'cancelled' ? 'Remove it' : 'Update'}
                  </button>
                )}
                {(alert.kind === 'exam_prep' || (alert.kind === 'module_done' && alert.folder_id)) && (
                  <button type="button" className="c-btn c-btn--secondary c-btn--sm" disabled={Boolean(reviewing)} onClick={() => review(alert)}>
                    {reviewing === alert.id ? 'Gathering…' : alert.kind === 'exam_prep' ? 'Build review' : 'Make review set'}
                  </button>
                )}
                <button type="button" className="c-icon-btn" aria-label="Dismiss" onClick={() => dismiss(alert)}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {coursework?.connected ? (
        <CourseWork data={coursework} onPlan={setPlanning}
          extraUpcoming={(data?.lectureItems || []).filter(item => !item.done && new Date(item.due_at).getTime() >= Date.now() - 86400000)}
          actions={<>
            <Link href="/week" className={'c-btn ' + (sunday ? 'c-btn--secondary' : 'c-btn--quiet')}>Plan your week</Link>
            <Link href="/calendar" className="c-btn c-btn--quiet today-see-calendar">See calendar</Link>
          </>} />
      ) : (
      <section className="c-section" aria-labelledby="due-title">
        <div className="c-row">
          <h2 id="due-title" className="c-section-title">Due soon</h2>
          <span className="c-spacer" />
          <Link href="/week" className={'c-btn ' + (sunday ? 'c-btn--secondary' : 'c-btn--quiet')}>Plan your week</Link>
          <Link href="/calendar" className="c-btn c-btn--quiet today-see-calendar">See calendar</Link>
        </div>
        {(dueItems.length > 0 || calendarSlow) ? (
          <div className="c-card c-list">
            {calendarSlow && <SectionLoader height={3 * 61} label="Loading deadlines" />}
            {dueItems.map(item => (
              <div key={item.id} className={'c-list-row today-due' + (doneNow[item.id] ? ' is-done' : '')}>
                <DoneCheck id={item.id} title={item.title} done={Boolean(doneNow[item.id])} onChange={done => setDoneNow(current => ({ ...current, [item.id]: done }))} />
                <a className="c-grow c-truncate today-due-link" href={safeHref(item.url, '/calendar')} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>{deadlineTitle(item)}</a>
                <span className="c-meta">{shortDate(item.due_at)}</span>
                {!item.internal && (
                  <button type="button" className="c-icon-btn" aria-label={`Plan ${item.title}`} title="Steps and study time" onClick={() => setPlanning(item)}>
                    <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : calendar?.connected ? (
          <p className="c-meta today-none">Nothing due in the next few days.</p>
        ) : (
          <CanvasConnectButton card className="c-btn c-btn--secondary" spot="canvas-connect" />
        )}
      </section>
      )}

      <Link href="/progress" className="c-card today-progress" aria-label="Your progress" data-tip="insights" data-spot="insights" onClick={() => walkthroughEvent('insights-opened')}>
        {streakInfo && (
          <span className="today-stat">
            {/* The flame flickers once today's study keeps the streak going, and grows at 7 and 30 days. */}
            <span className={'today-flame' + (streakInfo.today ? ' is-lit' : '') + (streakInfo.days >= 30 ? ' is-blaze' : streakInfo.days >= 7 ? ' is-big' : '')} aria-hidden="true"><Flame size={20} strokeWidth={1.75} /></span>
            <strong>{plural(streakInfo.days, 'day')}</strong>
            {streakInfo.frozenThisWeek && <Snowflake size={16} strokeWidth={1.75} aria-label="Freeze used this week" className="today-freeze" />}
          </span>
        )}
        <span className="today-stat"><Timer size={20} strokeWidth={1.75} aria-hidden="true" /><strong>{minutesLabel(weekMinutes)}</strong><span className="c-meta">last 7 days</span></span>
        <span className="c-spacer" />
        <span className="c-meta today-progress-more">Progress</span>
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>

      {planning && <AssignmentSheet item={planning} onClose={() => setPlanning(null)} />}

      <AppSetup canvasConnected={Boolean(calendar?.connected)} apps={data?.apps} canvas={data?.canvas} />

      {firstWeek && (dayOneFinished(progress) || !progress.wt) ? <LearnCordia hideWhenComplete compact /> : null}

      <style jsx>{`
        .today-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        .today-none { margin: 0; }
        .today-alert { gap: 12px; }
        .today-alert .c-grow { display: grid; gap: 2px; min-width: 0; }
        .today-updates-head { align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .today-updates-head .c-section-title { margin: 0; }
        .today-updates-head .c-meta { margin: 0; }
        .today-alert-title { font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
        .today-alert.is-grade_drop .today-alert-title, .today-alert.is-missing .today-alert-title { color: var(--error); }
        .today-alert.is-date_change .today-alert-title { font-variant-numeric: tabular-nums; }
        .today-continue { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; padding: 14px 18px; }
        :global(.today-continue-main) { display: flex; flex: 1 1 260px; align-items: center; gap: 16px; min-width: 0; color: var(--ink); text-decoration: none; }
        :global(.today-continue-main:hover) { text-decoration: none; }
        .today-continue:hover, :global(.today-progress:hover) { text-decoration: none; border-color: var(--olive); }
        .today-continue-study { display: flex; gap: 8px; }
        .today-exam { display: flex; align-items: center; gap: 16px; padding: 14px 18px; }
        .today-exam-days { display: grid; justify-items: center; min-width: 64px; }
        .today-exam-days strong { font: 600 28px/1 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--ink); }
        .today-exam-text { display: grid; gap: 2px; flex: 1 1 auto; min-width: 0; }
        .today-due { gap: 14px; }
        .today-due .c-meta { flex: none; white-space: nowrap; }
        .today-due-link { color: var(--ink); text-decoration: none; }
        .today-due.is-done .today-due-link { color: var(--muted); text-decoration: line-through; }
        .today-continue-title { flex: 1 1 auto; min-width: 0; font:600 17px/1.15 var(--font-sans); }
        :global(.today-progress) { display: flex; align-items: center; gap: 20px; padding: 14px 18px; color: var(--ink); text-decoration: none; flex-wrap: wrap; }
        .today-stat { display: inline-flex; align-items: center; gap: 6px; font:600 15px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .today-stat :global(.today-freeze) { color: var(--olive-ink); }
        @media (max-width: 767px) {
              :global(.today-progress) { gap: 14px; }
          .today-progress-more { display: none; }
          .today-continue-study { flex: 1 1 100%; }
          .today-continue-study :global(.c-btn) { flex: 1; justify-content: center; }
          .today-exam { flex-wrap: wrap; }
          .today-exam :global(.c-btn) { flex: 1 1 100%; justify-content: center; }
          /* The Canvas tab has the calendar; on a phone the heading keeps its one line. */
          :global(.today-see-calendar) { display: none !important; }
        }
      `}</style>
    </div>
    </LoadGate>
  );
}
