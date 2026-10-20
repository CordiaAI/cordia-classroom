import { useRef, useState } from 'react';
import { useRouter } from 'next/router';
import BodyPortal from '../BodyPortal';
import { notesRequest } from '../../lib/smartnotes';

const DEFAULT_TITLE = 'Untitled — Study Guide';
const NO_PREVIEW = { title: '', study_guide: '', pairs: [] };

// "Turn into Study Guide": generate from a saved note, review it, then save, edit, or cancel.
// Shared by the notes list and the editor; render <StudyGuidePreviewModal {...guide.modal} />.
export function useGuidePreview() {
  const router = useRouter();
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const folderId = useRef(null);

  // Opens the modal with a message and nothing to approve.
  function showError(message) {
    setPreview(NO_PREVIEW);
    setTitle('');
    setError(message);
  }

  async function generate(noteId, noteFolderId) {
    folderId.current = noteFolderId || null;
    setError('');
    try {
      const data = await notesRequest('/smart_notes/' + noteId + '/study_guide', { method: 'POST' });
      setPreview(data);
      setTitle(data.title || DEFAULT_TITLE);
    } catch (caught) {
      showError(caught.message);
    }
  }

  function close() {
    setPreview(null);
    setTitle('');
    setError('');
  }

  async function approve() {
    if (!preview?.study_guide) return;
    setSaving(true);
    try {
      const flashcards = (preview.pairs || []).map(p => ({ front: p.question, back: p.answer }));
      const data = await notesRequest('/guides', {
        method: 'POST',
        body: JSON.stringify({
          title: (title || DEFAULT_TITLE).trim(),
          study_guide: preview.study_guide,
          notes: preview.notes_html || '',
          flashcards: flashcards.length ? flashcards : undefined,
          folder_id: folderId.current,
          source_type: preview.source?.type,
          source_title: preview.source?.title,
          source_id: preview.source?.id,
        }),
      });
      router.push('/guide/' + data.guide.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  function edit() {
    if (!preview) return;
    const pairs = preview.pairs.map(p => ({ term: p.question, definition: p.answer }));
    try {
      localStorage.setItem('autostudy_manual_draft', JSON.stringify({ title: (title || DEFAULT_TITLE).trim(), pairs, inputMode: 'manual' }));
    } catch { /* storage blocked: the create page opens without the draft */ }
    close();
    router.push('/create');
  }

  return {
    generate,
    showError,
    modal: { preview, title, setTitle, error, saving, onClose: close, onApprove: approve, onEdit: edit },
  };
}

export function StudyGuidePreviewModal({ preview, title, setTitle, error, saving, onClose, onApprove, onEdit }) {
  if (!preview) return null;
  const hasPairs = preview.pairs && preview.pairs.length > 0;
  return (
    <BodyPortal>
    <div className="c-scrim" onClick={onClose}>
      <div className="c-sheet sn-modal" role="dialog" aria-modal="true" aria-label="Guide preview" onClick={e => e.stopPropagation()}>
        <div className="sn-modal-header">
          <input
            className="c-input sn-modal-title-input"
            aria-label="Guide title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title"
            disabled={saving}
          />
        </div>
        <div className="sn-modal-body">
          {error && <div className="sn-modal-error">{error}</div>}
          {hasPairs ? (
            <div className="sn-modal-pairs">
              {preview.pairs.map((p, i) => (
                <div key={i} className="sn-modal-pair">
                  <div className="sn-modal-q"><strong>Q{i + 1}.</strong> {p.question}</div>
                  <div className="sn-modal-a">{p.answer}</div>
                </div>
              ))}
            </div>
          ) : (
            !error && <div className="sn-modal-empty">0 questions</div>
          )}
        </div>
        <div className="sn-modal-footer">
          <button className="c-btn c-btn--quiet sn-modal-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="c-btn c-btn--secondary sn-modal-edit" onClick={onEdit} disabled={saving || !hasPairs}>Edit</button>
          <button
            className="c-btn c-btn--primary sn-modal-approve"
            onClick={onApprove}
            disabled={saving || !hasPairs || !title.trim()}
          >
            {saving ? 'Saving…' : 'Save guide'}
          </button>
        </div>
      </div>
    </div>
    </BodyPortal>
  );
}
