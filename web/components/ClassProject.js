import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowUpRight, AudioLines, BookOpen, CalendarCheck, Check, ChevronDown, FileText, FolderInput, Hash, Image as ImageIcon, Lock, MessageCircle, NotebookPen, PenLine, Pencil, Play, Plus, RefreshCw, Star, Trash2, UserRound, Users } from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { pageTitle } from '../lib/pageTitle';
import { classLabel } from '../lib/classLabel';
import { coverFor } from '../lib/coverDesign.mjs';
import { invalidateFolders } from '../lib/folders';
import { openNewSheet } from '../lib/newSheet';
import { setDeadlineDone, settleCanvasSync, syncCanvas } from '../lib/canvas';
import { deleteLecture, updateLecture } from '../lib/lectures';
import { CLASSROOMS_ON } from '../lib/featureFlags';
import { useUndoDelete } from '../lib/undoDelete';
import { useTutorChat } from '../lib/useTutorChat';
import { chatHref, classChats, deleteChat, keepOpenChat, moveChat, onChatsChanged, renameChat, showChatMessage, startChat } from '../lib/chats';
import { chatTitle } from '../lib/shellTools.mjs';
import { loadClassPage } from '../lib/classPageData';
import { saveShareDefault } from '../lib/classShare';
import { DEFAULT_TAB, classTabs, dueSoon, dueWhen, gradeEstimate, guideMeta, isReviewSet, masteredLine, masteryParts, orderGuides, pickTab, shortDay, syncAgo, syncLine } from '../lib/classPage.mjs';
import { deadlineTitle } from '../lib/formatters';
import { LoadingArea, Reveal, useLoadGate } from './CordiaLoader';
import { COVER_ICON_COMPONENTS } from './CoverArt';
import { sidebarClasses } from './Sidebar';
import Composer, { buildGuideFrom } from './Composer';
import TutorMessages from './TutorMessages';
import SegmentedControl from './SegmentedControl';
import Menu from './Menu';
import ProgressRing from './ProgressRing';
import ConfirmDialog from './ConfirmDialog';
import AddClass from './AddClass';
import AddToClassroom from './AddToClassroom';
import ClassCoverSheet from './ClassCoverSheet';
import AssignmentSheet from './AssignmentSheet';
import ClassGrades from './ClassGrades';
import CourseClassrooms from './CourseClassrooms';
import { ClassDeadlines, ClassSets } from './ClassSets';
import { CourseFiles } from './CanvasClasses';
import ClassExamCard from './ClassExamCard';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const SMALL = { size: 18, strokeWidth: 1.75, 'aria-hidden': true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Every row's ⋯ (F3): at the row's right end, shown on hover and keyboard focus, always on touch.
const MORE = 'c-icon-btn cls-more';

const dot = tone => function ClassDot() {
  return <span className={'c-class-dot' + (tone ? '' : ' is-none')} style={tone ? { '--dot': `var(--cover-ink-${tone})` } : undefined} aria-hidden="true" />;
};

// The class page in the new shell (docs/redesign/PLAN.md T7, DESIGN-SPEC 4.4): a class works like a
// project. The header (cover, name, code and Canvas sync, sharing, ⋯), a composer scoped to the class,
// then the tabs and list beside the exam card and Due soon (they stack on narrow windows). Everything
// today's class page does (components/ClassPageLegacy.js) is reachable from here.
// A message sent from the class composer starts a saved chat in this class (lib/chats.js startChat,
// as the home does) and the conversation opens here, in place: the class stays the context and Back
// returns to it. The chat is then in Recent chats and this class's Chats tab, and opens at /chat/<id>.
export default function ClassProject() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const { ready } = useRequireAuth();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const gate = useLoadGate(Boolean(data) || Boolean(loadError));
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoadError('');
    const result = await loadClassPage(id);
    if (!alive.current) return;
    if (result.error) { setLoadError(result.error); return; }
    setData(result);
  }, [id]);
  useEffect(() => { if (ready && id) load(); }, [ready, id, load]);
  const update = change => setData(current => (current ? { ...current, ...change(current) } : current));

  // The composer: the Tutor, scoped to this class until the student picks another (T4 criterion 3).
  const [classId, setClassId] = useState(id);
  useEffect(() => { setClassId(id); }, [id]);
  // The chat the composer started here (null until the first message makes one).
  const [chat, setChat] = useState(null);
  const firstSend = useRef(false);
  async function startNew({ session, material, question }) {
    const result = await startChat({ session, guideId: material?.kind === 'guide' ? material.id : null, classId: classId || null });
    if (!alive.current) return { ok: false };
    if (!result.ok) return { ok: false, message: result.reason === 'limit' ? '' : result.message };
    firstSend.current = true;
    const next = { ...result.chat, class_id: result.chat.class_id || classId || null };
    setChat(next);
    keepOpenChat({ ...next, title: chatTitle([{ role: 'user', text: question }]) });
    return { session: result.session };
  }
  // The first message didn't go through (a plan limit, no connection): the class page is back as it
  // was, with the question in the box.
  const onSendFailed = useCallback(() => {
    if (!firstSend.current) return;
    firstSend.current = false;
    setChat(null);
    keepOpenChat(null);
  }, []);
  const tutor = useTutorChat({ freshOnSend: true, scopeClassId: classId, startWith: chat ? null : startNew, startMessages: [], onSendFailed });
  const [showChat, setShowChat] = useState(true);
  useEffect(() => { if (tutor.loading) setShowChat(true); }, [tutor.loading]);
  const chatting = showChat && tutor.sentHere && tutor.messages.length > 0;
  useEffect(() => { if (tutor.messages.some(message => message.role !== 'user')) firstSend.current = false; }, [tutor.messages]);
  // While the chat shows here, Recent chats keeps it as the open one.
  useEffect(() => { keepOpenChat(chat && chatting ? { ...chat, title: chat.title || chatTitle(tutor.messages) } : null); }, [chat?.id, chatting, tutor.messages[0]?.text]);
  useEffect(() => () => keepOpenChat(null), []);

  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  const [confirm, setConfirm] = useState(null);
  const [renaming, setRenaming] = useState(null); // the class name being edited
  const [renamingRow, setRenamingRow] = useState(null); // { kind: 'guide' | 'chat', id, value }
  const [addingCode, setAddingCode] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [classroomOpen, setClassroomOpen] = useState(false);
  const [planning, setPlanning] = useState(null); // a deadline whose assignment sheet is open
  const [setsOpen, setSetsOpen] = useState(router.query.tab === 'sets');
  const [syncing, setSyncing] = useState(false);
  const { pending, remove, undo } = useUndoDelete();

  // The Chats tab follows the saved chats: a chat started, renamed, moved or deleted anywhere shows here.
  const folderId = data?.folder?.id || '';
  useEffect(() => {
    if (!folderId) return undefined;
    let timer = null;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => classChats(folderId).then(result => {
        if (alive.current && !result.failed) update(() => ({ chats: result.chats, chatsEditable: result.editable }));
      }), 300);
    };
    const off = onChatsChanged(refresh);
    return () => { clearTimeout(timer); off(); };
  }, [folderId]);

  // Library's "Rename class" lands here with ?rename=1.
  useEffect(() => {
    if (!data?.folder || !router.query.rename) return;
    setRenaming(classLabel(data.folder.name).title || data.folder.name);
    router.replace({ pathname: router.pathname, query: { id } }, undefined, { shallow: true });
  }, [data?.folder?.id, router.query.rename]);

  // The rail's Make guide builds from the files already in the composer, through the New sheet.
  useEffect(() => {
    const onMake = event => {
      const files = tutor.attachments.map(file => file.file).filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      buildGuideFrom({ mode: 'upload' }, { files, folderId: classId });
      tutor.setAttachments([]);
    };
    window.addEventListener('cordia:make-guide', onMake);
    return () => window.removeEventListener('cordia:make-guide', onMake);
  }, [tutor.attachments, classId]);

  if (loadError && !data) return (
    <div className="c-empty" role="alert">
      <h1 className="c-title">Class unavailable</h1>
      <p>{loadError}</p>
      <div className="c-row">
        <button type="button" className="c-btn c-btn--primary" onClick={load}>Retry</button>
        <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Library</button>
      </div>
    </div>
  );
  if (!data || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading class" />;

  const { folder, folders, cls, course, classData, deadlines, exam, tallies, chats, chatsEditable } = data;
  const label = classLabel(folder.name);
  const name = label.title || folder.name;
  const code = cls?.code || label.code || '';
  const cover = coverFor(folder, data.guides.map(guide => guide.title));
  const tone = (cover.color % 8) + 1;
  const CoverIcon = COVER_ICON_COMPONENTS[cover.icons[0]] || BookOpen;
  const classes = sidebarClasses(folders);
  const picked = classes.find(item => String(item.id) === String(classId));
  const meta = course ? syncLine(code, syncAgo(data.lastSynced)) : [code && code !== name ? code : '', cls?.school].filter(Boolean).join(' · ');
  const tab = pickTab(router.query.tab, Boolean(course));
  const guides = orderGuides(data.guides.filter(guide => guide.id !== pending?.id), exam?.guideId && isReviewSet(data.guides.find(guide => guide.id === exam.guideId)) ? exam.guideId : '');
  const notes = data.notes.filter(note => note.id !== pending?.id).map(note => ({ kind: 'note', id: note.id, title: note.title || 'Untitled Notes', date: note.updated_at, href: '/smartnotes?id=' + note.id }));
  const lectures = data.lectures.map(lecture => ({ kind: 'lecture', id: lecture.id, title: lecture.title || 'Lecture', date: lecture.lecture_date ? `${lecture.lecture_date}T12:00:00` : lecture.created_at, href: '/lecture/' + lecture.id }));
  const others = [...notes, ...lectures].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  // The exam on the card isn't repeated under Due soon.
  const soon = deadlines ? dueSoon(deadlines.filter(item => String(item.id) !== String(exam?.itemId || ''))) : [];
  const grade = gradeEstimate(data.grades);
  const showDue = Boolean(folder.class_id) && (soon.length > 0 || Boolean(grade) || Boolean(course));
  const showExam = Boolean(exam) || data.guides.length > 0;
  const otherClasses = folders.filter(item => item.id !== folder.id);
  const className = item => classLabel(item.name).title || item.name;

  function setTab(key) {
    router.replace({ pathname: router.pathname, query: { id, ...(key === DEFAULT_TAB ? {} : { tab: key }) } }, undefined, { shallow: true, scroll: false });
  }

  // ---- The class ----
  async function saveName(event) {
    event?.preventDefault();
    const typed = (renaming || '').trim();
    setRenaming(null);
    if (!typed || typed === name) return;
    // A Canvas name keeps its code in front ("MA 125 MA-125-001: Calculus I"), as Library shows it.
    const next = label.code ? folder.name.replace(/: .*$/, ': ' + typed) : typed;
    const previous = folder.name;
    update(current => ({ folder: { ...current.folder, name: next } }));
    const result = await apiFetch('/folders/' + folder.id, { method: 'PATCH', body: JSON.stringify({ name: next }) });
    if (result?.folder) { invalidateFolders(); setToast('Renamed'); }
    else { update(current => ({ folder: { ...current.folder, name: previous } })); setToast(apiErrorMessage(result?.detail, 'Could not rename this class.')); }
  }

  function deleteClass() {
    setConfirm({
      title: `Delete ${name}?`,
      onConfirm: async () => {
        // Deleting the class also leaves its shared class, so it doesn't come back as a link.
        await Promise.all([apiFetch('/folders/' + folder.id, { method: 'DELETE' }), folder.class_id && apiFetch('/classes/' + folder.class_id, { method: 'DELETE' })]);
        invalidateFolders();
        router.push('/library');
      },
    });
  }

  async function toggleShowName() {
    const next = !data.showName;
    update(() => ({ showName: next }));
    const result = await apiFetch('/sharing/settings', { method: 'PUT', body: JSON.stringify({ show_first_name: next }) });
    if (typeof result?.show_first_name === 'boolean') update(() => ({ showName: result.show_first_name }));
    setToast(next ? 'Your first name shows on sets you share' : 'Your sets are shared without your name');
  }

  async function chooseShare(share) {
    if (Boolean(data.shareDefault) === share) return;
    const before = data.shareDefault;
    update(() => ({ shareDefault: share }));
    const saved = await saveShareDefault(folder.class_id, share);
    if (saved === null) { update(() => ({ shareDefault: before })); setToast('Sharing was not changed. Try again.'); return; }
    update(() => ({ shareDefault: saved }));
    setToast(saved ? `New guides here are shared with ${code}` : 'New guides here stay private');
  }

  async function syncNow() {
    setSyncing(true);
    const status = await settleCanvasSync(await syncCanvas());
    setSyncing(false);
    if (status?.last_synced_at) update(() => ({ lastSynced: status.last_synced_at }));
    setToast(status?.error ? apiErrorMessage(status.error, 'Canvas could not sync.') : 'Synced with Canvas');
  }

  // ---- Guides, notes and lectures (the same calls Library makes) ----
  async function moveGuide(guide, target) {
    const result = await apiFetch('/guides/' + guide.id + '/move', { method: 'PATCH', body: JSON.stringify({ folder_id: target }) });
    if (!result?.updated) { setToast(apiErrorMessage(result?.detail, 'Guide not moved.')); return; }
    update(current => ({ guides: current.guides.filter(item => item.id !== guide.id) }));
    const found = folders.find(item => item.id === target);
    setToast('Moved to ' + (found ? className(found) : 'Miscellaneous'));
  }

  async function moveNote(note, target) {
    const result = await apiFetch('/smart_notes/' + note.id, { method: 'PUT', body: JSON.stringify({ folder_id: target || '' }) });
    if (!result?.updated) { setToast(apiErrorMessage(result?.detail, 'Note not moved.')); return; }
    update(current => ({ notes: current.notes.filter(item => item.id !== note.id) }));
    const found = folders.find(item => item.id === target);
    setToast('Moved to ' + (found ? className(found) : 'Miscellaneous'));
  }

  async function moveLecture(lecture, target) {
    const result = await updateLecture({ id: lecture.id, folder_id: target });
    if (result?.detail) { setToast(apiErrorMessage(result.detail, 'Lecture not moved.')); return; }
    update(current => ({ lectures: current.lectures.filter(item => item.id !== lecture.id) }));
    const found = folders.find(item => item.id === target);
    setToast('Moved to ' + (found ? className(found) : 'Miscellaneous'));
  }

  function removeLecture(lecture) {
    setConfirm({
      title: `Delete ${lecture.title}?`,
      onConfirm: async () => {
        setConfirm(null);
        const result = await deleteLecture(lecture.id);
        if (result?.detail) { setToast(apiErrorMessage(result.detail, 'Lecture not deleted.')); return; }
        update(current => ({ lectures: current.lectures.filter(item => item.id !== lecture.id) }));
        setToast('Deleted');
      },
    });
  }

  async function saveRowName(event) {
    event?.preventDefault();
    const editing = renamingRow;
    setRenamingRow(null);
    const title = editing?.value.trim();
    if (!title) return;
    if (editing.kind === 'chat') {
      const result = await renameChat(editing.id, title);
      if (!result.ok) showChatMessage(result.message);
      return;
    }
    const result = await apiFetch('/guides/' + editing.id + '/rename', { method: 'PATCH', body: JSON.stringify({ title }) });
    if (result?.title) update(current => ({ guides: current.guides.map(item => (item.id === editing.id ? { ...item, title: result.title } : item)) }));
    else setToast(apiErrorMessage(result?.detail, 'Guide not renamed.'));
  }

  async function toggleStar(guide) {
    update(current => ({ guides: current.guides.map(item => (item.id === guide.id ? { ...item, is_bookmarked: !item.is_bookmarked } : item)) }));
    const result = await apiFetch('/guides/' + guide.id + '/bookmark', { method: 'PATCH' });
    if (typeof result?.is_bookmarked === 'boolean') update(current => ({ guides: current.guides.map(item => (item.id === guide.id ? { ...item, is_bookmarked: result.is_bookmarked } : item)) }));
  }

  function deleteGuide(guide) {
    // A guide moved in from an old note takes that note with it (pages/smartnotes.js).
    const note = String(guide.source_type || '').startsWith('note:') ? ['/smart_notes/' + guide.source_type.slice(5)] : [];
    remove({ id: guide.id, title: guide.title, also: note });
  }

  // Move to class: Miscellaneous, then the student's other classes (as Library lists them).
  const moveTo = onMove => ({
    label: 'Move to class', icon: FolderInput, items: [
      { key: 'none', label: 'Miscellaneous', onSelect: () => onMove(null) },
      ...otherClasses.map(item => ({ key: item.id, label: className(item), meta: classLabel(item.name).code || undefined, onSelect: () => onMove(item.id) })),
    ],
  });

  function guideMenu(guide) {
    return [
      { label: 'Open guide', icon: ArrowUpRight, onSelect: () => router.push('/guide/' + guide.id) },
      { label: 'Rename', icon: Pencil, onSelect: () => setRenamingRow({ kind: 'guide', id: guide.id, value: guide.title || '' }) },
      moveTo(target => moveGuide(guide, target)),
      { label: guide.is_bookmarked ? 'Unstar' : 'Star', icon: Star, onSelect: () => toggleStar(guide) },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => deleteGuide(guide) },
    ];
  }

  function otherMenu(item) {
    const source = item.kind === 'note' ? data.notes.find(note => note.id === item.id) : data.lectures.find(lecture => lecture.id === item.id);
    if (item.kind === 'note') return [
      { label: 'Open note', icon: ArrowUpRight, onSelect: () => router.push(item.href) },
      moveTo(target => moveNote(source, target)),
      { label: 'Delete note', icon: Trash2, danger: true, onSelect: () => remove({ id: item.id, title: item.title, path: '/smart_notes/' + item.id }) },
    ];
    return [
      { label: 'Open lecture', icon: ArrowUpRight, onSelect: () => router.push(item.href) },
      moveTo(target => moveLecture(source, target)),
      { label: 'Delete lecture', icon: Trash2, danger: true, onSelect: () => removeLecture(source) },
    ];
  }

  // ---- Chats ----
  function backToClass() {
    setShowChat(false);
    setChat(null);
    keepOpenChat(null);
    // The next message from the class composer starts a new chat; this one is saved (lib/useTutorChat.js).
    window.dispatchEvent(new Event('cordia:tutor-new'));
  }

  // A chat's ⋯: the chat's own actions (Rename, Move to class, Delete with Undo, as in Recent
  // chats), once saved chats can be changed on this backend.
  function chatMenu(row) {
    return [
      { key: 'open', label: 'Open chat', icon: ArrowUpRight, onSelect: () => router.push(chatHref(row.id)) },
      ...(chatsEditable ? [
        { key: 'rename', label: 'Rename', icon: PenLine, onSelect: () => setRenamingRow({ kind: 'chat', id: row.id, value: row.title || '' }) },
        {
          key: 'move', label: 'Move to class', icon: FolderInput, items: [
            { key: 'none', label: 'No class', icon: dot(0), onSelect: () => moveChat(row.id, null).then(result => { if (!result.ok) showChatMessage(result.message); }) },
            ...classes.filter(item => String(item.id) !== String(folder.id)).map(item => ({ key: String(item.id), label: item.code, meta: item.name !== item.code ? item.name : undefined, icon: dot(item.tone), onSelect: () => moveChat(row.id, String(item.id)).then(result => { if (!result.ok) showChatMessage(result.message); }) })),
          ],
        },
        { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => deleteChat(row.id).then(result => { if (!result.ok) showChatMessage(result.message); }) },
      ] : []),
    ];
  }

  // ---- Deadlines ----
  async function markDone(item) {
    update(current => ({ deadlines: (current.deadlines || []).map(row => (row.id === item.id ? { ...row, done: true } : row)) }));
    if (await setDeadlineDone(item.id, true)) { setToast('Marked done'); return; }
    update(current => ({ deadlines: (current.deadlines || []).map(row => (row.id === item.id ? { ...row, done: false } : row)) }));
    setToast('That didn’t save. Try again.');
  }

  // ---- Menus ----
  const classMenu = [
    { label: 'New in this class', icon: Plus, onSelect: () => openNewSheet('', { folderId: folder.id }) },
    ...(data.guides.length && UUID.test(folder.id) ? [{ label: 'Study a mix from this class', icon: Play, onSelect: () => router.push('/session?scope=folder&id=' + folder.id) }] : []),
    { label: 'Rename class', icon: Pencil, onSelect: () => setRenaming(name) },
    { label: 'Change cover and colour', icon: ImageIcon, onSelect: () => setCoverOpen(true) },
    ...(folder.class_id ? [] : [{ label: 'Add course code', icon: Hash, onSelect: () => { setTab('deadlines'); setAddingCode(true); } }]),
    { label: 'Delete class', icon: Trash2, danger: true, onSelect: deleteClass },
  ];
  const shared = Boolean(folder.class_id) && data.shareDefault === true && !cls?.sharing_blocked;
  const shareItems = [
    ...(folder.class_id && !cls?.sharing_blocked ? [
      { key: 'private', label: 'Private', meta: 'New guides here stay yours', icon: Lock, current: !shared, onSelect: () => chooseShare(false) },
      { key: 'share', label: `Share with ${code}`, meta: 'New guides here go to classmates', icon: Users, current: shared, onSelect: () => chooseShare(true) },
    ] : []),
    ...(cls?.sharing_blocked ? [{ key: 'blocked', label: 'Sharing is off for this class', icon: Lock, disabled: true }] : []),
    ...(!folder.class_id ? [{ key: 'code', label: 'Add course code to share', meta: 'Classmates see sets shared with the code', icon: Hash, onSelect: () => { setTab('deadlines'); setAddingCode(true); } }] : []),
    ...(folder.class_id && data.showName !== null ? [{ key: 'name', label: data.showName ? 'Hide my first name on shared sets' : 'Show my first name on shared sets', icon: UserRound, onSelect: toggleShowName }] : []),
    ...(CLASSROOMS_ON ? [{ key: 'room', label: 'Add to classroom', icon: Plus, onSelect: () => setClassroomOpen(true) }] : []),
  ];

  const needsCode = (
    <div className="cls-pane cls-needs-code">
      <p className="cls-line">Add this class’s course code to see sets classmates share and your Canvas deadlines.</p>
      {addingCode
        ? <AddClass folderId={folder.id} onCancel={() => setAddingCode(false)} onAdded={() => { setAddingCode(false); invalidateFolders(); load(); }} />
        : <button type="button" className="c-btn c-btn--secondary" onClick={() => setAddingCode(true)}><Hash {...ICON} />Add course code</button>}
    </div>
  );

  // ---- Rows ----
  const renameField = ariaLabel => (
    <form className="cls-row-main" onSubmit={saveRowName}>
      <input className="c-input" value={renamingRow.value} maxLength={200} onChange={event => setRenamingRow({ ...renamingRow, value: event.target.value })} onBlur={saveRowName} onKeyDown={event => { if (event.key === 'Escape') setRenamingRow(null); }} aria-label={ariaLabel} autoFocus />
    </form>
  );

  function guideRow(guide) {
    const tally = tallies[guide.id];
    const lead = exam?.guideId === guide.id && Number.isFinite(exam.percent);
    const parts = masteryParts(tally);
    const learnHref = `/learn/${encodeURIComponent(guide.id)}${lead ? `?test=${exam.date}` : ''}`;
    return (
      <li key={guide.id} className={'cls-row' + (lead ? ' is-lead' : '')}>
        {lead
          ? <span className="cls-row-ring"><ProgressRing value={exam.percent / 100} size={36} stroke={3.5} label={false} title={`${exam.percent}% ready for the next exam`} /></span>
          : <span className="cls-tile"><FileText {...ICON} /></span>}
        {renamingRow?.kind === 'guide' && renamingRow.id === guide.id ? renameField('Guide title') : (
          <Link href={'/guide/' + guide.id} className="cls-row-main">
            <span className="cls-row-title c-truncate">{guide.title || 'Untitled guide'}</span>
            <span className="c-meta c-truncate">{guideMeta(guide, tally)}</span>
          </Link>
        )}
        {tally?.total > 0 && (
          <span className="cls-mastery">
            {!lead && (
              <span className="cls-bar" aria-hidden="true">
                {parts.map(part => <span key={part.key} className={'is-' + part.key} style={{ flexGrow: part.count }} />)}
              </span>
            )}
            <span className="c-meta">{masteredLine(tally)}</span>
          </span>
        )}
        <Link href={learnHref} className="c-btn c-btn--secondary cls-learn" aria-label={`Learn ${guide.title || 'this guide'}`}>Learn</Link>
        <Menu label={`More for ${guide.title || 'this guide'}`} items={guideMenu(guide)} triggerClassName={MORE} />
      </li>
    );
  }

  function otherRow(item) {
    const Icon = item.kind === 'note' ? NotebookPen : AudioLines;
    return (
      <li key={item.kind + item.id} className="cls-row">
        <span className="cls-tile"><Icon {...ICON} /></span>
        <Link href={item.href} className="cls-row-main">
          <span className="cls-row-title c-truncate">{item.title}</span>
          <span className="c-meta">{[item.kind === 'note' ? 'Note' : 'Lecture', shortDay(item.date)].filter(Boolean).join(' · ')}</span>
        </Link>
        <Menu label={`More for ${item.title}`} items={otherMenu(item)} triggerClassName={MORE} />
      </li>
    );
  }

  function chatRow(row) {
    const title = row.title || 'Tutor chat';
    return (
      <li key={row.id} className="cls-row">
        <span className="cls-tile"><MessageCircle {...ICON} /></span>
        {renamingRow?.kind === 'chat' && renamingRow.id === row.id ? renameField('Chat title') : (
          <Link href={chatHref(row.id)} className="cls-row-main">
            <span className="cls-row-title c-truncate">{title}</span>
            <span className="c-meta">{shortDay(row.updated_at || row.created_at)}</span>
          </Link>
        )}
        <Menu label={`More for ${title}`} items={chatMenu(row)} triggerClassName={MORE} />
      </li>
    );
  }

  const setCount = classData?.sets?.length || 0;
  const panels = {
    chats: chats.length ? (
      <ul className="cls-pane cls-rows">{chats.map(chatRow)}</ul>
    ) : (
      <div className="cls-pane cls-empty">
        <MessageCircle size={24} strokeWidth={1.75} aria-hidden="true" />
        <p className="cls-line">No chats in this class yet</p>
        <p className="c-meta">Ask about this class above to start a chat.</p>
      </div>
    ),
    guides: (
      <>
        {guides.length + others.length > 0 ? (
          <ul className="cls-pane cls-rows">
            {guides.map(guideRow)}
            {others.map(otherRow)}
          </ul>
        ) : (
          <div className="cls-pane cls-empty">
            <BookOpen size={24} strokeWidth={1.75} aria-hidden="true" />
            <p className="cls-line">No guides in this class yet</p>
            <p className="c-meta">Attach slides, a PDF or a lecture above and ask for a guide, or start one from New.</p>
            <button type="button" className="c-btn c-btn--secondary" onClick={() => openNewSheet('', { folderId: folder.id })}><Plus {...ICON} />New in this class</button>
          </div>
        )}
        {folder.class_id ? (
          <section className="cls-sets">
            <button type="button" className="cls-sets-toggle" aria-expanded={setsOpen} aria-controls="cls-sets-body" onClick={() => setSetsOpen(open => !open)}>
              <Users {...ICON} />
              <span className="cls-sets-label">Class sets</span>
              <span className="c-meta">{cls?.sharing_blocked ? 'Sharing is off' : setCount ? `${setCount} shared by classmates` : 'None shared yet'}</span>
              <ChevronDown {...SMALL} className={'cls-sets-chevron' + (setsOpen ? ' is-open' : '')} />
            </button>
            {setsOpen && (
              <div id="cls-sets-body" className="cls-sets-body">
                {CLASSROOMS_ON && <CourseClassrooms classId={folder.class_id} onToast={setToast} />}
                <ClassSets classId={folder.class_id} onToast={setToast} initial={classData} />
              </div>
            )}
          </section>
        ) : !guides.length ? null : (
          <p className="c-meta cls-sets-hint">Add this class’s course code (⋯ › Add course code) to see sets classmates share.</p>
        )}
      </>
    ),
    files: course ? (
      <div className="cls-files">
        <div className="cls-files-head">
          <span className="c-meta">{data.lastSynced ? `Synced from Canvas ${syncAgo(data.lastSynced)}` : 'From Canvas'}</span>
          <span className="cls-files-actions">
            <Link href="/canvas" className="c-btn c-btn--quiet cls-small-btn">Canvas settings</Link>
            <button type="button" className="c-btn c-btn--secondary cls-small-btn" onClick={syncNow} disabled={syncing}><RefreshCw {...SMALL} />{syncing ? 'Syncing…' : 'Sync now'}</button>
          </span>
        </div>
        <div className="cls-pane cls-files-body"><CourseFiles course={course} /></div>
      </div>
    ) : null,
    deadlines: !folder.class_id ? needsCode : <ClassDeadlines classId={folder.class_id} deadlines={deadlines} onOpen={setPlanning} />,
    grades: course ? <ClassGrades courseId={course.id} guides={data.guides} onMakeGuide={() => setTab('files')} /> : null,
  };

  const overlays = (
    <>
      {confirm && <ConfirmDialog title={confirm.title} confirmLabel="Delete" onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />}
      {coverOpen && (
        <ClassCoverSheet folder={folder} titles={data.guides.map(guide => guide.title)} onClose={() => setCoverOpen(false)}
          onSaved={saved => { update(current => ({ folder: { ...current.folder, ...saved }, folders: current.folders.map(item => (item.id === saved.id ? { ...item, ...saved } : item)) })); setCoverOpen(false); invalidateFolders(); setToast('Cover saved'); }} />
      )}
      {classroomOpen && (
        <AddToClassroom item={{ type: 'folder', id: folder.id, title: folder.name, mine: true }}
          onClose={() => setClassroomOpen(false)} onAdded={room => { setClassroomOpen(false); setToast(`Shared with ${room?.name || 'the classroom'}`); }} />
      )}
      {planning && <AssignmentSheet item={planning} onClose={() => setPlanning(null)} />}
      {pending ? (
        <div className="c-toast" role="status">
          <span>Deleted</span>
          <button type="button" className="c-btn c-btn--quiet" onClick={undo}>Undo</button>
        </div>
      ) : toast && <div className="c-toast" role="status"><span>{toast}</span></div>}
    </>
  );

  // ---- A chat started here (DESIGN-SPEC 4.3): the conversation scrolls, the composer sits under it ----
  if (chatting) {
    return (
      <div ref={tutor.rootRef} className={'chat-home is-chat cls-chat' + (tutor.attachDropActive ? ' is-drop' : '')}>
        <Head><title>{pageTitle(name)}</title></Head>
        <header className="chat-home-top">
          <button type="button" className="c-icon-btn" onClick={backToClass} aria-label={`Back to ${name}`}><ArrowLeft {...ICON} /></button>
          <h1 className="chat-home-title c-truncate">{chatTitle(tutor.messages)}</h1>
          {picked && <span className="chat-home-chip"><span className="c-class-dot" style={{ '--dot': `var(--cover-ink-${picked.tone})` }} aria-hidden="true" />{picked.code}</span>}
        </header>
        <div className="chat-home-stage">
          <div className="cordia-tutor-messages chat-home-thread" aria-live="polite">
            <div className="chat-home-column">
              <TutorMessages tutor={tutor} avatar />
              <div ref={tutor.endRef} />
            </div>
          </div>
          <div className="chat-home-composer">
            <Composer tutor={tutor} classes={classes} classId={classId} onClassChange={setClassId} variant="chat" autoFocus />
          </div>
        </div>
        <p className="chat-home-note">The Tutor answers from your class material. Check anything that matters before you rely on it.</p>
        {overlays}
      </div>
    );
  }

  return (
    <Reveal phase={gate}>
      <div ref={tutor.rootRef} className={'cls-v2' + (tutor.attachDropActive ? ' is-drop' : '')}>
        <Head><title>{pageTitle(name)}</title></Head>
        <header className="cls-head">
          <button type="button" className="cls-cover" style={{ '--cv': `var(--cover-${tone})`, '--cv-ink': `var(--cover-ink-${tone})` }} onClick={() => setCoverOpen(true)} aria-label={`Change cover for ${name}`}>
            <CoverIcon size={28} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="cls-head-text">
            {renaming !== null ? (
              <form onSubmit={saveName}>
                <input className="c-input cls-name-input" value={renaming} maxLength={100} onChange={event => setRenaming(event.target.value)} onBlur={saveName} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Class name" autoFocus />
              </form>
            ) : <h1 className="cls-name">{name}</h1>}
            {meta && <span className="c-meta cls-head-meta">{meta}</span>}
          </div>
          <div className="cls-head-actions">
            <Menu
              label={`Sharing: ${shared ? `shared with ${code}` : 'private'}`}
              items={shareItems}
              triggerClassName="c-btn c-btn--secondary cls-share"
              trigger={<>{shared ? <Users {...SMALL} /> : <Lock {...SMALL} />}<span>{shared ? `Shared with ${code}` : 'Private'}</span></>}
            />
            <Menu label="Class options" items={classMenu} />
          </div>
        </header>

        <div className="cls-composer">
          <Composer tutor={tutor} classes={classes} classId={classId} onClassChange={setClassId} variant="chat" showError />
        </div>

        <div className="cls-cols">
          <section className="cls-main" aria-label="Class material">
            <SegmentedControl kind="tabs" label="Class sections" className="cls-tabs" scroller>
              {classTabs(Boolean(course)).map(item => (
                <button key={item.key} id={'cls-tab-' + item.key} type="button" role="tab" aria-selected={tab === item.key} aria-controls="cls-panel" className={tab === item.key ? 'is-active' : ''} onClick={() => setTab(item.key)}>
                  {item.label}{item.key === 'guides' && <span className="cls-count">{guides.length}</span>}
                </button>
              ))}
            </SegmentedControl>
            <div id="cls-panel" role="tabpanel" aria-labelledby={'cls-tab-' + tab} className="cls-panel">
              {panels[tab]}
            </div>
          </section>

          {(showExam || showDue) && (
            <aside className="cls-aside" aria-label="Exam and deadlines">
              {showExam && <ClassExamCard exam={exam} folderId={folder.id} className={name} hasGuides={data.guides.length > 0} onPlan={setPlanning} />}
              {showDue && (
                <section className="cls-pane cls-due" aria-labelledby="cls-due-title">
                  <h2 id="cls-due-title" className="cls-due-title">Due soon</h2>
                  {soon.length ? (
                    <ul className="cls-due-list">
                      {soon.map(item => (
                        <li key={item.id} className="cls-due-item">
                          <button type="button" className="cls-due-row" onClick={() => setPlanning(item)}>
                            <span className="cls-due-main">
                              <span className="cls-due-name c-truncate">{deadlineTitle(item)}</span>
                              <span className="c-meta">{dueWhen(item.due_at)}</span>
                            </span>
                          </button>
                          <Menu label={`More for ${deadlineTitle(item)}`} triggerClassName={MORE} items={[
                            { label: 'Plan it', icon: CalendarCheck, onSelect: () => setPlanning(item) },
                            { label: 'Mark done', icon: Check, onSelect: () => markDone(item) },
                          ]} />
                        </li>
                      ))}
                    </ul>
                  ) : <p className="c-meta cls-due-none">Nothing due in this class</p>}
                  {grade && (
                    <button type="button" className="cls-due-row is-grade" onClick={() => setTab('grades')}>
                      <span className="cls-due-main">
                        <span className="cls-due-name">Grade estimate</span>
                        <span className="c-meta">From your scores in Canvas</span>
                      </span>
                      <span className="cls-grade">{[grade.percent, grade.letter].filter(Boolean).join(' · ')}</span>
                    </button>
                  )}
                </section>
              )}
            </aside>
          )}
        </div>
        {overlays}
      </div>
      <ClassProjectStyles />
    </Reveal>
  );
}

function ClassProjectStyles() {
  return (
    <style jsx global>{`
      /* The page fills the space between the sidebar and the rail, 12px from each (DESIGN-SPEC 3.1). */
      @media (min-width: 768px) {
        :root[data-shell='new'] .app-shell:has(.cls-v2) .main-content { padding: 0 var(--side-gap) !important; }
        :root[data-shell='new'] .app-shell:has(:is(.cls-v2, .cls-chat)) .workspace-route { max-width: none; }
      }
      .cls-v2 { box-sizing: border-box; display: flex; flex-direction: column; gap: 20px; min-width: 0; padding: var(--side-gap) 0; }
      .cls-v2.is-drop .composer { outline: 2px dashed var(--focus-ring); outline-offset: 2px; }

      /* Header: the 56px cover tile, the name in Newsreader 40, code and sync, sharing and ⋯. */
      .cls-head { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; min-width: 0; padding: 0 4px; }
      .cls-cover {
        flex: none; display: grid; place-items: center; width: 56px; height: 56px; padding: 0; border: 0; border-radius: 16px; cursor: pointer;
        background: var(--cv); color: var(--cv-ink); box-shadow: var(--glass-inner-shadow);
        transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
      }
      @media (hover: hover) { .cls-cover:hover { transform: var(--lift); box-shadow: var(--glass-inner-shadow), var(--lift-shadow); } }
      .cls-cover:active { transform: var(--press); }
      .cls-head-text { flex: 1 1 280px; display: grid; gap: 4px; min-width: 0; }
      .cls-head h1.cls-name { margin: 0; color: var(--ink); font: 600 2.5rem/1.12 var(--font-display) !important; letter-spacing: -0.015em !important; text-wrap: balance; overflow-wrap: anywhere; }
      .cls-head .cls-name-input { height: 52px; width: min(640px, 100%); font: 600 1.75rem/1.15 var(--font-display); }
      .cls-head-meta { font-variant-numeric: tabular-nums; }
      .cls-head-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      .cls-head-actions .cls-share { height: 40px; min-height: 40px; padding: 0 16px; gap: 8px; }
      .cls-head-actions .cls-share .lucide { color: var(--muted); }

      .cls-composer { min-width: 0; }

      /* Two columns: the tabs and list (flex 2, at least 520px) and the exam aside (flex 1, at least
         300px). With less room than both need (below 900px), the aside goes below. */
      .cls-cols { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; min-width: 0; }
      .cls-main { flex: 2 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
      .cls-aside { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
      .cls-main .cls-tabs { align-self: flex-start; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
      .cls-main .cls-tabs::-webkit-scrollbar { display: none; }
      .cls-main .cls-tabs button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
      .cls-count { color: var(--muted); font-variant-numeric: tabular-nums; }
      .cls-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .cls-panel:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; border-radius: 20px; }

      /* A resting pane of glass (DESIGN-SPEC 2.3): 20px corners, 8px inside. */
      .cls-pane {
        position: relative; isolation: isolate; box-sizing: border-box; margin: 0; padding: 8px; list-style: none; border-radius: 20px;
        background: var(--glass-sheen), var(--glass-fill); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--glass-shadow);
      }
      .cls-pane::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none; background: var(--glass-grain) repeat; background-size: 180px 180px; opacity: var(--glass-grain-opacity); }
      .cls-pane::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; background: var(--glass-rim); -webkit-mask: var(--glass-rim-mask-webkit); -webkit-mask-composite: xor; mask: var(--glass-rim-mask); }
      /* One frost per spot: nothing on the pane blurs again. */
      .cls-pane :not(.c-menu) { -webkit-backdrop-filter: none; backdrop-filter: none; }
      .cls-rows { display: flex; flex-direction: column; }
      .cls-line { margin: 0; color: var(--ink); font: 600 1.0625rem/1.4 var(--font-sans); }

      /* Rows (DESIGN-SPEC 4.4): a 40px tile, the title and its meta, the mastery bar, Learn and ⋯. */
      .cls-row { display: flex; align-items: center; gap: 16px; min-height: 68px; padding: 12px 12px 12px 20px; border-radius: 16px; transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
      @media (hover: hover) { .cls-row:hover { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); } }
      .cls-row.is-lead { background: var(--selected-glass); box-shadow: var(--selected-glass-shadow); }
      .cls-tile { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); color: var(--muted); }
      .cls-row-ring { flex: none; display: grid; place-items: center; width: 40px; height: 40px; }
      .cls-row-ring .c-ring-track { stroke: var(--ring-track); }
      .cls-v2 .cls-row-main { flex: 1 1 auto; display: grid; gap: 2px; min-width: 0; color: var(--ink); text-decoration: none; }
      .cls-v2 a.cls-row-main:hover { text-decoration: none; }
      .cls-v2 a.cls-row-main:hover .cls-row-title { text-decoration: underline; text-decoration-color: var(--hairline); text-underline-offset: 4px; }
      .cls-row-title { font: 600 1.0625rem/1.3 var(--font-sans); }
      .cls-row-main .c-input { height: 40px; }
      .cls-mastery { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .cls-bar { display: flex; gap: 2px; width: 120px; height: 6px; }
      .cls-bar > span { flex-basis: 0; min-width: 2px; border-radius: var(--r-pill); }
      .cls-bar > .is-mastered { background: var(--mastery-mastered); }
      .cls-bar > .is-familiar { background: var(--mastery-familiar); }
      .cls-bar > .is-learning { background: var(--mastery-learning); }
      .cls-bar > .is-new { background: var(--mastery-new); }
      .cls-v2 .cls-learn { flex: none; height: 36px; min-height: 36px; padding: 0 14px; }

      /* Every row's ⋯ (F3) sits at its right end: shown on hover, on keyboard focus anywhere in the row
         and while its menu is open; always on touch screens. It keeps its room, so nothing shifts. */
      .cls-v2 .cls-more { flex: none; opacity: 0; transition: opacity var(--dur) var(--ease), background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
      .cls-v2 :is(.cls-row, .cp-row, .cls-due-item, .cls-exam):focus-within .cls-more, .cls-v2 .cls-more[aria-expanded='true'] { opacity: 1; }
      .cls-v2 .cls-more[aria-expanded='true'] { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); }
      @media (hover: hover) { .cls-v2 :is(.cls-row, .cp-row, .cls-due-item, .cls-exam):hover .cls-more { opacity: 1; } }
      @media (hover: none) { .cls-v2 .cls-more { opacity: 1; } }

      .cls-empty { display: grid; justify-items: center; gap: 6px; padding: 32px 24px; text-align: center; color: var(--muted); }
      .cls-empty .cls-line { margin-top: 4px; }
      .cls-empty .c-meta { margin: 0 0 6px; max-width: 46ch; }
      .cls-needs-code { display: grid; gap: 12px; padding: 20px; justify-items: start; }
      .cls-needs-code .cls-add { width: 100%; box-shadow: none; padding: 0; background: none; border: 0; }

      /* Class sets, under the guides. */
      .cls-sets { display: grid; gap: 12px; }
      .cls-sets-toggle {
        display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 0 16px; border: 0; border-radius: 16px;
        background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); color: var(--ink); font: 600 0.9375rem/1 var(--font-sans); text-align: left; cursor: pointer;
        transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
      }
      .cls-sets-toggle .lucide { color: var(--muted); }
      @media (hover: hover) { .cls-sets-toggle:hover { transform: var(--lift); box-shadow: var(--glass-inner-shadow), var(--lift-shadow); } }
      .cls-sets-toggle:active { transform: var(--press); }
      .cls-sets-label { flex: none; }
      .cls-sets-toggle .c-meta { flex: 1 1 auto; min-width: 0; }
      .cls-sets-chevron { transition: transform var(--dur) var(--ease); }
      .cls-sets-chevron.is-open { transform: rotate(180deg); }
      .cls-sets-body { display: grid; gap: 12px; }
      .cls-sets-hint { margin: 0; padding: 0 8px; }

      .cls-files { display: grid; gap: 12px; }
      .cls-files-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; }
      .cls-files-actions { display: flex; gap: 6px; }
      .cls-v2 .cls-small-btn { height: 36px; min-height: 36px; padding: 0 14px; font-size: 0.875rem; }
      .cls-files-body { padding: 8px; }

      /* Due soon: a resting pane, deadlines that open their assignment sheet, the grade estimate. */
      .cls-due { padding: 16px 8px 8px; display: grid; gap: 2px; }
      .cls-aside h2.cls-due-title { margin: 0; padding: 0 12px 6px; color: var(--ink); font: 600 1.0625rem/1.3 var(--font-sans) !important; letter-spacing: 0 !important; }
      .cls-due-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
      .cls-due-item { display: flex; align-items: center; gap: 4px; border-radius: 14px; transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
      @media (hover: hover) { .cls-due-item:hover { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); } }
      .cls-due-item .c-menu-wrap { flex: none; margin-right: 4px; }
      .cls-due-row {
        display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 52px; padding: 6px 12px; border: 0; border-radius: 14px;
        background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer;
        transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
      }
      .cls-due-main { flex: 1 1 auto; display: grid; gap: 2px; min-width: 0; }
      .cls-due-name { font: 600 0.9375rem/1.35 var(--font-sans); }
      .cls-due-none { margin: 0; padding: 4px 12px 10px; }
      .cls-due-row.is-grade { margin-top: 4px; box-shadow: 0 -1px 0 var(--hairline); border-radius: 0 0 14px 14px; }
      @media (hover: hover) { .cls-due-row.is-grade:hover { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); border-radius: 14px; } }
      .cls-grade { flex: none; font: 600 0.9375rem/1 var(--font-sans); font-variant-numeric: tabular-nums; }

      .cls-v2 :is(.cls-due-row, .cls-sets-toggle, .cls-cover):focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
      .cls-chat .chat-home-top .c-icon-btn { flex: none; }

      @media (prefers-reduced-motion: reduce) {
        .cls-cover, .cls-sets-toggle, .cls-sets-chevron, .cls-v2 .cls-more { transition: none; }
        .cls-cover:hover, .cls-cover:active, .cls-sets-toggle:hover, .cls-sets-toggle:active { transform: none; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .cls-pane { background: var(--surface-raised); -webkit-backdrop-filter: none; backdrop-filter: none; }
      }
    `}</style>
  );
}
