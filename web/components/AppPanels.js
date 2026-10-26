import { useEffect, useState } from 'react';
import { ExternalLink, Hash, RefreshCw, Search, Send, Table2, X } from 'lucide-react';
import css from 'styled-jsx/css';
import Toggle from './Toggle';
import { apiErrorMessage } from '../lib/api';
import {
  agoLabel, setSlackWatched, sheetsAuto, sheetsExport, sheetsStatus, slackChannels, slackCheck, slackSession, slackWatched,
} from '../lib/studyPlans';

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const PANEL_CSS = css`
  .ap { display: grid; gap: 10px; width: 100%; padding-top: 12px; border-top: 1px solid var(--hairline); text-align: left; }
  .ap-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
  .ap .c-meta { margin: 0; }
  .ap :global(.c-toggle) { justify-content: space-between; width: 100%; }
  .ap-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .ap-list { list-style: none; margin: 0; padding: 0; display: grid; }
  .ap-row { display: flex; align-items: center; gap: 10px; min-height: 44px; min-width: 0; }
  .ap-results { max-height: 220px; overflow: auto; }
  .ap-form { display: grid; gap: 10px; }
  .ap-field { display: grid; gap: 6px; }
  .ap-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 520px) { .ap-two { grid-template-columns: 1fr; } }
`;

// In the Google Sheets sheet: grades and study time in a spreadsheet the student owns.
export function SheetsExport() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { sheetsStatus().then(data => setStatus(data && !data.detail ? data : { auto: false })); }, []);

  async function exportNow() {
    setBusy('export'); setError(''); setNotice('');
    const data = await sheetsExport();
    setBusy('');
    if (!data?.url) { setError(apiErrorMessage(data?.detail, "That didn't export. Try again.")); return; }
    setStatus(current => ({ ...current, url: data.url, last: new Date().toISOString() }));
    setNotice(`Exported ${data.classes} class${data.classes === 1 ? '' : 'es'} and ${data.days} day${data.days === 1 ? '' : 's'} of study time.`);
  }

  async function setAuto(on) {
    setBusy('auto'); setError('');
    const data = await sheetsAuto(on);
    setBusy('');
    if (data && !data.detail) setStatus(data);
    else setError(apiErrorMessage(data?.detail, "That didn't save. Try again."));
  }

  if (!status) return null;
  return (
    <div className="ap">
      <h3 className="ap-title">Grades and study time</h3>
      <p className="c-meta">One spreadsheet with two tabs: each class's current grade from Canvas, and the minutes you studied each day.</p>
      <div className="ap-actions">
        <button type="button" className="c-btn c-btn--secondary" disabled={Boolean(busy)} onClick={exportNow}>
          <Table2 {...ICON} />{busy === 'export' ? 'Exporting…' : status.url ? 'Update it now' : 'Export to Sheets'}
        </button>
        {status.url && <a className="c-btn c-btn--quiet" href={status.url} target="_blank" rel="noreferrer"><ExternalLink {...ICON} />Open sheet</a>}
      </div>
      <Toggle label="Keep it updated daily" checked={Boolean(status.auto)} disabled={Boolean(busy)} onChange={setAuto} />
      {status.last && <p className="c-meta">Last updated {agoLabel(status.last)}</p>}
      {notice && <p className="cn-notice" role="status">{notice}</p>}
      {error && <p className="cn-error" role="alert">{error}</p>}
      <style jsx>{PANEL_CSS}</style>
    </div>
  );
}

// "2026-10-28T19:00" in the student's own time, for the datetime-local default an hour from now.
function localInput(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// In the Slack sheet: channels Cordia watches for date changes and class announcements, and a
// study session posted to a channel (with a reminder before it starts).
export function SlackPanel() {
  const [watched, setWatched] = useState(null);
  const [channels, setChannels] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [session, setSession] = useState(null); // the form, when open

  useEffect(() => { slackWatched().then(data => setWatched(Array.isArray(data?.channels) ? data.channels : [])); }, []);

  // Channels load once (Slack lists them all); the search box filters here.
  useEffect(() => {
    if ((!picking && !session) || channels) return;
    slackChannels('').then(data => {
      if (Array.isArray(data?.channels)) setChannels(data.channels);
      else { setChannels([]); setError(apiErrorMessage(data?.detail, "Slack couldn't be reached. Try again.")); }
    });
  }, [picking, session, channels]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const watchedIds = new Set((watched || []).map(c => c.id));
  const matches = (channels || []).filter(c => !watchedIds.has(c.id) && words.every(w => c.name.toLowerCase().includes(w)));

  async function save(next, message) {
    setBusy('watch'); setError(''); setNotice('');
    const data = await setSlackWatched(next.map(({ id, name }) => ({ id, name })));
    setBusy('');
    if (!Array.isArray(data?.channels)) { setError(apiErrorMessage(data?.detail, "That didn't save. Try again.")); return; }
    setWatched(data.channels);
    setNotice(message);
  }

  async function checkNow() {
    setBusy('check'); setError(''); setNotice('');
    const data = await slackCheck();
    setBusy('');
    if (typeof data?.checked !== 'number') { setError(apiErrorMessage(data?.detail, "Slack couldn't be reached. Try again.")); return; }
    const found = (data.found || 0) + (data.posted || 0);
    setNotice(found ? `${found} new thing${found === 1 ? '' : 's'} on your Dashboard.` : `Read ${data.checked} new message${data.checked === 1 ? '' : 's'}. Nothing about classwork.`);
  }

  function openSession() {
    const start = new Date(Date.now() + 60 * 60000);
    start.setMinutes(0, 0, 0);
    setSession({ channel: (watched || [])[0]?.id || '', topic: '', when: localInput(start), place: '', remind: '60' });
    setError(''); setNotice('');
  }

  async function post(event) {
    event.preventDefault();
    const at = new Date(session.when);
    const channel = (channels || []).find(c => c.id === session.channel) || (watched || []).find(c => c.id === session.channel);
    if (!channel) { setError('Pick a channel.'); return; }
    if (Number.isNaN(at.getTime())) { setError('Pick a time.'); return; }
    setBusy('post'); setError('');
    const whenLabel = at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const data = await slackSession({ channel: { id: channel.id, name: channel.name }, topic: session.topic.trim(), when: at.toISOString(), whenLabel, place: session.place.trim(), remindMinutes: Number(session.remind) || null });
    setBusy('');
    if (!data?.posted) { setError(apiErrorMessage(data?.detail, "That didn't post. Try again.")); return; }
    setSession(null);
    setNotice(`Posted to #${channel.name}.${data.reminder_at ? ` Cordia will remind the channel ${new Date(data.reminder_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}`);
  }

  if (watched === null) return null;
  const sessionChannels = [...(watched || []), ...(channels || []).filter(c => !watchedIds.has(c.id))];
  return (
    <div className="ap">
      <h3 className="ap-title">Class channels</h3>
      <p className="c-meta">Pick your class and study-group channels. When someone posts that an exam moved, it shows on your Dashboard to confirm; class announcements show there too.</p>
      {watched.length > 0 && (
        <ul className="ap-list">
          {watched.map(channel => (
            <li key={channel.id} className="ap-row">
              <Hash {...ICON} /><span className="c-grow c-truncate">{channel.name}</span>
              <button type="button" className="c-icon-btn" aria-label={`Stop watching #${channel.name}`} disabled={Boolean(busy)}
                onClick={() => save(watched.filter(c => c.id !== channel.id), `Stopped watching #${channel.name}.`)}><X {...ICON} /></button>
            </li>
          ))}
        </ul>
      )}
      {picking ? (
        <>
          <label className="cn-search">
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            <input className="c-input" type="search" autoFocus placeholder="Search channels" aria-label="Search Slack channels" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {channels === null ? <p className="c-meta">Loading channels…</p> : matches.length ? (
            <div className="c-list ap-results">
              {matches.slice(0, 20).map(channel => (
                <button key={channel.id} type="button" className="c-list-row cn-result" disabled={Boolean(busy) || watched.length >= 10}
                  onClick={() => save([...watched, channel], `Watching #${channel.name}. New posts are read every 30 minutes.`)}>
                  <span className="c-grow"><span className="cn-row-title c-truncate">#{channel.name}</span>{!channel.member && <span className="c-meta">you're not in it</span>}</span>
                </button>
              ))}
            </div>
          ) : <p className="c-meta">No channels found.</p>}
          <button type="button" className="c-btn c-btn--quiet c-btn--sm" style={{ justifySelf: 'start' }} onClick={() => { setPicking(false); setQuery(''); }}>Done</button>
        </>
      ) : (
        <div className="ap-actions">
          <button type="button" className="c-btn c-btn--secondary" disabled={Boolean(busy) || watched.length >= 10} onClick={() => setPicking(true)}><Hash {...ICON} />Watch a channel</button>
          {watched.length > 0 && <button type="button" className="c-btn c-btn--quiet" disabled={Boolean(busy)} onClick={checkNow}><RefreshCw {...ICON} />{busy === 'check' ? 'Reading…' : 'Check now'}</button>}
        </div>
      )}

      <h3 className="ap-title">Study sessions</h3>
      {session ? (
        <form className="ap-form" onSubmit={post}>
          <label className="ap-field"><span className="c-meta">Channel</span>
            <select className="c-input" value={session.channel} onChange={event => setSession({ ...session, channel: event.target.value })} required>
              <option value="">{channels === null ? 'Loading channels…' : 'Pick a channel'}</option>
              {sessionChannels.map(channel => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </label>
          <label className="ap-field"><span className="c-meta">What you're studying</span>
            <input className="c-input" required maxLength={120} placeholder="Midterm review, chapters 4–6" value={session.topic} onChange={event => setSession({ ...session, topic: event.target.value })} />
          </label>
          <div className="ap-two">
            <label className="ap-field"><span className="c-meta">When</span>
              <input className="c-input" type="datetime-local" required value={session.when} onChange={event => setSession({ ...session, when: event.target.value })} />
            </label>
            <label className="ap-field"><span className="c-meta">Remind the channel</span>
              <select className="c-input" value={session.remind} onChange={event => setSession({ ...session, remind: event.target.value })}>
                <option value="">No reminder</option>
                <option value="15">15 min before</option>
                <option value="60">1 hour before</option>
                <option value="1440">1 day before</option>
              </select>
            </label>
          </div>
          <label className="ap-field"><span className="c-meta">Where (optional)</span>
            <input className="c-input" maxLength={120} placeholder="Library, 2nd floor, or a Zoom link" value={session.place} onChange={event => setSession({ ...session, place: event.target.value })} />
          </label>
          <div className="ap-actions">
            <button type="submit" className="c-btn c-btn--primary" disabled={Boolean(busy)}><Send {...ICON} />{busy === 'post' ? 'Posting…' : 'Post it'}</button>
            <button type="button" className="c-btn c-btn--quiet" onClick={() => setSession(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="c-meta">Post a session to a channel so people can join, with a reminder before it starts.</p>
          <div className="ap-actions"><button type="button" className="c-btn c-btn--secondary" disabled={Boolean(busy)} onClick={openSession}><Send {...ICON} />Post a study session</button></div>
        </>
      )}
      {notice && <p className="cn-notice" role="status">{notice}</p>}
      {error && <p className="cn-error" role="alert">{error}</p>}
      <style jsx>{PANEL_CSS}</style>
    </div>
  );
}
