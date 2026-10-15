import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, Bookmark, Check, Flag, Layers } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { apiFetch, apiErrorMessage } from '../../lib/api';
import Menu from '../../components/Menu';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const REASONS = [['wrong', 'Wrong'], ['copied_exam', 'Copied exam'], ['copyright', 'Copyright'], ['inappropriate', 'Inappropriate']];

function dueLabel(iso) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function SetRow({ entry, onSaved, onReported }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const item = entry.versions?.[index] || entry;
  const versions = entry.versions || [entry];

  async function save() {
    if (item.saved) return;
    setBusy(true);
    const data = await apiFetch(`/sharing/sets/${item.id}/save`, { method: 'POST' });
    setBusy(false);
    if (data?.guide_id) { onSaved(item.id); router.push('/guide/' + data.guide_id); }
  }

  async function report(reason) {
    const data = await apiFetch(`/sharing/sets/${item.id}/report`, { method: 'POST', body: JSON.stringify({ reason }) });
    onReported(data?.ok ? 'Reported' : apiErrorMessage(data?.detail, 'Could not report'));
  }

  return (
    <li className="cp-row">
      <span className="cp-main">
        <span className="cp-title c-truncate">{item.title}</span>
        <span className="cp-meta c-meta">
          <span>{item.card_count} cards</span>
          {item.studied_by > 0 && <span>Studied by {item.studied_by}</span>}
          {item.owner_name && <span>{item.owner_name}</span>}
        </span>
      </span>
      {versions.length > 1 && (
        <Menu
          label={`${versions.length} versions`}
          trigger={<span className="cp-versions">{versions.length} versions</span>}
          items={versions.map((version, i) => ({ label: `${version.title} · ${version.card_count} cards`, current: i === index, onSelect: () => setIndex(i) }))}
        />
      )}
      {item.mine ? <span className="c-meta">Yours</span> : (
        <button type="button" className="c-btn c-btn--secondary" onClick={save} disabled={busy || item.saved}>
          {item.saved ? <><Check {...ICON} />Saved</> : <><Bookmark {...ICON} />Save</>}
        </button>
      )}
      {!item.mine && (
        <Menu
          label={`More for ${item.title}`}
          items={[{ label: 'Report', icon: Flag, items: REASONS.map(([key, label]) => ({ label, onSelect: () => report(key) })) }]}
        />
      )}
    </li>
  );
}

export default function ClassPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('sets');
  const [deadlines, setDeadlines] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!ready || !id) return;
    apiFetch('/classes/' + id).then(result => {
      if (result?.class) setData(result);
      else setError(apiErrorMessage(result?.detail, 'Class not found'));
    });
  }, [ready, id]);

  useEffect(() => {
    if (tab === 'deadlines' && !deadlines && id) apiFetch(`/classes/${id}/deadlines`).then(result => setDeadlines(result?.deadlines || []));
  }, [tab, id, deadlines]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!ready) return null;
  const info = data?.class;

  return (
    <div className="c-page cp">
      <header className="cp-head">
        <Link href="/library?tab=classes" className="c-icon-btn" aria-label="Back to classes"><ArrowLeft {...ICON} /></Link>
        <h1 className="c-title cp-heading">{info ? <>{info.code}{info.name && <span> {info.name}</span>}</> : error ? 'Class' : ''}</h1>
      </header>

      {error && <p className="cp-line" role="alert">{error}</p>}

      {info && (
        <>
          <div className="c-seg cp-tabs" role="tablist" aria-label="Class">
            <button type="button" role="tab" aria-selected={tab === 'sets'} className={tab === 'sets' ? 'is-active' : ''} onClick={() => setTab('sets')}>Sets</button>
            <button type="button" role="tab" aria-selected={tab === 'deadlines'} className={tab === 'deadlines' ? 'is-active' : ''} onClick={() => setTab('deadlines')}>Deadlines</button>
          </div>

          {tab === 'sets' ? (
            info.sharing_blocked ? (
              <p className="cp-line">Sharing is off for this class</p>
            ) : data.sets.length ? (
              <ul className="c-card cp-list">
                {data.sets.map(entry => (
                  <SetRow
                    key={entry.id}
                    entry={entry}
                    onSaved={setId => setData(current => ({ ...current, sets: current.sets.map(s => ({ ...s, versions: (s.versions || []).map(v => v.id === setId ? { ...v, saved: true } : v), saved: s.id === setId ? true : s.saved })) }))}
                    onReported={setToast}
                  />
                ))}
              </ul>
            ) : (
              <div className="c-empty"><Layers size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">No shared sets</span></div>
            )
          ) : !deadlines ? (
            <div className="c-skeleton" style={{ height: 120, borderRadius: 20 }} />
          ) : deadlines.length ? (
            <ul className="c-card cp-list">
              {deadlines.map((item, index) => (
                <li key={index} className="cp-row">
                  <span className="cp-main"><span className="cp-title c-truncate">{item.title}</span></span>
                  <span className="c-meta cp-due">{dueLabel(item.due_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cp-line">No deadlines</p>
          )}
        </>
      )}

      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}

      <style jsx global>{`
        .cp-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .cp-heading { min-width: 0; overflow-wrap: anywhere; }
        .cp-heading span { color: var(--muted); }
        .cp-tabs { justify-self: start; }
        .cp-line { margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .cp-list { list-style: none; margin: 0; padding: 8px 8px 8px 24px; display: grid; }
        .cp-row { display: flex; align-items: center; gap: 12px; min-height: 72px; border-bottom: 1px solid var(--line); }
        .cp-row:last-child { border-bottom: 0; }
        .cp-main { flex: 1; display: grid; gap: 4px; min-width: 0; }
        .cp-title { font: 500 17px/1.3 var(--font-display); }
        .cp-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-variant-numeric: tabular-nums; }
        .cp-versions { font: 600 13px/1 var(--font-sans); white-space: nowrap; }
        .cp-row .c-menu-wrap:has(.cp-versions) > .c-icon-btn { width: auto; padding: 0 12px; border-radius: 999px; }
        .cp-due { font-variant-numeric: tabular-nums; padding-right: 16px; white-space: nowrap; }
        @media (max-width: 767px) { .cp-list { padding-left: 16px; } .cp-row { flex-wrap: wrap; padding: 12px 0; } .cp-main { flex-basis: 100%; } }
      `}</style>
    </div>
  );
}
