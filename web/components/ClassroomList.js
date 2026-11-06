import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Plus, UsersRound } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { KIND_LABELS, ROLE_LABELS, VISIBILITY_HELP, createClassroom, listClassrooms } from '../lib/classrooms';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Your classrooms (Library's Classrooms tab and /classrooms): name, kind, size, your role, and a
// New classroom button. A classroom waiting on your join request shows "Waiting for approval".
export default function ClassroomList({ showHeading = false }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listClassrooms().then(data => setList(data?.classrooms || []));
  }, []);

  return (
    <section className="crl" aria-label="Your classrooms">
      <div className="crl-head">
        {showHeading ? <h2 className="c-section-title">Your classrooms</h2> : <span className="c-meta">Study groups and classes you’re in.</span>}
        <span className="crl-actions">
          <Link href="/join" className="c-btn c-btn--secondary c-btn--sm">Join with a code</Link>
          <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => setCreating(true)}><Plus {...ICON} />New classroom</button>
        </span>
      </div>
      {list === null && <SectionLoader label="Loading classrooms" />}
      {list && !list.length && (
        <div className="c-card crl-empty">
          <UsersRound {...ICON} />
          <p>No classrooms yet. Make one for a study group, or join one with a link or code.</p>
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="crl-list">
          {list.map(room => (
            <li key={room.id}>
              <Link href={'/classrooms/' + room.id} className="c-card crl-row">
                <span className="crl-name">{room.name}</span>
                <span className="c-meta">
                  {KIND_LABELS[room.kind]}{room.instructor_request === 'requested' ? ' (instructor class requested)' : ''}
                  {' · '}{room.member_count} {room.member_count === 1 ? 'member' : 'members'}
                  {' · '}{room.me?.status === 'pending' ? 'Waiting for approval' : ROLE_LABELS[room.me?.role] || ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewClassroomSheet onClose={() => setCreating(false)} onMade={room => router.push('/classrooms/' + room.id)} />}
      <style jsx>{`
        .crl { display: grid; gap: 12px; }
        .crl-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
        .crl-head :global(.c-section-title) { margin: 0; }
        .crl-actions { display: inline-flex; flex-wrap: wrap; gap: 8px; }
        .crl-empty { display: flex; gap: 12px; align-items: center; padding: 16px; color: var(--muted-ink); }
        .crl-empty p { margin: 0; }
        .crl-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .crl-list :global(.crl-row) { display: grid; gap: 4px; padding: 14px 16px; color: var(--ink); text-decoration: none; min-width: 0; }
        .crl-name { font: 600 16px/1.3 var(--font-sans); overflow-wrap: anywhere; }
      `}</style>
    </section>
  );
}

// Make a classroom: a study group anyone can start, or an instructor class (it works as a study
// group until Cordia approves it).
export function NewClassroomSheet({ onClose, onMade, classId = null }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('study_group');
  const [visibility, setVisibility] = useState('unlisted');
  const [approval, setApproval] = useState(false);
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
    if (!name.trim()) { setError('Give it a name.'); return; }
    setBusy(true);
    const data = await createClassroom({ name: name.trim(), kind, visibility, join_policy: approval ? 'approval' : 'auto', ...(classId ? { class_id: classId } : {}) });
    setBusy(false);
    if (data?.classroom) onMade(data.classroom);
    else setError(data?.detail || "Couldn't make the classroom. Try again.");
  }

  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <form className="c-sheet ncs" role="dialog" aria-modal="true" aria-labelledby="ncs-title" onClick={event => event.stopPropagation()} onSubmit={submit}>
          <h2 id="ncs-title" className="ncs-title">New classroom</h2>
          <label className="ncs-field">
            <span>Name</span>
            <input ref={firstRef} className="c-input" value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Bio 101 study group" />
          </label>
          <fieldset className="ncs-field">
            <legend>Kind</legend>
            <label className="ncs-choice"><input type="radio" name="kind" checked={kind === 'study_group'} onChange={() => setKind('study_group')} /><span><b>Study group</b> Everyone can add guides.</span></label>
            <label className="ncs-choice"><input type="radio" name="kind" checked={kind === 'instructor_class'} onChange={() => setKind('instructor_class')} /><span><b>Instructor class</b> You add the guides. Students can choose to share their progress with you. Cordia checks instructor classes first; until then it works as a study group.</span></label>
          </fieldset>
          <fieldset className="ncs-field">
            <legend>Who can join</legend>
            {['unlisted', 'private', ...(classId ? ['public'] : [])].map(value => (
              <label key={value} className="ncs-choice"><input type="radio" name="visibility" checked={visibility === value} onChange={() => setVisibility(value)} />
                <span><b>{value === 'unlisted' ? 'Link or code' : value === 'private' ? 'Invited by name' : 'Listed on the class page'}</b> {VISIBILITY_HELP[value]}</span></label>
            ))}
          </fieldset>
          <label className="ncs-choice"><input type="checkbox" checked={approval} onChange={event => setApproval(event.target.checked)} /><span>Approve each person before they join</span></label>
          {error && <p className="ncs-error" role="alert">{error}</p>}
          <div className="ncs-actions">
            <button type="submit" className="c-btn c-btn--primary" disabled={busy}>{busy ? 'Making…' : 'Make classroom'}</button>
            <button type="button" className="c-btn c-btn--secondary" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
      <style jsx global>{`
        .ncs { width: min(480px, 100%); display: grid; gap: 16px; max-height: min(90vh, 760px); overflow-y: auto; }
        .ncs-title { margin: 0; font: 500 28px/1.15 var(--font-display); color: var(--ink); }
        .ncs-field { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; min-width: 0; }
        .ncs-field > span, .ncs-field legend { font: 600 14px/1.2 var(--font-sans); color: var(--ink); padding: 0; margin-bottom: 4px; }
        .ncs-choice { display: flex; gap: 10px; align-items: flex-start; color: var(--ink); cursor: pointer; }
        .ncs-choice input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--olive); flex: none; }
        .ncs-choice b { display: block; font-weight: 600; }
        .ncs-choice span { color: var(--muted-ink); }
        .ncs-choice span b { color: var(--ink); }
        .ncs-error { margin: 0; color: var(--text-error); }
        .ncs-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media (max-width: 420px) { .ncs-actions { grid-template-columns: 1fr; } }
      `}</style>
    </BodyPortal>
  );
}
