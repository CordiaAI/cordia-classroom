import { useEffect, useMemo, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowUpDown, ArrowUpRight, AudioLines, BookOpen, ChevronDown, FilePlus2, FolderInput, FolderPlus, Layers, Mic, NotebookPen, Pencil, Plus, Search, Star, Trash2,
} from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import useSessionTracker from '../lib/useSessionTracker';
import { dueCount } from '../lib/studyQueue';
import { listLectures } from '../lib/lectures';
import { useUndoDelete } from '../lib/undoDelete';
import ProgressRing from '../components/ProgressRing';
import Menu from '../components/Menu';
import ConfirmDialog from '../components/ConfirmDialog';
import AddClass from '../components/AddClass';
import LectureList from '../components/LectureList';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';

const SORTS = [
  { key: 'recent', label: 'Newest' },
  { key: 'title', label: 'A-Z' },
  { key: 'progress', label: 'Progress' },
];

// One list of everything, filtered by kind. Old ?tab= links land on the matching filter.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'guides', label: 'Guides' },
  { key: 'notes', label: 'Notes' },
  { key: 'lectures', label: 'Lectures' },
  { key: 'flashcards', label: 'Flashcards' },
  { key: 'starred', label: 'Starred' },
];
const TAB_ALIASES = { cards: 'flashcards', classes: 'all' };
const ICONS = { guide: BookOpen, note: NotebookPen, lecture: AudioLines };

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
  const asked = String(router.query.tab || router.query.filter || 'all');
  const filter = FILTERS.some(item => item.key === asked) ? asked : TAB_ALIASES[asked] || 'all';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [sharedClasses, setSharedClasses] = useState([]);
  const [guides, setGuides] = useState([]);
  const [notes, setNotes] = useState([]);
  const [lectures, setLectures] = useState([]);
  const [cardSets, setCardSets] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [closed, setClosed] = useState(() => new Set());
  const [addingClass, setAddingClass] = useState(false);
  const [addingLecture, setAddingLecture] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const gate = useLoadGate(!loading || Boolean(loadError));
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null);
  const { pending, remove, undo } = useUndoDelete();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cordiaClosedClasses') || '[]');
      if (Array.isArray(saved)) setClosed(new Set(saved));
    } catch {}
  }, []);

  useEffect(() => { if (ready) loadData(); }, [ready]);

  // Due counts need each guide's cards, so the Flashcards filter loads them when opened.
  useEffect(() => {
    if (ready && filter === 'flashcards' && !cardSets) {
      apiFetch('/guides?limit=100').then(data => setCardSets((data?.guides || []).filter(guide => guide.flashcards?.length)));
    }
  }, [ready, filter, cardSets]);

  // The notes editor's "Delete note" lands here, so the delete gets the same Undo as guides.
  useEffect(() => {
    const id = String(router.query.delete || '');
    if (loading || !id) return;
    const note = notes.find(item => item.id === id);
    if (note) remove({ id, title: note.title, path: '/smart_notes/' + id });
    router.replace('/library?filter=notes', undefined, { shallow: true });
  }, [loading, router.query.delete]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadData() {
    setLoading(true);
    setLoadError('');
    const [foldersData, guidesData, notesData, lectureData, classData] = await Promise.all([
      apiFetch('/folders'), apiFetch('/guides?fields=summary&limit=500'), apiFetch('/smart_notes'), listLectures().catch(() => null), apiFetch('/classes'),
    ]);
    const failure = [foldersData, guidesData].find(data => !data || data.detail);
    if (failure) setLoadError(apiErrorMessage(failure?.detail, 'Your library could not be loaded.'));
    if (Array.isArray(foldersData?.folders)) setFolders(foldersData.folders);
    if (Array.isArray(guidesData?.guides)) setGuides(guidesData.guides);
    setNotes(Array.isArray(notesData?.notes) ? notesData.notes : []);
    setLectures(Array.isArray(lectureData?.lectures) ? lectureData.lectures : []);
    setSharedClasses(Array.isArray(classData?.classes) ? classData.classes : []);
    setLoading(false);
  }

  function setFilter(key) {
    router.replace(key === 'all' ? '/library' : `/library?filter=${key}`, undefined, { shallow: true });
  }

  function toggleClass(id) {
    setClosed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('cordiaClosedClasses', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function classAdded({ folder }) {
    setAddingClass(false);
    if (folder) setFolders(current => [folder, ...current.filter(item => item.id !== folder.id)]);
    loadData();
  }

  function deleteClass(folder) {
    setConfirm({
      title: `Delete ${folder.name}?`,
      onConfirm: async () => {
        await Promise.all([apiFetch('/folders/' + folder.id, { method: 'DELETE' }), folder.class_id && apiFetch('/classes/' + folder.class_id, { method: 'DELETE' })]);
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

  async function moveItem(item, folderId) {
    if ((item.folderId || null) === folderId) return;
    const label = folderId ? `Moved to ${folders.find(folder => folder.id === folderId)?.name || 'class'}` : 'Moved to Unfiled';
    if (item.kind === 'guide') {
      const data = await apiFetch('/guides/' + item.id + '/move', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
      if (!data?.updated) return;
      setGuides(current => current.map(guide => (guide.id === item.id ? { ...guide, folder_id: folderId } : guide)));
    } else if (item.kind === 'note') {
      const data = await apiFetch('/smart_notes/' + item.id, { method: 'PUT', body: JSON.stringify({ folder_id: folderId || '' }) });
      if (!data?.updated) { setToast(apiErrorMessage(data?.detail, 'Note not moved.')); return; }
      setNotes(current => current.map(note => (note.id === item.id ? { ...note, folder_id: folderId } : note)));
    } else return;
    setToast(label);
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

  // Every guide, note and lecture as one kind of row, filtered, searched and sorted.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cardsById = new Map((cardSets || []).map(guide => [guide.id, guide]));
    const rows = [];
    if (['all', 'guides', 'starred'].includes(filter)) {
      guides.forEach(guide => rows.push({ kind: 'guide', id: guide.id, title: guide.title || 'Untitled guide', folderId: guide.folder_id, date: guide.created_at, href: '/guide/' + guide.id, progress: guide.read_progress, starred: Boolean(guide.is_bookmarked), guide }));
    }
    if (filter === 'flashcards') {
      (cardSets || []).forEach(guide => rows.push({ kind: 'cards', id: guide.id, title: guide.title || 'Untitled guide', folderId: guide.folder_id, date: guide.created_at, href: '/flashcards/study?guideId=' + guide.id, due: dueCount(cardsById.get(guide.id)), total: guide.flashcards.length }));
    }
    if (['all', 'notes'].includes(filter)) {
      notes.forEach(note => rows.push({ kind: 'note', id: note.id, title: note.title || 'Untitled Notes', folderId: note.folder_id, date: note.updated_at || note.created_at, href: '/smartnotes?id=' + note.id }));
    }
    if (['all', 'lectures'].includes(filter)) {
      lectures.forEach(lecture => rows.push({ kind: 'lecture', id: lecture.id, title: lecture.title || 'Lecture', folderId: lecture.folder_id, date: lecture.lecture_date ? `${lecture.lecture_date}T12:00:00` : lecture.created_at, href: '/lecture/' + lecture.id }));
    }
    let list = rows.filter(row => row.id !== pending?.id);
    if (filter === 'starred') list = list.filter(row => row.starred);
    if (q) list = list.filter(row => row.title.toLowerCase().includes(q));
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'progress') list.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    else list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return list;
  }, [guides, notes, lectures, cardSets, filter, query, sort, pending?.id]);

  if (!ready) return null;

  const folderIds = new Set(folders.map(folder => folder.id));
  const narrowed = Boolean(query.trim()) || filter !== 'all';
  const groups = folders
    .map(folder => ({ folder, list: items.filter(item => item.folderId === folder.id) }))
    .filter(group => !narrowed || group.list.length);
  const unfiled = items.filter(item => !item.folderId || !folderIds.has(item.folderId));
  // Shared classes joined without a Library class yet (older accounts) still get a link.
  const linkedClassIds = new Set(folders.map(folder => folder.class_id).filter(Boolean));
  const looseClasses = narrowed ? [] : sharedClasses.filter(item => !linkedClassIds.has(item.id));

  function dropProps(folderId) {
    return {
      onDragOver: event => { if (!dragId) return; event.preventDefault(); setDropId(folderId || 'none'); },
      onDragLeave: () => setDropId(current => (current === (folderId || 'none') ? null : current)),
      onDrop: event => {
        event.preventDefault();
        setDropId(null);
        const id = event.dataTransfer.getData('text/plain') || dragId;
        const item = items.find(row => row.id === id);
        if (item) moveItem(item, folderId);
      },
    };
  }

  function moveMenu(item) {
    return {
      label: 'Move to class',
      icon: FolderInput,
      items: [
        { label: 'Unfiled', current: !item.folderId, onSelect: () => moveItem(item, null) },
        ...folders.map(folder => ({ label: folder.name, current: item.folderId === folder.id, onSelect: () => moveItem(item, folder.id) })),
      ],
    };
  }

  function row(item) {
    const editing = renaming?.id === item.id;
    const movable = item.kind === 'guide' || item.kind === 'note';
    const Icon = ICONS[item.kind];
    return (
      <li
        key={item.kind + item.id}
        className={'lib-row' + (dragId === item.id ? ' is-dragging' : '')}
        draggable={movable && !editing}
        onDragStart={event => { setDragId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }}
        onDragEnd={() => { setDragId(null); setDropId(null); }}
      >
        {item.kind === 'guide' ? <ProgressRing value={item.progress} size={36} label={false} />
          : item.kind === 'cards' ? <span className="lib-kind"><Layers size={20} strokeWidth={1.75} aria-hidden="true" /></span>
          : <span className="lib-kind"><Icon size={20} strokeWidth={1.75} aria-hidden="true" /></span>}
        {editing ? (
          <form className="lib-rename" onSubmit={saveRename}>
            <input className="c-input" value={renaming.value} onChange={event => setRenaming({ ...renaming, value: event.target.value })} onBlur={saveRename} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Guide title" autoFocus />
          </form>
        ) : (
          <Link href={item.href} className="lib-row-link">
            <span className="lib-row-title c-truncate">{item.title}</span>
            <span className="c-meta">
              {item.kind === 'cards' ? (item.due ? `${item.due} due` : `${item.total} cards`) : [item.kind === 'note' ? 'Note' : item.kind === 'lecture' ? 'Lecture' : '', shortDate(item.date)].filter(Boolean).join(' · ')}
            </span>
          </Link>
        )}
        {item.kind === 'cards' && <Link href={item.href} className="c-btn c-btn--secondary">Study</Link>}
        {item.kind === 'guide' && (
          <button type="button" className={'c-icon-btn lib-star' + (item.starred ? ' is-on' : '')} onClick={() => toggleStar(item.guide)} aria-pressed={item.starred} aria-label={item.starred ? 'Unstar' : 'Star'}>
            <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={item.starred ? 'currentColor' : 'none'} />
          </button>
        )}
        {item.kind === 'guide' && (
          <Menu
            label={`More for ${item.title}`}
            items={[
              { label: 'Rename', icon: Pencil, onSelect: () => setRenaming({ id: item.id, value: item.title }) },
              moveMenu(item),
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove({ id: item.id, title: item.title }) },
            ]}
          />
        )}
        {item.kind === 'note' && (
          <Menu
            label={`More for ${item.title}`}
            items={[
              moveMenu(item),
              { label: 'Delete note', icon: Trash2, danger: true, onSelect: () => remove({ id: item.id, title: item.title, path: '/smart_notes/' + item.id }) },
            ]}
          />
        )}
      </li>
    );
  }

  function group({ id, name, list, folder }) {
    const open = narrowed || !closed.has(id);
    return (
      <section key={id} className={'c-card lib-group' + (dropId === id ? ' is-drop' : '')} {...dropProps(folder ? folder.id : null)} aria-label={name}>
        <div className="lib-group-head">
          <button type="button" className="c-icon-btn lib-group-toggle" onClick={() => toggleClass(id)} aria-expanded={open} aria-label={open ? `Collapse ${name}` : `Expand ${name}`}>
            <ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" className={open ? '' : 'is-closed'} />
          </button>
          {folder ? (
            <Link href={'/folder/' + folder.id} className="lib-group-name c-truncate">{name}</Link>
          ) : <span className="lib-group-name c-truncate">{name}</span>}
          <span className="c-meta">{list.length}</span>
          <span className="c-spacer" />
          {folder && (
            <Menu
              label={`More for ${name}`}
              items={[
                { label: 'Open class', icon: ArrowUpRight, onSelect: () => router.push('/folder/' + folder.id) },
                { label: 'Rename class', icon: Pencil, onSelect: () => router.push('/folder/' + folder.id + '?rename=1') },
                { label: 'Delete class', icon: Trash2, danger: true, onSelect: () => deleteClass(folder) },
              ]}
            />
          )}
        </div>
        {open && (list.length ? <ul className="lib-list">{list.map(row)}</ul> : <p className="c-meta lib-empty-group">Nothing here yet. Drag items in, or use Move to class.</p>)}
      </section>
    );
  }

  const primary = filter === 'notes'
    ? <button type="button" className="c-btn c-btn--primary" data-spot="note-new" onClick={() => { walkthroughEvent('note-created'); router.push('/smartnotes?id=new'); }}><FilePlus2 size={20} strokeWidth={1.75} aria-hidden="true" />New note</button>
    : filter === 'lectures'
      ? <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet('record')}><Mic size={20} strokeWidth={1.75} aria-hidden="true" />Record lecture</button>
      : filter === 'flashcards'
        ? <button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/create')}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Make cards</button>
        : <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />New</button>;

  if (gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate} label="Loading Library" />;
  return (
    <Reveal phase={gate}>
    <div className="c-page library">
      <header className="c-page-head">
        <h1 className="c-title">Library</h1>
        <div className="c-row lib-head-actions">
          {filter === 'lectures' && <button type="button" className="c-btn c-btn--secondary" onClick={() => setAddingLecture(true)}><NotebookPen size={20} strokeWidth={1.75} aria-hidden="true" />Add notes</button>}
          <button type="button" className="c-icon-btn lib-add-class-icon" onClick={() => setAddingClass(true)} aria-label="Add a class"><FolderPlus size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          {primary}
        </div>
      </header>

      {loadError && <div className="lib-error" role="alert"><span>{loadError}</span><button type="button" className="c-btn c-btn--secondary" onClick={loadData}>Retry</button></div>}

      <div className="lib-tools">
        <label className="c-search">
          <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Search your library</span>
          <input className="c-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" />
        </label>
        <Menu
          label={`Sort: ${SORTS.find(item => item.key === sort).label}`}
          trigger={<ArrowUpDown size={20} strokeWidth={1.75} aria-hidden="true" />}
          items={SORTS.map(item => ({ label: item.label, current: item.key === sort, onSelect: () => setSort(item.key) }))}
        />
      </div>
      <div className="c-row lib-filter-row">
        <div className="c-chips lib-filters" role="group" aria-label="Show">
          {FILTERS.map(item => (
            <button key={item.key} type="button" className="c-chip" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.key === 'starred' && <Star size={16} strokeWidth={1.75} aria-hidden="true" />}{item.label}
            </button>
          ))}
        </div>
        <span className="c-spacer" />
        <button type="button" className="c-btn c-btn--quiet lib-add-class" onClick={() => setAddingClass(true)}><FolderPlus size={20} strokeWidth={1.75} aria-hidden="true" />Add a class</button>
      </div>

      {addingClass && <AddClass withName onCancel={() => setAddingClass(false)} onAdded={classAdded} />}
      {addingLecture && <LectureList folders={folders} adding onAddingChange={setAddingLecture} showList={false} />}

      {loading || (filter === 'flashcards' && !cardSets) ? null : (
        <div className="c-stack">
          {groups.map(entry => group({ id: entry.folder.id, name: entry.folder.name, list: entry.list, folder: entry.folder }))}
          {looseClasses.map(item => (
            <Link key={item.id} href={'/class/' + item.id} className="c-card lib-loose">
              <span className="lib-group-name c-truncate">{item.code}{item.name ? ` ${item.name}` : ''}</span>
              <span className="c-meta">Class sets</span>
            </Link>
          ))}
          {(unfiled.length > 0 || !narrowed) && group({ id: 'none', name: 'Unfiled', list: unfiled })}
          {narrowed && !items.length && <p className="c-meta lib-empty-group">{query.trim() ? '0 results' : 'Nothing here yet.'}</p>}
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
        .library > *, .library .c-page-head, .lib-head-actions { min-width: 0; max-width: 100%; }
        .library .lib-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        .library .lib-tools { display: flex; align-items: center; gap: 8px; }
        .library .lib-add-class-icon { display: none; }
        @media (max-width: 767px) { .library .lib-add-class-icon { display: inline-grid; } }
        .library .lib-filter-row { flex-wrap: nowrap; min-width: 0; }
        /* Six filters: on narrow phones they scroll inside their row, never the page. */
        .library .lib-filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; min-width: 0; }
        .library .lib-filters::-webkit-scrollbar { display: none; }
        .library .lib-filters .c-chip { flex: 0 0 auto; }
        .library .lib-group { padding: 6px; }
        .library .lib-group.is-drop { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .library .lib-group-head { display: flex; align-items: center; gap: 6px; min-height: 52px; padding-right: 4px; }
        .library .lib-group-toggle .lucide { transition: transform var(--dur) var(--ease); }
        .library .lib-group-toggle .is-closed { transform: rotate(-90deg); }
        .library .lib-group-name { min-width: 0; color: var(--ink); font:600 20px/1.15 var(--font-sans); text-decoration: none; }
        .library a.lib-group-name:hover { text-decoration: underline; }
        .library .lib-loose { display: flex; align-items: center; gap: 12px; padding: 16px 18px; text-decoration: none; }
        .library .lib-list { list-style: none; margin: 0; padding: 0; }
        .library .lib-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 4px 4px 4px 12px; border-top: 1px solid var(--line); }
        .library .lib-row.is-dragging { opacity: .5; }
        .library .lib-kind { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .library .lib-row-link { display: flex; align-items: baseline; gap: 12px; flex: 1; min-width: 0; color: var(--ink); text-decoration: none; padding: 10px 0; }
        .library .lib-row-link:hover { text-decoration: none; }
        .library .lib-row-link:hover .lib-row-title { text-decoration: underline; }
        .library .lib-row-title { font:600 17px/1.15 var(--font-sans); min-width: 0; }
        .library .lib-rename { flex: 1; min-width: 0; }
        .library .lib-star.is-on { color: var(--olive-ink); }
        .library .lib-empty-group { padding: 8px 16px 14px; margin: 0; }
        @media (max-width: 767px) {
          .library .lib-row-link { flex-direction: column; gap: 2px; }
          /* Phones: "Add a class" moves up beside New, so the filters get the whole row. */
          .library .lib-add-class { display: none; }
          .library .lib-filters { margin: 0 -16px; padding: 2px 16px; }
        }
      `}</style>
    </div>
    </Reveal>
  );
}
