import { useEffect, useMemo, useState } from 'react';
import { LoadingArea, Reveal, SectionLoader, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowUpDown, ArrowUpRight, ChevronDown, FolderInput, FolderPlus, Layers, Pencil, Plus, Search, Star, Trash2, X,
} from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { organizeDashboardGuides } from '../lib/dashboardOrganization';
import { dueCount } from '../lib/studyQueue';
import { useUndoDelete } from '../lib/undoDelete';
import ProgressRing from '../components/ProgressRing';
import Menu from '../components/Menu';
import ConfirmDialog from '../components/ConfirmDialog';
import { openNewSheet } from '../lib/newSheet';

const SORTS = [
  { key: 'recent', label: 'Newest' },
  { key: 'title', label: 'A-Z' },
  { key: 'progress', label: 'Progress' },
];

function shortDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export default function LibraryPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useSessionTracker('browse');
  const tab = router.query.tab === 'cards' ? 'cards' : 'guides';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [guides, setGuides] = useState([]);
  const [cardSets, setCardSets] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [starredOnly, setStarredOnly] = useState(false);
  const [openClasses, setOpenClasses] = useState(() => new Set());
  const [unsortedOpen, setUnsortedOpen] = useState(true);
  const [newClass, setNewClass] = useState(null);
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const gate = useLoadGate(!loading || Boolean(loadError));
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null);
  const { pending, remove, undo } = useUndoDelete();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cordiaOpenClasses') || '[]');
      if (Array.isArray(saved)) setOpenClasses(new Set(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (ready) loadData();
  }, [ready]);

  useEffect(() => {
    if (ready && tab === 'cards' && !cardSets) {
      apiFetch('/guides?limit=100').then(data => setCardSets((data?.guides || []).filter(guide => guide.flashcards?.length)));
    }
  }, [ready, tab, cardSets]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadData() {
    setLoading(true);
    setLoadError('');
    const [foldersData, guidesData] = await Promise.all([apiFetch('/folders'), apiFetch('/guides?fields=summary&limit=500')]);
    const failure = [foldersData, guidesData].find(data => !data || data.detail);
    if (failure) setLoadError(apiErrorMessage(failure?.detail, 'Your library could not be loaded.'));
    if (Array.isArray(foldersData?.folders)) setFolders(foldersData.folders);
    if (Array.isArray(guidesData?.guides)) setGuides(guidesData.guides);
    setLoading(false);
  }

  function toggleClass(id) {
    setOpenClasses(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('cordiaOpenClasses', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  async function createClass(event) {
    event.preventDefault();
    const name = newClass?.trim();
    if (!name) return;
    const data = await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name }) });
    if (data?.folder) {
      setFolders(current => [data.folder, ...current]);
      setOpenClasses(current => new Set([...current, data.folder.id]));
      setNewClass(null);
    } else setToast(apiErrorMessage(data?.detail, 'Class not created.'));
  }

  function deleteClass(folder) {
    setConfirm({
      title: `Delete ${folder.name}?`,
      onConfirm: async () => {
        await apiFetch('/folders/' + folder.id, { method: 'DELETE' });
        setConfirm(null);
        loadData();
      },
    });
  }

  async function toggleStar(guide) {
    setGuides(current => current.map(item => (item.id === guide.id ? { ...item, is_bookmarked: !item.is_bookmarked } : item)));
    const data = await apiFetch('/guides/' + guide.id + '/bookmark', { method: 'PATCH' });
    if (data && typeof data.is_bookmarked === 'boolean') {
      setGuides(current => current.map(item => (item.id === guide.id ? { ...item, is_bookmarked: data.is_bookmarked } : item)));
    }
  }

  async function moveGuide(guide, folderId) {
    if ((guide.folder_id || null) === folderId) return;
    const data = await apiFetch('/guides/' + guide.id + '/move', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
    if (data?.updated) {
      setGuides(current => current.map(item => (item.id === guide.id ? { ...item, folder_id: folderId } : item)));
      setToast(folderId ? `Moved to ${folders.find(folder => folder.id === folderId)?.name || 'class'}` : 'Moved to Unsorted');
    }
  }

  async function saveRename(event) {
    event?.preventDefault();
    const title = renaming?.value.trim();
    const id = renaming?.id;
    setRenaming(null);
    if (!title || !id) return;
    const data = await apiFetch('/guides/' + id + '/rename', { method: 'PATCH', body: JSON.stringify({ title }) });
    if (data?.title) setGuides(current => current.map(item => (item.id === id ? { ...item, title: data.title } : item)));
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = guides.filter(guide => guide.id !== pending?.id);
    if (starredOnly) list = list.filter(guide => guide.is_bookmarked);
    if (q) list = list.filter(guide => (guide.title || '').toLowerCase().includes(q));
    if (sort === 'title') list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (sort === 'progress') list = [...list].sort((a, b) => (b.read_progress || 0) - (a.read_progress || 0));
    return list;
  }, [guides, query, sort, starredOnly, pending?.id]);

  if (!ready) return null;

  const organized = organizeDashboardGuides(folders, visible);
  const filtering = Boolean(query.trim()) || starredOnly;
  const classes = filtering ? organized.classes.filter(entry => entry.guides.length) : organized.classes;

  function dropProps(folderId) {
    return {
      onDragOver: event => { if (!dragId) return; event.preventDefault(); setDropId(folderId || 'none'); },
      onDragLeave: () => setDropId(current => (current === (folderId || 'none') ? null : current)),
      onDrop: event => {
        event.preventDefault();
        setDropId(null);
        const guide = guides.find(item => item.id === (event.dataTransfer.getData('text/plain') || dragId));
        if (guide) moveGuide(guide, folderId);
      },
    };
  }

  function guideRow(guide) {
    const editing = renaming?.id === guide.id;
    return (
      <li
        key={guide.id}
        className={'lib-row' + (dragId === guide.id ? ' is-dragging' : '')}
        draggable={!editing}
        onDragStart={event => { setDragId(guide.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', guide.id); }}
        onDragEnd={() => { setDragId(null); setDropId(null); }}
      >
        <ProgressRing value={guide.read_progress} size={36} label={false} />
        {editing ? (
          <form className="lib-rename" onSubmit={saveRename}>
            <input className="c-input" value={renaming.value} onChange={event => setRenaming({ ...renaming, value: event.target.value })} onBlur={saveRename} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Guide title" autoFocus />
          </form>
        ) : (
          <Link href={'/guide/' + guide.id} className="lib-row-link">
            <span className="lib-row-title c-truncate">{guide.title}</span>
            <span className="c-meta">{shortDate(guide.created_at)}</span>
          </Link>
        )}
        <button type="button" className={'c-icon-btn lib-star' + (guide.is_bookmarked ? ' is-on' : '')} onClick={() => toggleStar(guide)} aria-pressed={Boolean(guide.is_bookmarked)} aria-label={guide.is_bookmarked ? 'Unstar' : 'Star'}>
          <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={guide.is_bookmarked ? 'currentColor' : 'none'} />
        </button>
        <Menu
          label={`More for ${guide.title}`}
          items={[
            { label: 'Rename', icon: Pencil, onSelect: () => setRenaming({ id: guide.id, value: guide.title || '' }) },
            {
              label: 'Move to class',
              icon: FolderInput,
              items: [
                { label: 'Unsorted', current: !guide.folder_id, onSelect: () => moveGuide(guide, null) },
                ...folders.map(folder => ({ label: folder.name, current: guide.folder_id === folder.id, onSelect: () => moveGuide(guide, folder.id) })),
              ],
            },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove({ id: guide.id, title: guide.title }) },
          ]}
        />
      </li>
    );
  }

  function group({ id, name, list, open, onToggle, folder }) {
    return (
      <section key={id} className={'c-card lib-group' + (dropId === id ? ' is-drop' : '')} {...dropProps(folder ? folder.id : null)} aria-label={name}>
        <div className="lib-group-head">
          <button type="button" className="lib-group-toggle" onClick={onToggle} aria-expanded={open}>
            <ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" className={open ? '' : 'is-closed'} />
            <span className="c-section-title c-truncate">{name}</span>
            <span className="c-meta">{list.length}</span>
          </button>
          {folder && (
            <Menu
              label={`More for ${name}`}
              items={[
                { label: 'Open', icon: ArrowUpRight, onSelect: () => router.push('/folder/' + folder.id) },
                { label: 'Delete', icon: Trash2, danger: true, onSelect: () => deleteClass(folder) },
              ]}
            />
          )}
        </div>
        {open && (list.length ? <ul className="lib-list">{list.map(guideRow)}</ul> : <p className="c-meta lib-empty-group">0 guides</p>)}
      </section>
    );
  }

  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading Library" />;
  return (
    <Reveal phase={gate}>
    <div className="c-page library">
      <header className="c-page-head">
        <h1 className="c-title">Library</h1>
        <div className="c-row c-row--wrap lib-head-actions">
          <div className="c-seg" role="tablist" aria-label="Library">
            <Link href="/library" role="tab" aria-selected={tab === 'guides'} className={tab === 'guides' ? 'is-active' : ''}>Guides</Link>
            <Link href="/library?tab=cards" role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'is-active' : ''}>Cards</Link>
          </div>
          {tab === 'guides'
            ? <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />New guide</button>
            : <button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/create')}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Make cards</button>}
        </div>
      </header>

      {loadError && <div className="lib-error" role="alert"><span>{loadError}</span><button type="button" className="c-btn c-btn--secondary" onClick={loadData}>Retry</button></div>}

      {tab === 'guides' ? (
        <>
          <div className="lib-tools">
            <label className="c-search">
              <Search size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Search guides</span>
              <input className="c-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" />
            </label>
            <Menu
              label={`Sort: ${SORTS.find(item => item.key === sort).label}`}
              trigger={<ArrowUpDown size={20} strokeWidth={1.75} aria-hidden="true" />}
              items={SORTS.map(item => ({ label: item.label, current: item.key === sort, onSelect: () => setSort(item.key) }))}
            />
          </div>
          <div className="c-row c-row--wrap">
            <div className="c-chips" role="group" aria-label="Filter">
              <button type="button" className="c-chip" aria-pressed={!starredOnly} onClick={() => setStarredOnly(false)}>All</button>
              <button type="button" className="c-chip" aria-pressed={starredOnly} onClick={() => setStarredOnly(true)}><Star size={16} strokeWidth={1.75} aria-hidden="true" />Starred</button>
            </div>
            <span className="c-spacer" />
            <button type="button" className="c-btn c-btn--quiet" onClick={() => setNewClass('')}><FolderPlus size={20} strokeWidth={1.75} aria-hidden="true" />Add class</button>
          </div>

          {newClass !== null && (
            <form className="lib-new-class" onSubmit={createClass}>
              <input className="c-input" value={newClass} onChange={event => setNewClass(event.target.value)} placeholder="Class name" aria-label="Class name" autoFocus onKeyDown={event => { if (event.key === 'Escape') setNewClass(null); }} />
              <button type="submit" className="c-btn c-btn--primary" disabled={!newClass.trim()}>Add</button>
              <button type="button" className="c-icon-btn" onClick={() => setNewClass(null)} aria-label="Cancel"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
            </form>
          )}

          {loading ? null : (
            <div className="c-stack">
              {classes.map(entry => group({
                id: entry.folder.id,
                name: entry.folder.name,
                list: entry.guides,
                folder: entry.folder,
                open: filtering || openClasses.has(entry.folder.id),
                onToggle: () => toggleClass(entry.folder.id),
              }))}
              {(organized.unclassified.length > 0 || !filtering) && group({
                id: 'none',
                name: 'Unsorted',
                list: organized.unclassified,
                open: unsortedOpen || filtering,
                onToggle: () => setUnsortedOpen(open => !open),
              })}
              {filtering && !visible.length && <p className="c-meta lib-empty-group">0 results</p>}
            </div>
          )}
        </>
      ) : (
        <div className="c-card c-list">
          {!cardSets ? (
            <SectionLoader height={180} label="Loading cards" />
          ) : !cardSets.length ? (
            <div className="c-empty"><Layers size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">No cards</span><button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/create')}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Make cards</button></div>
          ) : cardSets.map(guide => {
            const due = dueCount(guide);
            return (
              <div key={guide.id} className="c-list-row">
                <Layers size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className="c-grow c-truncate lib-row-title">{guide.title}</span>
                <span className="c-meta">{due ? `${due} due` : `${guide.flashcards.length} cards`}</span>
                <Link href={'/flashcards/study?guideId=' + guide.id} className="c-btn c-btn--secondary">Study</Link>
              </div>
            );
          })}
        </div>
      )}

      {pending && (
        <div className="c-toast" role="status">
          <span>Deleted</span>
          <button type="button" className="c-btn c-btn--quiet" onClick={undo}>Undo</button>
        </div>
      )}
      {!pending && toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      {confirm && <ConfirmDialog title={confirm.title} confirmLabel="Delete" onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <style jsx global>{`
        .library .lib-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        .library .lib-tools { display: flex; align-items: center; gap: 8px; }
        .library .lib-new-class { display: flex; gap: 8px; align-items: center; max-width: 480px; }
        .library .lib-group { padding: 6px; }
        .library .lib-group.is-drop { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .library .lib-group-head { display: flex; align-items: center; gap: 4px; }
        .library .lib-group-toggle { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; height: 52px; padding: 0 12px; border: 0; border-radius:var(--r-input); background: transparent; color: var(--ink); cursor: pointer; text-align: left; }
        .library .lib-group-toggle:hover { background: var(--olive-tint); }
        .library .lib-group-toggle .lucide { transition: transform var(--dur) var(--ease); }
        .library .lib-group-toggle .is-closed { transform: rotate(-90deg); }
        .library .lib-list { list-style: none; margin: 0; padding: 0; }
        .library .lib-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 4px 4px 4px 12px; border-top: 1px solid var(--line); }
        .library .lib-row.is-dragging { opacity: .5; }
        .library .lib-row-link { display: flex; align-items: baseline; gap: 12px; flex: 1; min-width: 0; color: var(--ink); text-decoration: none; padding: 10px 0; }
        .library .lib-row-link:hover { text-decoration: none; }
        .library .lib-row-link:hover .lib-row-title { text-decoration: underline; }
        .library .lib-row-title, .library .lib-row-title { font:600 17px/1.15 var(--font-display); min-width: 0; }
        .library .lib-rename { flex: 1; min-width: 0; }
        .library .lib-star.is-on { color: var(--olive-ink); }
        .library .lib-empty-group { padding: 8px 16px 14px; margin: 0; }
        @media (max-width: 767px) { .library .lib-row-link { flex-direction: column; gap: 2px; } }
      `}</style>
    </div>
    </Reveal>
  );
}
