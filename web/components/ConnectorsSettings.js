import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronRight, Copy, Mail, Search, Wallet, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import ConfirmDialog from './ConfirmDialog';
import { SectionLoader } from './CordiaLoader';
import { apiFetch } from '../lib/api';
import { canvasStatus, displayDate } from '../lib/canvas';
import CanvasConnectSheet from './CanvasConnectSheet';
import CanvasCourseList from './CanvasCourseList';
import Toggle from './Toggle';
import { BRAND_PATHS } from '../lib/brandIcons';
import { walkthroughEvent } from '../lib/walkthrough';
import { assistantApi } from '../lib/assistant';
import { agoLabel, syncOff, syncOn } from '../lib/studyPlans';
import IcloudSheet from './assistant/IcloudSheet';
import DriveFolders from './DriveFolders';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
// What each app does here, shown in its sheet.
const DETAILS = {
  canvas: 'Brings in your classes, deadlines, what you turned in, grades and course files. An access token does all of it; a calendar link is only for schools that block tokens.',
  gcal: 'Puts your study time on a separate "Cordia" calendar, fitted around what is already on yours. Move or delete a block and Cordia keeps your change. Nothing is added to your own calendars.',
  apple_calendar: 'Subscribes your Apple Calendar to your deadlines. It refreshes every hour on your iPhone, iPad and Mac. No Apple password needed.',
  gtasks: 'Keeps a "Cordia" list in Google Tasks: each deadline is a to-do, with its steps as subtasks. Check one off on your phone and it is done in Cordia too.',
  gdrive: 'Link a Drive folder to a class and new slides and readings come into Library on their own. Import a single file into Create, or save a copy of any guide back to a Cordia folder in your Drive.',
  gdocs: 'Find a Google Doc and open its text in Create, ready to make a guide.',
  notion: 'Find a Notion page and open it in Create, ready to make a guide. Share the page with Cordia in Notion first.',
  gsheets: 'Text Cordia Assistant to add a row or read a sheet: log study hours, expenses, anything.',
  gmail: 'Cordia Assistant can text you about emails that need a reply and read recent mail when you ask.',
  outlook: 'Cordia Assistant can text you about emails that need a reply and read recent mail when you ask.',
  slack: 'Ask Cordia Assistant what you missed in Slack and reply by text.',
  ynab: 'Ask Cordia Assistant what is left in a budget category before you spend.',
  dropbox: 'Ask Cordia Assistant to find a file in your Dropbox.',
  github: 'Ask Cordia Assistant about your issues and pull requests.',
};
// Apps that work in Classroom itself; the rest are for texting Cordia Assistant. Every app
// connected here works in both.
const CLASSROOM_APPS = ['gcal', 'apple_calendar', 'gtasks', 'gdrive', 'gdocs', 'notion'];
// Simple Icons has no mark for these; a plain icon stands in.
const FALLBACK_ICONS = { outlook: Mail, ynab: Wallet };

// The app's logo on a rounded glass tile, like Cordia Assistant. Decorative: the name is beside it.
function ConnectorIcon({ id, size = 'md' }) {
  const Fallback = !BRAND_PATHS[id] && FALLBACK_ICONS[id];
  return (
    <span className={`cn-icon is-${size}`} aria-hidden="true">
      {Fallback ? <Fallback strokeWidth={1.75} /> : <svg viewBox="0 0 24 24" fill="currentColor"><path d={BRAND_PATHS[id] || ''} /></svg>}
    </span>
  );
}

// In the Apple Calendar sheet: Cordia Assistant reads your Apple Calendar (with an app-specific
// password) to text you before classes and events. Separate from the deadline feed above it.
function AssistantAppleCalendar() {
  const [state, setState] = useState(null); // { connector, status, available } | { off: true }
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    const [catalog, me] = await Promise.all([assistantApi('/catalog'), assistantApi('/me')]);
    const connector = catalog.ok && catalog.data.connectors?.find(item => item.id === 'icloud_calendar');
    if (!connector || !me.ok || me.data.stage !== 'active') { setState({ off: true }); return; }
    const status = me.data.settings.connections.find(item => item.provider === 'icloud_calendar')?.status;
    setState({ connector, status, available: me.data.settings.available?.icloud_calendar !== false });
  }
  useEffect(() => { load(); }, []);
  async function disconnect() {
    setBusy(true);
    const out = await assistantApi('/connections/icloud_calendar', { method: 'DELETE' });
    setBusy(false);
    if (out.ok) { setMessage('Cordia Assistant no longer reads your Apple Calendar'); load(); }
    else setMessage(out.data.error || "That didn't disconnect. Try again.");
  }
  if (!state || state.off || !state.available) return null;
  const on = state.status === 'active';
  return (
    <div className="cn-assistant">
      <p className="c-meta">{on ? 'Cordia Assistant reads your Apple Calendar to text you before classes and events.' : 'Want texts before classes and events? Let Cordia Assistant read your Apple Calendar.'}</p>
      {on
        ? <button type="button" className="c-btn c-btn--quiet" disabled={busy} onClick={disconnect}>Stop reading it</button>
        : <button type="button" className="c-btn c-btn--secondary" onClick={() => setSigningIn(true)}>Let Cordia read it</button>}
      {message && <p className="cn-notice" role="status">{message}</p>}
      {signingIn && <IcloudSheet connector={state.connector} onClose={() => setSigningIn(false)} onConnected={() => { setSigningIn(false); setMessage('Apple Calendar connected to Cordia Assistant'); load(); }} />}
    </div>
  );
}
const IMPORTS = ['gdrive', 'gdocs', 'notion'];
const SYNC_APPS = { gcal: 'calendar', gtasks: 'list' };
const STAT_WORDS = { tasks: 'to-do', blocks: 'study block', assignments: 'assignment', announcements: 'announcement', files: 'file imported', imported_files: 'file imported' };

// "Last synced 4 min ago · 12 assignments": what a connection is actually doing.
function healthLine(health) {
  if (!health) return '';
  const counts = Object.entries(health.stats || {})
    .filter(([key, value]) => STAT_WORDS[key] && typeof value === 'number')
    .map(([key, value]) => { const [noun, ...rest] = STAT_WORDS[key].split(' '); return [`${value} ${noun}${value === 1 ? '' : 's'}`, ...rest].join(' '); });
  return [health.last_synced_at && `Last synced ${agoLabel(health.last_synced_at)}`, ...counts].filter(Boolean).join(' · ');
}
// Create reads this draft, so an import opens there ready to make a guide.
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';

function ImportSheet({ connector, onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const data = await apiFetch(`/connectors/${connector.id}/files?q=${encodeURIComponent(query.trim())}`);
      if (!live) return;
      if (Array.isArray(data?.files)) { setFound(data.files); setError(''); }
      else { setFound([]); setError(data?.detail || "Couldn't search. Try again."); }
    }, query ? 350 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [connector.id, query]);

  async function pick(file) {
    setBusy(file.id); setError('');
    const data = await apiFetch(`/connectors/${connector.id}/import`, { method: 'POST', body: JSON.stringify({ id: file.id, title: file.title }) });
    if (!data?.text) { setBusy(''); setError(data?.detail || "That didn't import. Try again."); return; }
    try { localStorage.setItem(SOURCE_DRAFT_KEY, JSON.stringify({ title: data.title, content: data.text })); } catch { /* storage blocked */ }
    router.push('/create');
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <div className="c-sheet cn-sheet" role="dialog" aria-modal="true" aria-labelledby="cn-import-title" onClick={event => event.stopPropagation()}>
          <div className="c-sheet-head">
            <h2 id="cn-import-title" className="c-section-title">Import from {connector.name}</h2>
            <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={onClose}>Close</button>
          </div>
          <label className="cn-search">
            <Search {...ICON} />
            <input ref={inputRef} className="c-input" type="search" placeholder={`Search ${connector.name}`} aria-label={`Search ${connector.name}`} value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {found === null ? <SectionLoader label="Searching" /> : found.length === 0 && !error ? (
            <p className="c-meta">{connector.id === 'notion' ? 'Nothing found. In Notion, share the page with Cordia, then search again.' : 'Nothing found. Try another name.'}</p>
          ) : (
            <div className="c-list cn-results">
              {found.map(file => (
                <button key={file.id} type="button" className="c-list-row cn-result" onClick={() => pick(file)} disabled={Boolean(busy)}>
                  <span className="c-grow">
                    <span className="cn-row-title c-truncate">{file.title}</span>
                    <span className="c-meta">{busy === file.id ? 'Importing…' : [file.kind, file.edited && `edited ${file.edited}`].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && <p className="cn-error" role="alert">{error}</p>}
          <p className="c-meta">Imports open in Create so you can check the text before making a guide.</p>
        </div>
      </div>
    </BodyPortal>
  );
}

export default function ConnectorsSettings() {
  const router = useRouter();
  const [connectors, setConnectors] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [feed, setFeed] = useState('');
  const [open, setOpen] = useState(null);
  const [canvas, setCanvas] = useState(undefined);
  const [canvasConnecting, setCanvasConnecting] = useState(false);
  const [showClasses, setShowClasses] = useState(false);
  const [canvasRemoving, setCanvasRemoving] = useState(false);

  // Canvas connects through Classroom's own Canvas flow, unlike the other apps: an access token, or a
  // calendar link where the school blocks tokens. Its tile shows which one is in.
  async function loadCanvas() {
    const [status, calendar] = await Promise.all([canvasStatus(), apiFetch('/calendar/connection')]);
    setCanvas(status ? { status, feed: Boolean(calendar?.connected) && calendar?.source !== 'canvas' } : null);
  }
  useEffect(() => { loadCanvas(); }, []);
  const school = () => (typeof window !== 'undefined' ? localStorage.getItem('cordiaSchool') || '' : '');

  async function syncCanvas() {
    setBusy('canvas'); setError('');
    const data = await apiFetch('/canvas/sync', { method: 'POST' });
    setBusy('');
    if (data && 'connected' in data) { setCanvas(current => ({ ...current, status: data })); say('Canvas synced'); }
    else fail(data?.detail || "Canvas couldn't be reached. Try again.");
  }

  async function disconnectCanvas() {
    setCanvasRemoving(false);
    setBusy('canvas');
    const data = await apiFetch('/canvas', { method: 'DELETE' });
    setBusy('');
    if (data && 'connected' in data) {
      await loadCanvas();
      say(data.settings_url ? 'Canvas disconnected. Delete the token in Canvas too: Account › Settings › Approved Integrations.' : 'Canvas disconnected');
    } else fail(data?.detail || "That didn't disconnect. Try again.");
  }

  function canvasActions() {
    const { status, feed } = canvas;
    const working = busy === 'canvas';
    if (status.status === 'needs_reconnect') return <button type="button" className="c-btn c-btn--primary" onClick={() => setCanvasConnecting(true)}>Reconnect</button>;
    if (!status.connected) {
      return <button type="button" className="c-btn c-btn--primary" onClick={() => setCanvasConnecting(true)}>{feed ? 'Add access token' : 'Connect'}</button>;
    }
    return (
      <>
        <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={syncCanvas}>{working ? 'Syncing…' : 'Sync now'}</button>
        <button type="button" className="c-btn c-btn--secondary" onClick={() => setShowClasses(value => !value)} aria-expanded={showClasses}>Classes</button>
        <button type="button" className="c-btn c-btn--quiet" disabled={working} onClick={() => setCanvasRemoving(true)}>Disconnect</button>
      </>
    );
  }

  const canvasBadge = !canvas ? null
    : canvas.status.status === 'needs_reconnect' ? { text: 'Reconnect', cls: 'is-warn' }
      : canvas.status.connected ? { text: 'Connected', cls: 'is-on' }
        : canvas.feed ? { text: 'Calendar link', cls: 'is-on' } : null;

  async function load() {
    const data = await apiFetch('/connectors');
    if (Array.isArray(data?.connectors)) {
      setConnectors(data.connectors);
      if (data.connectors.some(item => item.connected)) walkthroughEvent('connector-connected');
    }
    else { setConnectors([]); setError(data?.detail || "Connectors couldn't load. Try again."); }
    return data?.connectors || [];
  }
  useEffect(() => {
    if (!router.isReady) return;
    load().then(list => {
      const back = router.query.connected;
      const app = list.find(item => item.id === back);
      if (app) setNotice(app.connected ? `${app.name} connected` : `${app.name} didn't finish connecting. Try again.`);
    });
  }, [router.isReady]);

  function say(text) { setNotice(text); setError(''); }
  function fail(text) { setError(text); setNotice(''); }

  async function connect(connector) {
    setBusy(connector.id);
    const data = await apiFetch(`/connectors/${connector.id}/connect`, { method: 'POST' });
    if (data?.redirect_url) { window.location.assign(data.redirect_url); return; }
    setBusy('');
    fail(data?.detail || "That didn't start. Try again in a minute.");
  }

  async function disconnect() {
    const connector = removing;
    setRemoving(null);
    setBusy(connector.id);
    const data = await apiFetch(`/connectors/${connector.id}`, { method: 'DELETE' });
    setBusy('');
    if (data?.ok) { await load(); say(`${connector.name} disconnected`); }
    else fail(data?.detail || "That didn't disconnect. Try again.");
  }

  async function setSync(connector, on) {
    setBusy(connector.id);
    const data = on ? await syncOn(connector.id) : await syncOff(connector.id);
    setBusy('');
    if (!data || data.detail) { fail(data?.detail || "That didn't work. Try again."); return; }
    await load();
    const place = `Cordia ${SYNC_APPS[connector.id]}`;
    say(on ? `${connector.name} is syncing to your ${place}` : `Stopped syncing. Your ${place} stays in ${connector.name} for you to keep or delete.`);
  }

  async function subscribe(connector) {
    setBusy(connector.id);
    const data = await apiFetch('/connectors/apple_calendar/feed');
    setBusy('');
    if (!data?.webcal_url) { fail(data?.detail || "That didn't open. Try again."); return; }
    setFeed(data.url);
    window.location.assign(data.webcal_url);
  }

  async function copyFeed() {
    try { await navigator.clipboard.writeText(feed); say('Calendar link copied'); } catch { fail('Copy the link above by hand.'); }
  }

  // Switches an app on or off for the Tutor or Cordia Assistant; it stays connected either way.
  async function setUse(connector, use, on) {
    const before = connector.uses;
    const flip = item => (item.id === connector.id ? { ...item, uses: { ...item.uses, [use]: on } } : item);
    setConnectors(list => list.map(flip));
    const data = await apiFetch(`/connectors/${connector.id}/uses`, { method: 'PATCH', body: JSON.stringify({ [use]: on }) });
    if (data?.uses) { setConnectors(list => list.map(item => (item.id === connector.id ? { ...item, uses: { ...item.uses, ...data.uses } } : item))); return; }
    setConnectors(list => list.map(item => (item.id === connector.id ? { ...item, uses: before } : item)));
    fail(data?.detail || "That didn't save. Try again.");
  }

  function uses(connector) {
    const list = Object.keys(connector.uses || {});
    if (!connector.connected || !list.length) return null;
    return (
      <div className="cn-uses" role="group" aria-label={`Where ${connector.name} is used`}>
        {list.includes('tutor') && <Toggle label="Use in Tutor" checked={connector.uses.tutor} onChange={on => setUse(connector, 'tutor', on)} />}
        {list.includes('assistant') && <Toggle label="Use in Cordia Assistant" checked={connector.uses.assistant} onChange={on => setUse(connector, 'assistant', on)} />}
      </div>
    );
  }

  function actions(connector) {
    const working = busy === connector.id;
    if (connector.id === 'apple_calendar') {
      return <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => subscribe(connector)}>{working ? 'Opening…' : 'Subscribe'}</button>;
    }
    if (!connector.available) return <span className="c-meta">Coming soon</span>;
    if (!connector.connected) {
      return <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => connect(connector)}>{working ? 'Opening…' : 'Connect'}</button>;
    }
    return (
      <>
        {SYNC_APPS[connector.id] && (connector.health?.sync_on ? (
          <>
            <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => setSync(connector, true)}>{working ? 'Syncing…' : 'Sync now'}</button>
            <button type="button" className="c-btn c-btn--secondary" disabled={working} onClick={() => setSync(connector, false)}>Stop syncing</button>
          </>
        ) : (
          <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => setSync(connector, true)}>{working ? 'Setting up…' : `Sync to a Cordia ${SYNC_APPS[connector.id]}`}</button>
        ))}
        {IMPORTS.includes(connector.id) && (
          <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => { setOpen(null); setImporting(connector); }}>Import</button>
        )}
        <button type="button" className="c-btn c-btn--quiet" disabled={working} onClick={() => { setOpen(null); setRemoving(connector); }}>Disconnect</button>
      </>
    );
  }

  function tile(connector) {
    const soon = connector.id !== 'apple_calendar' && !connector.available;
    return (
      <li key={connector.id}>
        <button type="button" className={'cn-tile' + (soon ? ' is-soon' : '')} onClick={() => { walkthroughEvent('connector-opened'); setOpen(connector.id); setError(''); setNotice(''); }}>
          <ConnectorIcon id={connector.id} />
          <span className="cn-tile-text">
            <span className="cn-name">{connector.name}</span>
            <span className="cn-tag">{connector.tagline}</span>
          </span>
          {connector.connected && (connector.health?.needs_reconnect
            ? <span className="cn-badge is-warn">Reconnect</span>
            : <span className="cn-badge is-on">{connector.health?.sync_on ? 'Syncing' : 'Connected'}</span>)}
          {soon && <span className="cn-badge">Soon</span>}
          <ChevronRight className="cn-chev" size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </li>
    );
  }

  const active = open && open !== 'canvas' && connectors?.find(item => item.id === open);
  return (
    <div className="c-card cn-card">
      <h2 className="c-section-title">Connect your apps</h2>
      <p className="c-meta">Tap one to see what it does and how to connect it. Once it's connected, choose whether the Tutor and Cordia Assistant use it.</p>
      {connectors === null ? <SectionLoader label="Loading connectors" /> : (
        <ul className="cn-grid" data-spot="connectors">
          {canvas && (
            <li>
              <button type="button" className="cn-tile" onClick={() => { walkthroughEvent('connector-opened'); setOpen('canvas'); setShowClasses(false); setError(''); setNotice(''); }}>
                <ConnectorIcon id="canvas" />
                <span className="cn-tile-text">
                  <span className="cn-name">Canvas</span>
                  <span className="cn-tag">{canvas.status.connected ? canvas.status.domain : 'Bring in your classes and deadlines.'}</span>
                </span>
                {canvasBadge && <span className={`cn-badge ${canvasBadge.cls}`}>{canvasBadge.text}</span>}
                <ChevronRight className="cn-chev" size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          )}
          {connectors.filter(item => CLASSROOM_APPS.includes(item.id)).map(tile)}
        </ul>
      )}
      {connectors?.some(item => !CLASSROOM_APPS.includes(item.id)) && (
        <>
          <h3 className="cn-group-title">For texting with Cordia Assistant</h3>
          <ul className="cn-grid">{connectors.filter(item => !CLASSROOM_APPS.includes(item.id)).map(tile)}</ul>
        </>
      )}
      {!open && notice && <p className="cn-notice" role="status">{notice}</p>}
      {!open && error && <p className="cn-error" role="alert">{error}</p>}
      {open === 'canvas' && canvas && (
        <BodyPortal>
          <div className="c-scrim" onClick={() => { setOpen(null); loadCanvas(); }}>
            <div className="c-sheet cn-detail is-canvas" role="dialog" aria-modal="true" aria-labelledby="cn-canvas-title" onClick={event => event.stopPropagation()}>
              <button type="button" className="c-icon-btn cn-close" onClick={() => { setOpen(null); loadCanvas(); }} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
              <ConnectorIcon id="canvas" size="lg" />
              <h2 id="cn-canvas-title" className="c-section-title">Canvas</h2>
              {canvasBadge && <span className={`cn-badge ${canvasBadge.cls}`}>{canvasBadge.text}</span>}
              <p className="cn-detail-text">{DETAILS.canvas}</p>
              {canvas.status.connected && (canvas.status.sync_error || canvas.status.last_synced_at) && (
                <p className={'c-meta cn-health' + (canvas.status.sync_error ? ' is-error' : '')}>
                  {canvas.status.sync_error || healthLine({ last_synced_at: canvas.status.last_synced_at, stats: canvas.status.stats })}
                </p>
              )}
              {canvas.status.connected && (
                <p className="c-meta cn-canvas-meta">{canvas.status.domain} · •••• {canvas.status.last4}{canvas.status.expires_at ? ` · Expires ${displayDate(canvas.status.expires_at)}` : ''}</p>
              )}
              {canvas.feed && !canvas.status.connected && <p className="c-meta">Your deadlines come from a calendar link. An access token also brings what you turned in, grades and course files.</p>}
              <div className="cn-actions">{canvasActions()}</div>
              {showClasses && canvas.status.connected && (
                <div className="cn-canvas-classes">
                  <CanvasCourseList courses={canvas.status.courses} onChange={next => setCanvas(current => ({ ...current, status: next }))} />
                </div>
              )}
              {!canvas.status.connected && !canvas.feed && (
                <p className="c-meta">School blocks access tokens? Use a calendar link instead: on the Canvas page, open Calendar.</p>
              )}
              {notice && <p className="cn-notice" role="status">{notice}</p>}
              {error && <p className="cn-error" role="alert">{error}</p>}
            </div>
          </div>
        </BodyPortal>
      )}
      {active && (
        <BodyPortal>
          <div className="c-scrim" onClick={() => setOpen(null)}>
            <div className="c-sheet cn-detail" role="dialog" aria-modal="true" aria-labelledby="cn-detail-title" onClick={event => event.stopPropagation()}>
              <button type="button" className="c-icon-btn cn-close" onClick={() => setOpen(null)} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
              <ConnectorIcon id={active.id} size="lg" />
              <h2 id="cn-detail-title" className="c-section-title">{active.name}</h2>
              {active.connected && <span className="cn-badge is-on">Connected</span>}
              <p className="cn-detail-text">{DETAILS[active.id]}</p>
              {active.connected && (active.health?.error || healthLine(active.health)) && (
                <p className={'c-meta cn-health' + (active.health?.error ? ' is-error' : '')}>
                  {active.health?.needs_reconnect ? `${active.health.error} Disconnect and connect it again.` : active.health?.error || healthLine(active.health)}
                </p>
              )}
              {uses(active)}
              <div className="cn-actions">{actions(active)}</div>
              {active.id === 'apple_calendar' && feed && (
                <div className="cn-feed">
                  <p className="c-meta">If Calendar didn't open, add this link in Calendar → File → New Calendar Subscription, or on iPhone in Settings → Calendar → Accounts → Add Subscribed Calendar.</p>
                  <div className="cn-feed-row">
                    <input className="c-input" readOnly value={feed} aria-label="Calendar link" onFocus={event => event.target.select()} />
                    <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={copyFeed}><Copy size={18} strokeWidth={1.75} aria-hidden="true" />Copy</button>
                  </div>
                </div>
              )}
              {active.id === 'apple_calendar' && <AssistantAppleCalendar />}
              {active.id === 'gdrive' && active.connected && <DriveFolders />}
              {notice && <p className="cn-notice" role="status">{notice}</p>}
              {error && <p className="cn-error" role="alert">{error}</p>}
            </div>
          </div>
        </BodyPortal>
      )}
      {canvasConnecting && (
        <CanvasConnectSheet
          school={school()}
          initialDomain={canvas?.status?.domain || ''}
          onClose={() => setCanvasConnecting(false)}
          onConnected={() => { setCanvasConnecting(false); loadCanvas(); say('Canvas connected'); }}
        />
      )}
      {canvasRemoving && (
        <ConfirmDialog
          title="Disconnect Canvas?"
          message="Your classes and guides stay. Deadlines, grades and files stop updating until you connect again."
          confirmLabel="Disconnect"
          onConfirm={disconnectCanvas}
          onCancel={() => setCanvasRemoving(false)}
        />
      )}
      {importing && <ImportSheet connector={importing} onClose={() => setImporting(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Disconnect ${removing.name}?`}
          message="Cordia stops using it right away, here and in Cordia Assistant. You can connect it again any time."
          confirmLabel="Disconnect"
          onConfirm={disconnect}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
