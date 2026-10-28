import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../components/CordiaLoader';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowUpDown, ArrowUpRight, AudioLines, BookOpen, ChevronDown, FolderInput, FolderPlus, ImageIcon, Layers, LayoutGrid, List, Mic, NotebookPen, Pencil, PencilRuler, Plus, Search, Star, Trash2, Upload, X,
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
import { classLabel } from '../lib/classLabel';
import { PRACTICE_FILES, handOffUpload, readPracticeFile } from '../lib/practiceUpload';
import ClassCard from '../components/ClassCard';
import ClassCoverSheet from '../components/ClassCoverSheet';
import { designCover } from '../lib/classCover';

const VIEW_KEY = 'cordiaLibraryView';

const SORTS = [
  { key: 'recent', label: 'Newest' },
  { key: 'title', label: 'A-Z' },
  { key: 'progress', label: 'Progress' },
];

// One list of everything, filtered by kind. Old ?tab= links land on the matching filter.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'guides', label: 'Guides' },
  { key: 'lectures', label: 'Lectures' },
  { key: 'flashcards', label: 'Flashcards' },
  { key: 'practice', label: 'Practice' },
  { key: 'starred', label: 'Starred' },
];
// Notes live in guides now, so old Notes links show them all.
const TAB_ALIASES = { cards: 'flashcards', classes: 'all', notes: 'all' };
const ICONS = { guide: BookOpen, note: NotebookPen, lecture: AudioLines, practice: PencilRuler };

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
  // Sections closed while a filter or search is on: kept apart from the saved ones, and cleared
  // when the filter or search changes so new results are never hidden in a closed section.
  const [narrowClosed, setNarrowClosed] = useState(() => new Set());
  const [addingClass, setAddingClass] = useState(false);
  const [addingLecture, setAddingLecture] = useState(false);
  const [renaming, setRenaming] = useState(null); // { id, value }
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const gate = useLoadGate(!loading || Boolean(loadError));
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null);
  // Rows (classes that open in place) or cards (one card per class, with its Napkin cover).
  const [view, setView] = useState('rows');
  const [coverFor, setCoverFor] = useState(null); // the folder whose cover is being changed
  const [designingId, setDesigningId] = useState(null);
  const triedCovers = useRef(new Set());
  const { pending, remove, undo } = useUndoDelete();
  // Practice from a file that isn't in Library: read it here, then open the workspace on it.
  const practiceFileRef = useRef(null);
  const [readingFile, setReadingFile] = useState(false);
  async function practiceFromFile(file) {
    if (!file) return;
    setReadingFile(true);
    try {
      handOffUpload(await readPracticeFile(file));
      router.push('/practice');
    } catch (error) {
      setToast(error.message || 'This file could not be read.');
    } finally {
      setReadingFile(false);
      if (practiceFileRef.current) practiceFileRef.current.value = '';
    }
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cordiaClosedClasses') || '[]');
      if (Array.isArray(saved)) setClosed(new Set(saved));
      if (localStorage.getItem(VIEW_KEY) === 'cards') setView('cards');
    } catch {}
  }, []);

  function chooseView(next) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch {}
  }

  // The titles inside a class, which its cover's icons are picked from.
  function classTitles(folderId) {
    return [...guides, ...lectures, ...notes].filter(item => item.folder_id === folderId).map(item => item.title);
  }

  // In card view every class shows a cover at once (its colour and keyword icons); one class at
  // a time, a quick AI call picks better icons from its material and the cover is kept.
  useEffect(() => {
    if (view !== 'cards' || loading || designingId) return;
    const folder = folders.find(item => item.cover?.kind !== 'design' && !triedCovers.current.has(item.id));
    if (!folder) return;
    triedCovers.current.add(folder.id);
    setDesigningId(folder.id);
    designCover(folder, classTitles(folder.id))
      .then(cover => setFolders(current => current.map(item => (item.id === folder.id ? { ...item, cover } : item))))
      .catch(() => {})
      .finally(() => setDesigningId(null));
  }, [view, loading, designingId, folders, guides, lectures, notes]);

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

  useEffect(() => { setNarrowClosed(new Set()); }, [filter, query]);

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
    // Notes already moved into a guide show as that guide.
    const moved = new Set((guidesData?.guides || []).map(guide => guide.source_type).filter(type => String(type || '').startsWith('note:')).map(type => type.slice(5)));
    setNotes(Array.isArray(notesData?.notes) ? notesData.notes.filter(note => !moved.has(note.id)) : []);
    setLectures(Array.isArray(lectureData?.lectures) ? lectureData.lectures : []);
    setSharedClasses(Array.isArray(classData?.classes) ? classData.classes : []);
    setLoading(false);
  }

  function setFilter(key) {
    router.replace(key === 'all' ? '/library' : `/library?filter=${key}`, undefined, { shallow: true });
  }

  function toggleClass(id) {
    if (narrowed) {
      setNarrowClosed(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
    setClosed(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('cordiaClosedClasses', JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // The sidebar's "Add a class" (?add=class) opens the same sheet, then drops the parameter.
  useEffect(() => {
    if (router.query.add !== 'class') return;
    setAddingClass(true);
    const { add: _drop, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
  }, [router.query.add]);

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
    const label = folderId ? `Moved to ${classLabel(folders.find(folder => folder.id === folderId)?.name).title || 'class'}` : 'Moved to Unfiled';
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
    if (filter === 'practice') {
      guides.forEach(guide => rows.push({ kind: 'practice', id: guide.id, title: guide.title || 'Untitled guide', folderId: guide.folder_id, date: guide.created_at, href: '/practice/' + guide.id }));
    }
    if (filter === 'flashcards') {
      (cardSets || []).forEach(guide => rows.push({ kind: 'cards', id: guide.id, title: guide.title || 'Untitled guide', folderId: guide.folder_id, date: guide.created_at, href: '/flashcards/study?guideId=' + guide.id, due: dueCount(cardsById.get(guide.id)), total: guide.flashcards.length }));
    }
    if (filter === 'all') {
      // Older notes not yet moved into a guide; opening one moves it (pages/smartnotes.js).
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
        ...folders.map(folder => ({ key: folder.id, label: classLabel(folder.name).title, meta: classLabel(folder.name).code, current: item.folderId === folder.id, onSelect: () => moveItem(item, folder.id) })),
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
              {item.kind === 'cards' ? (item.due ? `${item.due} due` : `${item.total} cards`) : [item.kind === 'note' ? 'Note' : item.kind === 'lecture' ? 'Lecture' : item.kind === 'practice' ? 'Problems with worked answers' : '', shortDate(item.date)].filter(Boolean).join(' · ')}
            </span>
          </Link>
        )}
        {item.kind === 'cards' && <Link href={item.href} className="c-btn c-btn--secondary">Study</Link>}
        {item.kind === 'practice' && <Link href={item.href} className="c-btn c-btn--secondary" onClick={() => walkthroughEvent('practice-guide')}>Practice</Link>}
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
              // A guide moved in from an old note takes that note with it (pages/smartnotes.js).
              { label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove({ id: item.id, title: item.title, also: String(item.guide?.source_type || '').startsWith('note:') ? ['/smart_notes/' + item.guide.source_type.slice(5)] : [] }) },
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
    const open = narrowed ? !narrowClosed.has(id) : !closed.has(id);
    return (
      <section key={id} className={'c-card lib-group' + (dropId === id ? ' is-drop' : '')} {...dropProps(folder ? folder.id : null)} aria-label={name}>
        <div className="lib-group-head">
          <button type="button" className="c-icon-btn lib-group-toggle" onClick={() => toggleClass(id)} aria-expanded={open} aria-label={open ? `Collapse ${name}` : `Expand ${name}`}>
            <ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" className={open ? '' : 'is-closed'} />
          </button>
          {folder ? (
            <Link href={'/folder/' + folder.id} className="lib-group-name c-truncate">{name}</Link>
          ) : <span className="lib-group-name c-truncate">{name}</span>}
          <span className="c-spacer" />
          <span className={'lib-group-count' + (list.length ? '' : ' is-empty')}>{list.length ? `${list.length} item${list.length === 1 ? '' : 's'}` : 'Empty'}</span>
          {folder && (
            <Menu
              label={`More for ${name}`}
              items={[
                ...classMenu(folder),
              ]}
            />
          )}
        </div>
        {open && (list.length ? <ul className="lib-list">{list.map(row)}</ul> : <p className="c-meta lib-empty-group">Nothing here yet. Drag items in, or use Move to class.</p>)}
      </section>
    );
  }

  function classMenu(folder) {
    return [
      { label: 'Open class', icon: ArrowUpRight, onSelect: () => router.push('/folder/' + folder.id) },
      { label: 'Change cover', icon: ImageIcon, onSelect: () => setCoverFor(folder) },
      { label: 'Rename class', icon: Pencil, onSelect: () => router.push('/folder/' + folder.id + '?rename=1') },
      { label: 'Delete class', icon: Trash2, danger: true, onSelect: () => deleteClass(folder) },
    ];
  }

  const primary = filter === 'lectures'
      ? <button type="button" className="c-btn c-btn--primary" data-spot="record-lecture" onClick={() => { walkthroughEvent('record-opened'); openNewSheet('record'); }}><Mic size={20} strokeWidth={1.75} aria-hidden="true" />Record lecture</button>
      : filter === 'flashcards'
        ? <button type="button" className="c-btn c-btn--primary" onClick={() => router.push('/create')}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Make cards</button>
      : filter === 'practice'
        ? <>
            <input ref={practiceFileRef} type="file" hidden accept={PRACTICE_FILES} onChange={event => practiceFromFile(event.target.files?.[0])} />
            <button type="button" className="c-btn c-btn--primary" disabled={readingFile} onClick={() => practiceFileRef.current?.click()}><Upload size={20} strokeWidth={1.75} aria-hidden="true" />{readingFile ? 'Reading…' : 'Practice from a file'}</button>
          </>
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
          <input className="c-input" type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); } }} placeholder="Search" />
          {query && <button type="button" className="c-search-clear" onClick={() => setQuery('')} aria-label="Clear search"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
        </label>
        <div className="lib-view" role="group" aria-label="View">
          <button type="button" className="c-icon-btn" aria-pressed={view === 'rows'} aria-label="Rows" title="Rows" onClick={() => chooseView('rows')}><List size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <button type="button" className="c-icon-btn" aria-pressed={view === 'cards'} aria-label="Cards" title="Cards" onClick={() => chooseView('cards')}><LayoutGrid size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
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
        <div className="c-stack" data-spot={filter === 'practice' ? 'practice-picker' : undefined}>
          {view === 'cards' && (groups.length > 0 || looseClasses.length > 0) && (
            <div className="lib-cards">
              {groups.map(({ folder, list }) => (
                <ClassCard key={folder.id} folder={folder} name={folder.name} href={'/folder/' + folder.id} count={list.length} titles={classTitles(folder.id)}
                  menuItems={classMenu(folder)} dropProps={dropProps(folder.id)} isDrop={dropId === folder.id} />
              ))}
              {looseClasses.map(item => <ClassCard key={item.id} name={`${item.code}${item.name ? `: ${item.name}` : ''}`} href={'/class/' + item.id} count={0} />)}
            </div>
          )}
          {view === 'rows' && groups.map(entry => group({ id: entry.folder.id, name: entry.folder.name, list: entry.list, folder: entry.folder }))}
          {view === 'rows' && looseClasses.map(item => (
            <Link key={item.id} href={'/class/' + item.id} className="c-card lib-loose">
              <span className="lib-group-name c-truncate">{item.code}{item.name ? ` ${item.name}` : ''}</span>
              <span className="c-meta">Class sets</span>
            </Link>
          ))}
          {(unfiled.length > 0 || (!narrowed && view === 'rows')) && group({ id: 'none', name: 'Unfiled', list: unfiled })}
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
      {coverFor && (
        <ClassCoverSheet folder={coverFor} titles={classTitles(coverFor.id)} onClose={() => setCoverFor(null)}
          onSaved={folder => { setFolders(current => current.map(item => (item.id === folder.id ? { ...item, ...folder } : item))); setCoverFor(null); setToast('Cover saved'); }} />
      )}
      {confirm && <ConfirmDialog title={confirm.title} confirmLabel="Delete" onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}

      <style jsx global>{`
        .library > *, .library .c-page-head, .lib-head-actions { min-width: 0; max-width: 100%; }
        .library .lib-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 12px 18px; border-radius:var(--r-card); background: var(--error-bg); color: var(--error); font-weight:600; }
        .library .lib-tools { display: flex; align-items: center; gap: 8px; }
        .library .lib-add-class-icon { display: none; }
        .library .lib-view { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: var(--olive-tint); }
        .library .lib-view .c-icon-btn[aria-pressed='true'] { background: var(--surface-raised); color: var(--ink); box-shadow: var(--shadow-card); }
        .library .lib-view .c-icon-btn[aria-pressed='false'] { color: var(--muted); }
        .library .lib-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
        @media (max-width: 767px) { .library .lib-add-class-icon { display: inline-grid; } }
        .library .lib-filter-row { flex-wrap: nowrap; min-width: 0; }
        /* Six filters: on narrow phones they scroll inside their row, never the page. */
        .library .lib-filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; min-width: 0; }
        .library .lib-filters::-webkit-scrollbar { display: none; }
        .library .lib-filters .c-chip { flex: 0 0 auto; min-width: 64px; padding: 0 16px; justify-content: center; }
        /* Like the sidebar: the chosen filter is a raised pane, the rest are plain until hovered. */
        .library .lib-filters .c-chip:not([aria-pressed='true']) { background: transparent !important; border-color: transparent !important; box-shadow: none !important; color: var(--muted); }
        .library .lib-filters .c-chip:not([aria-pressed='true']):hover { background: var(--olive-tint) !important; color: var(--ink); }
        .library .lib-group { padding: 6px; }
        .library .lib-group.is-drop { border-color: var(--olive); box-shadow: 0 0 0 2px var(--olive); }
        .library .lib-group-head { display: flex; align-items: center; gap: 6px; min-height: 52px; padding-right: 12px; }
        .library .lib-group-toggle .lucide { transition: transform var(--dur) var(--ease); }
        .library .lib-group-toggle .is-closed { transform: rotate(-90deg); }
        .library .lib-group-name { min-width: 0; color: var(--ink); font:600 20px/1.15 var(--font-sans); text-decoration: none; }
        .library a.lib-group-name:hover { text-decoration: underline; }
        .library .lib-group-count { flex: none; display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 999px; background: var(--olive-tint); color: var(--olive-ink); font: 600 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .library .lib-group-count.is-empty { background: transparent; color: var(--muted); font-weight: 500; }
        .library .lib-loose { display: flex; align-items: center; gap: 12px; padding: 16px 18px; text-decoration: none; }
        .library .lib-list { list-style: none; margin: 0; padding: 0; }
        .library .lib-list { display: grid; gap: 2px; }
        /* Rows are soft rounded tiles: a gentle tint on hover, no lines, edges, shadow or underline. */
        .library .lib-row { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 4px 12px; border: 0; border-radius: var(--r-row, 16px); }
        .library .lib-list .lib-row:hover, .library .lib-list .lib-row:focus-within:has(:focus-visible) { border-color: transparent !important; box-shadow: none !important; background: var(--olive-tint); }
        .library .lib-row:focus-within:has(:focus-visible) { outline: 2px solid var(--olive); outline-offset: -2px; }
        .library .lib-row.is-dragging { opacity: .5; }
        .library .lib-kind { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); }
        .library .lib-row-link { display: flex; align-items: baseline; gap: 12px; flex: 1; min-width: 0; color: var(--ink); text-decoration: none; padding: 10px 0; }
        .library .lib-row-link:hover { text-decoration: none; }
        .library .lib-row-title { font:600 17px/1.15 var(--font-sans); min-width: 0; }
        .library .lib-rename { flex: 1; min-width: 0; }
        .library .lib-star.is-on { color: var(--olive-ink); }
        .library .lib-empty-group { padding: 8px 16px 14px; margin: 0; }
        @media (max-width: 767px) {
          /* Phones: the title takes the row's width and wraps to two lines instead of pushing the buttons off-screen. */
          .library .lib-row-link { flex-direction: column; align-items: stretch; gap: 2px; }
          .library .lib-row-title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; overflow-wrap: anywhere; }
          /* Phones: "Add a class" moves up beside New, so the filters get the whole row. */
          .library .lib-add-class { display: none; }
          .library .lib-filters { margin: 0 -16px; padding: 2px 16px; }
          .library .lib-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        }
      `}</style>
    </div>
    </Reveal>
  );
}
