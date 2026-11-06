import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap, Users } from 'lucide-react';
import { CLASSROOMS_ON } from '../lib/featureFlags';
import { classroomSuggestions, joinMessage, requestJoin } from '../lib/classrooms';
import { follow, requestFriend } from '../lib/social';
import UserChip from './UserChip';

const MAX_ROOMS = 3;
const MAX_PEOPLE = 5;

// Dashboard: "Classmates from Canvas". From the courses you take this term: public classrooms for
// them you aren't in yet, and classmates who let people in their courses find them (the backend
// leaves out private profiles, blocked people, friends and anyone who turned it off). Loads on its
// own and shows only when there's something to suggest.
export default function ClassmatesCard() {
  const [data, setData] = useState(null);
  const [done, setDone] = useState({}); // key -> message
  const [asking, setAsking] = useState(null); // instructor class waiting on the sharing question

  useEffect(() => {
    if (!CLASSROOMS_ON) return undefined;
    let live = true;
    classroomSuggestions().then(result => { if (live && result && Array.isArray(result.classmates)) setData(result); }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!data || (!data.classrooms.length && !data.classmates.length)) return null;
  const mark = (key, text) => setDone(current => ({ ...current, [key]: text }));

  async function join(room, share) {
    setAsking(null);
    const result = await requestJoin(room.id, share === undefined ? {} : { share_progress: share });
    if (result?.detail === 'consent_required') { setAsking(room.id); return; }
    mark('room:' + room.id, joinMessage(result));
  }

  async function act(person, kind) {
    // lib/social.js answers { data } or { error }.
    const result = kind === 'follow' ? await follow(person.user_id) : await requestFriend(person.user_id);
    const key = `${kind}:${person.user_id}`;
    if (result?.error) mark(key, result.error);
    else if (kind === 'follow') mark(key, result?.data?.status === 'pending' ? 'Requested' : 'Following');
    else mark(key, 'Request sent');
  }

  return (
    <section className="c-section cm" aria-labelledby="cm-title">
      <h2 id="cm-title" className="c-section-title">Classmates from Canvas</h2>
      <div className="c-card cm-card">
        <p className="c-meta cm-lead">From {data.courses.join(', ')} this term.</p>

        {data.classrooms.slice(0, MAX_ROOMS).map(room => (
          <div key={room.id} className="cm-row">
            <span className="cm-icon" aria-hidden="true"><GraduationCap size={18} strokeWidth={1.75} /></span>
            <span className="cm-main">
              <strong className="cm-name">{room.name}</strong>
              <span className="c-meta">{room.course} · {room.kind === 'instructor_class' ? 'Instructor class' : 'Study group'} · {room.member_count} {room.member_count === 1 ? 'member' : 'members'}</span>
              {asking === room.id && (
                <span className="cm-ask" role="group" aria-label="Share your progress with the instructor?">
                  <span>Share your progress with the instructor?</span>
                  <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => join(room, true)}>Share</button>
                  <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => join(room, false)}>Keep it private</button>
                </span>
              )}
            </span>
            {done['room:' + room.id]
              ? <span className="c-meta cm-done" role="status">{done['room:' + room.id]}</span>
              : asking !== room.id && <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => join(room)}>{room.join_policy === 'approval' ? 'Ask to join' : 'Join classroom'}</button>}
          </div>
        ))}

        {data.classmates.slice(0, MAX_PEOPLE).map(person => (
          <div key={person.user_id} className="cm-row is-person">
            <span className="cm-main"><UserChip person={person} meta={person.courses.join(', ')} /></span>
            <span className="cm-actions">
              {person.can_follow && (done['follow:' + person.user_id]
                ? <span className="c-meta cm-done" role="status">{done['follow:' + person.user_id]}</span>
                : <button type="button" className="c-btn c-btn--secondary c-btn--sm" onClick={() => act(person, 'follow')}>{person.follows_need_approval ? 'Ask to follow' : 'Follow'}</button>)}
              {person.can_friend && (done['friend:' + person.user_id]
                ? <span className="c-meta cm-done" role="status">{done['friend:' + person.user_id]}</span>
                : <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={() => act(person, 'friend')}>Add friend</button>)}
            </span>
          </div>
        ))}

        <p className="c-meta cm-foot"><Users size={14} strokeWidth={1.75} aria-hidden="true" /><span>Only classmates who let people in their courses find them. <Link href="/settings/privacy">Your setting</Link></span></p>
      </div>
      <style jsx>{`
        .cm-card { display: grid; gap: 4px; padding: 12px 16px; min-width: 0; }
        .cm-lead, .cm-foot { margin: 4px 0; }
        .cm-foot { display: flex; align-items: flex-start; gap: 6px; }
        .cm-foot :global(svg) { flex: none; margin-top: 3px; }
        .cm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 0; border-top: 1px solid var(--line); min-width: 0; }
        .cm-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .cm-main { display: grid; gap: 2px; flex: 1 1 200px; min-width: 0; }
        .cm-name { font: 600 15px/1.3 var(--font-sans); color: var(--ink); overflow-wrap: anywhere; }
        .cm-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .cm-done { font-weight: 600; color: var(--olive-ink); }
        .cm-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 6px; color: var(--ink); font: 500 14px/1.35 var(--font-sans); }
      `}</style>
    </section>
  );
}
