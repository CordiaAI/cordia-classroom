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
  if (moved) return moved.id;
  const note = (await apiFetch(`/smart_notes/${encodeURIComponent(noteId)}`))?.note;
  if (!note) throw new Error('That note could not be found.');
  const page = new DOMParser().parseFromString(`<body>${note.content || ''}</body>`, 'text/html').body;
  const saved = await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title: note.title || 'Notes',
      notes: domToOutline(page),
      source_type: NOTE_SOURCE(noteId),
      ...(note.folder_id ? { folder_id: note.folder_id } : {}),
    }),
  });
  if (!saved?.guide) throw new Error(apiErrorMessage(saved?.detail, 'That note could not be opened.'));
  return saved.guide.id;
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
