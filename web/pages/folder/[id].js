import { useEffect, useState } from 'react';
import Head from 'next/head';
import { pageTitle } from '../../lib/pageTitle';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, AudioLines, BookOpen, FolderInput, Hash, NotebookPen, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { listLectures } from '../../lib/lectures';
import ConfirmDialog from '../../components/ConfirmDialog';
import Menu from '../../components/Menu';
import ProgressRing from '../../components/ProgressRing';
import AddClass from '../../components/AddClass';
import { ClassDeadlines, ClassSets } from '../../components/ClassSets';
import { openNewSheet } from '../../lib/newSheet';
import { invalidateFolders, loadFolders } from '../../lib/folders';
import { canvasStatus } from '../../lib/canvas';
import { CourseFiles } from '../../components/CanvasClasses';
import ClassGrades from '../../components/ClassGrades';
import useScrollerTabs from '../../lib/useScrollerTabs';
import { useListView } from '../../lib/listView';
import ViewToggle from '../../components/ViewToggle';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
// Course files and Grades show for a class brought in from Canvas.
const TABS = [['material', 'Your material'], ['files', 'Course files', 'canvas'], ['grades', 'Grades', 'canvas'], ['sets', 'Class sets'], ['deadlines', 'Deadlines']];

function shortDate(value) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// The one Class page: your own material, its Canvas files and grade, the sets classmates shared,
// and your deadlines.
// A class with a course code is the same thing as the shared class (folders.class_id).
export default function ClassPage() {
  const router = useRouter();
  const [view, chooseView] = useListView();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  const [folder, setFolder] = useState(null);
  const [cls, setCls] = useState(null);
  const [classData, setClassData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [deadlines, setDeadlines] = useState(null);
  const [showName, setShowName] = useState(null);
  const [addingCode, setAddingCode] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const [course, setCourse] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const tabs = TABS.filter(([, , needs]) => !needs || course);
  const tab = tabs.some(([key]) => key === router.query.tab) ? router.query.tab : 'material';
  const tabsRef = useScrollerTabs(tab);
  const gate = useLoadGate(Boolean(folder) || Boolean(loadError));

  useEffect(() => { if (ready && id) loadData(); }, [ready, id]);

  // Library's "Rename class" lands here with ?rename=1.
  useEffect(() => {
    if (!folder || !router.query.rename) return;
    setRenaming(folder.name);
    router.replace({ pathname: router.pathname, query: { id } }, undefined, { shallow: true });
  }, [folder?.id, router.query.rename]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadData() {
    setLoadError('');
    const [foldersData, guidesData, notesData, lectureData] = await Promise.all([
      loadFolders(), apiFetch('/guides?fields=summary&folder_id=' + encodeURIComponent(id)), apiFetch('/smart_notes'), listLectures().catch(() => null),
    ]);
    const failure = [foldersData, guidesData].find(data => !data || data.detail);
    if (failure) { setLoadError(apiErrorMessage(failure?.detail, 'This class could not be loaded.')); return; }
    const all = foldersData?.folders || [];
    const current = all.find(item => item.id === id);
    if (!current) { setLoadError('This class no longer exists or you do not have access to it.'); return; }
    // Everything for a Canvas-linked class (its tabs, code, deadlines) arrives before the page shows.
    if (current.class_id) {
      const safe = promise => promise.catch(() => null);
      const [status, classResult, deadlineResult, sharing] = await Promise.all([
        safe(canvasStatus()), safe(apiFetch('/classes/' + current.class_id)), safe(apiFetch(`/classes/${current.class_id}/deadlines`)), safe(apiFetch('/sharing/settings')),
      ]);
      setCourse((status?.courses || []).find(item => item.imported && item.class_id === current.class_id) || null);
      setCls(classResult?.class || null);
      setClassData(classResult?.class ? classResult : null);
      setDeadlines(deadlineResult?.deadlines || []);
      setShowName(typeof sharing?.show_first_name === 'boolean' ? sharing.show_first_name : null);
    }
    setFolders(all);
    setItems([
      ...(guidesData?.guides || []).map(guide => ({ kind: 'guide', id: guide.id, title: guide.title, date: guide.created_at, href: '/guide/' + guide.id, progress: guide.read_progress })),
      ...(notesData?.notes || []).filter(note => note.folder_id === id).map(note => ({ kind: 'note', id: note.id, title: note.title || 'Untitled Notes', date: note.updated_at, href: '/smartnotes?id=' + note.id })),
      ...(lectureData?.lectures || []).filter(lecture => lecture.folder_id === id).map(lecture => ({ kind: 'lecture', id: lecture.id, title: lecture.title, date: lecture.lecture_date ? `${lecture.lecture_date}T12:00:00` : lecture.created_at, href: '/lecture/' + lecture.id })),
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)));
    setFolder(current);
  }

  function setTab(key) {
    router.replace({ pathname: router.pathname, query: { id, ...(key === 'material' ? {} : { tab: key }) } }, undefined, { shallow: true });
  }

  async function toggleShowName() {
    const next = !showName;
    setShowName(next);
    const data = await apiFetch('/sharing/settings', { method: 'PUT', body: JSON.stringify({ show_first_name: next }) });
    if (typeof data?.show_first_name === 'boolean') setShowName(data.show_first_name);
    setToast(next ? 'Your first name shows on sets you share' : 'Your sets are shared without your name');
  }

  async function moveGuide(item, folderId) {
    const data = await apiFetch('/guides/' + item.id + '/move', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
    if (!data?.updated) return;
    setItems(current => current.filter(row => row.id !== item.id));
    setToast('Moved to ' + (folderId ? folders.find(f => f.id === folderId)?.name : 'Unfiled'));
  }

  async function saveName(event) {
    event?.preventDefault();
    const name = (renaming || '').trim();
    setRenaming(null);
    if (!name || name === folder.name) return;
    const previous = folder.name;
    setFolder(current => ({ ...current, name }));
    const data = await apiFetch('/folders/' + id, { method: 'PATCH', body: JSON.stringify({ name }) });
    if (data?.folder) { invalidateFolders(); setToast('Renamed'); }
    else { setFolder(current => ({ ...current, name: previous })); setToast(apiErrorMessage(data?.detail, 'Could not rename this class.')); }
  }

  function deleteClass() {
    setConfirm({
      title: `Delete ${folder.name}?`,
      onConfirm: async () => {
        // Deleting the class also leaves its shared class, so it doesn't come back as a link.
        await Promise.all([apiFetch('/folders/' + id, { method: 'DELETE' }), folder.class_id && apiFetch('/classes/' + folder.class_id, { method: 'DELETE' })]);
        invalidateFolders();
        router.push('/library');
      },
    });
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

  const upcoming = deadlines ? deadlines.filter(item => !item.done && new Date(item.due_at) >= new Date()).length : 0;
  const menu = [
    { label: 'Rename class', icon: Pencil, onSelect: () => setRenaming(folder.name) },
    ...(folder.class_id ? [] : [{ label: 'Add course code', icon: Hash, onSelect: () => setAddingCode(true) }]),
    ...(folder.class_id && showName !== null ? [{ label: showName ? 'Hide my first name on shared sets' : 'Show my first name on shared sets', icon: UserRound, onSelect: toggleShowName }] : []),
    { label: 'Delete class', icon: Trash2, danger: true, onSelect: deleteClass },
  ];
  const needsCode = (
    <div className="c-card cls-needs-code">
      <p className="cp-line">Add this class’s course code to see sets classmates share{tab === 'deadlines' ? ' and your Canvas deadlines' : ''}.</p>
      {addingCode
        ? <AddClass folderId={folder.id} onCancel={() => setAddingCode(false)} onAdded={() => { setAddingCode(false); loadData(); }} />
        : <button type="button" className="c-btn c-btn--secondary" onClick={() => setAddingCode(true)}><Hash {...ICON} />Add course code</button>}
    </div>
  );

  return (
    <Reveal phase={gate}>
    <div className="c-page cls-page">
      {confirm && <ConfirmDialog title={confirm.title} confirmLabel="Delete" onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      <header className="c-page-head">
        <div className="c-row cls-title-row">
          <Link href="/library" className="c-icon-btn" aria-label="Library"><ArrowLeft {...ICON} /></Link>
          <Head><title>{pageTitle(folder.name)}</title></Head>
          <div className="cls-title">
            {renaming !== null ? (
              <form onSubmit={saveName}>
                <input className="c-input cls-name-input" value={renaming} maxLength={100} onChange={event => setRenaming(event.target.value)} onBlur={saveName} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Class name" autoFocus />
              </form>
            ) : (
              <h1 className="c-title"><button type="button" className="cls-name-btn" onClick={() => setRenaming(folder.name)} title="Rename class">{folder.name}</button></h1>
            )}
            <span className="c-meta">
              {[cls?.code && cls.code !== folder.name ? cls.code : '', cls?.school, folder.class_id && deadlines ? `${upcoming} upcoming deadline${upcoming === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
            </span>
          </div>
        </div>
        <div className="c-row">
          <button type="button" className="c-btn c-btn--primary" onClick={() => openNewSheet()}><Plus {...ICON} />New</button>
          <Menu label="Class actions" items={menu} />
        </div>
      </header>

      <div className="cls-tabs-row">
        <div ref={tabsRef} className="c-seg is-scroller cls-tabs" role="tablist" aria-label="Class">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        {tab === 'material' && items.length > 0 && <ViewToggle view={view} onChange={chooseView} />}
      </div>

      {tab === 'material' ? (
        items.length === 0 ? (
          <div className="c-empty"><BookOpen size={32} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">Nothing here yet</span></div>
        ) : (
          <div className={view === 'cards' ? 'item-grid' : 'c-card c-list'}>
            {items.map(item => (
              <div key={item.kind + item.id} className="c-list-row">
                {item.kind === 'guide' ? <ProgressRing value={item.progress} size={36} label={false} />
                  : item.kind === 'note' ? <NotebookPen {...ICON} /> : <AudioLines {...ICON} />}
                <Link href={item.href} className="c-grow folder-row-link ig-main">
                  <span className="folder-row-title c-truncate ig-title">{item.title}</span>
                  <span className="c-meta">{[item.kind === 'note' ? 'Note' : item.kind === 'lecture' ? 'Lecture' : '', shortDate(item.date)].filter(Boolean).join(' · ')}</span>
                </Link>
                {item.kind === 'guide' && (
                  <Menu
                    label={`More for ${item.title}`}
                    items={[{ label: 'Move to class', icon: FolderInput, items: [
                      { label: 'Unfiled', onSelect: () => moveGuide(item, null) },
                      ...folders.filter(f => f.id !== id).map(f => ({ label: f.name, onSelect: () => moveGuide(item, f.id) })),
                    ] }]}
                  />
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === 'files' && course ? <div className="c-card cls-files"><CourseFiles course={course} /></div>
        : tab === 'grades' && course ? <ClassGrades courseId={course.id} guides={items.filter(item => item.kind === 'guide')} onMakeGuide={() => setTab('files')} />
        : !folder.class_id ? needsCode
        : tab === 'sets' ? <ClassSets classId={folder.class_id} onToast={setToast} initial={classData} />
        : <ClassDeadlines classId={folder.class_id} deadlines={deadlines} />}

      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
      <style jsx>{`
        .cls-title-row { min-width: 0; align-items: flex-start; }
        .cls-title { display: grid; gap: 2px; min-width: 0; }
        .cls-title :global(.c-title) { overflow-wrap: anywhere; }
        .cls-name-btn { max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; letter-spacing: inherit; text-align: left; cursor: text; }
        .cls-name-btn:hover { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 6px; }
        :global(.cls-name-input) { font: 600 28px/1.15 var(--font-display); height: 52px; width: min(640px, 70vw); }
        .cls-files { padding: 8px; }
        .cls-tabs button { flex: 0 0 auto; white-space: nowrap; }
        .cls-tabs { justify-self: start; max-width: 100%; overflow-x: auto; }
        .cls-tabs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
        .cls-needs-code { display: grid; gap: 12px; padding: 20px; justify-items: start; }
        .cls-needs-code :global(.cls-add) { width: 100%; box-shadow: none; padding: 0; background: none; border: 0; }
        :global(.folder-row-link) { display: flex; align-items: baseline; gap: 12px; min-width: 0; color: var(--ink); text-decoration: none; }
        .folder-row-title { font:600 17px/1.15 var(--font-sans); min-width: 0; }
        @media (max-width: 767px) {
          :global(.folder-row-link) { flex-direction: column; align-items: stretch; gap: 2px; }
          .folder-row-title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; overflow-wrap: anywhere; }
        }
      `}</style>
    </div>
    </Reveal>
  );
}
