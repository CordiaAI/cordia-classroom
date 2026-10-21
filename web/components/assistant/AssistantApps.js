import { useEffect, useRef, useState } from 'react';
import { CalendarDays, FileText, FolderOpen, GitPullRequest, HardDrive, ListChecks, Mail, MessagesSquare, NotebookPen, RefreshCw, Sheet, Wallet } from 'lucide-react';
import BodyPortal from '../BodyPortal';
import ConfirmDialog from '../ConfirmDialog';
import Toggle from '../Toggle';
import { assistantApi } from '../../lib/assistant';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
// One icon set (Lucide), so apps show what they are, not their brand marks.
const APP_ICONS = {
  gcal: CalendarDays, icloud_calendar: CalendarDays, gtasks: ListChecks, gdrive: HardDrive, gdocs: FileText,
  gsheets: Sheet, notion: NotebookPen, gmail: Mail, outlook: Mail, slack: MessagesSquare, ynab: Wallet,
  dropbox: FolderOpen, github: GitPullRequest,
};
const CALENDARS = ['gcal', 'icloud_calendar'];

function IcloudSheet({ connector, onClose, onConnected }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    const out = await assistantApi(`/connections/${connector.id}`, { method: 'POST', json: { email, password } });
    setBusy(false);
    if (!out.ok) { setError(out.data.error || "That didn't connect. Try again."); return; }
    onConnected(out.data);
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <form className="c-sheet asst-sheet" role="dialog" aria-modal="true" aria-labelledby="icloud-title" onClick={event => event.stopPropagation()} onSubmit={submit}>
          <h2 id="icloud-title" className="c-title">Connect {connector.name}</h2>
          <p>{connector.never}</p>
          <ol className="c-steps">
            {connector.steps.map((step, index) => (
              <li key={step} className="c-step">
                <span className="c-step-num" aria-hidden="true">{index + 1}</span>
                <p className="c-step-title">{step}</p>
              </li>
            ))}
          </ol>
          <label className="c-field"><span>Apple ID email</span><input ref={firstRef} className="c-input" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="c-field"><span>App-specific password</span><input className="c-input" autoComplete="off" placeholder="xxxx-xxxx-xxxx-xxxx" value={password} onChange={event => setPassword(event.target.value)} /></label>
          {error && <p className="asst-error" role="alert">{error}</p>}
          <div className="asst-sheet-actions">
            <span className="c-grow" />
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="c-btn c-btn--primary" disabled={busy || !email || !password}>{busy ? 'Connecting…' : 'Connect'}</button>
          </div>
        </form>
      </div>
    </BodyPortal>
  );
}

export default function AssistantApps({ view, catalog, setView, save, toast }) {
  const [busy, setBusy] = useState('');
  const [icloud, setIcloud] = useState(null);
  const [removing, setRemoving] = useState(null);
  const status = id => view.connections.find(c => c.provider === id)?.status;
  const settingsFor = id => view.connections.find(c => c.provider === id)?.settings || {};

  async function connect(connector) {
    if (connector.kind === 'icloud') { setIcloud(connector); return; }
    setBusy(connector.id);
    const out = await assistantApi(`/connections/${connector.id}`, { method: 'POST' });
    if (out.ok && out.data.redirect_url) { window.location.assign(out.data.redirect_url); return; }
    setBusy('');
    toast(out.data.error || "That didn't start. Try again in a minute.");
  }

  async function disconnect() {
    const connector = removing;
    setRemoving(null);
    setBusy(connector.id);
    const out = await assistantApi(`/connections/${connector.id}`, { method: 'DELETE' });
    setBusy('');
    if (out.ok) { setView(out.data); toast(`${connector.name} disconnected`); }
    else toast(out.data.error || "That didn't disconnect. Try again.");
  }

  async function setCalendar(provider, id, included) {
    const calendars = (settingsFor(provider).calendars || []).map(cal => ({ id: cal.id, included: cal.id === id ? included : cal.included }));
    const out = await assistantApi(`/connections/${provider}/calendars`, { method: 'PUT', json: { calendars } });
    if (out.ok) setView(out.data);
    else toast(out.data.error || "That didn't save. Try again.");
  }

  async function refreshCalendars(provider) {
    setBusy(provider);
    const out = await assistantApi(`/connections/${provider}/calendars`, { method: 'POST' });
    setBusy('');
    if (out.ok) { setView(out.data); toast('Calendars updated'); }
  }

  const name = view.identity.assistant_name;
  return (
    <div className="c-stack">
      <div className="c-card asst-card">
        <h2 className="c-section-title">Apps</h2>
        <p className="c-meta">Connect an app and {name} can use it when you text: check your calendar, update a sheet, add a task. Canvas deadlines come from your Canvas connection in Classroom.</p>
        <div className="c-list asst-flat-list">
          {catalog.connectors.map(connector => {
            const Icon = APP_ICONS[connector.id] || FolderOpen;
            const state = status(connector.id);
            const connected = state === 'active';
            const available = view.available[connector.id];
            const calendars = connected && CALENDARS.includes(connector.id) ? settingsFor(connector.id).calendars || [] : [];
            return (
              <div key={connector.id} className="asst-app">
                <div className="c-list-row">
                  <Icon {...ICON} />
                  <span className="c-grow asst-app-text">
                    <strong className="asst-row-title">{connector.name}</strong>
                    <span className="c-meta">{connected ? `Connected${settingsFor(connector.id).account_name ? ` · ${settingsFor(connector.id).account_name}` : ''}` : connector.tagline}</span>
                  </span>
                  {connected ? (
                    <button type="button" className="c-btn c-btn--secondary c-btn--sm" disabled={busy === connector.id} onClick={() => setRemoving(connector)}>Disconnect</button>
                  ) : available ? (
                    <button type="button" className="c-btn c-btn--secondary c-btn--sm" disabled={busy === connector.id} onClick={() => connect(connector)}>{busy === connector.id ? 'Opening…' : state === 'pending' ? 'Try again' : 'Connect'}</button>
                  ) : (
                    <span className="c-meta">Coming soon</span>
                  )}
                </div>
                {calendars.length > 0 && (
                  <div className="asst-calendars">
                    {calendars.map(cal => <Toggle key={cal.id} label={cal.name} checked={cal.included} onChange={value => setCalendar(connector.id, cal.id, value)} />)}
                    <button type="button" className="c-btn c-btn--quiet c-btn--sm" disabled={busy === connector.id} onClick={() => refreshCalendars(connector.id)}><RefreshCw {...ICON} />Refresh calendars</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {icloud && <IcloudSheet connector={icloud} onClose={() => setIcloud(null)} onConnected={data => { setIcloud(null); setView(data); toast(`${icloud.name} connected`); }} />}
      {removing && (
        <ConfirmDialog title={`Disconnect ${removing.name}?`} message={`${name} stops using it right away. You can connect it again any time.`} confirmLabel="Disconnect" onConfirm={disconnect} onCancel={() => setRemoving(null)} />
      )}
    </div>
  );
}
