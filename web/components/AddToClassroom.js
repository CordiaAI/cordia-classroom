import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { SectionLoader } from './CordiaLoader';
import { addItem, listClassrooms } from '../lib/classrooms';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// Share a guide or a folder with one of your classrooms. Only classrooms you can add to are listed.
// item: { type: 'guide' | 'folder', id, title, mine, private }.
export default function AddToClassroom({ item, onClose, onAdded }) {
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState('');
  const [label, setLabel] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    listClassrooms(true).then(data => {
      const rooms = data?.classrooms || [];
      setList(rooms);
      if (rooms.length === 1) setPicked(rooms[0].id);
    });
  }, []);

  async function add() {
    if (!picked) return;
    setBusy(true);
    setError('');
    const data = await addItem(picked, { item_type: item.type, item_id: item.id, ...(label.trim() ? { milestone_label: label.trim() } : {}), ...(when ? { milestone_date: when } : {}) });
    setBusy(false);
    if (data?.added) onAdded?.(list.find(room => room.id === picked));
    else setError(data?.detail || "Couldn't add it. Try again.");
  }

  const room = list?.find(entry => entry.id === picked);
  const note = item.type === 'folder'
    ? `Everything in this folder, now and later, will be visible to ${room ? room.name : 'the classroom'}'s members. Nobody else sees it.`
    : item.mine && item.private
      ? `This guide is private. Adding it lets ${room ? room.name : 'the classroom'}'s members see it (and your class, if it has one).`
      : null;
  return (
    <BodyPortal>
      <div className="c-scrim" onClick={onClose}>
        <section className="c-sheet atc" role="dialog" aria-modal="true" aria-labelledby="atc-title" onClick={event => event.stopPropagation()}>
          <div className="atc-head">
            <h2 id="atc-title" className="atc-title">Add to classroom</h2>
            <button ref={closeRef} type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X {...ICON} /></button>
          </div>
          <p className="c-meta atc-what">{item.title}</p>
          {list === null && <SectionLoader label="Loading classrooms" />}
          {list && !list.length && (
            <p className="c-meta">You’re not in a classroom you can add to. <Link href="/classrooms">Make one</Link> or ask an admin to let members add guides.</p>
          )}
          {list && list.length > 0 && (
            <>
              <fieldset className="atc-rooms">
                <legend className="atc-label">Classroom</legend>
                {list.map(entry => (
                  <label key={entry.id} className="atc-room">
                    <input type="radio" name="atc-room" checked={picked === entry.id} onChange={() => setPicked(entry.id)} />
                    <span>{entry.name}<span className="c-meta"> · {entry.member_count} {entry.member_count === 1 ? 'member' : 'members'}</span></span>
                  </label>
                ))}
              </fieldset>
              {room?.can?.manage && (
                <div className="atc-milestone">
                  <label className="atc-label" htmlFor="atc-label">Milestone (optional)</label>
                  <input id="atc-label" className="c-input" value={label} maxLength={120} onChange={event => setLabel(event.target.value)} placeholder="Unit 2 quiz" />
                  <input aria-label="Milestone date" className="c-input" type="date" value={when} onChange={event => setWhen(event.target.value)} />
                </div>
              )}
              {note && <p className="atc-note">{note}</p>}
              {error && <p className="atc-error" role="alert">{error}</p>}
              <button type="button" className="c-btn c-btn--primary" disabled={busy || !picked} onClick={add}>{busy ? 'Adding…' : 'Add'}</button>
            </>
          )}
        </section>
      </div>
      <style jsx global>{`
        .atc { width: min(460px, 100%); display: grid; gap: 14px; max-height: min(90vh, 720px); overflow-y: auto; }
        .atc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .atc-title { margin: 0; font: 500 26px/1.15 var(--font-display); color: var(--ink); }
        .atc-what { margin: 0; overflow-wrap: anywhere; }
        .atc-rooms { margin: 0; padding: 0; border: 0; display: grid; gap: 8px; min-width: 0; }
        .atc-label { font: 600 14px/1.2 var(--font-sans); color: var(--ink); padding: 0; margin: 0 0 4px; }
        .atc-room { display: flex; gap: 10px; align-items: center; color: var(--ink); cursor: pointer; overflow-wrap: anywhere; }
        .atc-room input { width: 18px; height: 18px; accent-color: var(--olive); flex: none; }
        .atc-milestone { display: grid; gap: 8px; }
        .atc-note { margin: 0; padding: 10px 14px; border-radius: var(--r-row); background: var(--olive-tint); color: var(--ink); }
        .atc-error { margin: 0; color: var(--text-error); }
      `}</style>
    </BodyPortal>
  );
}
