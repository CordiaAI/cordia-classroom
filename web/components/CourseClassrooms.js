import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Plus } from 'lucide-react';
import { KIND_LABELS, courseClassrooms, joinMessage, requestJoin } from '../lib/classrooms';
import { NewClassroomSheet } from './ClassroomList';

// "Classrooms for this course" on a course page: public classrooms linked to it, with Join (or
// Ask to join), and a way to start one for the course.
export default function CourseClassrooms({ classId, onToast }) {
  const router = useRouter();
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState(null); // an instructor class: share progress first?

  async function load() {
    const data = await courseClassrooms(classId);
    setList(data?.classrooms || []);
  }
  useEffect(() => { if (classId) load(); }, [classId]);

  async function join(room, share = null) {
    const result = await requestJoin(room.id, share === null ? {} : { share_progress: share });
    if (result?.detail === 'consent_required') { setAsking(room); return; }
    setAsking(null);
    if (result?.status === 'active') { router.push('/classrooms/' + room.id); return; }
    onToast?.(joinMessage(result));
    load();
  }

  if (list === null) return null;
  return (
    <section className="c-card ccr" aria-labelledby="ccr-title">
      <div className="ccr-head">
        <h2 id="ccr-title" className="ccr-title">Classrooms for this course</h2>
        <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => setCreating(true)}><Plus size={18} strokeWidth={1.75} aria-hidden="true" />New</button>
      </div>
      {!list.length && <p className="c-meta">None yet. Start one for a study group, or for your section if you teach it.</p>}
      <ul className="ccr-list">
        {list.map(room => (
          <li key={room.id} className="ccr-row">
            <span className="ccr-main">
              <span className="ccr-name">{room.name}</span>
              <span className="c-meta">{KIND_LABELS[room.kind]} · {room.member_count} {room.member_count === 1 ? 'member' : 'members'}{room.owner ? ` · ${room.owner.display_name}` : ''}</span>
            </span>
            {room.my_status === 'active' ? <Link href={'/classrooms/' + room.id} className="c-btn c-btn--secondary c-btn--sm">Open</Link>
              : room.my_status === 'pending' ? <span className="c-meta">Asked to join</span>
                : <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => join(room)}>{room.join_policy === 'approval' ? 'Ask to join' : 'Join'}</button>}
            {asking?.id === room.id && (
              <div className="ccr-consent" role="group" aria-label="Share your progress?">
                <p className="c-meta">Your instructor can see your progress in this class if you allow it. You can change this later.</p>
                <button type="button" className="c-btn c-btn--primary c-btn--sm" onClick={() => join(room, true)}>Share my progress</button>
                <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => join(room, false)}>Keep it private</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {creating && <NewClassroomSheet classId={classId} onClose={() => setCreating(false)} onMade={room => router.push('/classrooms/' + room.id)} />}
      <style jsx>{`
        .ccr { display: grid; gap: 10px; padding: 16px; }
        .ccr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .ccr-title { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--ink); }
        .ccr :global(p) { margin: 0; }
        .ccr-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
        .ccr-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
        .ccr-main { display: grid; gap: 2px; min-width: 0; flex: 1 1 200px; }
        .ccr-name { font: 600 15px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
        .ccr-consent { flex: 1 1 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      `}</style>
    </section>
  );
}
