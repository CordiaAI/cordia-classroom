import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { RefreshCw, Settings2 } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { canvasStatus } from '../lib/canvas';
import { walkthroughEvent } from '../lib/walkthrough';
import CalendarDashboard from '../components/CalendarDashboard';
import CanvasClasses from '../components/CanvasClasses';
import CanvasConnectButton from '../components/CanvasConnectButton';
import { SectionLoader } from '../components/CordiaLoader';

const TABS = [['classes', 'Classes'], ['calendar', 'Calendar']];
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Everything from Canvas in one place: your classes with their course material, and the calendar.
export default function CanvasPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const tab = TABS.some(([key]) => key === router.query.tab) ? router.query.tab : 'classes';
  const [status, setStatus] = useState(undefined);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (ready) canvasStatus().then(setStatus); }, [ready]);
  useEffect(() => { if (ready && tab === 'calendar') walkthroughEvent('calendar-opened'); }, [ready, tab]);

  function setTab(key) {
    router.replace(key === 'classes' ? '/canvas' : `/canvas?tab=${key}`, undefined, { shallow: true });
  }

  async function syncNow() {
    setSyncing(true);
    setError('');
    const data = await apiFetch('/canvas/sync', { method: 'POST' });
    setSyncing(false);
    if (data && 'connected' in data) setStatus(data);
    else setError(apiErrorMessage(data?.detail, 'Canvas could not be reached.'));
  }

  if (!ready) return null;
  const connected = Boolean(status?.connected);

  return (
    <div className="c-page canvas-page">
      <header className="c-page-head">
        <h1 className="c-title">Canvas</h1>
        {connected && (
          <div className="c-row">
            <button type="button" className="c-btn c-btn--secondary" onClick={syncNow} disabled={syncing}><RefreshCw {...ICON} />{syncing ? 'Syncing…' : 'Sync now'}</button>
            <Link href="/settings?section=connections" className="c-icon-btn" aria-label="Canvas settings"><Settings2 {...ICON} /></Link>
          </div>
        )}
      </header>
      {error && <p className="canvas-error" role="alert">{error}</p>}

      <div className="c-seg canvas-tabs" role="tablist" aria-label="Canvas">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'calendar' ? <CalendarDashboard /> : status === undefined ? (
        <SectionLoader height={200} label="Loading Canvas" />
      ) : connected ? (
        <CanvasClasses status={status} onStatus={setStatus} />
      ) : status ? (
        <div className="c-stack">
          <CanvasConnectButton card className="c-btn c-btn--primary" spot="canvas-connect" />
          <p className="c-meta canvas-note">Connect once to bring in every class, its files and its deadlines. Make a study guide from any file in one tap.</p>
        </div>
      ) : (
        <div className="c-empty">
          <span className="c-section-title">Canvas classes are almost ready</span>
          <p className="c-meta">Your Canvas calendar works now in the Calendar tab.</p>
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setTab('calendar')}>Open Calendar</button>
        </div>
      )}
      <style jsx>{`
        .canvas-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        .canvas-tabs { justify-self: start; }
        .canvas-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .canvas-note { margin: 0; }
      `}</style>
    </div>
  );
}
