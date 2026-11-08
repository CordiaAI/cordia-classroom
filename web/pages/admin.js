import { useEffect, useState } from 'react';
import { useRequireAuth } from '../lib/auth';
import { apiFetch, apiErrorMessage } from '../lib/api';
import Toggle from '../components/Toggle';
import { SectionLoader } from '../components/CordiaLoader';
import { REASON_LABELS as REASON } from '../lib/reportReasons.mjs';

const TYPES = [['', 'All'], ['guide', 'Guides'], ['profile', 'Profiles'], ['classroom', 'Classrooms']];
const TYPE_NAMES = { guide: 'Guide', profile: 'Profile', classroom: 'Classroom' };
const STATUS = { held: 'Held', hidden: 'Hidden', ok: 'Visible' };

// Review queue for admins: reports (guides, profiles, classrooms; 3 reporters hold one at once),
// held sets, merge proposals, takedowns, school policy.
export default function Admin() {
  const { ready } = useRequireAuth();
  const [allowed, setAllowed] = useState(null);
  const [queue, setQueue] = useState(null);
  const [policy, setPolicy] = useState({ domain: '', school_name: '', tokens_allowed: false, source_url: '' });
  const [message, setMessage] = useState('');
  // Takedowns: "Reporter confirmed by email from support@cordiaai.io", ticked per report.
  const [confirmed, setConfirmed] = useState({});
  const [reportType, setReportType] = useState('');

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
      {!queue ? <SectionLoader label="Loading the review queue" /> : (
        <>
          <section className="c-card adm-card" aria-labelledby="adm-reports">
            <h2 id="adm-reports" className="c-section-title">Reports</h2>
            <div className="c-chips adm-filters" role="group" aria-label="Show reports for">
              {TYPES.map(([key, label]) => {
                const count = (queue.reports || []).filter(item => !key || item.target_type === key).length;
                return <button key={key || 'all'} type="button" className="c-chip" aria-pressed={reportType === key} onClick={() => setReportType(key)}>{label} ({count})</button>;
              })}
            </div>
            {(queue.reports || []).filter(item => !reportType || item.target_type === reportType).map(item => (
              <div key={`${item.target_type}:${item.target_id}`} className="adm-row">
                <span className="adm-main">
                  <strong>{TYPE_NAMES[item.target_type]} · {item.target?.link ? <a href={item.target.link} target="_blank" rel="noreferrer">{item.target.title}</a> : (item.target?.title || 'Gone')}</strong>
                  <span className="c-meta">{[STATUS[item.target?.status] || item.target?.status, `${item.count} ${item.count === 1 ? 'report' : 'reports'}: ${Object.entries(item.reasons).map(([k, n]) => `${REASON[k] || k} ${n}`).join(', ')}`].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="c-btn c-btn--secondary" onClick={() => act(`/admin/reports/${item.target_type}/${item.target_id}`, { decision: 'clear' })}>Clear</button>
                <button type="button" className="c-btn c-btn--quiet adm-danger" onClick={() => act(`/admin/reports/${item.target_type}/${item.target_id}`, { decision: 'hide' })}>Keep hidden</button>
              </div>
            ))}
            {!(queue.reports || []).some(item => !reportType || item.target_type === reportType) && <p className="c-meta">Empty</p>}
          </section>

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

          {(queue.classrooms || []).length > 0 && (
            <section className="c-card adm-card" aria-labelledby="adm-classrooms">
              <h2 id="adm-classrooms" className="c-section-title">Instructor class requests</h2>
              {queue.classrooms.map(item => (
                <div key={item.id} className="adm-row">
                  <span className="adm-main">
                    <strong>{item.name}</strong>
                    <span className="c-meta">{[item.owner?.name, item.owner?.email, item.owner?.username && `@${item.owner.username}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" className="c-btn c-btn--secondary" onClick={() => act(`/admin/classrooms/${item.id}`, { approve: true })}>Approve</button>
                  <button type="button" className="c-btn c-btn--quiet" onClick={() => act(`/admin/classrooms/${item.id}`, { approve: false })}>Decline</button>
                </div>
              ))}
            </section>
          )}

          <section className="c-card adm-card" aria-labelledby="adm-guides">
            <h2 id="adm-guides" className="c-section-title">Guides</h2>
            {(queue.guides || []).length ? queue.guides.map(item => (
              <div key={item.id} className="adm-row">
                <span className="adm-main">
                  <a href={`/sets/${item.id}`} target="_blank" rel="noopener noreferrer"><strong>{item.title || 'Untitled'}</strong></a>
                  <span className="c-meta">{[item.visibility, item.review_status, item.hold_reason].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="c-btn c-btn--secondary" onClick={() => act(`/admin/guides/${item.id}`, { status: 'ok' })}>Release</button>
                <button type="button" className="c-btn c-btn--quiet adm-danger" onClick={() => act(`/admin/guides/${item.id}`, { status: 'hidden' })}>Hide</button>
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
            <p className="c-meta">Nothing is held or removed until you act. Email the reporter from support@cordiaai.io to confirm before taking anything down.</p>
            {queue.takedowns.length ? queue.takedowns.map(item => {
              const target = item.target || {};
              const owner = item.owner ? (item.owner.username ? `@${item.owner.username}` : item.owner.name || item.owner.email || item.owner.id) : 'unknown';
              const seen = target.kind === 'profile'
                ? `profile ${target.profile_visibility || 'visibility unknown'}${target.profile_status && target.profile_status !== 'ok' ? ` (${target.profile_status})` : ''}`
                : [target.guide_visibility && `guide ${target.guide_visibility}${target.guide_status && target.guide_status !== 'ok' ? ` (${target.guide_status})` : ''}`,
                  target.set_visibility && `class set ${target.set_visibility}${target.set_status && target.set_status !== 'visible' ? ` (${target.set_status})` : ''}`].filter(Boolean).join(' · ');
              const ticked = Boolean(confirmed[item.id] || item.confirmed_at);
              return (
                <div key={item.id} className="adm-row adm-takedown">
                  <span className="adm-main">
                    <strong>{item.claimant_name} · {item.claimant_email}</strong>
                    <span className="c-meta">Work claimed: {item.work_description}</span>
                    <span className="c-meta">Link: {item.location}</span>
                    <span className="c-meta">{target.found ? `“${target.title || 'Untitled'}” · ${seen || 'visibility unknown'} · owner ${owner}` : 'No guide, class set or profile matched this link'}{item.duplicate_count ? ` · reported ${item.duplicate_count + 1} times` : ''}{item.held_at ? ' · held while confirming' : ''}</span>
                  </span>
                  <label className="adm-confirm">
                    <input type="checkbox" checked={ticked} disabled={Boolean(item.confirmed_at)} onChange={event => setConfirmed(current => ({ ...current, [item.id]: event.target.checked }))} />
                    Reporter confirmed by email from support@cordiaai.io
                  </label>
                  {target.found && target.kind === 'guide' && !item.held_at && <button type="button" className="c-btn c-btn--quiet" onClick={() => act(`/admin/takedowns/${item.id}/hold`, {})}>Hold while confirming</button>}
                  <button type="button" className="c-btn c-btn--secondary" disabled={!ticked} onClick={() => act(`/admin/takedowns/${item.id}`, { action: 'actioned', reporter_confirmed: ticked })}>Take down</button>
                  <button type="button" className="c-btn c-btn--quiet" onClick={() => act(`/admin/takedowns/${item.id}`, { action: 'rejected' })}>Reject</button>
                </div>
              );
            }) : <p className="c-meta">Empty</p>}
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
        .adm-takedown { align-items: flex-start; padding: 12px 0; }
        .adm-confirm { display: flex; align-items: center; gap: 8px; flex-basis: 100%; font: 500 14px/1.4 var(--font-sans); }
        .adm-confirm input { width: 18px; height: 18px; accent-color: var(--olive); }
        .adm-danger { color: var(--error); }
        .adm-filters { margin-bottom: 4px; }
        .adm-main a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
        .adm-line { margin: 0; font: 600 15px/1.4 var(--font-sans); }
        .adm-add { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto; gap: 8px; align-items: center; padding-top: 12px; border-top: 1px solid var(--line); }
        @media (max-width: 767px) { .adm-add { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </div>
  );
}
