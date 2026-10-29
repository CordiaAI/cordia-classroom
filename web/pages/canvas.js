import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { RefreshCw, Settings2 } from 'lucide-react';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { apiErrorMessage } from '../lib/api';
import { canvasStatus, syncCanvas } from '../lib/canvas';
import { loadFolders } from '../lib/folders';
import CanvasClasses from '../components/CanvasClasses';
import CanvasConnectButton from '../components/CanvasConnectButton';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Your Canvas classes with their course material. The calendar is its own page (/calendar).
export default function CanvasPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const [status, setStatus] = useState(undefined);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [folders, setFolders] = useState(undefined);

  // The classes and their Cordia covers arrive together, so the page appears once, whole.
  useEffect(() => {
    if (!ready) return;
    Promise.all([canvasStatus(), loadFolders().catch(() => null)]).then(([next, folderData]) => {
      setFolders(folderData?.folders || []);
      setStatus(next);
    });
  }, [ready]);
  const gate = useLoadGate(status !== undefined && folders !== undefined);
  // Old links to the Calendar tab open the Calendar page.
  useEffect(() => { if (router.query.tab === 'calendar') router.replace('/calendar'); }, [router.query.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function syncNow() {
    setSyncing(true);
    setError('');
    const data = await syncCanvas();
    setSyncing(false);
    if (data && 'connected' in data) setStatus(data);
    else setError(apiErrorMessage(data?.detail, 'Canvas could not be reached.'));
  }

  if (!ready) return null;
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading Canvas" />;
  const connected = Boolean(status?.connected);

  return (
    <Reveal phase={gate}>
    <div className="c-page canvas-page">
      <header className="c-page-head">
        <h1 className="c-title">Canvas</h1>
        {connected && (
          <div className="c-row">
            <button type="button" className="c-btn c-btn--secondary" onClick={syncNow} disabled={syncing}><RefreshCw {...ICON} />{syncing ? 'Syncing…' : 'Sync now'}</button>
            <Link href="/settings?section=connectors" className="c-icon-btn" aria-label="Canvas settings"><Settings2 {...ICON} /></Link>
          </div>
        )}
      </header>
      {error && <p className="canvas-error" role="alert">{error}</p>}

      {connected ? (
        <CanvasClasses status={status} onStatus={setStatus} folders={folders} />
      ) : status ? (
        <div className="c-stack">
          <CanvasConnectButton card className="c-btn c-btn--primary" spot="canvas-connect" />
          <p className="c-meta canvas-note">Connect once to bring in every class, its files and its deadlines. Make a study guide from any file in one tap.</p>
        </div>
      ) : (
        <div className="c-empty">
          <span className="c-section-title">Canvas classes are almost ready</span>
          <p className="c-meta">Your Canvas calendar works now on the Calendar page.</p>
          <Link href="/calendar" className="c-btn c-btn--secondary">Open Calendar</Link>
        </div>
      )}
      <style jsx>{`
        .canvas-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        .canvas-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .canvas-note { margin: 0; }
      `}</style>
    </div>
    </Reveal>
  );
}
