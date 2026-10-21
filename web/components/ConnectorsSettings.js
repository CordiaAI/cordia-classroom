import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronRight, Copy, Search, X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import ConfirmDialog from './ConfirmDialog';
import { SectionLoader } from './CordiaLoader';
import { apiFetch } from '../lib/api';
import { BRAND_PATHS } from '../lib/brandIcons';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
// What each app does here, shown in its sheet.
const DETAILS = {
  gcal: 'Adds each upcoming deadline to your Google Calendar as a 30-minute event ending when it is due. Run it again any time: deadlines already there are skipped.',
  apple_calendar: 'Subscribes your Apple Calendar to your deadlines. It refreshes every hour on your iPhone, iPad and Mac. No Apple password needed.',
  gtasks: 'Adds each upcoming deadline to Google Tasks as a to-do due that day. To-dos already there are skipped.',
  gdrive: 'Find a PDF, Word, PowerPoint or Google Doc in your Drive and open it in Create, ready to make a guide.',
  gdocs: 'Find a Google Doc and open its text in Create, ready to make a guide.',
  notion: 'Find a Notion page and open it in Create, ready to make a guide. Share the page with Cordia in Notion first.',
};

// The app's logo on a rounded glass tile, like Cordia Assistant. Decorative: the name is beside it.
function ConnectorIcon({ id, size = 'md' }) {
  return (
    <span className={`cn-icon is-${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d={BRAND_PATHS[id] || ''} /></svg>
    </span>
  );
}
const IMPORTS = ['gdrive', 'gdocs', 'notion'];
// Create reads this draft, so an import opens there ready to make a guide.
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

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

  async function load() {
    const data = await apiFetch('/connectors');
    if (Array.isArray(data?.connectors)) setConnectors(data.connectors);
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

  async function sendDeadlines(connector) {
    setBusy(connector.id);
    const data = await apiFetch(`/connectors/${connector.id}/deadlines`, { method: 'POST', body: JSON.stringify({ time_zone: timeZone() }) });
    setBusy('');
    if (typeof data?.added !== 'number') { fail(data?.detail || "That didn't send. Try again."); return; }
    const noun = connector.id === 'gtasks' ? 'to-do' : 'deadline';
    if (data.added) say(`Added ${data.added} ${noun}${data.added === 1 ? '' : 's'} to ${connector.name}`);
    else say(data.skipped ? `${connector.name} already has every upcoming deadline.` : 'No upcoming deadlines to add. Connect Canvas to bring them in.');
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
        {['gcal', 'gtasks'].includes(connector.id) && (
          <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => sendDeadlines(connector)}>{working ? 'Adding…' : connector.id === 'gcal' ? 'Add deadlines' : 'Add to-dos'}</button>
        )}
        {IMPORTS.includes(connector.id) && (
          <button type="button" className="c-btn c-btn--primary" disabled={working} onClick={() => { setOpen(null); setImporting(connector); }}>Import</button>
        )}
        <button type="button" className="c-btn c-btn--quiet" disabled={working} onClick={() => { setOpen(null); setRemoving(connector); }}>Disconnect</button>
      </>
    );
  }

  const active = open && connectors?.find(item => item.id === open);
  return (
    <div className="c-card cn-card">
      <h2 className="c-section-title">Connect your apps</h2>
      <p className="c-meta">Tap one to see what it does and how to connect it. Apps you connect here work in Cordia Assistant too.</p>
      {connectors === null ? <SectionLoader label="Loading connectors" /> : (
        <ul className="cn-grid">
          {connectors.map(connector => {
            const soon = connector.id !== 'apple_calendar' && !connector.available;
            return (
              <li key={connector.id}>
                <button type="button" className={'cn-tile' + (soon ? ' is-soon' : '')} onClick={() => { setOpen(connector.id); setError(''); setNotice(''); }}>
                  <ConnectorIcon id={connector.id} />
                  <span className="cn-tile-text">
                    <span className="cn-name">{connector.name}</span>
                    <span className="cn-tag">{connector.tagline}</span>
                  </span>
                  {connector.connected && <span className="cn-badge is-on">Connected</span>}
                  {soon && <span className="cn-badge">Soon</span>}
                  <ChevronRight className="cn-chev" size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!active && notice && <p className="cn-notice" role="status">{notice}</p>}
      {!active && error && <p className="cn-error" role="alert">{error}</p>}
      {active && (
        <BodyPortal>
          <div className="c-scrim" onClick={() => setOpen(null)}>
            <div className="c-sheet cn-detail" role="dialog" aria-modal="true" aria-labelledby="cn-detail-title" onClick={event => event.stopPropagation()}>
              <button type="button" className="c-icon-btn cn-close" onClick={() => setOpen(null)} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
              <ConnectorIcon id={active.id} size="lg" />
              <h2 id="cn-detail-title" className="c-section-title">{active.name}</h2>
              {active.connected && <span className="cn-badge is-on">Connected</span>}
              <p className="cn-detail-text">{DETAILS[active.id]}</p>
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
              {notice && <p className="cn-notice" role="status">{notice}</p>}
              {error && <p className="cn-error" role="alert">{error}</p>}
            </div>
          </div>
        </BodyPortal>
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
