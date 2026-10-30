import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { getToken, tryRefreshToken } from '../lib/api';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/supabase';
import { agoLabel } from '../lib/studyPlans';
import { clientName, oauthApi } from '../lib/oauthConsent.mjs';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const day = iso => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

// AI apps (Claude, ChatGPT…) the student has let into Cordia through the consent page, with a
// Disconnect that revokes the grant: the app's tokens stop working on its next request. Hidden
// until an app is connected.
export default function ConnectedApps() {
  const api = useMemo(() => oauthApi({ supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, getToken, refresh: tryRefreshToken }), []);
  const [apps, setApps] = useState(null);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [status, setStatus] = useState('');

  async function load() {
    const [grants, activity] = await Promise.all([api.grants(), api.lastUsed()]).catch(() => [{ ok: false }, { ok: false }]);
    // 404: the OAuth server isn't switched on for this project, so nothing can be connected.
    if (!grants.ok && grants.status !== 404) { setFailed(true); return; }
    const used = new Map((activity.ok && Array.isArray(activity.data) ? activity.data : []).map(row => [row.client_id, row.last_used_at]));
    setFailed(false);
    setApps((grants.ok && Array.isArray(grants.data) ? grants.data : []).map(grant => ({
      id: grant.client?.id || grant.client?.client_id,
      name: clientName(grant.client),
      grantedAt: grant.granted_at,
      lastUsed: used.get(grant.client?.id || grant.client?.client_id) || '',
    })).filter(app => app.id));
  }

  useEffect(() => { load(); }, []);

  // Nothing connected (or the OAuth server is off): no card, so Settings looks as before.
  if (!failed && !apps?.length && !status) return null;

  async function disconnect() {
    const app = removing;
    setRemoving(null);
    const { ok } = await api.revoke(app.id).catch(() => ({ ok: false }));
    setStatus(ok ? `${app.name} was disconnected.` : `${app.name} couldn't be disconnected. Try again.`);
    if (ok) setApps(list => list.filter(item => item.id !== app.id));
  }

  return (
    <section className="c-card ca" aria-labelledby="ca-title">
      <div className="ca-head">
        <span className="ca-title"><Bot {...ICON} /><h2 id="ca-title" className="c-section-title">Connected AI apps</h2></span>
        <p className="c-meta">Apps like Claude that you let read your study material and add to your Library. They can't see your Canvas data, texts or other connected accounts.</p>
      </div>
      {failed && <p className="c-meta" role="alert">Connected apps couldn't load. <button type="button" className="ca-retry" onClick={load}>Try again</button></p>}
      {!failed && apps && !apps.length && <p className="c-meta">No apps are connected.</p>}
      {!failed && apps?.length > 0 && (
        <ul className="ca-list">
          {apps.map(app => (
            <li key={app.id} className="ca-row">
              <span className="ca-name">{app.name}</span>
              <span className="c-meta">Connected {app.grantedAt ? day(app.grantedAt) : ''}{app.lastUsed ? ` · Last used ${agoLabel(app.lastUsed)}` : ' · Not used yet'}</span>
              <button type="button" className="c-btn c-btn--secondary ca-disconnect" onClick={() => setRemoving(app)} aria-label={`Disconnect ${app.name}`}>Disconnect</button>
            </li>
          ))}
        </ul>
      )}
      <p className="c-meta ca-status" role="status">{status}</p>
      {removing && (
        <ConfirmDialog
          title={`Disconnect ${removing.name}?`}
          message="It loses access to Cordia right away. Anything it already added to your Library stays."
          confirmLabel="Disconnect"
          onConfirm={disconnect}
          onCancel={() => setRemoving(null)}
        />
      )}
      <style jsx>{`
        .ca { display: grid; gap: 14px; padding: 20px 24px; }
        .ca-head { display: grid; gap: 6px; }
        .ca-title { display: inline-flex; align-items: center; gap: 10px; }
        .ca-title h2 { margin: 0; }
        .ca-title :global(.lucide) { color: var(--olive-ink); }
        .ca-head .c-meta { margin: 0; }
        .ca-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
        .ca-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'name action' 'meta action'; align-items: center; column-gap: 12px; row-gap: 2px; padding: 12px 0; border-top: 1px solid var(--hairline); }
        .ca-name { grid-area: name; font: 600 15px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
        .ca-row .c-meta { grid-area: meta; }
        .ca-disconnect { grid-area: action; }
        .ca-status:empty { display: none; }
        .ca-retry { padding: 0; border: 0; background: none; color: var(--olive-ink); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; }
      `}</style>
    </section>
  );
}
