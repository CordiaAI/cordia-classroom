import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../lib/api';
import { canvasStatus, displayDate, ENDPOINT_LABELS, schoolPolicy } from '../lib/canvas';
import CanvasConnectSheet from './CanvasConnectSheet';
import CanvasCourseList from './CanvasCourseList';
import Toggle from './Toggle';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function when(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CanvasSettings({ school = '' }) {
  const [status, setStatus] = useState(undefined);
  const [connecting, setConnecting] = useState(false);
  const [activity, setActivity] = useState(null);
  const [tokensAllowed, setTokensAllowed] = useState(true);
  const [removed, setRemoved] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    canvasStatus().then(data => setStatus(data));
    if (school) schoolPolicy({ school }).then(policy => setTokensAllowed(policy.tokens_allowed !== false));
  }, [school]);

  useEffect(() => {
    if (status?.domain) schoolPolicy({ domain: status.domain }).then(policy => setTokensAllowed(policy.tokens_allowed !== false));
  }, [status?.domain]);

  async function run(kind, request) {
    setBusy(kind);
    setError('');
    const data = await request();
    setBusy('');
    if (data && 'connected' in data) setStatus(data);
    else setError(apiErrorMessage(data?.detail, 'Canvas could not be reached.'));
    return data;
  }

  async function disconnect() {
    const data = await run('disconnect', () => apiFetch('/canvas', { method: 'DELETE' }));
    if (data && 'connected' in data) {
      setRemoved(data.settings_url);
      setActivity(null);
    }
  }

  async function showActivity() {
    if (activity) { setActivity(null); return; }
    const data = await apiFetch('/canvas/activity');
    setActivity(data?.activity || []);
  }

  if (status === undefined) return <div className="c-skeleton" style={{ height: 160, borderRadius: 20 }} />;
  if (status === null) return null;

  const connected = status.connected;
  return (
    <div className="c-stack cset">
      {removed && (
        <div className="c-card cset-card cset-removed" role="status">
          <p className="cset-line">Delete the token there too</p>
          <a className="c-btn c-btn--secondary" href={removed} target="_blank" rel="noreferrer"><ExternalLink {...ICON} />Canvas settings</a>
        </div>
      )}

      {status.status === 'needs_reconnect' && (
        <div className="c-card cset-card" role="alert">
          <button type="button" className="c-btn c-btn--primary" onClick={() => setConnecting(true)}>Reconnect Canvas</button>
        </div>
      )}

      {connected ? (
        <>
          {status.remind && (
            <div className="c-card cset-card" role="status">
              <p className="cset-line">Token expires {status.expires_in_days === 0 ? 'today' : `in ${status.expires_in_days} day${status.expires_in_days === 1 ? '' : 's'}`}</p>
              <button type="button" className="c-btn c-btn--primary" onClick={() => setConnecting(true)}>Reconnect</button>
            </div>
          )}
          <section className="c-card cset-card" aria-labelledby="cset-title">
            <header className="cset-head">
              <div className="cset-id">
                <h2 id="cset-title" className="c-section-title">Canvas</h2>
                <span className="c-meta">{status.domain} · •••• {status.last4}{status.expires_at ? ` · Expires ${displayDate(status.expires_at)}` : ''}</span>
              </div>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => run('sync', () => apiFetch('/canvas/sync', { method: 'POST' }))} disabled={busy === 'sync'}>
                <RefreshCw {...ICON} />{busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
            </header>
            <CanvasCourseList courses={status.courses} onChange={setStatus} />
            <div className="cset-foot">
              <Toggle label="Pause sync" checked={status.sync_paused} onChange={value => run('pause', () => apiFetch('/canvas/pause', { method: 'PUT', body: JSON.stringify({ paused: value }) }))} />
              {status.last_synced_at && <span className="c-meta">Synced {when(status.last_synced_at)}</span>}
            </div>
            {error && <p className="cset-error" role="alert">{error}</p>}
            <div className="cset-actions">
              <button type="button" className="c-btn c-btn--quiet" onClick={showActivity} aria-expanded={Boolean(activity)}>Activity</button>
              <button type="button" className="c-btn c-btn--quiet cset-danger" onClick={disconnect} disabled={busy === 'disconnect'}>Disconnect</button>
            </div>
          </section>
          {activity && (
            <section className="c-card cset-card" aria-label="Activity">
              {activity.length ? (
                <ul className="cset-activity">
                  {activity.map((item, index) => (
                    <li key={index}>
                      <span>{ENDPOINT_LABELS[item.endpoint] || item.endpoint}</span>
                      <span className="c-meta">{when(item.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="c-meta">No calls in 30 days</p>}
            </section>
          )}
        </>
      ) : status.status !== 'needs_reconnect' && (
        <section className="c-card cset-card" aria-labelledby="cset-title">
          <h2 id="cset-title" className="c-section-title">Canvas</h2>
          <div className="cset-options">
            <Link href="/canvas?tab=calendar" className="cset-option">
              <CalendarDays {...ICON} />
              <strong>Calendar feed</strong>
            </Link>
            {tokensAllowed ? (
              <button type="button" className="cset-option" onClick={() => setConnecting(true)}>
                <KeyRound {...ICON} />
                <strong>Access token</strong>
              </button>
            ) : (
              <p className="cset-line">Your school doesn't allow tokens</p>
            )}
          </div>
        </section>
      )}

      {connecting && (
        <CanvasConnectSheet
          school={school}
          initialDomain={status.domain || ''}
          onClose={() => setConnecting(false)}
          onConnected={data => { setStatus(data); setRemoved(null); }}
        />
      )}

      <style jsx global>{`
        .cset-card { display: grid; gap: 16px; padding: 24px; }
        .cset-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .cset-id { display: grid; gap: 4px; min-width: 0; }
        .cset-id .c-section-title { margin: 0; }
        .cset-id .c-meta { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .cset-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .cset-actions { display: flex; gap: 8px; justify-content: space-between; margin: 0 -12px -8px; }
        .cset-danger { color: var(--error); }
        .cset-line { margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .cset-removed, .cset-card[role='alert'], .cset-card[role='status'] { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .cset-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .cset-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .cset-option { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 12px 16px; border-radius: 20px; border: 1px solid var(--line); background: var(--card); color: var(--ink); text-align: left; text-decoration: none; cursor: pointer; font: inherit; }
        .cset-option:hover { background: var(--hover); }
        .cset-option > span { display: grid; gap: 2px; }
        .cset-option strong { font: 600 15px/1.3 var(--font-sans); }
        .cset-activity { list-style: none; margin: 0; padding: 0; display: grid; }
        .cset-activity li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); font: 500 15px/1.3 var(--font-sans); }
        .cset-activity li:last-child { border-bottom: 0; }
        .cset-activity .c-meta { font-variant-numeric: tabular-nums; }
      `}</style>
    </div>
  );
}
