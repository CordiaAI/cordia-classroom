import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { formatDate } from '../lib/formatters';
import useSessionTracker from '../lib/useSessionTracker';
import SearchModal from '../components/SearchModal';
import AILoadingSphere from '../components/AILoadingSphere';
import StudyWorkspaceFrame from '../components/StudyWorkspaceFrame';
import CalendarDashboard from '../components/CalendarDashboard';
import DashboardOverview from '../components/DashboardOverview';
import SetupWizard from '../components/SetupWizard';
import { organizeDashboardGuides } from '../lib/dashboardOrganization';

export default function Dashboard({ timerState, setTimerState }) {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const view = router.query.view || null; // null = dashboard; guides/calendar = focused workspace views
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [stats, setStats] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [dragGuideId, setDragGuideId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [guidesFilter, setGuidesFilter] = useState('all'); // all, bookmarked, unassigned
  const [guidesSort, setGuidesSort] = useState('recent'); // recent, title, progress
  const contextRef = useRef(null);

  useEffect(() => {
    if (ready && router.query.view === 'notes') router.replace('/smartnotes');
    if (ready && router.query.view === 'classes') router.replace('/dashboard?view=guides');
  }, [ready, router, router.query.view]);

  useEffect(() => {
    if (ready) {
      setLoading(true);
      loadData();
    }
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setShowSearch(true); }
      if (e.key === 'Escape') setContextMenu(null);
    }
    function onClick(e) {
      if (contextRef.current && !contextRef.current.contains(e.target)) setContextMenu(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick); };
  }, [ready, router.asPath]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function loadData() {
    setLoading(true);
    setLoadError('');
    try {
      const results = await Promise.allSettled([
        apiFetch('/folders'),
        apiFetch('/guides'),
        apiFetch('/stats/overview'),
      ]);
      const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
      const foldersData = value(0);
      const guidesData = value(1);
      const statsData = value(2);
      const responses = [foldersData, guidesData, statsData];
      const failure = responses.find(data => !data || data.detail);
      if (failure) {
        setLoadError(apiErrorMessage(
          failure?.detail,
          'Some Classroom data could not be refreshed. Your saved work is unchanged.'
        ));
      }
      if (Array.isArray(foldersData?.folders)) setFolders(foldersData.folders);
      if (Array.isArray(guidesData?.guides)) setGuides(guidesData.guides);
      if (statsData && !statsData.detail) setStats(statsData);
    } finally {
      setLoading(false);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    const data = await apiFetch('/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim() })
    });
    if (data?.folder) {
      setFolders([data.folder, ...folders]);
      setNewFolderName('');
      setShowNewFolder(false);
      showToast('Class created!');
    }
  }

  async function toggleBookmark(guideId, e) {
    e.stopPropagation();
    const data = await apiFetch('/guides/' + guideId + '/bookmark', { method: 'PATCH' });
    if (data) {
      setGuides(guides.map(g => g.id === guideId ? { ...g, is_bookmarked: data.is_bookmarked } : g));
    }
  }

  // --- Drag & Drop ---
  function onDragStart(e, guideId) {
    setDragGuideId(guideId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', guideId);
    e.currentTarget.style.opacity = '0.5';
  }

  function onDragEnd(e) {
    e.currentTarget.style.opacity = '1';
    setDragGuideId(null);
    setDropTargetId(null);
  }

  function onDragOver(e, folderId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(folderId);
  }

  function onDragLeave(e, folderId) {
    if (dropTargetId === folderId) setDropTargetId(null);
  }

  async function onDrop(e, folderId) {
    e.preventDefault();
    setDropTargetId(null);
    const guideId = e.dataTransfer.getData('text/plain') || dragGuideId;
    if (!guideId) return;
    const guide = guides.find(g => g.id === guideId);
    if (guide?.folder_id === folderId) return;

    const data = await apiFetch('/guides/' + guideId + '/move', {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId })
    });
    if (data?.updated) {
      setGuides(guides.map(g => g.id === guideId ? { ...g, folder_id: folderId } : g));
      const folderName = folders.find(f => f.id === folderId)?.name || 'folder';
      showToast('Moved to ' + folderName);
    }
    setDragGuideId(null);
  }

  // --- Context Menu ---
  function onGuideContextMenu(e, guide) {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      guide
    });
  }

  async function moveGuideToFolder(guideId, folderId) {
    setContextMenu(null);
    const data = await apiFetch('/guides/' + guideId + '/move', {
      method: 'PATCH',
      body: JSON.stringify({ folder_id: folderId })
    });
    if (data?.updated) {
      setGuides(guides.map(g => g.id === guideId ? { ...g, folder_id: folderId } : g));
      const folderName = folderId ? folders.find(f => f.id === folderId)?.name : 'No folder';
      showToast('Moved to ' + folderName);
    }
  }

  async function deleteGuide(guideId) {
    setContextMenu(null);
    await apiFetch('/guides/' + guideId, { method: 'DELETE' });
    setGuides(guides.filter(g => g.id !== guideId));
    showToast('Guide deleted', 'info');
  }

  // --- Guides filtering & sorting ---
  function getFilteredGuides() {
    let filtered = [...guides];
    if (guidesFilter === 'bookmarked') filtered = filtered.filter(g => g.is_bookmarked);
    if (guidesFilter === 'unassigned') filtered = filtered.filter(g => !g.folder_id);
    if (guidesSort === 'title') filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (guidesSort === 'progress') filtered.sort((a, b) => (b.read_progress || 0) - (a.read_progress || 0));
    // 'recent' is default from API
    return filtered;
  }

  if (!ready || view === 'notes' || view === 'classes') return null;

  // ============== LOADING STATE ==============
  if (!ready || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <AILoadingSphere />
      </div>
    );
  }

  const organized = organizeDashboardGuides(folders, guides);
  const loadErrorBanner = loadError && (
    <div className="canvas-inline-error" role="alert">
      <span>{loadError}</span>
      <button type="button" className="btn-outline" onClick={loadData}>Try again</button>
    </div>
  );
  const workspaceClassRail = {
    newFolderName,
    setNewFolderName,
    showNewFolder,
    setShowNewFolder,
    createFolder,
    openFolder: folderId => router.push('/folder/' + folderId),
    openGuide: guideId => router.push('/guide/' + guideId),
    onDragOver,
    onDragLeave,
    onDrop,
    dropTargetId,
  };

  // ============== STUDY GUIDES VIEW ==============
  if (view === 'guides') {
    const filteredGuides = getFilteredGuides();
    return (
      <StudyWorkspaceFrame classes={organized.classes} classRail={workspaceClassRail} section="guides" timerState={timerState} setTimerState={setTimerState}>
        <div className="fade-in study-library">
          {loadErrorBanner}
          <div className="study-library-header">
            <div>
              <h1>Study Guides</h1>
              <p>Everything you have captured or created, ready to review.</p>
            </div>
            <button className="btn" onClick={() => router.push('/create')}>New study guide</button>
          </div>
          <div className="study-library-tabs" role="tablist" aria-label="Study library">
            <button type="button" className="active" role="tab" aria-selected="true">Study guides</button>
            <button type="button" role="tab" aria-selected="false" onClick={() => router.push('/flashcards')}>Flashcards</button>
          </div>
          <div className="study-library-toolbar">
            <button className="guides-search-trigger" onClick={() => setShowSearch(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              Search guides...
              <kbd>Ctrl+K</kbd>
            </button>
          </div>

        {/* Filters & Sort */}
        <div className="guides-toolbar">
          <div className="filter-pills">
            {[
              { key: 'all', label: 'All (' + guides.length + ')' },
              { key: 'bookmarked', label: '★ Bookmarked' },
              { key: 'unassigned', label: 'No Class' },
            ].map(f => (
              <button
                key={f.key}
                className={'pill' + (guidesFilter === f.key ? ' pill-active' : '')}
                onClick={() => setGuidesFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select
            className="sort-select"
            value={guidesSort}
            onChange={e => setGuidesSort(e.target.value)}
          >
            <option value="recent">Newest First</option>
            <option value="title">Title A-Z</option>
            <option value="progress">Read Progress</option>
          </select>
        </div>

        {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}

        {filteredGuides.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#128214;</div>
            {guidesFilter !== 'all' ? 'No guides match this filter.' : 'No study guides yet. Use the Chrome extension to capture content!'}
          </div>
        ) : (
          filteredGuides.map(guide => (
            <div
              key={guide.id}
              className={'card draggable-guide' + (dragGuideId === guide.id ? ' dragging' : '')}
              draggable
              onDragStart={e => onDragStart(e, guide.id)}
              onDragEnd={onDragEnd}
              onClick={() => router.push('/guide/' + guide.id)}
              onContextMenu={e => onGuideContextMenu(e, guide)}
            >
              <div className="card-row">
                <div className="drag-handle" title="Drag to move">&#9776;</div>
                <div style={{ flex: 1 }}>
                  <h3>{guide.title}</h3>
                  <p>
                    <span className="guide-folder-tag">
                      {folders.find(f => f.id === guide.folder_id)?.name || 'No class'}
                    </span>
                    {' | '}
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
                <button className={'bookmark-btn' + (guide.is_bookmarked ? ' active' : '')} onClick={e => toggleBookmark(guide.id, e)}>
                  {guide.is_bookmarked ? '\u2605' : '\u2606'}
                </button>
                <button
                  className="bookmark-btn"
                  style={{ color: 'var(--error)', opacity: 0.55, fontSize: '0.95em' }}
                  title="Delete guide"
                  onClick={e => { e.stopPropagation(); if (window.confirm('Delete "' + guide.title + '"?')) deleteGuide(guide.id); }}
                >
                  &#128465;
                </button>
              </div>
            </div>
          ))
        )}

        {toast && <div className={'toast toast-' + toast.type}>{toast.message}</div>}
        {contextMenu && renderContextMenu()}
        </div>
      </StudyWorkspaceFrame>
    );
  }

  if (view === 'calendar') {
    return (
      <StudyWorkspaceFrame classes={organized.classes} section="calendar" timerState={timerState} setTimerState={setTimerState}>
        {loadErrorBanner}
        <div className="dashboard-desktop-header">
          <div>
            <h1>Calendar</h1>
            <p>Review Canvas deadlines and control reminders from one place.</p>
          </div>
        </div>
        <CalendarDashboard />
      </StudyWorkspaceFrame>
    );
  }

  // ============== CONTEXT MENU RENDERER ==============
  function renderContextMenu() {
    if (!contextMenu) return null;
    const menuW = 260;
    const menuH = 320;
    const x = Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuW - 8));
    const y = Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuH - 8));
    return (
      <div
        ref={contextRef}
        className="context-menu"
        style={{ top: y, left: x }}
      >
        <div className="context-menu-header">{contextMenu.guide.title}</div>
        <div className="context-menu-divider" />
        <div className="context-menu-item" onClick={() => { router.push('/guide/' + contextMenu.guide.id); setContextMenu(null); }}>
          &#128214; Open Guide
        </div>
        <div className="context-menu-item" onClick={() => { toggleBookmark(contextMenu.guide.id, { stopPropagation: () => {} }); setContextMenu(null); }}>
          {contextMenu.guide.is_bookmarked ? '★ Remove Bookmark' : '☆ Add Bookmark'}
        </div>
        <div className="context-menu-item" onClick={() => {
          const newTitle = prompt('Rename guide:', contextMenu.guide.title);
          if (newTitle && newTitle.trim()) {
            apiFetch('/guides/' + contextMenu.guide.id + '/rename', {
              method: 'PATCH',
              body: JSON.stringify({ title: newTitle.trim() })
            }).then(data => { if (data?.title) loadData(); });
          }
          setContextMenu(null);
        }}>
          &#9998; Rename
        </div>
        <div className="context-menu-divider" />
        <div className="context-menu-label">Move to Class:</div>
        {contextMenu.guide.folder_id && (
          <div className="context-menu-item" onClick={() => moveGuideToFolder(contextMenu.guide.id, null)}>
            &#10060; Remove from class
          </div>
        )}
        {folders.map(f => (
          <div
            key={f.id}
            className={'context-menu-item' + (contextMenu.guide.folder_id === f.id ? ' context-menu-current' : '')}
            onClick={() => contextMenu.guide.folder_id !== f.id && moveGuideToFolder(contextMenu.guide.id, f.id)}
          >
            &#128193; {f.name}
            {contextMenu.guide.folder_id === f.id && ' ✓'}
          </div>
        ))}
        <div className="context-menu-divider" />
        <div className="context-menu-item context-menu-danger" onClick={() => deleteGuide(contextMenu.guide.id)}>
          &#128465; Delete Guide
        </div>
      </div>
    );
  }

  // ============== DEFAULT DASHBOARD VIEW ==============
  return (
    <StudyWorkspaceFrame classes={organized.classes} classRail={workspaceClassRail} section="dashboard" timerState={timerState} setTimerState={setTimerState}>
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      <SetupWizard />
      <div>
        {loadErrorBanner}
        <DashboardOverview folders={folders} guides={guides} stats={stats} navigate={path => router.push(path)} />
      </div>
      {toast && <div className={'toast toast-' + toast.type}>{toast.message}</div>}
      {contextMenu && renderContextMenu()}
    </StudyWorkspaceFrame>
  );
}
