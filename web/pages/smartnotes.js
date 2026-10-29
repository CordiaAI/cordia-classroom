import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { domToOutline } from '../lib/outlineDoc';
import { SectionLoader } from '../components/CordiaLoader';

// Notes live in a guide's Outline now (New › Note makes one). This page only forwards old links:
//   /smartnotes?id=<id> -> that old note, moved into a guide (once; later visits open the guide)
//   /smartnotes         -> Library
export const NOTE_SOURCE = id => `note:${id}`;

async function guideForNote(noteId) {
  const guides = (await apiFetch('/guides?fields=summary&limit=500'))?.guides || [];
  const moved = guides.find(guide => guide.source_type === NOTE_SOURCE(noteId));
  const note = (await apiFetch(`/smart_notes/${encodeURIComponent(noteId)}`))?.note;
  if (moved) {
    if (note) await reshapeMoved(moved.id, note);
    return moved.id;
  }
  if (!note) throw new Error('That note could not be found.');
  const page = new DOMParser().parseFromString(`<body>${note.content || ''}</body>`, 'text/html').body;
  const saved = await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title: note.title || 'Notes',
      keep_title: Boolean(note.title && !/^untitled/i.test(note.title)),
      notes: domToOutline(page, { title: note.title }),
      source_type: NOTE_SOURCE(noteId),
      ...(note.folder_id ? { folder_id: note.folder_id } : {}),
    }),
  });
  if (!saved?.guide) throw new Error(apiErrorMessage(saved?.detail, 'That note could not be opened.'));
  return saved.guide.id;
}

// Notes moved before headings kept their levels came out with every heading as a section (the
// title as section 1). If the student hasn't changed them since, read the note again properly.
async function reshapeMoved(guideId, note) {
  const page = new DOMParser().parseFromString(`<body>${note.content || ''}</body>`, 'text/html').body;
  const before = domToOutline(page, { levels: false });
  const after = domToOutline(page, { title: note.title });
  if (before === after) return;
  const guide = (await apiFetch('/guides/' + guideId))?.guide;
  if (guide && (guide.notes || '') === before) {
    await apiFetch('/guides/' + guideId, { method: 'PATCH', body: JSON.stringify({ title: guide.title, notes: after }) });
  }
}

export default function SmartNotesPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready || !router.isReady) return;
    setError('');
    const { id } = router.query;
    if (!id || id === 'new') { router.replace('/library'); return; }
    (async () => {
      try {
        router.replace(`/guide/${await guideForNote(String(id))}`);
      } catch (caught) {
        setError(caught.message);
      }
    })();
  }, [ready, router.isReady, router.query.id, attempt]);

  // Never a dead end: try again, or go back to the Library.
  if (error) {
    return (
      <div className="c-empty" role="alert">
        <p>{error}</p>
        <div className="c-row c-row--wrap">
          <button type="button" className="c-btn c-btn--primary" onClick={() => setAttempt(value => value + 1)}>Try again</button>
          <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Library</button>
        </div>
      </div>
    );
  }
  return <SectionLoader height={200} label="Opening your notes" />;
}
