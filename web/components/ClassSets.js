import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Bookmark, Check, Flag, Layers } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '../lib/api';
import Menu from './Menu';

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

// Sets classmates shared with this class: versions, "Studied by N", Save a copy, Report.
export function ClassSets({ classId, onToast }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!classId) return;
    apiFetch('/classes/' + classId).then(result => setData(result?.class ? result : { error: apiErrorMessage(result?.detail, 'Class not found') }));
  }, [classId]);
  if (!data) return <div className="c-skeleton" style={{ height: 120, borderRadius: 20 }} />;
  if (data.error) return <p className="cp-line" role="alert">{data.error}</p>;
  if (data.class.sharing_blocked) return <p className="cp-line">Sharing is off for this class</p>;
  if (!data.sets.length) return <div className="c-empty"><Layers size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">No shared sets yet</span></div>;
  return (
    <ul className="c-card cp-list">
      {data.sets.map(entry => (
        <SetRow
          key={entry.id}
          entry={entry}
          onSaved={setId => setData(current => ({ ...current, sets: current.sets.map(s => ({ ...s, versions: (s.versions || []).map(v => v.id === setId ? { ...v, saved: true } : v), saved: s.id === setId ? true : s.saved })) }))}
          onReported={onToast}
        />
      ))}
      <ClassStyles />
    </ul>
  );
}

// Your own Canvas deadlines for this class.
export function ClassDeadlines({ classId, deadlines }) {
  if (!classId) return null;
  if (!deadlines) return <div className="c-skeleton" style={{ height: 120, borderRadius: 20 }} />;
  if (!deadlines.length) return <p className="cp-line">No deadlines</p>;
  return (
    <ul className="c-card cp-list">
      {deadlines.map((item, index) => (
        <li key={index} className="cp-row">
          <span className="cp-main"><span className="cp-title c-truncate">{item.title}</span></span>
          <span className="c-meta cp-due">{dueLabel(item.due_at)}</span>
        </li>
      ))}
      <ClassStyles />
    </ul>
  );
}

function ClassStyles() {
  return (
    <style jsx global>{`
        .cp-line { margin: 0; font: 600 17px/1.4 var(--font-sans); }
        .cp-list { list-style: none; margin: 0; padding: 8px 8px 8px 24px; display: grid; }
        .cp-row { display: flex; align-items: center; gap: 12px; min-height: 72px; border-bottom: 1px solid var(--line); }
        .cp-row:last-child { border-bottom: 0; }
        .cp-main { flex: 1; display: grid; gap: 4px; min-width: 0; }
        .cp-title { font: 500 17px/1.3 var(--font-sans); }
        .cp-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-variant-numeric: tabular-nums; }
        .cp-versions { font: 600 13px/1 var(--font-sans); white-space: nowrap; }
        .cp-row .c-menu-wrap:has(.cp-versions) > .c-icon-btn { width: auto; padding: 0 12px; border-radius: 999px; }
        .cp-due { font-variant-numeric: tabular-nums; padding-right: 16px; white-space: nowrap; }
        @media (max-width: 767px) { .cp-list { padding-left: 16px; } .cp-row { flex-wrap: wrap; padding: 12px 0; } .cp-main { flex-basis: 100%; } }
    `}</style>
  );
}
