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
  const [openClasses, setOpenClasses] = useState(() => new Set());
  const [unclassifiedOpen, setUnclassifiedOpen] = useState(true);
  const contextRef = useRef(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cordiaOpenClasses') || '[]');
      if (Array.isArray(saved)) setOpenClasses(new Set(saved));
    } catch {}
  }, []);

  function toggleClass(folderId) {
    setOpenClasses(current => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      try { localStorage.setItem('cordiaOpenClasses', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

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
        apiFetch('/guides?fields=summary&limit=500'),
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
      const folderName = folderId ? folders.find(f => f.id === folderId)?.name || 'class' : 'No class';
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
  // ============== STUDY GUIDES VIEW ==============
  if (view === 'guides') {
    const filteredGuides = getFilteredGuides();
    const organizedFiltered = organizeDashboardGuides(folders, filteredGuides);
    const visibleClasses = guidesFilter === 'bookmarked'
      ? organizedFiltered.classes.filter(entry => entry.guides.length)
      : organizedFiltered.classes;
    const renderGuideRow = guide => (
      <div
        key={guide.id}
        className={'library-guide-row draggable-guide' + (dragGuideId === guide.id ? ' dragging' : '')}
        draggable
        onDragStart={e => onDragStart(e, guide.id)}
        onDragEnd={onDragEnd}
        onClick={() => router.push('/guide/' + guide.id)}
        onContextMenu={e => onGuideContextMenu(e, guide)}
      >
        <div className="library-guide-row-main">
          <h3>{guide.title}</h3>
          <p>
            <span className="timestamp">{formatDate(guide.created_at)}</span>
            {guide.read_progress > 0 && (
              <span className="library-guide-row-progress">
                <span className="mini-progress">
                  <span className="mini-progress-fill" style={{ width: Math.round((guide.read_progress || 0) * 100) + '%' }} />
                </span>
                {Math.round((guide.read_progress || 0) * 100)}%
              </span>
            )}
          </p>
        </div>
        <button className={'bookmark-btn' + (guide.is_bookmarked ? ' active' : '')} onClick={e => toggleBookmark(guide.id, e)} aria-label={guide.is_bookmarked ? 'Remove bookmark' : 'Bookmark'}>
          {guide.is_bookmarked ? '\u2605' : '\u2606'}
        </button>
        <button
          className="bookmark-btn library-guide-row-delete"
          title="Delete guide"
          aria-label="Delete guide"
          onClick={e => { e.stopPropagation(); if (window.confirm('Delete "' + guide.title + '"?')) deleteGuide(guide.id); }}
        >
          &#128465;
        </button>
      </div>
    );
    return (
      <StudyWorkspaceFrame section="guides" timerState={timerState} setTimerState={setTimerState}>
        <div className="fade-in study-library">
          {loadErrorBanner}
          <div className="study-library-header">
            <div>
              <h1>My classes</h1>
              <p>All your study materials, organized and enhanced by Cordia.</p>
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

        <div className="guides-toolbar">
          <div className="filter-pills">
            {[
              { key: 'all', label: 'All (' + guides.length + ')' },
              { key: 'bookmarked', label: '★ Bookmarked' },
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

        <div className="guide-boxes">
          <section className="guide-box" aria-labelledby="guide-box-classes">
            <header className="guide-box-header">
              <h2 id="guide-box-classes">Classes</h2>
              <button type="button" className="guide-box-add" onClick={() => setShowNewFolder(true)}>+ Add class</button>
            </header>
            {showNewFolder && <form className="classroom-new-class" onSubmit={event => { event.preventDefault(); createFolder(); }}><input autoFocus aria-label="Class name" placeholder="Class name" value={newFolderName} onChange={event => setNewFolderName(event.target.value)} /><button type="submit" className="btn">Create class</button><button type="button" className="btn-outline" onClick={() => setShowNewFolder(false)}>Cancel</button></form>}
            {visibleClasses.length === 0 && <p className="guide-box-empty">{guidesFilter === 'bookmarked' ? 'No bookmarked guides in your classes.' : 'No classes yet. Add one to organize your guides.'}</p>}
            {visibleClasses.map(entry => {
              const open = openClasses.has(entry.folder.id) || guidesFilter === 'bookmarked';
              return (
                <div key={entry.folder.id} className={'guide-class' + (dropTargetId === entry.folder.id ? ' is-drop-target' : '')} onDragOver={event => onDragOver(event, entry.folder.id)} onDragLeave={event => onDragLeave(event, entry.folder.id)} onDrop={event => onDrop(event, entry.folder.id)}>
                  <div className="guide-class-head">
                    <button type="button" className="guide-class-toggle" onClick={() => toggleClass(entry.folder.id)} aria-expanded={open}>
                      <span className={'guide-chevron' + (open ? ' is-open' : '')} aria-hidden="true">›</span>
                      <strong>{entry.folder.name}</strong>
                      <small>{entry.guides.length} {entry.guides.length === 1 ? 'guide' : 'guides'}</small>
                    </button>
                    <button type="button" className="guide-class-open" onClick={() => router.push('/folder/' + entry.folder.id)}>Open</button>
                  </div>
                  {open && (
                    <div className="guide-class-list">
                      {entry.guides.length ? entry.guides.map(renderGuideRow) : <p className="guide-box-empty">No study guides yet. Drag one here.</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <section className={'guide-box' + (dropTargetId === 'none' ? ' is-drop-target' : '')} aria-labelledby="guide-box-unclassified" onDragOver={event => onDragOver(event, 'none')} onDragLeave={event => onDragLeave(event, 'none')} onDrop={event => onDrop(event, null)}>
            <header className="guide-box-header">
              <h2 id="guide-box-unclassified">Not in a class</h2>
            </header>
            <div className="guide-class">
              <div className="guide-class-head">
                <button type="button" className="guide-class-toggle" onClick={() => setUnclassifiedOpen(open => !open)} aria-expanded={unclassifiedOpen}>
                  <span className={'guide-chevron' + (unclassifiedOpen ? ' is-open' : '')} aria-hidden="true">›</span>
                  <strong>Unsorted study guides</strong>
                  <small>{organizedFiltered.unclassified.length} {organizedFiltered.unclassified.length === 1 ? 'guide' : 'guides'}</small>
                </button>
              </div>
              {unclassifiedOpen && (
                <div className="guide-class-list">
                  {organizedFiltered.unclassified.length
                    ? organizedFiltered.unclassified.map(renderGuideRow)
                    : <p className="guide-box-empty">{guides.length ? 'Every guide is in a class.' : 'No study guides yet. Create one or use the Chrome extension.'}</p>}
                </div>
              )}
            </div>
          </section>
        </div>

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
    <div className="classroom-home">
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      <SetupWizard />
      <div>
        {loadErrorBanner}
        <DashboardOverview folders={folders} guides={guides} stats={stats} navigate={path => router.push(path)} />
      </div>
      {toast && <div className={'toast toast-' + toast.type}>{toast.message}</div>}
      {contextMenu && renderContextMenu()}
    </div>
  );
}
