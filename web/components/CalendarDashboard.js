import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, ClipboardCopy, ClipboardPaste, ExternalLink, KeyRound, RefreshCw, Unlink } from 'lucide-react';
import { apiErrorMessage, apiFetch, getUserId } from '../lib/api';
import { walkthroughEvent } from '../lib/walkthrough';
import { CanvasCalendarFeed, CanvasCalendarNav, CanvasFeedLink } from './CanvasShots';
import { LoadingArea, SectionLoader, useLoadGate } from './CordiaLoader';
import { readCalendarCache, rememberCalendar } from '../lib/calendarCache';
import { confirmedTodos, lectureCalendarItems, mergeCalendarItems } from '../lib/lectures';

// Checked before Connect: a Canvas calendar feed is an https (or webcal) link ending in .ics.
export function feedLinkProblem(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try { url = new URL(text.replace(/^webcal:\/\//i, 'https://')); } catch { return 'That is not a link. Paste the whole link from Canvas.'; }
  if (url.protocol !== 'https:') return 'The link should start with https://';
  if (!/\.ics$/i.test(url.pathname)) return 'Use the Calendar Feed link that ends in .ics.';
  return '';
}
import { canvasStatus } from '../lib/canvas';
import CanvasConnectSheet from './CanvasConnectSheet';
import BodyPortal from './BodyPortal';
import Toggle from './Toggle';
import { deadlineCourse, deadlineTitle } from '../lib/formatters';
import { loadFolders } from '../lib/folders';
import { loadBlocks, loadExamReadiness } from '../lib/calendarData';
import { buildBlocks, buildDeadlines, classIndex, needsStudyTime } from '../lib/calendarViews.mjs';
import CalendarViews from './calendar/CalendarViews';

const FEED_KEY = 'cordiaCanvasCalendarFeed';
const REMINDER_KEY = 'cordiaCalendarReminders';

function accountKey(key, userId) {
  return userId ? `${key}:${userId}` : '';
}

function dateValue(item) {
  const value = new Date(item?.due_at || '').getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function dueLabel(item) {
  const date = new Date(item?.due_at || '');
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return item.all_day ? 'Due today' : `Due today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    + (item.all_day ? '' : ` · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
}

// "Today" is the student's local day, not the server's UTC day.
function localDueToday(items) {
  const today = new Date().toDateString();
  return items.filter(item => new Date(item?.due_at || '').toDateString() === today);
}

function notifyDueToday(items, userId) {
  const reminderKey = accountKey(REMINDER_KEY, userId);
  if (typeof window === 'undefined' || !reminderKey || !('Notification' in window) || localStorage.getItem(reminderKey) !== 'on' || Notification.permission !== 'granted') return;
  items.forEach(item => {
    const key = `cordiaCalendarNotified:${userId}:${item.id}:${new Date().toDateString()}`;
    if (localStorage.getItem(key)) return;
    new Notification('Due today in Canvas', { body: item.title, tag: key });
    localStorage.setItem(key, '1');
  });
}

export default function CalendarDashboard({ compact = false, onOpenCalendar = () => {} }) {
  const [feedUrl, setFeedUrl] = useState('');
  // The last feed this account loaded shows at once; a fresh copy replaces it in place.
  const [cached] = useState(() => readCalendarCache());
  const [status, setStatus] = useState(cached ? 'connected' : 'checking'); // checking | connected | disconnected | error
  const connected = status === 'connected';
  // Deadlines, lecture to-dos, study blocks, the Canvas offer and the classes (their colours)
  // arrive before the calendar shows, and then the readiness of any exam coming up.
  const [extrasIn, setExtrasIn] = useState(0);
  const arrived = () => setExtrasIn(count => count + 1);
  const [folders, setFolders] = useState([]);
  useEffect(() => { if (compact) { arrived(); return; } loadFolders().catch(() => null).then(data => { setFolders(Array.isArray(data?.folders) ? data.folders : []); arrived(); }); }, [compact]);
  const [readiness, setReadiness] = useState({ key: null, map: {} });
  const [items, setItems] = useState(() => cached?.items || []);
  const [dueToday, setDueToday] = useState(() => localDueToday(cached?.items || []));
  // To-dos confirmed from lectures show alongside the Canvas feed.
  const [lectureItems, setLectureItems] = useState([]);
  useEffect(() => { confirmedTodos().catch(() => null).then(data => { setLectureItems(lectureCalendarItems(data?.todos)); arrived(); }); }, []);
  // Study blocks from Plan my week (and assignment plans) show too, with or without Canvas.
  const [blocks, setBlocks] = useState([]);
  useEffect(() => { loadBlocks().catch(() => null).then(data => { setBlocks(Array.isArray(data?.blocks) ? data.blocks : []); arrived(); }); }, []);
  const reloadBlocks = useCallback(() => loadBlocks().catch(() => null).then(data => { if (Array.isArray(data?.blocks)) setBlocks(data.blocks); }), []);
  // Canvas token connection (all classes and course files), offered when the backend has it.
  const [canvasReady, setCanvasReady] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenConnected, setTokenConnected] = useState(false);
  const [foundClasses, setFoundClasses] = useState(null);
  // One Connect Canvas: the access token first; the calendar link is the fallback.
  const [feedOpen, setFeedOpen] = useState(false);
  // Deadlines from the access token (not a calendar link) are managed in Settings.
  const [fromToken, setFromToken] = useState(false);
  useEffect(() => { canvasStatus().catch(() => null).then(data => { setCanvasReady(Boolean(data) && !data.connected); arrived(); }); }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reminders, setReminders] = useState(false);
  const [userId, setUserId] = useState('');

  // The four views' model: deadlines and study blocks with their classes' colours.
  const dataIn = status !== 'checking' && extrasIn >= 4;
  const model = useMemo(() => {
    const index = classIndex(folders);
    const deadlines = buildDeadlines(mergeCalendarItems(status === 'connected' ? items : [], lectureItems), index);
    const blockEntries = buildBlocks(blocks, deadlines, index);
    return { deadlines, blocks: blockEntries, needs: needsStudyTime(deadlines, blockEntries, new Date()) };
  }, [folders, status, items, lectureItems, blocks]);
  // Exams from yesterday to a month ahead get Learn's readiness (the same number as the sidebar).
  const exams = useMemo(() => {
    const from = Date.now() - 86400000;
    return model.deadlines.filter(entry => entry.exam && entry.at.getTime() >= from && entry.at.getTime() <= from + 31 * 86400000);
  }, [model.deadlines]);
  const examKey = exams.map(entry => entry.id).join(',');
  useEffect(() => {
    if (compact || !dataIn) return undefined;
    let live = true;
    loadExamReadiness(exams).catch(() => ({})).then(map => { if (live) setReadiness({ key: examKey, map: map || {} }); });
    return () => { live = false; };
  }, [compact, dataIn, examKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const gate = useLoadGate(dataIn && (compact || readiness.key === examKey));

  useEffect(() => {
    const accountId = getUserId();
    const feedKey = accountKey(FEED_KEY, accountId);
    const reminderKey = accountKey(REMINDER_KEY, accountId);

    // Legacy keys were shared by every account in one browser. Never attach
    // that feed URL to a different signed-in user.
    localStorage.removeItem(FEED_KEY);
    localStorage.removeItem(REMINDER_KEY);

    setUserId(accountId);
    const saved = feedKey ? localStorage.getItem(feedKey) || '' : '';
    setFeedUrl(saved);
    setReminders(Boolean(reminderKey && localStorage.getItem(reminderKey) === 'on'));
    if (saved) {
      connect(saved, accountId);
    } else {
      refresh(accountId);
    }
  }, []);

  function applyCalendar(data, accountId) {
    if (!data?.connected || !Array.isArray(data.items)) return false;
    rememberCalendar(data, accountId);
    setStatus('connected');
    setFromToken(data.source === 'canvas');
    const today = localDueToday(data.items);
    setItems(data.items);
    setDueToday(today);
    notifyDueToday(today, accountId);
    return true;
  }

  async function connect(url, accountId = userId) {
    if (!url || !accountId) return;
    setLoading(true);
    setError('');
    const data = await apiFetch('/calendar/connection', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    if (applyCalendar(data, accountId)) {
      walkthroughEvent('calendar-connected');
      if (Array.isArray(data.classes) && data.classes.length) setFoundClasses(data.classes);
      const feedKey = accountKey(FEED_KEY, accountId);
      if (feedKey) localStorage.removeItem(feedKey);
      setFeedUrl('');
    } else {
      setError(apiErrorMessage(data?.detail, 'Classroom could not read this calendar feed.'));
      setStatus(current => (current === 'checking' ? 'disconnected' : current));
    }
    setLoading(false);
  }

  async function refresh(accountId = userId) {
    if (!accountId) return;
    setLoading(true);
    setError('');
    const data = await apiFetch('/calendar/connection');
    if (data?.connected === false) {
      rememberCalendar(data, accountId);
      setStatus('disconnected');
    } else if (!applyCalendar(data, accountId)) {
      setError(apiErrorMessage(data?.detail, 'Classroom could not refresh this calendar feed.'));
      setStatus(current => (current === 'checking' ? 'error' : current));
    }
    setLoading(false);
  }

  async function disconnect() {
    setLoading(true);
    setError('');
    const data = await apiFetch('/calendar/connection', { method: 'DELETE' });
    if (data?.connected !== false) {
      setError(apiErrorMessage(data?.detail, 'Classroom could not disconnect this calendar.'));
      setLoading(false);
      return;
    }
    const feedKey = accountKey(FEED_KEY, userId);
    if (feedKey) localStorage.removeItem(feedKey);
    rememberCalendar({ connected: false }, userId);
    setStatus('disconnected');
    setFeedUrl('');
    setItems([]);
    setDueToday([]);
    setLoading(false);
  }

  async function toggleReminders() {
    const reminderKey = accountKey(REMINDER_KEY, userId);
    if (!reminderKey) {
      setError('Sign in again before enabling reminders.');
      return;
    }
    if (reminders) {
      localStorage.removeItem(reminderKey);
      setReminders(false);
      return;
    }
    if (!('Notification' in window)) {
      setError('This browser does not support desktop reminders. Your dashboard reminders will still work.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setError('Desktop reminders were not allowed. You can still review deadlines on this dashboard.');
      return;
    }
    localStorage.setItem(reminderKey, 'on');
    setReminders(true);
    notifyDueToday(dueToday, userId);
  }

  // Never show the connect steps, or a week still missing its blocks, while loading: the loader instead.
  if (status === 'checking' || gate === 'waiting' || gate === 'loader') {
    return compact ? <SectionLoader height={183} label="Loading calendar" /> : <><PageTitle /><LoadingArea phase={gate === 'loader' ? 'loader' : 'waiting'} label="Loading calendar" /></>;
  }
  if (status === 'error') {
    return (
      <>
        {!compact && <PageTitle />}
        <div className="c-empty" role="alert">
          <p>{error}</p>
          <button type="button" className="c-btn c-btn--secondary" onClick={() => refresh()}>Try again</button>
        </div>
      </>
    );
  }

  let connectCard = null;
  if (!connected) {
    if (compact) {
      return (
        <section className="compact-calendar">
          <header><h2>Due soon</h2></header>
          {error && <div className="compact-calendar-error" role="alert">{error}</div>}
          <button type="button" onClick={onOpenCalendar}>Connect</button>
          <CompactStyles />
        </section>
      );
    }
    const steps = [
      { label: 'Open Canvas', icon: ExternalLink, shot: <CanvasCalendarNav />, line: 'Open Canvas Calendar' },
      { label: 'Copy link', icon: ClipboardCopy, shot: <CanvasCalendarFeed />, line: 'Click Calendar Feed in the right sidebar' },
      { label: 'Paste here', icon: ClipboardPaste, shot: <CanvasFeedLink />, line: 'Copy the link ending in .ics' },
    ];
    const linkProblem = feedLinkProblem(feedUrl);
    if (canvasReady && !feedOpen) {
      connectCard = (
        <section className="c-card cal-connect cal-connect--one" aria-label="Connect Canvas">
          <KeyRound size={28} strokeWidth={1.75} aria-hidden="true" />
          <h2 className="c-section-title">Add your Canvas deadlines</h2>
          <p className="c-meta">Your study time and lecture to-dos are above. Connect Canvas to add every class’s deadlines, kept in sync.</p>
          <button type="button" className="c-btn c-btn--primary" data-spot="calendar-feed" onClick={() => setTokenOpen(true)}>Connect Canvas</button>
          <button type="button" className="c-btn c-btn--quiet" onClick={() => setFeedOpen(true)}>Use a calendar link instead</button>
          <style jsx>{`
            .cal-connect--one { display: grid; justify-items: center; gap: 12px; padding: 40px 28px; text-align: center; }
            .cal-connect--one :global(.lucide) { color: var(--olive-ink); }
            .cal-connect--one h2, .cal-connect--one p { margin: 0; }
          `}</style>
        </section>
      );
    } else connectCard = (
      <section className="c-card cal-connect" aria-label="Connect Canvas calendar">
        <ol className="cal-steps">
          {steps.map((step, index) => (
            <li key={step.label}>
              <span className="cal-step-num" aria-hidden="true">{index + 1}</span>
              <step.icon size={24} strokeWidth={1.75} aria-hidden="true" />
              <span>{step.label}</span>
              <div className="cal-step-shot">{step.shot}</div>
              <p className="cal-step-line">{step.line}</p>
            </li>
          ))}
        </ol>
        <form className="cal-form" onSubmit={event => { event.preventDefault(); if (feedUrl.trim() && !linkProblem) connect(feedUrl.trim().replace(/^webcal:\/\//i, 'https://')); }}>
          <label className="c-field cal-field">
            <span>Calendar feed link</span>
            <input className="c-input" type="text" inputMode="url" value={feedUrl} onChange={event => setFeedUrl(event.target.value)} placeholder="https://" data-spot="calendar-feed" aria-invalid={Boolean(linkProblem)} aria-describedby={linkProblem ? 'cal-link-problem' : undefined} />
          </label>
          <button type="submit" className="c-btn c-btn--primary" disabled={loading || !feedUrl.trim() || Boolean(linkProblem)}>{loading ? 'Checking…' : 'Connect'}</button>
        </form>
        {linkProblem && <p id="cal-link-problem" className="canvas-inline-error" role="alert">{linkProblem}</p>}
        {error && <div className="canvas-inline-error" role="alert">{error}</div>}
        {canvasReady && (
          <button type="button" className="c-btn c-btn--quiet cal-token" onClick={() => setTokenOpen(true)}>
            <KeyRound size={20} strokeWidth={1.75} aria-hidden="true" />Connect with an access token instead
          </button>
        )}
        <style jsx>{`
          .cal-connect { display: grid; gap: 24px; padding: 28px; }
          .cal-token { justify-self: start; margin: -12px 0 -8px -12px; }
          .cal-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
          .cal-steps li { display: grid; justify-items: center; gap: 10px; padding: 20px 12px; border-radius:var(--r-card); background: var(--card-sunk); font:600 0.9375rem/1.15 var(--font-sans); text-align: center; }
          .cal-steps :global(.lucide) { color: var(--olive-ink); }
          .cal-step-num { display: grid; place-items: center; width: 28px; height: 28px; border-radius:50%; background: var(--olive); color: var(--on-olive); font:600 0.8125rem/1 var(--font-sans); }
          .cal-step-shot { width: 100%; border-radius:var(--r-input); overflow: hidden; }
          .cal-step-line { margin: 0; font:600 0.8125rem/1.5 var(--font-sans); color: var(--ink); }
          .cal-form { display: flex; align-items: flex-end; gap: 8px; }
          .cal-field { flex: 1; }
          @media (max-width: 767px) { .cal-steps { grid-template-columns: 1fr; } .cal-steps li { grid-template-columns: auto auto 1fr; justify-items: start; align-items: center; padding: 14px; } .cal-step-shot, .cal-step-line { grid-column: 1 / -1; } .cal-form { flex-direction: column; align-items: stretch; } }
        `}</style>
      </section>
    );
  }

  const allItems = mergeCalendarItems(connected ? items : [], lectureItems);
  const allToday = localDueToday(allItems);
  const todayIds = new Set(allToday.map(item => item.id));
  const upcoming = allItems
    .filter(item => !todayIds.has(item.id) && dateValue(item) >= Date.now())
    .sort((a, b) => dateValue(a) - dateValue(b))
    .slice(0, 10);

  if (compact) {
    const agenda = [...allToday, ...upcoming]
      .sort((left, right) => dateValue(left) - dateValue(right))
      .slice(0, 3);
    return (
      <section className="compact-calendar">
        <header>
          <h2>Due soon</h2>
          <button type="button" className="compact-calendar-link" onClick={onOpenCalendar}>Calendar</button>
        </header>
        {error && <div className="compact-calendar-error" role="alert">{error}</div>}
        <div className="compact-agenda">
          {agenda.length ? agenda.map(item => (
            <a key={item.id} href={item.url || undefined} target={item.url && !item.internal ? '_blank' : undefined} rel={item.url && !item.internal ? 'noreferrer' : undefined}>
              <span className="compact-date">{dueLabel(item)}</span>
              <strong title={deadlineTitle(item)}>{deadlineTitle(item)}</strong>
              <small>{deadlineCourse(item) || 'Canvas'}</small>
            </a>
          )) : <p>0 due</p>}
        </div>
        <CompactStyles />
      </section>
    );
  }

  const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
  // Canvas's own controls, kept from the old week: reminders, refresh and disconnect (or, connected
  // with an access token, Canvas settings, where Sync now updates everything).
  const tools = connected ? (
    <div className="cal-tools">
      <p className="c-meta cal-tools-note">{fromToken ? 'Canvas deadlines, kept in sync' : 'Canvas deadlines from your calendar link'}</p>
      <div className="cal-tools-actions">
        <button type="button" className="c-btn c-btn--quiet" onClick={toggleReminders} aria-pressed={reminders}>{reminders ? <Bell {...ICON} /> : <BellOff {...ICON} />}Reminders</button>
        {!fromToken && <button type="button" className="c-btn c-btn--quiet" onClick={() => refresh()} disabled={loading}><RefreshCw {...ICON} />{loading ? 'Refreshing…' : 'Refresh'}</button>}
        {fromToken
          ? <Link href="/settings?section=connectors" className="c-btn c-btn--quiet">Canvas settings</Link>
          : <button type="button" className="c-btn c-btn--quiet" onClick={disconnect} disabled={loading}><Unlink {...ICON} />Disconnect</button>}
      </div>
      {error && <div className="canvas-inline-error" role="alert">{error}</div>}
      <style jsx>{`
        .cal-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; }
        .cal-tools p { margin: 0; }
        .cal-tools .cal-tools-note { color: var(--muted-strong); }
        .cal-tools-actions { display: flex; flex-wrap: wrap; gap: 0.25rem; }
        .cal-tools-actions :global(.c-btn) { min-height: 2.75rem; }
        .cal-tools :global(.canvas-inline-error) { flex-basis: 100%; }
      `}</style>
    </div>
  ) : null;

  return (
    <>
      <CalendarViews
        deadlines={model.deadlines}
        blocks={model.blocks}
        needs={model.needs}
        readiness={readiness.map}
        setRawBlocks={setBlocks}
        reloadBlocks={reloadBlocks}
        tools={tools}
        below={connectCard}
      />
      {/* Outside the connect card: connecting hides the card, and the sheet's next step is
          choosing classes (feedback 10). The calendar reloads once the sheet closes. */}
      {tokenOpen && (
        <CanvasConnectSheet
          school={typeof window !== 'undefined' ? localStorage.getItem('cordiaSchool') || '' : ''}
          onClose={() => { setTokenOpen(false); if (tokenConnected) { setTokenConnected(false); refresh(); } }}
          onConnected={data => { if (data?.connected) { setCanvasReady(false); setTokenConnected(true); } }}
        />
      )}
      {foundClasses && <CalendarClassChooser classes={foundClasses} onClose={() => setFoundClasses(null)} />}
    </>
  );
}

// The page title while the calendar loads, the same size as the loaded header's.
function PageTitle() {
  return <h1 className="c-title" style={{ fontSize: '2.25rem', lineHeight: 1.1 }}>Calendar</h1>;
}

// Right after a calendar link connects: the classes Cordia read from it, all kept unless the
// student unticks one (a code it guessed wrong, or a class they don't want). Done drops the unticked.
function CalendarClassChooser({ classes, onClose }) {
  const [kept, setKept] = useState(() => new Set(classes.map(c => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = id => setKept(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function done() {
    setBusy(true);
    setError('');
    const dropped = classes.filter(c => !kept.has(c.id));
    const results = await Promise.all(dropped.map(c => apiFetch(`/classes/${c.id}`, { method: 'DELETE' })));
    setBusy(false);
    if (results.some(result => !result?.ok)) { setError('Some classes couldn’t be removed. Try again.'); return; }
    onClose();
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet ccc" role="dialog" aria-modal="true" aria-labelledby="ccc-title" onClick={event => event.stopPropagation()}>
          <header className="c-sheet-head">
            <h2 id="ccc-title" className="c-section-title">Choose classes</h2>
          </header>
          <p className="c-meta">Found in your calendar. Untick any you don’t take.</p>
          <ul className="ccc-list">
            {classes.map(c => (
              <li key={c.id}>
                <Toggle checked={kept.has(c.id)} disabled={busy} onChange={() => toggle(c.id)} label={c.name ? `${c.code} ${c.name}` : c.code} />
              </li>
            ))}
          </ul>
          {error && <p className="canvas-inline-error" role="alert">{error}</p>}
          <div className="ccc-actions"><button type="button" className="c-btn c-btn--primary" onClick={done} disabled={busy}>{busy ? 'Saving…' : 'Done'}</button></div>
          <style jsx>{`
            .ccc { display: grid; gap: var(--space-4); }
            .ccc p { margin: 0; }
            .ccc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
            .ccc-actions { display: flex; justify-content: flex-end; }
          `}</style>
        </section>
      </div>
    </BodyPortal>
  );
}

function CompactStyles() {
  return (
    <style jsx global>{`
      .compact-calendar { display: flex; min-width: 0; min-height: 255px; flex-direction: column; padding: 26px; border: 1px solid var(--border-default); border-radius: var(--r-card); background: var(--surface); box-shadow: var(--shadow-md); }
      .compact-calendar header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .compact-eyebrow { color: var(--accent); font-size: 0.8125rem; font-weight:600; letter-spacing:0; text-transform:none; }
      .compact-calendar h2 { margin: 5px 0 0; font-size:1.25rem; letter-spacing:-0.015em; }
      .compact-calendar > p, .compact-agenda > p { margin: 18px 0; color: var(--text-muted); line-height:1.5; }
      .compact-calendar > button { align-self: flex-start; margin-top: auto; padding: 10px 14px; border: 1px solid var(--border-default); border-radius: var(--r-input); color: var(--ink); background: var(--bg-hover); font: inherit; font-size: 0.8125rem; font-weight:600; cursor: pointer; }
      .compact-calendar-mark { display: grid; width: 43px; height: 43px; flex: 0 0 auto; place-items: center; border-radius:12px; color: var(--accent); background: var(--bg-hover); font-weight:600; }
      .compact-calendar-link { flex: 0 0 auto; padding: 0; border: 0; color: var(--accent); background: transparent; font: inherit; font-size: 0.8125rem; font-weight:600; cursor: pointer; }
      .compact-agenda { display: grid; margin-top: 13px; }
      .compact-agenda a { display: grid; min-width: 0; gap: 2px; padding: 11px 0; border-top: 1px solid var(--border-default); color: var(--ink); text-decoration: none; }
      .compact-agenda strong { overflow: hidden; font-size:0.8125rem; text-overflow: ellipsis; white-space: nowrap; }
      .compact-agenda small { overflow: hidden; color: var(--text-muted); font-size: 0.8125rem; text-overflow: ellipsis; white-space: nowrap; }
      .compact-date { color: var(--accent); font-size: 0.8125rem; font-weight:600; }
      .compact-calendar-error { margin-top: 12px; color: var(--error); font-size: 0.8125rem; line-height:1.5; }
      @media (max-width: 620px) { .compact-calendar { min-height: 0; border-radius: var(--r-card); padding: 22px; } }
    `}</style>
  );
}
