import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FilePlus2, Sparkles } from 'lucide-react';
import CordiaLoader, { SectionLoader } from '../CordiaLoader';
import { authHeaders } from '../../lib/api';
import { MIN_CHARS, htmlToText, isDefaultTitle, needsCover } from '../../lib/noteMeta.mjs';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import { notesRequest } from '../../lib/smartnotes';
import { walkthroughEvent } from '../../lib/walkthrough';
import { StudyGuidePreviewModal, useGuidePreview } from './GuidePreview';

// Grid of saved notes with a stacked-paper preview (or a Napkin cover); "Turn into guide" converts one.
export default function NotesIndex() {
  const router = useRouter();
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Select-mode for "Turn into guide" → click a note to convert
  const [selectMode, setSelectMode] = useState(false);
  const [convertingNoteId, setConvertingNoteId] = useState(null);
  const guide = useGuidePreview();
  // Napkin covers and AI titles, made in the background a few notes at a time.
  const [covers, setCovers] = useState({});
  const [coversEnabled, setCoversEnabled] = useState(false);
  const [labelling, setLabelling] = useState({});
  const labelled = useRef(new Set());

  useEffect(() => {
    fetch('/api/notes/covers', { headers: authHeaders() })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!data) return;
        setCoversEnabled(Boolean(data.enabled));
        setCovers(Object.fromEntries((data.covers || []).map(cover => [cover.note_id, cover])));
      })
      .catch(() => { /* covers are optional: cards show their text instead */ });
  }, []);

  // Untitled notes get an AI title; notes without a current cover get one (2 at a time, 6 per visit).
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const due = notes.map(note => {
      const length = htmlToText(note.content).length;
      return { note, title: length >= MIN_CHARS && isDefaultTitle(note.title), cover: coversEnabled && needsCover(covers[note.id], length) };
    }).filter(item => (item.title || item.cover) && !labelled.current.has(item.note.id)).slice(0, 6);
    if (!due.length) return undefined;
    due.forEach(item => labelled.current.add(item.note.id));
    let next = 0;
    const work = async () => {
      while (!cancelled && next < due.length) {
        const item = due[next++];
        if (item.cover) setLabelling(current => ({ ...current, [item.note.id]: true }));
        const data = await fetch('/api/notes/meta', {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ note_id: item.note.id, title: item.title, cover: item.cover }),
        }).then(response => (response.ok ? response.json() : null)).catch(() => null);
        if (data?.title) setNotes(current => current.map(note => (note.id === item.note.id ? { ...note, title: data.title } : note)));
        if (data?.cover?.url) setCovers(current => ({ ...current, [item.note.id]: { ...data.cover, content_length: htmlToText(item.note.content).length } }));
        setLabelling(current => { const { [item.note.id]: _, ...rest } = current; return rest; });
      }
    };
    work(); work();
    return () => { cancelled = true; };
  }, [loading, notes.length, coversEnabled, Object.keys(covers).length]);

  useEffect(() => {
    // Each list loads on its own, so one failure still shows the others, plus the error.
    Promise.allSettled([notesRequest('/smart_notes'), notesRequest('/folders')])
      .then(([notesResult, foldersResult]) => {
        setNotes(notesResult.value?.notes || []);
        setFolders(foldersResult.value?.folders || []);
        const failed = [notesResult, foldersResult].find(result => result.status === 'rejected');
        if (failed) setError(failed.reason.message);
        setLoading(false);
      });
  }, []);

  const folderById = Object.fromEntries(folders.map(f => [f.id, f]));
  useEffect(() => { walkthroughEvent('notes-opened'); }, []);

  // A new note is only saved once it has text or a title (see doSave), so empty notes never pile up.
  function handleNew() {
    walkthroughEvent('note-created');
    router.push('/smartnotes?id=new');
  }

  async function handleSelectNoteForGuide(note) {
    if (convertingNoteId) return; // ignore extra clicks while one is processing
    setConvertingNoteId(note.id);
    await guide.generate(note.id, note.folder_id);
    setConvertingNoteId(null);
    setSelectMode(false);
  }

  function previewText(html) {
    if (!html) return '';
    // Parsed in an inert document so saved HTML can never run code while building a preview.
    const doc = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html');
    return (doc.body.textContent || '').trim().slice(0, 200);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  return (
    <div className="sn-index c-page">
      <div className="c-page-head">
        <h1 className="c-title">Notes</h1>
        {notes.length > 0 && (
          <div className="c-row">
            {selectMode ? (
              <button className="c-btn c-btn--secondary" onClick={() => setSelectMode(false)} disabled={!!convertingNoteId}>Cancel</button>
            ) : (
              <>
                {notes.some(n => previewText(n.content)) && (
                  <button className="c-btn c-btn--quiet sn-convert-header-btn" onClick={() => setSelectMode(true)}><Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Turn into guide</button>
                )}
                <button className="c-btn c-btn--primary" onClick={handleNew} data-spot="note-new"><FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" />New note</button>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p className="sn-status error" role="alert">{error}</p>}
      {selectMode && <p className="c-section-title" role="status">Pick a note</p>}

      {loading && <SectionLoader height={180} label="Loading notes" />}

      {!loading && notes.length === 0 && (
        <div className="c-empty">
          <button className="c-btn c-btn--primary c-btn--lg" onClick={handleNew} data-spot="note-new"><FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" />New note</button>
        </div>
      )}

      {!loading && notes.length > 0 && (
        <div className={'sn-grid' + (selectMode ? ' sn-grid--select' : '')}>
          {notes.map(n => {
            const folder = n.folder_id ? folderById[n.folder_id] : null;
            const isConverting = convertingNoteId === n.id;
            const cardClasses = [
              'sn-card',
              selectMode ? 'sn-card--selectable' : '',
              isConverting ? 'sn-card--converting' : '',
            ].filter(Boolean).join(' ');
            const onCardClick = selectMode
              ? () => handleSelectNoteForGuide(n)
              : () => router.push('/smartnotes?id=' + n.id);
            return (
              <div
                key={n.id}
                className={cardClasses}
                onClick={onCardClick}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') onCardClick(); }}
              >
                <div className="sn-card-stack">
                  <div className="sn-card-paper sn-card-paper-3" />
                  <div className="sn-card-paper sn-card-paper-2" />
                  <div className="sn-card-paper sn-card-paper-1">
                    {covers[n.id]?.url
                      ? <img className="sn-card-cover" src={covers[n.id].url} alt={covers[n.id].alt || ''} loading="lazy" />
                      : <div className="sn-card-preview">{previewText(n.content) || 'Empty note'}</div>}
                    {labelling[n.id] && <span className="sn-card-making"><CordiaLoader size={20} label="Making a cover" /></span>}
                  </div>
                </div>
                <div className="sn-card-meta">
                  <div className="sn-card-title">{n.title || 'Untitled Notes'}</div>
                  <div className="sn-card-sub">
                    <span className="sn-card-date">{fmtDate(n.updated_at || n.created_at)}</span>
                    {folder && <span className="sn-card-class">{folder.name}</span>}
                  </div>
                </div>
                {isConverting && <div className="sn-card-converting-overlay">Generating…</div>}
              </div>
            );
          })}
        </div>
      )}

      <StudyGuidePreviewModal {...guide.modal} />
    </div>
  );
}
