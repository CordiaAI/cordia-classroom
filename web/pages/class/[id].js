import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { apiFetch, apiErrorMessage } from '../../lib/api';
import { ClassDeadlines, ClassSets } from '../../components/ClassSets';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// A shared class. When it has a Library class (it normally does), that page is the one
// Class page, so this forwards there; older memberships without one still show sets here.
export default function SharedClassPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const { id } = router.query;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('sets');
  const [deadlines, setDeadlines] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!ready || !id) return;
    Promise.all([apiFetch('/folders'), apiFetch('/classes/' + id)]).then(([folders, result]) => {
      const folder = (folders?.folders || []).find(item => item.class_id === id);
      if (folder) { router.replace('/folder/' + folder.id); return; }
      if (result?.class) setInfo(result.class);
      else setError(apiErrorMessage(result?.detail, 'Class not found'));
    });
  }, [ready, id]);

  useEffect(() => {
    if (tab === 'deadlines' && !deadlines && id) apiFetch(`/classes/${id}/deadlines`).then(result => setDeadlines(result?.deadlines || []));
  }, [tab, id, deadlines]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!ready) return null;
  return (
    <div className="c-page cp">
      <header className="cp-head">
        <Link href="/library" className="c-icon-btn" aria-label="Back to Library"><ArrowLeft {...ICON} /></Link>
        <h1 className="c-title cp-heading">{info ? <>{info.code}{info.name && <span> {info.name}</span>}</> : error ? 'Class' : ''}</h1>
      </header>
      {error && <p className="cp-line" role="alert">{error}</p>}
      {info && (
        <>
          <div className="c-seg cp-tabs" role="tablist" aria-label="Class">
            <button type="button" role="tab" aria-selected={tab === 'sets'} className={tab === 'sets' ? 'is-active' : ''} onClick={() => setTab('sets')}>Class sets</button>
            <button type="button" role="tab" aria-selected={tab === 'deadlines'} className={tab === 'deadlines' ? 'is-active' : ''} onClick={() => setTab('deadlines')}>Deadlines</button>
          </div>
          {tab === 'sets' ? <ClassSets classId={id} onToast={setToast} /> : <ClassDeadlines classId={id} deadlines={deadlines} />}
        </>
      )}
      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      <style jsx global>{`
        .cp-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .cp-heading { min-width: 0; overflow-wrap: anywhere; }
        .cp-heading span { color: var(--muted); }
        .cp-tabs { justify-self: start; }
      `}</style>
    </div>
  );
}
