import { useEffect, useState } from 'react';
import { apiErrorMessage, apiFetch, getUserId } from '../lib/api';

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

// "Today" is the student's local day, not the server's UTC day.
function localDueToday(items) {
  const today = new Date().toDateString();
  return items.filter(item => new Date(item?.due_at || '').toDateString() === today);
}

function timeLabel(item) {
  if (item.all_day) return 'All day';
  return new Date(item.due_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function weekSummary(items) {
  if (!items.length) return 'Nothing due this week.';
  const tests = items.filter(item => item.type === 'exam' || item.type === 'quiz').length;
  const parts = [`${items.length} due this week`];
  if (tests) parts.push(`${tests} ${tests === 1 ? 'exam or quiz' : 'exams and quizzes'}`);
  const next = items.find(item => dateValue(item) >= Date.now());
  if (next) parts.push(`next: ${next.title} (${new Date(next.due_at).toLocaleDateString([], { weekday: 'short' })})`);
  return parts.join(' · ');
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
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState([]);
  const [dueToday, setDueToday] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reminders, setReminders] = useState(false);
  const [userId, setUserId] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

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
    setConnected(true);
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
      const feedKey = accountKey(FEED_KEY, accountId);
      if (feedKey) localStorage.removeItem(feedKey);
      setFeedUrl('');
    } else {
      setError(apiErrorMessage(data?.detail, 'Classroom could not read this calendar feed.'));
    }
    setLoading(false);
  }

  async function refresh(accountId = userId) {
    if (!accountId) return;
    setLoading(true);
    setError('');
    const data = await apiFetch('/calendar/connection');
    if (data?.connected === false) {
      setConnected(false);
    } else if (!applyCalendar(data, accountId)) {
      setError(apiErrorMessage(data?.detail, 'Classroom could not refresh this calendar feed.'));
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
    setConnected(false);
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

  if (!connected) {
    if (compact) {
      return (
        <section className="compact-calendar">
          <header>
            <div>
              <span className="compact-eyebrow">Upcoming</span>
              <h2>Bring deadlines into view.</h2>
            </div>
            <span className="compact-calendar-mark" aria-hidden="true">31</span>
          </header>
          <p>Connect your Canvas calendar once to see assignments and due dates here.</p>
          {error && <div className="compact-calendar-error" role="alert">{error}</div>}
          <button type="button" onClick={onOpenCalendar}>Connect calendar</button>
          <CompactStyles />
        </section>
      );
    }
    return (
      <section className="canvas-dashboard calendar-connect-card">
        <div className="calendar-mark" aria-hidden="true">31</div>
        <div className="calendar-connect-copy">
          <span className="calendar-eyebrow">Canvas calendar</span>
          <h2>See what is due without connecting your Canvas account.</h2>
          <ol className="calendar-steps">
            <li><strong>Open Canvas Calendar</strong> and select Calendar Feed.</li>
            <li><strong>Copy the feed link</strong> shown by Canvas.</li>
            <li><strong>Paste it here</strong> to show due dates and reminders.</li>
          </ol>
          <div className="calendar-connect-form">
            <input
              type="url"
              value={feedUrl}
              onChange={event => setFeedUrl(event.target.value)}
              placeholder="https://your-school.edu/feeds/calendars/..."
              aria-label="Canvas calendar feed URL"
            />
            <button type="button" className="btn btn-green" onClick={() => connect(feedUrl.trim())} disabled={loading || !feedUrl.trim()}>
              {loading ? 'Checking calendar…' : 'Connect calendar'}
            </button>
          </div>
          <small>Your private feed link is saved to your Classroom account so deadlines reconnect automatically on your devices.</small>
          {error && <div className="canvas-inline-error" role="alert">{error}</div>}
        </div>
      </section>
    );
  }

  const todayIds = new Set(dueToday.map(item => item.id));
  const upcoming = items
    .filter(item => !todayIds.has(item.id) && dateValue(item) >= Date.now())
    .sort((a, b) => dateValue(a) - dateValue(b))
    .slice(0, 10);

  if (compact) {
    const agenda = [...dueToday, ...upcoming]
      .sort((left, right) => dateValue(left) - dateValue(right))
      .slice(0, 3);
    return (
      <section className="compact-calendar">
        <header>
          <div>
            <span className="compact-eyebrow">Upcoming</span>
            <h2>Your next deadlines</h2>
          </div>
          <button type="button" className="compact-calendar-link" onClick={onOpenCalendar}>View calendar</button>
        </header>
        {error && <div className="compact-calendar-error" role="alert">{error}</div>}
        <div className="compact-agenda">
          {agenda.length ? agenda.map(item => (
            <a key={item.id} href={item.url || undefined} target={item.url ? '_blank' : undefined} rel={item.url ? 'noreferrer' : undefined}>
              <span className="compact-date">{dueLabel(item)}</span>
              <strong>{item.title}</strong>
              <small>{item.course || 'Canvas'}</small>
            </a>
          )) : <p>Nothing due soon. Your calendar is clear.</p>}
        </div>
        <CompactStyles />
      </section>
    );
  }

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = addDays(weekStart, 7).getTime();
  const weekItems = items
    .filter(item => dateValue(item) >= weekStart.getTime() && dateValue(item) < weekEnd)
    .sort((a, b) => dateValue(a) - dateValue(b));
  const todayKey = new Date().toDateString();
  const rangeLabel = `${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  function itemCard(item) {
    const past = dateValue(item) < Date.now() && new Date(item.due_at).toDateString() !== todayKey;
    const body = (
      <>
        <span className="calendar-item-meta">
          <span className={`calendar-kind calendar-kind-${item.type}`}>{item.type}</span>
          <small>{timeLabel(item)}</small>
        </span>
        <strong>{item.title}</strong>
        {item.course && <small>{item.course}</small>}
      </>
    );
    const className = `calendar-item${past ? ' calendar-item-past' : ''}`;
    return item.url
      ? <a key={item.id} className={className} href={item.url} target="_blank" rel="noreferrer" title={`Open in Canvas: ${item.title}`}>{body}</a>
      : <div key={item.id} className={className}>{body}</div>;
  }

  return (
    <section className="canvas-dashboard calendar-dashboard">
      <header className="canvas-dashboard-header">
        <div>
          <span className="calendar-eyebrow">Canvas calendar</span>
          <h2>Week of {rangeLabel}</h2>
          <p className="calendar-week-summary">{weekSummary(weekItems)}</p>
        </div>
        <div className="calendar-actions">
          <div className="calendar-week-nav">
            <button type="button" className="btn-outline" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">‹</button>
            <button type="button" className="btn-outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
            <button type="button" className="btn-outline" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">›</button>
          </div>
          <button type="button" className="btn-outline" onClick={toggleReminders}>{reminders ? 'Reminders on' : 'Enable reminders'}</button>
          <button type="button" className="btn-outline" onClick={() => refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="calendar-disconnect" onClick={disconnect}>Disconnect</button>
        </div>
      </header>
      {error && <div className="canvas-inline-error" role="alert">{error}</div>}
      <div className="calendar-week">
        {days.map(day => {
          const dayItems = weekItems.filter(item => new Date(item.due_at).toDateString() === day.toDateString());
          const isToday = day.toDateString() === todayKey;
          return (
            <section key={day.toISOString()} className={`calendar-day${isToday ? ' calendar-day-today' : ''}`} aria-label={day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
              <header>
                <span>{day.toLocaleDateString([], { weekday: 'short' })}</span>
                <strong>{day.getDate()}</strong>
                {isToday && <em>Due today</em>}
              </header>
              <div className="calendar-day-items">
                {dayItems.length ? dayItems.map(itemCard) : <p className="calendar-day-empty">—</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function CompactStyles() {
  return (
    <style jsx global>{`
      .compact-calendar { display: flex; min-width: 0; min-height: 255px; flex-direction: column; padding: 26px; border: 1px solid var(--border-default); border-radius: 28px; background: var(--surface); box-shadow: var(--shadow-md); }
      .compact-calendar header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .compact-eyebrow { color: var(--accent); font-size: .69rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
      .compact-calendar h2 { margin: 5px 0 0; font-size: 1.45rem; letter-spacing: -.04em; }
      .compact-calendar > p, .compact-agenda > p { margin: 18px 0; color: var(--text-muted); line-height: 1.55; }
      .compact-calendar > button { align-self: flex-start; margin-top: auto; padding: 10px 14px; border: 1px solid var(--border-default); border-radius: 12px; color: var(--ink); background: var(--bg-hover); font: inherit; font-size: .78rem; font-weight: 750; cursor: pointer; }
      .compact-calendar-mark { display: grid; width: 43px; height: 43px; flex: 0 0 auto; place-items: center; border-radius: 13px; color: var(--accent); background: var(--bg-hover); font-weight: 850; }
      .compact-calendar-link { flex: 0 0 auto; padding: 0; border: 0; color: var(--accent); background: transparent; font: inherit; font-size: .73rem; font-weight: 750; cursor: pointer; }
      .compact-agenda { display: grid; margin-top: 13px; }
      .compact-agenda a { display: grid; min-width: 0; gap: 2px; padding: 11px 0; border-top: 1px solid var(--border-default); color: var(--ink); text-decoration: none; }
      .compact-agenda strong { overflow: hidden; font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
      .compact-agenda small { overflow: hidden; color: var(--text-muted); font-size: .67rem; text-overflow: ellipsis; white-space: nowrap; }
      .compact-date { color: var(--accent); font-size: .62rem; font-weight: 750; }
      .compact-calendar-error { margin-top: 12px; color: var(--error); font-size: .72rem; line-height: 1.4; }
      @media (max-width: 620px) { .compact-calendar { min-height: 0; border-radius: 22px; padding: 22px; } }
    `}</style>
  );
}
