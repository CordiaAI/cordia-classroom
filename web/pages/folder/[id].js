import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { formatDate } from '../../lib/formatters';
import ConfirmDialog from '../../components/ConfirmDialog';
import AILoadingSphere from '../../components/AILoadingSphere';

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
      title: 'Delete Guide',
      message: 'Are you sure you want to delete this study guide?',
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
      title: 'Delete Folder',
      message: 'Delete this folder and all its contents?',
      onConfirm: async () => {
        await apiFetch('/folders/' + id, { method: 'DELETE' });
        router.push('/dashboard');
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
    <div className="empty-state" role="alert">
      <h2>Class unavailable</h2>
      <p>{loadError}</p>
      <div className="resource-load-actions">
        <button type="button" className="btn" onClick={loadData}>Try again</button>
        <button type="button" className="btn-outline" onClick={() => router.push('/dashboard?view=guides')}>Back to Study Guides</button>
      </div>
    </div>
  );

  if (!folder) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
      <AILoadingSphere />
    </div>
  );

  return (
    <div className="fade-in">
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      <a href="#" onClick={e => { e.preventDefault(); router.push('/dashboard?view=guides'); }} style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
        &larr; All Study Guides
      </a>

      <div className="section-header" style={{ marginTop: 12 }}>
        <h2>{folder.name}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ fontSize: '0.8em', padding: '6px 14px' }} onClick={() => router.push('/create?folder=' + id)}>
            + Create Guide
          </button>
          <button className="btn btn-red" style={{ fontSize: '0.8em', padding: '6px 14px' }} onClick={deleteFolder}>
            Delete Folder
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{guides.length} study guides &middot; Right-click a guide for options</p>

      {guides.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">&#128214;</div>
          No study guides in this folder yet.<br />Use the Chrome extension to capture content and save it here.
        </div>
      ) : (
        guides.map(guide => (
          <div
            key={guide.id}
            className="card draggable-guide"
            onClick={() => router.push('/guide/' + guide.id)}
            onContextMenu={e => onGuideContextMenu(e, guide)}
          >
            <div className="card-row">
              <div style={{ flex: 1 }}>
                <h3>{guide.title}</h3>
                <p>
                  {(guide.source_title || guide.source_url) && <span>Based on {guide.source_title || 'Original source'}</span>}
                  {' '}
                  <span className="timestamp">{formatDate(guide.created_at)}</span>
                  {guide.read_progress > 0 && (
                    <span style={{ marginLeft: 8 }}>
                      <span className="mini-progress">
                        <span className="mini-progress-fill" style={{ width: Math.round((guide.read_progress || 0) * 100) + '%' }} />
                      </span>
                      {Math.round((guide.read_progress || 0) * 100)}%
                    </span>
                  )}
                </p>
              </div>
              <button className="btn btn-red" style={{ fontSize: '0.8em', padding: '4px 10px' }} onClick={e => deleteGuide(guide.id, e)}>
                Delete
              </button>
            </div>
          </div>
        ))
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="context-menu-header">{contextMenu.guide.title}</div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={() => { router.push('/guide/' + contextMenu.guide.id); setContextMenu(null); }}>
            &#128214; Open Guide
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-label">Move to:</div>
          <div className="context-menu-item" onClick={() => moveGuideToFolder(contextMenu.guide.id, null)}>
            &#10060; Remove from class
          </div>
          {folders.filter(f => f.id !== id).map(f => (
            <div key={f.id} className="context-menu-item" onClick={() => moveGuideToFolder(contextMenu.guide.id, f.id)}>
              &#128193; {f.name}
            </div>
          ))}
          <div className="context-menu-divider" />
          <div className="context-menu-item context-menu-danger" onClick={() => deleteGuide(contextMenu.guide.id)}>
            &#128465; Delete Guide
          </div>
        </div>
      )}

      {toast && <div className={'toast toast-' + toast.type}>{toast.message}</div>}
    </div>
  );
}
