import { useEffect, useState } from 'react';
import { useRequireAuth } from '../lib/auth';
import { apiFetch, apiErrorMessage } from '../lib/api';
import Toggle from '../components/Toggle';

const REASON = { wrong: 'Wrong', copied_exam: 'Copied exam', copyright: 'Copyright', inappropriate: 'Inappropriate' };

// Review queue for admins: reports, held sets, merge proposals, takedowns, school policy.
export default function Admin() {
  const { ready } = useRequireAuth();
  const [allowed, setAllowed] = useState(null);
  const [queue, setQueue] = useState(null);
  const [policy, setPolicy] = useState({ domain: '', school_name: '', tokens_allowed: false, source_url: '' });
  const [message, setMessage] = useState('');

  async function load() {
    const data = await apiFetch('/admin/queue');
    if (data?.policy) setQueue(data);
  }

  useEffect(() => {
    if (!ready) return;
    apiFetch('/admin/me').then(data => {
      setAllowed(Boolean(data?.admin));
      if (data?.admin) load();
    });
  }, [ready]);

  async function act(path, body) {
    const data = await apiFetch(path, { method: path.startsWith('/admin/policy/') ? 'DELETE' : body ? 'POST' : 'DELETE', body: body ? JSON.stringify(body) : undefined });
    setMessage(data?.ok ? 'Saved' : apiErrorMessage(data?.detail));
    load();
  }

  async function savePolicy(row) {
    const data = await apiFetch('/admin/policy', { method: 'PUT', body: JSON.stringify({ ...row, source_url: row.source_url || null }) });
    setMessage(data?.ok ? 'Saved' : apiErrorMessage(data?.detail));
    if (data?.ok) { setPolicy({ domain: '', school_name: '', tokens_allowed: false, source_url: '' }); load(); }
  }

  if (!ready || allowed === null) return null;
  if (!allowed) return <div className="c-page"><h1 className="c-title">Admin</h1><p className="adm-line">Admins only</p></div>;

  return (
    <div className="c-page adm">
      <header className="c-page-head"><h1 className="c-title">Review</h1></header>
      {message && <p className="adm-line" role="status">{message}</p>}
      {!queue ? <div className="c-skeleton" style={{ height: 200, borderRadius: 20 }} /> : (
        <>
          <section className="c-card adm-card" aria-labelledby="adm-sets">
            <h2 id="adm-sets" className="c-section-title">Sets</h2>
            {queue.sets.length ? queue.sets.map(item => (
              <div key={item.id} className="adm-row">
                <span className="adm-main">
                  <strong>{item.title}</strong>
                  <span className="c-meta">{[item.class, item.status, item.hold_reason, item.reports && `${item.reports.count} reports: ${Object.entries(item.reports.reasons).map(([k, n]) => `${REASON[k] || k} ${n}`).join(', ')}`].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="c-btn c-btn--secondary" onClick={() => act(`/admin/sets/${item.id}`, { status: 'visible' })}>Restore</button>
                <button type="button" className="c-btn c-btn--quiet adm-danger" onClick={() => act(`/admin/sets/${item.id}`, { status: 'hidden' })}>Hide</button>
              </div>
            )) : <p className="c-meta">Empty</p>}
          </section>

          <section className="c-card adm-card" aria-labelledby="adm-merges">
            <h2 id="adm-merges" className="c-section-title">Merges</h2>
            {queue.merges.length ? queue.merges.map(item => (
              <div key={item.id} className="adm-row">
                <span className="adm-main"><strong>{item.raw_code}</strong><span className="c-meta">{item.from} → {item.into || '?'} · {Math.round(item.confidence * 100)}%</span></span>
                <button type="button" className="c-btn c-btn--secondary" disabled={!item.into} onClick={() => act(`/admin/merges/${item.id}`, { approve: true })}>Merge</button>
                <button type="button" className="c-btn c-btn--quiet" onClick={() => act(`/admin/merges/${item.id}`, { approve: false })}>Keep apart</button>
              </div>
            )) : <p className="c-meta">Empty</p>}
          </section>

          <section className="c-card adm-card" aria-labelledby="adm-takedowns">
            <h2 id="adm-takedowns" className="c-section-title">Takedowns</h2>
            {queue.takedowns.length ? queue.takedowns.map(item => (
              <div key={item.id} className="adm-row">
                <span className="adm-main"><strong>{item.claimant_name} · {item.claimant_email}</strong><span className="c-meta">{item.work_description} · {item.location}</span></span>
                <button type="button" className="c-btn c-btn--secondary" onClick={() => act(`/admin/takedowns/${item.id}`, { action: 'actioned' })}>Keep down</button>
                <button type="button" className="c-btn c-btn--quiet" onClick={() => act(`/admin/takedowns/${item.id}`, { action: 'rejected' })}>Reject</button>
              </div>
            )) : <p className="c-meta">Empty</p>}
          </section>

          <section className="c-card adm-card" aria-labelledby="adm-policy">
            <h2 id="adm-policy" className="c-section-title">School policy</h2>
            {queue.policy.map(row => (
              <div key={row.domain} className="adm-row">
                <span className="adm-main"><strong>{row.domain}</strong><span className="c-meta">{row.school_name}</span></span>
                <Toggle label="Tokens" checked={row.tokens_allowed} onChange={value => savePolicy({ ...row, tokens_allowed: value })} />
                <button type="button" className="c-btn c-btn--quiet adm-danger" onClick={() => act(`/admin/policy/${encodeURIComponent(row.domain)}`)}>Remove</button>
              </div>
            ))}
            <form className="adm-add" onSubmit={event => { event.preventDefault(); if (policy.domain.trim()) savePolicy(policy); }}>
              <input className="c-input" placeholder="canvas.school.edu" aria-label="Canvas domain" value={policy.domain} onChange={event => setPolicy({ ...policy, domain: event.target.value })} />
              <input className="c-input" placeholder="School" aria-label="School name" value={policy.school_name} onChange={event => setPolicy({ ...policy, school_name: event.target.value })} />
              <input className="c-input" placeholder="https://" aria-label="Source" value={policy.source_url} onChange={event => setPolicy({ ...policy, source_url: event.target.value })} />
              <Toggle label="Tokens" checked={policy.tokens_allowed} onChange={value => setPolicy({ ...policy, tokens_allowed: value })} />
              <button type="submit" className="c-btn c-btn--primary" disabled={!policy.domain.trim()}>Add</button>
            </form>
          </section>
        </>
      )}
      <style jsx global>{`
        .adm-card { display: grid; gap: 4px; padding: 20px 24px; }
        .adm-card h2 { margin: 0 0 8px; }
        .adm-row { display: flex; align-items: center; gap: 8px; min-height: 64px; border-top: 1px solid var(--line); flex-wrap: wrap; }
        .adm-main { flex: 1; display: grid; gap: 2px; min-width: 220px; }
        .adm-main strong { font: 600 15px/1.3 var(--font-sans); overflow-wrap: anywhere; }
        .adm-main .c-meta { overflow-wrap: anywhere; }
        .adm-danger { color: var(--error); }
        .adm-line { margin: 0; font: 600 15px/1.4 var(--font-sans); }
        .adm-add { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--line); }
        @media (max-width: 767px) { .adm-add { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </div>
  );
}
