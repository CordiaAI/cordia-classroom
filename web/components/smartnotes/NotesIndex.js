import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import StudyWorkspaceFrame from '../StudyWorkspaceFrame';
import { organizeDashboardGuides } from '../../lib/dashboardOrganization';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import { notesRequest } from '../../lib/smartnotes';
import { StudyGuidePreviewModal, useGuidePreview } from './GuidePreview';

// Grid of saved notes with a stacked-paper preview; "Turn into Study Guide" converts one.
export default function NotesIndex({ timerState, setTimerState }) {
  const router = useRouter();
  const [notes, setNotes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);

  // Select-mode for "Turn into Study Guide" → click a note to convert
  const [selectMode, setSelectMode] = useState(false);
  const [convertingNoteId, setConvertingNoteId] = useState(null);
  const guide = useGuidePreview();
  const [error, setError] = useState('');

  useEffect(() => {
    // Each list loads on its own, so one failure still shows the others, plus the error.
    Promise.allSettled([notesRequest('/smart_notes'), notesRequest('/folders'), notesRequest('/guides')])
      .then(([notesResult, foldersResult, guidesResult]) => {
        setNotes(notesResult.value?.notes || []);
        setFolders(foldersResult.value?.folders || []);
        setGuides(guidesResult.value?.guides || []);
        const failed = [notesResult, foldersResult, guidesResult].find(result => result.status === 'rejected');
        if (failed) setError(failed.reason.message);
        setLoading(false);
      });
  }, []);

  const folderById = Object.fromEntries(folders.map(f => [f.id, f]));
  const organized = organizeDashboardGuides(folders, guides);

  async function handleNew() {
    setError('');
    try {
      const data = await notesRequest('/smart_notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Notes' }) });
      router.push('/smartnotes?id=' + data.note.id);
    } catch (caught) {
      setError(caught.message);
    }
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
    <StudyWorkspaceFrame
      classes={organized.classes}
      section="smartnotes"
      timerState={timerState}
      setTimerState={setTimerState}
      classRail={{
        allowCreate: false,
        openFolder: folderId => router.push('/folder/' + folderId),
        openGuide: guideId => router.push('/guide/' + guideId),
      }}
    >
    <div className="sn-index">
      <div className="sn-index-header">
        <div>
          <h1 className="sn-index-title">SmartNotes</h1>
          <p className="sn-index-subtitle">
            {selectMode
              ? 'Click the note you want to turn into a study guide.'
              : 'Your SmartNotes sessions — pick up where you left off, or start fresh.'}
          </p>
          {error && <p className="sn-status error" role="alert">{error}</p>}
        </div>
        <div className="sn-index-actions">
          {selectMode ? (
            <button className="btn sn-cancel-select-btn" onClick={() => setSelectMode(false)} disabled={!!convertingNoteId}>
              Cancel
            </button>
          ) : (
            <>
              <button
                className="btn sn-convert-header-btn"
                onClick={() => setSelectMode(true)}
                disabled={notes.length === 0}
                title="Turn one of your notes into a study guide"
              >
                Turn into Study Guide
              </button>
              <button className="btn sn-save-btn" onClick={handleNew}>+ New Note</button>
            </>
          )}
        </div>
      </div>

      {loading && <div className="sn-index-empty">Loading…</div>}

      {!loading && notes.length === 0 && (
        <div className="sn-index-empty">
          <p>No notes yet. Click <strong>+ New Note</strong> to start writing.</p>
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
                    <div className="sn-card-preview">{previewText(n.content) || 'Empty note'}</div>
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
    </StudyWorkspaceFrame>
  );
}
