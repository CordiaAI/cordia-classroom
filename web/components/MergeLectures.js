import { useEffect, useRef, useState } from 'react';
import { Check, Merge } from 'lucide-react';
import BodyPortal from './BodyPortal';
import { listLectures, mergeLectures } from '../lib/lectures';

function dateLabel(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
}

// Picks the other parts of a lecture that was recorded in pieces, then joins them into one
// (POST /api/lectures/merge). Lectures from the same class and the closest dates come first.
export default function MergeLectures({ lecture, folders = [], onMerged, onCancel }) {
  const [others, setOthers] = useState(null);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(null);
  const folderName = id => folders.find(folder => folder.id === id)?.name || '';

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = event => { if (event.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  useEffect(() => {
    const day = value => new Date(`${value || '1970-01-01'}T12:00:00`).getTime();
    listLectures().then(data => {
      const list = (data?.lectures || []).filter(item => item.id !== lecture.id);
      list.sort((a, b) => (Number(b.folder_id === lecture.folder_id) - Number(a.folder_id === lecture.folder_id))
        || (Math.abs(day(a.lecture_date) - day(lecture.lecture_date)) - Math.abs(day(b.lecture_date) - day(lecture.lecture_date))));
      setOthers(list.slice(0, 30));
    });
  }, [lecture.id]);

  const toggle = id => setPicked(current => (current.includes(id) ? current.filter(item => item !== id) : current.length < 7 ? [...current, id] : current));

  async function merge() {
    setBusy(true);
    setError('');
    const result = await mergeLectures([lecture.id, ...picked]);
    setBusy(false);
    if (result?.lecture?.id) onMerged(result.lecture);
    else setError(result?.detail || "These lectures weren't merged. Try again.");
  }

  return (
    <BodyPortal>
    <div className="c-scrim" onClick={() => { if (!busy) onCancel(); }}>
      <div className="c-sheet merge-sheet" role="dialog" aria-modal="true" aria-labelledby="merge-title" onClick={event => event.stopPropagation()}>
        <h2 id="merge-title" className="c-section-title">Merge with another part</h2>
        <p className="c-meta merge-note">Pick the other parts of this lecture. They're joined in order into one lecture with new notes, and the separate parts are removed.</p>
        {others === null ? (
          <p className="c-meta" role="status">Loading your lectures…</p>
        ) : !others.length ? (
          <p className="c-meta">There are no other lectures to merge with yet.</p>
        ) : (
          <ul className="merge-list">
            {others.map(item => {
              const on = picked.includes(item.id);
              return (
                <li key={item.id}>
                  <button type="button" className={'merge-row' + (on ? ' is-on' : '')} aria-pressed={on} onClick={() => toggle(item.id)} disabled={busy}>
                    <span className="merge-check" aria-hidden="true">{on && <Check size={14} strokeWidth={2.5} />}</span>
                    <span className="merge-main">
                      <span className="merge-title">{item.title}</span>
                      <span className="c-meta">{[folderName(item.folder_id), dateLabel(item.lecture_date), item.duration_ms > 60000 ? `${Math.round(item.duration_ms / 60000)} min` : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="merge-error" role="alert">{error}</p>}
        <div className="merge-actions">
          <button ref={cancelRef} type="button" className="c-btn c-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="c-btn c-btn--primary" onClick={merge} disabled={busy || !picked.length}>
            <Merge size={18} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Merging and writing notes…' : picked.length ? `Merge ${picked.length + 1} parts` : 'Merge'}
          </button>
        </div>
      </div>
      <style jsx>{`
        .merge-sheet { width: min(520px, 100%); display: grid; gap: 14px; max-height: min(640px, 90vh); }
        .merge-note { margin: 0; }
        .merge-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; overflow: auto; min-height: 0; }
        .merge-row { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-input); background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
        .merge-row.is-on { border-color: var(--olive); background: var(--olive-tint); }
        .merge-check { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border: 1.5px solid var(--line); border-radius: 6px; color: var(--on-olive); }
        .is-on .merge-check { background: var(--olive); border-color: var(--olive); }
        .merge-main { display: grid; gap: 2px; min-width: 0; }
        .merge-title { font: 600 15px/1.3 var(--font-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .merge-error { margin: 0; color: var(--error); font-weight: 600; }
        .merge-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
      `}</style>
    </div>
    </BodyPortal>
  );
}
