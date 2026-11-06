import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { CLASSROOMS_ON } from '../lib/featureFlags';
import { classroomsDue } from '../lib/classrooms';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dashboard: what's due across your classrooms (your own progress on each one's guides), each
// row opening that classroom's Study tab. Loads on its own and shows only when something is due.
export default function ClassroomsDue() {
  const [rooms, setRooms] = useState([]);
  useEffect(() => {
    if (!CLASSROOMS_ON) return undefined;
    let live = true;
    classroomsDue().then(result => { if (live && Array.isArray(result?.classrooms)) setRooms(result.classrooms); }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!rooms.length) return null;
  return (
    <section className="c-section" aria-labelledby="rooms-due-title">
      <h2 id="rooms-due-title" className="c-section-title">Due across your classrooms</h2>
      <div className="c-card c-list">
        {rooms.slice(0, 5).map(room => (
          <Link key={room.id} href={UUID.test(room.id) ? `/classrooms/${room.id}?tab=study` : '/classrooms'} className="c-list-row cdue-row">
            <span className="c-grow c-truncate">{room.name}</span>
            <span className="c-meta">{room.due} due</span>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ))}
      </div>
      <style jsx>{`.c-list :global(.cdue-row) { color: var(--ink); text-decoration: none; }`}</style>
    </section>
  );
}
