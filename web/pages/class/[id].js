import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft } from 'lucide-react';
import { useRequireAuth } from '../../lib/auth';
import { apiFetch, apiErrorMessage } from '../../lib/api';
import { loadFolders } from '../../lib/folders';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { ClassDeadlines, ClassSets } from '../../components/ClassSets';
import SegmentedControl from '../../components/SegmentedControl';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };

// A shared class. When it has a Library class (it normally does), that page is the one
// Class page, so this forwards there; older memberships without one still show sets here.
export default function SharedClassPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const { id } = router.query;
  const [info, setInfo] = useState(null);
  const [classData, setClassData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('sets');
  const [deadlines, setDeadlines] = useState(null);
  const [toast, setToast] = useState('');
  const gate = useLoadGate(Boolean(info || error));

  useEffect(() => {
    if (!ready || !id) return;
    Promise.all([loadFolders(), apiFetch('/classes/' + id)]).then(([folders, result]) => {
      const folder = (folders?.folders || []).find(item => item.class_id === id);
      if (folder) { router.replace('/folder/' + folder.id); return; }
      if (result?.class) { setClassData(result); setInfo(result.class); }
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
  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading class" />;
  return (
    <Reveal phase={gate}>
    <div className="c-page cp">
      <header className="cp-head">
        <Link href="/library" className="c-icon-btn" aria-label="Back to Library"><ArrowLeft {...ICON} /></Link>
        <h1 className="c-title cp-heading">{info ? <>{info.code}{info.name && <span> {info.name}</span>}</> : error ? 'Class' : ''}</h1>
      </header>
      {error && (
        <div className="c-card cp-missing" role="alert">
          <h2 className="c-section-title">{error}</h2>
          <p className="c-meta">The link may be old, or you may have left this class.</p>
          <Link href="/library" className="c-btn c-btn--secondary">Go to Library</Link>
        </div>
      )}
      {info && (
        <>
          <SegmentedControl kind="tabs" label="Class" className="cp-tabs">
            <button type="button" role="tab" aria-selected={tab === 'sets'} className={tab === 'sets' ? 'is-active' : ''} onClick={() => setTab('sets')}>Class sets</button>
            <button type="button" role="tab" aria-selected={tab === 'deadlines'} className={tab === 'deadlines' ? 'is-active' : ''} onClick={() => setTab('deadlines')}>Deadlines</button>
          </SegmentedControl>
          {tab === 'sets' ? <ClassSets classId={id} onToast={setToast} initial={classData} /> : <ClassDeadlines classId={id} deadlines={deadlines} />}
        </>
      )}
      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      <style jsx global>{`
        .cp-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .cp-heading { min-width: 0; overflow-wrap: anywhere; }
        .cp-heading span { color: var(--muted); }
        :global(.cp-tabs) { justify-self: start; }
        .cp-missing { display: grid; justify-items: start; gap: 12px; max-width: 520px; }
        .cp-missing :is(h2, p) { margin: 0; }
      `}</style>
    </div>
    </Reveal>
  );
}
