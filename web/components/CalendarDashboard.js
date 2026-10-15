import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Bell, BellOff, BookOpen, CalendarCheck, ChevronLeft, ChevronRight, ExternalLink, GraduationCap, RefreshCw, Unlink, X } from 'lucide-react';
import { apiErrorMessage, apiFetch, getUserId } from '../lib/api';
import { dueLabel, folderForCode, splitTitle } from '../lib/calendarItems';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';
import ConfirmDialog from './ConfirmDialog';
import Menu from './Menu';
import { Sheet } from './Overlay';
import StepGuide from './StepGuide';
import { CanvasCalendarFeed, CanvasCalendarNav, CanvasFeedLink } from './Illustrations';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const REMINDER_KEY = 'cordiaCalendarReminders';
const MAX_PER_DAY = 4;
const KIND_LABEL = { exam: 'Exam', quiz: 'Quiz', project: 'Project', assignment: 'Assignment', event: 'Event', discussion: 'Discussion' };

function dateValue(item) {
  const value = new Date(item?.due_at || '').getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function timeLabel(item) {
  return item.all_day ? 'All day' : new Date(item.due_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function kindTag(type) {
  return type === 'exam' || type === 'quiz' ? 'exam' : type === 'project' ? 'project' : type === 'event' ? 'event' : 'assignment';
}

function notifyDueToday(items, userId) {
  const key = userId ? `${REMINDER_KEY}:${userId}` : '';
  if (typeof window === 'undefined' || !key || !('Notification' in window) || localStorage.getItem(key) !== 'on' || Notification.permission !== 'granted') return;
  const today = new Date().toDateString();
  items.filter(item => new Date(item.due_at).toDateString() === today).forEach(item => {
    const seen = `cordiaCalendarNotified:${userId}:${item.id}:${today}`;
    if (localStorage.getItem(seen)) return;
    new Notification('Due today', { body: splitTitle(item).title, tag: seen });
    localStorage.setItem(seen, '1');
  });
}

// One event: its class chip, kind, time, Study and Open in Canvas.
function EventSheet({ item, folders, onClose }) {
  const router = useRouter();
  const { title, code } = splitTitle(item);
  const folder = folderForCode(folders, code);
  return (
    <Sheet onClose={onClose} labelledBy="event-title" className="cal-sheet">
      <header className="c-sheet-head">
        <h2 id="event-title" className="cal-sheet-title">{title}</h2>
        <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" title="Close"><X {...ICON} /></button>
      </header>
      <div className="cal-sheet-meta">
        {code && <span className="class-chip">{code}</span>}
        <span className={`cal-kind cal-kind-${kindTag(item.type)}`}>{KIND_LABEL[item.type] || 'Due'}</span>
        <span className="cal-sheet-when">{dueLabel(item)}</span>
      </div>
      <div className="cal-sheet-actions">
        <button type="button" className="c-btn c-btn--primary" onClick={() => { onClose(); if (folder) router.push('/folder/' + folder.id); else openNewSheet(); }}><BookOpen {...ICON} />Study</button>
        {item.url && <a className="c-btn c-btn--secondary" href={item.url} target="_blank" rel="noreferrer"><ExternalLink {...ICON} />Open in Canvas</a>}
      </div>
    </Sheet>
  );
}

function EventButton({ item, onPick, wide = false }) {
  const { title, code } = splitTitle(item);
  const past = dateValue(item) < Date.now() && new Date(item.due_at).toDateString() !== new Date().toDateString();
  return (
    <button type="button" className={'cal-item' + (past ? ' is-past' : '') + (wide ? ' is-wide' : '')} onClick={() => onPick(item)}>
      <span className="cal-item-top">
        <span className={`cal-kind cal-kind-${kindTag(item.type)}`}>{KIND_LABEL[item.type] || 'Due'}</span>
        <span className="cal-item-time">{timeLabel(item)}</span>
      </span>
      <span className="cal-item-title">{title}</span>
      {code && <span className="class-chip">{code}</span>}
    </button>
  );
}

function DaySheet({ day, items, onPick, onClose }) {
  const label = day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <Sheet onClose={onClose} labelledBy="day-title" className="cal-sheet">
      <header className="c-sheet-head">
        <h2 id="day-title" className="cal-sheet-title">{label}</h2>
        <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close" title="Close"><X {...ICON} /></button>
      </header>
      <ul className="cal-day-list">
        {items.map(item => <li key={item.id}><EventButton item={item} onPick={onPick} wide /></li>)}
      </ul>
    </Sheet>
  );
}

// The calendar feed connect guide: show the real screens, then the field.
function ConnectGuide({ onConnected }) {
  const [canvasUrl, setCanvasUrl] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const valid = /^https:\/\/\S+\.ics(\?\S*)?$/i.test(feedUrl.trim());
  const host = (() => {
    const text = canvasUrl.trim();
    if (!text) return '';
    try { return new URL(text.includes('://') ? text : 'https://' + text).origin; } catch { return ''; }
  })();

  async function connect(event) {
    event.preventDefault();
    if (!valid || checking) return;
    setChecking(true);
    setError('');
    const data = await apiFetch('/calendar/connection', { method: 'POST', body: JSON.stringify({ url: feedUrl.trim() }) });
    setChecking(false);
    if (data?.connected && Array.isArray(data.items)) {
      walkthroughEvent('calendar-connected');
      setFound(data.items.length);
      setTimeout(() => onConnected(data), 1200);
    } else {
      setError(apiErrorMessage(data?.detail, "That link didn't work. Copy the Calendar Feed link again."));
    }
  }

  return (
    <div className="cal-connect">
      <StepGuide label="Connect your Canvas calendar" steps={[
        {
          visual: <CanvasCalendarNav />,
          text: 'Open your Canvas Calendar.',
          action: (
            <form className="cal-open" onSubmit={event => { event.preventDefault(); if (host) window.open(host + '/calendar', '_blank', 'noopener,noreferrer'); }}>
              <input className="c-input" value={canvasUrl} onChange={event => setCanvasUrl(event.target.value)} placeholder="school.instructure.com" aria-label="Your Canvas address" inputMode="url" />
              <button type="submit" className="c-btn c-btn--secondary" disabled={!host}><ExternalLink {...ICON} />Open Canvas Calendar</button>
            </form>
          ),
        },
        { visual: <CanvasCalendarFeed />, text: 'In the right sidebar, click Calendar Feed.' },
        { visual: <CanvasFeedLink />, text: 'Copy the link ending in .ics.' },
      ]} />
      <form className="c-card cal-form" onSubmit={connect}>
        <label className="c-field cal-field">
          <span>Calendar Feed link</span>
          <input className="c-input" type="url" value={feedUrl} onChange={event => { setFeedUrl(event.target.value); setError(''); }} placeholder="https://…/feeds/calendars/….ics" data-spot="calendar-feed" aria-invalid={Boolean(feedUrl.trim()) && !valid} />
        </label>
        <button type="submit" className="c-btn c-btn--primary" disabled={!valid || checking}>{checking ? 'Checking…' : 'Connect'}</button>
        {feedUrl.trim() && !valid && <p className="cal-hint" role="status">Use the https link that ends in .ics</p>}
        {found !== null && <p className="cal-found" role="status"><CalendarCheck {...ICON} />Found {found} {found === 1 ? 'assignment' : 'assignments'}</p>}
        {error && <p className="cal-error" role="alert">{error}</p>}
      </form>
      <section className="cal-gets" aria-labelledby="cal-gets-title">
        <h2 id="cal-gets-title" className="c-section-title">What you get</h2>
        <ul>
          <li><CalendarCheck {...ICON} />Deadlines on Today</li>
          <li><Bell {...ICON} />Reminders</li>
          <li><GraduationCap {...ICON} />Exam study plans</li>
        </ul>
      </section>
    </div>
  );
}

export default function CalendarDashboard() {
  const [connected, setConnected] = useState(null);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reminders, setReminders] = useState(false);
  const [userId, setUserId] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [view, setView] = useState('week');
  const [picked, setPicked] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const accountId = getUserId();
    setUserId(accountId);
    setReminders(Boolean(accountId && localStorage.getItem(`${REMINDER_KEY}:${accountId}`) === 'on'));
    try { const saved = localStorage.getItem('cordiaCalendarView'); if (saved === 'list' || saved === 'week') setView(saved); } catch { /* optional */ }
    apiFetch('/folders').then(data => setFolders(data?.folders || []));
    refresh(accountId);
  }, []);

  function apply(data, accountId = userId) {
    setConnected(true);
    setItems(data.items);
    notifyDueToday(data.items, accountId);
  }

  async function refresh(accountId = userId) {
    setLoading(true);
    setError('');
    const data = await apiFetch('/calendar/connection');
    setLoading(false);
    if (data?.connected === false) setConnected(false);
    else if (data?.connected && Array.isArray(data.items)) apply(data, accountId);
    else { setConnected(current => current ?? false); setError(apiErrorMessage(data?.detail, "Couldn't refresh the calendar.")); }
  }

  async function disconnect() {
    setConfirming(false);
    const data = await apiFetch('/calendar/connection', { method: 'DELETE' });
    if (data?.connected !== false) { setError(apiErrorMessage(data?.detail, "Couldn't disconnect.")); return; }
    setConnected(false);
    setItems([]);
  }

  async function toggleReminders() {
    const key = `${REMINDER_KEY}:${userId}`;
    if (reminders) { localStorage.removeItem(key); setReminders(false); return; }
    if (!('Notification' in window)) { setError("This browser can't show reminders."); return; }
    if (await Notification.requestPermission() !== 'granted') { setError('Reminders are blocked in this browser.'); return; }
    localStorage.setItem(key, 'on');
    setReminders(true);
    notifyDueToday(items, userId);
  }

  function changeView(next) {
    setView(next);
    try { localStorage.setItem('cordiaCalendarView', next); } catch { /* optional */ }
  }

  if (connected === null) return <div className="c-skeleton" style={{ height: 420, borderRadius: 20 }} />;
  if (!connected) return <ConnectGuide onConnected={data => apply(data)} />;

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = addDays(weekStart, 7).getTime();
  const sorted = [...items].sort((a, b) => dateValue(a) - dateValue(b));
  const weekItems = sorted.filter(item => dateValue(item) >= weekStart.getTime() && dateValue(item) < weekEnd);
  const todayKey = new Date().toDateString();
  const rangeLabel = `${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const upcoming = sorted.filter(item => dateValue(item) >= new Date(new Date().setHours(0, 0, 0, 0)).getTime());
  const listDays = [...new Set(upcoming.map(item => new Date(item.due_at).toDateString()))];

  return (
    <section className="cal">
      <header className="cal-head">
        <div className="cal-range">
          <button type="button" className="c-icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" title="Previous week" disabled={view === 'list'}><ChevronLeft {...ICON} /></button>
          <h2 className="c-section-title">{view === 'list' ? 'Upcoming' : rangeLabel}</h2>
          <button type="button" className="c-icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" title="Next week" disabled={view === 'list'}><ChevronRight {...ICON} /></button>
          {view === 'week' && weekStart.toDateString() !== startOfWeek(new Date()).toDateString() && (
            <button type="button" className="c-btn c-btn--quiet" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
          )}
        </div>
        <div className="cal-tools">
          <div className="c-seg" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'is-active' : ''} onClick={() => changeView('week')}>Week</button>
            <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => changeView('list')}>List</button>
          </div>
          <button type="button" className="c-icon-btn" onClick={toggleReminders} aria-pressed={reminders} aria-label={reminders ? 'Reminders on' : 'Reminders off'} title={reminders ? 'Reminders on' : 'Reminders off'}>{reminders ? <Bell {...ICON} /> : <BellOff {...ICON} />}</button>
          <button type="button" className="c-icon-btn" onClick={() => refresh()} disabled={loading} aria-label="Refresh" title="Refresh"><RefreshCw {...ICON} /></button>
          <Menu label="Calendar options" items={[{ label: 'Disconnect', icon: Unlink, danger: true, onSelect: () => setConfirming(true) }]} />
        </div>
      </header>
      {error && <p className="cal-error" role="alert">{error}</p>}

      {view === 'week' ? (
        <div className="cal-week">
          {days.map(day => {
            const dayItems = weekItems.filter(item => new Date(item.due_at).toDateString() === day.toDateString());
            const isToday = day.toDateString() === todayKey;
            return (
              <section key={day.toISOString()} className={'cal-day' + (isToday ? ' is-today' : '')} aria-label={day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
                <header className="cal-day-head">
                  <span>{day.toLocaleDateString([], { weekday: 'short' })}</span>
                  <strong>{day.getDate()}</strong>
                </header>
                <div className="cal-day-items">
                  {dayItems.slice(0, MAX_PER_DAY).map(item => <EventButton key={item.id} item={item} onPick={setPicked} />)}
                  {dayItems.length > MAX_PER_DAY && (
                    <button type="button" className="c-btn c-btn--quiet cal-more" data-qa="calendar-more" onClick={() => setDayOpen({ day, items: dayItems })}>+{dayItems.length - MAX_PER_DAY} more</button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="cal-list">
          {listDays.length ? listDays.map(key => (
            <section key={key} className="c-card cal-list-day" aria-label={key}>
              <h3 className={'cal-list-date' + (key === todayKey ? ' is-today' : '')}>{dueLabel({ due_at: new Date(key).toISOString(), all_day: true })}</h3>
              <div className="cal-list-items">
                {upcoming.filter(item => new Date(item.due_at).toDateString() === key).map(item => <EventButton key={item.id} item={item} onPick={setPicked} wide />)}
              </div>
            </section>
          )) : <p className="cal-empty">Nothing due</p>}
        </div>
      )}

      {picked && <EventSheet item={picked} folders={folders} onClose={() => setPicked(null)} />}
      {dayOpen && <DaySheet day={dayOpen.day} items={dayOpen.items} onPick={item => { setDayOpen(null); setPicked(item); }} onClose={() => setDayOpen(null)} />}
      {confirming && <ConfirmDialog title="Disconnect Calendar?" message="Deadlines leave Today and Calendar." confirmLabel="Disconnect" onConfirm={disconnect} onCancel={() => setConfirming(false)} />}
    </section>
  );
}
