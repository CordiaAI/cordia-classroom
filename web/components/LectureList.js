import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AudioLines, Eye, ListChecks, Mic, NotebookPen, X } from 'lucide-react';
import { SectionLoader } from './CordiaLoader';
import { listLectures, localDate, saveLecture } from '../lib/lectures';
import { openNewSheet } from '../lib/newSheet';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

function dateLabel(value) {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Library → Lectures: recordings and lecture notes, newest first. Library shows only the
// add-notes form (showList=false) and lists lectures in its own class groups.
export default function LectureList({ folders = [], adding, onAddingChange, showList = true }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ text: '', date: localDate(), folderId: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const folderName = id => folders.find(folder => folder.id === id)?.name || '';

  useEffect(() => { if (showList) listLectures().then(setData); }, [showList]);

  // Notes taken in a lecture, or a transcript from elsewhere, saved as a lecture.
  async function saveNotes(event) {
    event.preventDefault();
    if (form.text.trim().length < 40) { setError('Add a little more: at least a few sentences.'); return; }
    setSaving(true);
    setError('');
    const saved = await saveLecture({
      transcript: form.text.trim(), source: 'notes', lecture_date: form.date, folder_id: form.folderId,
      classes: folders.map(folder => ({ id: folder.id, name: folder.name })),
    });
    setSaving(false);
    if (saved?.lecture?.id) router.push('/lecture/' + saved.lecture.id);
    else setError(saved?.detail || "Couldn't save this lecture. Try again.");
  }

  const lectures = data?.lectures || [];
  return (
    <div className="c-stack lectures">
      {adding && (
        <form className="c-card lecture-add" onSubmit={saveNotes}>
          <div className="lecture-add-head">
            <h2 className="c-section-title">Lecture notes or transcript</h2>
            <button type="button" className="c-icon-btn" onClick={() => onAddingChange(false)} aria-label="Cancel"><X {...ICON} /></button>
          </div>
          <label className="c-field">
            <span className="sr-only">Notes or transcript</span>
            <textarea className="c-input lecture-add-text" value={form.text} onChange={event => setForm(current => ({ ...current, text: event.target.value }))} placeholder="Paste or type what was said in the lecture" autoFocus />
          </label>
          <div className="c-row c-row--wrap">
            <label className="c-field lecture-add-small"><span>Date</span><input className="c-input" type="date" value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} /></label>
            {folders.length > 0 && (
              <label className="c-field lecture-add-small">
                <span>Class</span>
                <select className="c-select" value={form.folderId} onChange={event => setForm(current => ({ ...current, folderId: event.target.value }))}>
                  <option value="">Suggest for me</option>
                  {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
            )}
            <span className="c-spacer" />
            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>{saving ? 'Reading the lecture…' : 'Save lecture'}</button>
          </div>
          {error && <p className="lecture-error" role="alert">{error}</p>}
        </form>
      )}

      {!showList ? null : !data ? (
        <SectionLoader height={180} label="Loading lectures" />
      ) : data.enabled === false ? (
        <div className="c-empty">
          <AudioLines size={32} strokeWidth={1.75} aria-hidden="true" />
          <span className="c-section-title">Lectures are almost ready</span>
          <p className="c-meta">Saving lectures needs one setup step on this site. Recordings still become study guides until then.</p>
        </div>
      ) : !lectures.length ? (
        !adding && (
          <div className="c-empty">
            <AudioLines size={32} strokeWidth={1.75} aria-hidden="true" />
            <span className="c-section-title">No lectures yet</span>
            <div className="c-row c-row--wrap">
              <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet('record')}><Mic {...ICON} />Record lecture</button>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => onAddingChange(true)}><NotebookPen {...ICON} />Add notes or transcript</button>
            </div>
          </div>
        )
      ) : (
        <div className="c-card c-list">
          {lectures.map(lecture => (
            <Link key={lecture.id} href={'/lecture/' + lecture.id} className="c-list-row lecture-row">
              {lecture.source === 'notes' ? <NotebookPen {...ICON} /> : <AudioLines {...ICON} />}
              <span className="c-grow lecture-row-main">
                <span className="c-truncate lib-row-title">{lecture.title}</span>
                {lecture.summary && <span className="c-meta c-truncate">{lecture.summary}</span>}
              </span>
              {lecture.watch_count > 0 && <span className="c-chip lecture-count" title="To watch for"><Eye size={16} strokeWidth={1.75} aria-hidden="true" />{lecture.watch_count}</span>}
              {lecture.todo_count > 0 && <span className="c-chip lecture-count" title="To-dos"><ListChecks size={16} strokeWidth={1.75} aria-hidden="true" />{lecture.todo_count}</span>}
              <span className="c-meta lecture-row-meta">{[folderName(lecture.folder_id), dateLabel(lecture.lecture_date)].filter(Boolean).join(' · ')}</span>
            </Link>
          ))}
        </div>
      )}
      <style jsx>{`
        .lecture-add { display: grid; gap: 16px; padding: 20px; }
        .lecture-add-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .lecture-add :global(.c-section-title) { margin: 0; }
        .lecture-add-text { min-height: 180px; }
        .lecture-add-small { min-width: 160px; }
        .lecture-error { margin: 0; color: var(--error); font: 600 var(--fs-15)/var(--lh-body) var(--font-sans); }
        .lectures :global(.lecture-row) { color: var(--ink); text-decoration: none; }
        .lecture-row-main { display: grid; gap: 2px; min-width: 0; }
        .lecture-count { display: inline-flex; align-items: center; gap: 4px; }
        .lecture-row-meta { white-space: nowrap; }
        .lectures :global(.c-empty .c-meta) { max-width: 420px; text-align: center; margin: 0; }
        @media (max-width: 600px) { .lecture-row-meta { display: none; } }
      `}</style>
    </div>
  );
}
