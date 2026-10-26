import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { domToOutline } from '../lib/outlineDoc';
import { SectionLoader } from '../components/CordiaLoader';

// Notes live in a guide's Outline now. This page only forwards old links:
//   /smartnotes?id=new  -> a new guide that is just your notes
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

  useEffect(() => {
    if (!ready || !router.isReady) return;
    const { id } = router.query;
    if (!id) { router.replace('/library'); return; }
    (async () => {
      try {
        if (id === 'new') {
          const saved = await apiFetch('/guides', { method: 'POST', body: JSON.stringify({ title: 'Untitled notes', notes: '', source_type: 'notes' }) });
          if (!saved?.guide) throw new Error(apiErrorMessage(saved?.detail, 'A new page could not be made. Try again.'));
          router.replace(`/guide/${saved.guide.id}`);
        } else router.replace(`/guide/${await guideForNote(String(id))}`);
      } catch (caught) {
        setError(caught.message);
      }
    })();
  }, [ready, router.isReady, router.query.id]);

  if (error) return <div className="c-empty" role="alert"><p>{error}</p><button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Library</button></div>;
  return <SectionLoader height={200} label="Opening your notes" />;
}
