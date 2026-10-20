import { useState, useEffect, useRef } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import Link from 'next/link';
import { ArrowLeft, BookOpen, FolderInput, Plus, Trash2 } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import Menu from '../../components/Menu';
import ProgressRing from '../../components/ProgressRing';
import { openNewSheet } from '../../lib/newSheet';

export default function FolderPage() {
  const router = useRouter();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  const [folder, setFolder] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const gate = useLoadGate(Boolean(folder) || Boolean(loadError));
  const contextRef = useRef(null);

  useEffect(() => {
    if (ready && id) loadData();
    function onClick(e) {
      if (contextRef.current && !contextRef.current.contains(e.target)) setContextMenu(null);
    }
    function onKey(e) { if (e.key === 'Escape') setContextMenu(null); }
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, [ready, id]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function loadData() {
    setLoadError('');
    const [foldersData, guidesData] = await Promise.all([
      apiFetch('/folders'),
      apiFetch('/guides?folder_id=' + id)
    ]);
    const failure = [foldersData, guidesData].find(data => !data || data.detail);
    if (failure) {
      setLoadError(apiErrorMessage(failure?.detail, 'This class could not be loaded.'));
      return;
    }
    const allFolders = foldersData?.folders || [];
    setFolders(allFolders);
    const currentFolder = allFolders.find(f => f.id === id);
    if (!currentFolder) {
      setLoadError('This class no longer exists or you do not have access to it.');
      return;
    }
    setFolder(currentFolder);
    setGuides(guidesData?.guides || []);
  }

  function deleteGuide(guideId, e) {
    if (e) e.stopPropagation();
    setContextMenu(null);
    setConfirm({
      title: 'Delete guide?',
      message: '',
      onConfirm: async () => {
        await apiFetch('/guides/' + guideId, { method: 'DELETE' });
        setGuides(guides.filter(g => g.id !== guideId));
        setConfirm(null);
        showToast('Guide deleted', 'info');
      }
    });
  }

  function deleteFolder() {
    setConfirm({
      title: 'Delete class?',
      message: '',
      onConfirm: async () => {
        await apiFetch('/folders/' + id, { method: 'DELETE' });
        router.push('/library');
      }
    });
  }

  function onGuideContextMenu(e, guide) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, guide });
  }

  async function moveGuideToFolder(guideId, folderId) {
    setContextMenu(null);
    const data = await apiFetch('/guides/' + guideId + '/move', {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId })
    });
    if (data?.updated) {
      if (folderId !== id) {
        // Moved out of this folder
        setGuides(guides.filter(g => g.id !== guideId));
        const targetName = folderId ? folders.find(f => f.id === folderId)?.name : 'No class';
        showToast('Moved to ' + targetName);
      }
    }
  }

  if (loadError && !folder) return (
    <div className="c-empty" role="alert">
      <h1 className="c-title">Class unavailable</h1>
      <p>{loadError}</p>
      <div className="c-row">
        <button type="button" className="c-btn c-btn--primary" onClick={loadData}>Retry</button>
        <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Library</button>
      </div>
    </div>
  );

  if (!folder || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading class" />;

  return (
    <Reveal phase={gate}>
    <div className="c-page">
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      <header className="c-page-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push('/library')} aria-label="Library"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <h1 className="c-title">{folder.name}</h1>
          <span className="c-meta">{guides.length}</span>
        </div>
        <div className="c-row">
          <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />New</button>
          <Menu label="Class actions" items={[{ label: 'Delete class', icon: Trash2, danger: true, onSelect: deleteFolder }]} />
        </div>
      </header>

      {guides.length === 0 ? (
        <div className="c-empty"><BookOpen size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">0 guides</span></div>
      ) : (
        <div className="c-card c-list">
          {guides.map(guide => (
            <div key={guide.id} className="c-list-row">
              <ProgressRing value={guide.read_progress} size={36} label={false} />
              <Link href={'/guide/' + guide.id} className="c-grow folder-row-link">
                <span className="folder-row-title c-truncate">{guide.title}</span>
                <span className="c-meta">{new Date(guide.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
              </Link>
              <Menu
                label={`More for ${guide.title}`}
                items={[
                  { label: 'Move to class', icon: FolderInput, items: [
                    { label: 'Unsorted', onSelect: () => moveGuideToFolder(guide.id, null) },
                    ...folders.filter(f => f.id !== id).map(f => ({ label: f.name, onSelect: () => moveGuideToFolder(guide.id, f.id) })),
                  ] },
                  { label: 'Delete', icon: Trash2, danger: true, onSelect: () => deleteGuide(guide.id) },
                ]}
              />
            </div>
          ))}
        </div>
      )}
      {toast && <div className="c-toast" role="status"><span>{toast.message}</span></div>}
      <style jsx>{`
        :global(.folder-row-link) { display: flex; align-items: baseline; gap: 12px; min-width: 0; color: var(--ink); text-decoration: none; }
        .folder-row-title { font:600 17px/1.15 var(--font-display); min-width: 0; }
      `}</style>
    </div>
    </Reveal>
  );
}
