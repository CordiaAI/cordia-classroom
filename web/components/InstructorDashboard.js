import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { SectionLoader } from './CordiaLoader';
import UserChip from './UserChip';
import { ROLE_LABELS, downloadInstructorCsv, instructorDashboard } from '../lib/classrooms';

const when = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const countdown = days => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

function Bar({ value, label }) {
  return (
    <div className="idb-bar">
      <div className="idb-bar-top"><span className="idb-bar-label">{label}</span><b>{value === null ? 'No data' : `${value}% ready`}</b></div>
      <div className="c-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>
      <style jsx>{`
        .idb-bar { display: grid; gap: 6px; min-width: 0; }
        .idb-bar-top { display: flex; justify-content: space-between; gap: 12px; color: var(--ink); }
        .idb-bar-label { overflow-wrap: anywhere; min-width: 0; }
        .idb-bar b { flex: none; font-weight: 600; }
      `}</style>
    </div>
  );
}

// The Instructor tab of an instructor class (staff only; routers/classrooms.py /instructor):
// class readiness per guide, the weakest ideas, upcoming milestones and the member list with each
// member's sharing choice. Only members who share their progress are counted or exported.
export default function InstructorDashboard({ room, onToast }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { instructorDashboard(room.id).then(result => setData(result?.members ? result : { failed: true })); }, [room.id]);

  if (data === null) return <SectionLoader label="Loading the class overview" />;
  if (data.failed) return <p className="c-card idb-note">The class overview couldn’t load. Try again in a moment.</p>;

  async function exportCsv() {
    setSaving(true);
    try { await downloadInstructorCsv(room.id, room.name); } catch (error) { onToast?.(error.message); }
    setSaving(false);
  }

  return (
    <div className="idb">
      <section className="c-card idb-card" aria-labelledby="idb-class">
        <div className="idb-head">
          <h2 id="idb-class" className="idb-title">Class readiness</h2>
          <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={exportCsv} disabled={saving || !data.sharing} aria-busy={saving}>
            <Download size={16} strokeWidth={1.75} aria-hidden="true" />{saving ? 'Preparing…' : 'Export CSV'}
          </button>
        </div>
        <p className="c-meta">
          Counted from {data.sharing} {data.sharing === 1 ? 'student who shares' : 'students who share'} their progress with you.
          {data.not_sharing > 0 && ` ${data.not_sharing} ${data.not_sharing === 1 ? 'keeps theirs' : 'keep theirs'} private and ${data.not_sharing === 1 ? 'isn’t' : 'aren’t'} counted or exported.`}
        </p>
        {data.sharing > 0 && <Bar value={data.readiness} label="All guides" />}
        {data.guides.length ? (
          <ul className="idb-list">
            {data.guides.map(guide => (
              <li key={guide.id} className="idb-guide">
                <Bar value={guide.readiness} label={guide.title} />
                {data.sharing > 0 && <span className="c-meta">{guide.studied} of {data.sharing} studied it</span>}
              </li>
            ))}
          </ul>
        ) : <p className="c-meta">Add guides to see how the class is doing.</p>}
      </section>

      {data.milestones.length > 0 && (
        <section className="c-card idb-card" aria-labelledby="idb-miles">
          <h2 id="idb-miles" className="idb-title">Coming up</h2>
          <ul className="idb-list">
            {data.milestones.map((mile, index) => (
              <li key={index} className="idb-mile">
                <span className="idb-mile-main"><strong>{mile.label}</strong>{mile.item_title ? <span className="c-meta"> · {mile.item_title}</span> : null}</span>
                <span className="c-meta idb-mile-when">{when(mile.date)}, {countdown(mile.days_left)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.weakest.length > 0 && (
        <section className="c-card idb-card" aria-labelledby="idb-weak">
          <h2 id="idb-weak" className="idb-title">Ideas to go over</h2>
          <p className="c-meta">The ideas the sharing students know least, across every guide here.</p>
          <table className="idb-table">
            <thead><tr><th scope="col">Idea</th><th scope="col">Know it</th><th scope="col">Learning</th><th scope="col">Not started</th></tr></thead>
            <tbody>
              {data.weakest.map((idea, index) => (
                <tr key={index}>
                  <th scope="row"><span className="idb-q">{idea.question}</span><span className="c-meta">{idea.guide_title}</span></th>
                  <td>{idea.knows}</td><td>{idea.learning}</td><td>{idea.new}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="c-card idb-card" aria-labelledby="idb-members">
        <h2 id="idb-members" className="idb-title">Members</h2>
        {data.members.length ? (
          <ul className="idb-list">
            {data.members.map(person => (
              <li key={person.user_id} className="idb-member">
                <UserChip person={person} meta={ROLE_LABELS[person.role] || ''} />
                <span className={'idb-share' + (person.sharing ? ' is-on' : '')}>
                  {person.sharing ? `Shares · ${person.readiness}% ready` : 'Keeps progress private'}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="c-meta">No one has joined yet.</p>}
      </section>

      <style jsx>{`
        .idb { display: grid; gap: 12px; min-width: 0; }
        .idb-card { display: grid; gap: 12px; padding: 16px; min-width: 0; }
        .idb-card :global(.c-meta), .idb-note { margin: 0; }
        .idb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
        .idb-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .idb-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
        .idb-guide { display: grid; gap: 4px; }
        .idb-mile { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; color: var(--ink); }
        .idb-mile-main { min-width: 0; overflow-wrap: anywhere; }
        .idb-mile-when { flex: none; }
        .idb-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .idb-table thead th { font: 600 13px/1.3 var(--font-sans); color: var(--muted-ink); text-align: left; padding: 0 8px 6px 0; }
        .idb-table thead th:not(:first-child) { width: 72px; text-align: center; padding-right: 0; }
        .idb-table tbody th { display: grid; gap: 2px; text-align: left; font: 400 14px/1.35 var(--font-sans); color: var(--ink); padding: 8px 8px 8px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
        .idb-table td { text-align: center; font: 600 14px/1 var(--font-sans); color: var(--ink); border-top: 1px solid var(--line); }
        .idb-member { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; min-width: 0; }
        .idb-share { flex: none; font: 500 13px/1.3 var(--font-sans); color: var(--muted-ink); }
        .idb-share.is-on { color: var(--olive-ink); }
        @media (max-width: 520px) {
          .idb-table thead th:not(:first-child) { width: 52px; font-size: 12px; }
        }
      `}</style>
    </div>
  );
}
