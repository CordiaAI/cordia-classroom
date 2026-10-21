import { useEffect, useRef, useState } from 'react';
import { LoadingArea, Reveal, SectionLoader, useLoadGate } from '../../components/CordiaLoader';
import BodyPortal from '../../components/BodyPortal';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowLeft, Brain, Download, ExternalLink, FolderInput, Layers, Lock, MessageCircle, NotebookText, PencilRuler, Pencil, Play, RefreshCw, Star, Stethoscope, SquarePen, Trash2, Users, X,
} from 'lucide-react';
import { apiErrorMessage, apiFetch, authHeaders } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { guideNotes, hasStudyNotes, isStudyGuideNotes, parseQAPairs, parseStudyNotes } from '../../lib/formatters';
import useSessionTracker from '../../lib/useSessionTracker';
import StudyAidPanel from '../../components/StudyAidPanel';
import StudyDocument from '../../components/StudyDocument';
import OutlineEditor from '../../components/OutlineEditor';
import { newRequestId } from '../../lib/guideCreate';
import { classLabel } from '../../lib/classLabel';
import Menu from '../../components/Menu';
import ClassChip from '../../components/ClassChip';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useLearningStyle } from '../../lib/learningStyle';
import { rememberGuidePage, rememberLastGuide } from '../../lib/userStore';
import { activeStep, walkthroughEvent } from '../../lib/walkthrough';
import { requestTip } from '../../lib/tips';
import { readUserValue, writeUserValue } from '../../lib/userStore';

const NURSING_TERMS = ['nursing', 'nurse', 'nclex', 'patient', 'vital signs', 'medication administration', 'care plan', 'nursing diagnosis', 'iv therapy', 'delegation', 'scope of practice', 'sbar', 'discharge planning', 'wound care', 'fall prevention', 'infection control', 'postoperative', 'preoperative', 'lab values', 'contraindications'];

// NCLEX Mode is offered only for nursing material.
function isNursing(guide) {
  if (guide?.domain === 'nursing') return true;
  const text = `${guide?.title || ''}\n${guide?.study_guide || ''}`.toLowerCase();
  return NURSING_TERMS.filter(term => text.includes(term)).length >= 4;
}

function ask(guideId, prompt, send = false) {
  window.dispatchEvent(new CustomEvent('cordia:tutor-prompt', { detail: { guideId, prompt, send } }));
}

// **term** in notes → bold.
function rich(text) {
  return String(text).split(/\*\*(.+?)\*\*/g).map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : part));
}

function exportGuide(guide) {
  const pairs = parseQAPairs(guide.study_guide);
  const notes = guideNotes(guide);
  const lines = [`# ${guide.title}`, ''];
  if (hasStudyNotes(notes)) {
    lines.push('## Notes', '');
    if (notes.overview) lines.push(notes.overview, '');
    notes.sections.forEach(section => lines.push(...(section.heading ? [`### ${section.heading}`, ''] : []), ...section.points.flatMap(point => [`- ${point.text}`, ...point.sub.map(item => `  - ${item}`)]), ''));
    if (notes.keyPoints.length) lines.push('### Key points', '', ...notes.keyPoints.map(point => `- ${point}`), '');
  }
  lines.push('## Questions', '');
  pairs.forEach((pair, index) => lines.push(`### ${index + 1}. ${pair.question}`, '', pair.answer, ''));
  if (guide.flashcards?.length) lines.push('## Cards', '', ...guide.flashcards.map(card => `- **${card.front}** — ${card.back}`), '');
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${(guide.title || 'guide').replace(/[^\w\s-]/g, '').trim() || 'guide'}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function MakeCard({ front: initialFront, onSave, onClose }) {
  const [front, setFront] = useState(initialFront);
  const [back, setBack] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <BodyPortal>
    <div className="c-scrim" onClick={onClose}>
      <form className="c-sheet make-card" role="dialog" aria-modal="true" aria-labelledby="make-card-title" onClick={event => event.stopPropagation()} onSubmit={async event => { event.preventDefault(); setSaving(true); await onSave({ front: front.trim(), back: back.trim() }); setSaving(false); }}>
        <header className="c-sheet-head">
          <h2 id="make-card-title" className="c-title">New card</h2>
          <button type="button" className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        <label className="c-field"><span>Front</span><textarea className="c-input" value={front} onChange={event => setFront(event.target.value)} rows={3} /></label>
        <label className="c-field"><span>Back</span><textarea className="c-input" value={back} onChange={event => setBack(event.target.value)} rows={3} autoFocus /></label>
        <div className="make-card-foot"><button type="submit" data-spot="card-save" className="c-btn c-btn--primary" disabled={saving || !front.trim() || !back.trim()}>{saving ? 'Saving…' : 'Save'}</button></div>
        <style jsx>{`
          .make-card { display: grid; gap: 16px; width: min(520px, 100%); }
          .make-card .c-sheet-head { margin-bottom: 0; }
          .make-card textarea { min-height: 88px; }
          .make-card-foot { display: flex; justify-content: flex-end; }
        `}</style>
      </form>
    </div>
    </BodyPortal>
  );
}

export default function GuidePage() {
  const router = useRouter();
  const { id } = router.query;
  const { ready } = useRequireAuth();
  useSessionTracker('read', id || null);
  const [guide, setGuide] = useState(null);
  const [loadError, setLoadError] = useState('');
  // Outline: the topic as an outline. By page: every question, 3 per page, to read through.
  const [view, setView] = useState('outline');
  // The Outline is also where the student's notes live; bumping this refills it after a rewrite.
  const [notesVersion, setNotesVersion] = useState(0);
  const [making, setMaking] = useState(''); // '' | 'outline' | 'cards'
  const [classes, setClasses] = useState([]);
  useEffect(() => { apiFetch('/folders').then(data => setClasses(data?.folders || [])); }, []);
  // Every guide has outline notes: one without them gets them written the first time it opens.
  const [notesState, setNotesState] = useState('idle'); // idle | making | done
  const notesAsked = useRef('');
  const [page, setPage] = useState(0);
  const [revealed, setRevealed] = useState(new Set());
  const [renaming, setRenaming] = useState(null);
  const [openAid, setOpenAid] = useState(null);
  const [cardDraft, setCardDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState('');
  // The outline before "Regenerate outline", so the toast can put it back.
  const [undoNotes, setUndoNotes] = useState(null);
  const [sharing, setSharing] = useState(null);
  const prevRevealed = useRef(0);
  const { learningStyle } = useLearningStyle();
  const gate = useLoadGate(Boolean(guide) || Boolean(loadError));

  useEffect(() => {
    if (!router.isReady) return;
    const requested = Number(router.query.page);
    if (requested > 0) setPage(requested - 1);
  }, [router.isReady]);

  // ?learn=1 opens Explain on the first question.
  useEffect(() => {
    if (router.query.learn !== '1' || !guide || !learningStyle?.enabled || openAid) return;
    const first = parseQAPairs(guide.study_guide)[0];
    if (first) setOpenAid(first.index);
  }, [router.query.learn, guide, learningStyle?.enabled]);

  useEffect(() => {
    if (ready && id) loadGuide();
  }, [ready, id]);

  useEffect(() => {
    if (!guide || !id) return;
    const pairs = parseQAPairs(guide.study_guide);
    if (!pairs.length || revealed.size <= prevRevealed.current) return;
    prevRevealed.current = revealed.size;
    const progress = revealed.size / pairs.length;
    apiFetch('/guides/' + id + '/read-progress', { method: 'PATCH', body: JSON.stringify({ read_progress: progress }) });
    setGuide(current => ({ ...current, read_progress: Math.max(current.read_progress || 0, progress) }));
  }, [revealed]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => { setToast(''); setUndoNotes(null); }, undoNotes === null ? 2500 : 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  // A guide without outline notes gets them written (once per visit); a loader shows meanwhile.
  useEffect(() => {
    // Only guides made from material; a guide that is the student's own notes is never rewritten.
    if (!guide?.id || notesAsked.current === guide.id || isStudyGuideNotes(guide.notes) || !String(guide.study_guide || '').trim()) return;
    notesAsked.current = guide.id;
    setNotesState('making');
    fetch('/api/guide-notes', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ guide_id: guide.id }) })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data?.notes) { setGuide(current => (current && current.id === guide.id ? { ...current, notes: data.notes } : current)); setNotesVersion(value => value + 1); } })
      .catch(() => {})
      .finally(() => setNotesState('done'));
  }, [guide?.id]);

  // The Tutor edited this guide's outline: load the new outline into the page.
  useEffect(() => {
    async function onUpdated(event) {
      if (event.detail?.guideId !== id) return;
      const data = await apiFetch('/guides/' + id);
      if (data?.guide) { setGuide(current => ({ ...current, notes: data.guide.notes })); setNotesVersion(value => value + 1); setToast('Outline updated'); }
    }
    window.addEventListener('cordia:outline-updated', onUpdated);
    return () => window.removeEventListener('cordia:outline-updated', onUpdated);
  }, [id]);

  // A "Show me" that points at the questions (Explain, highlighting) opens By page.
  useEffect(() => {
    const step = activeStep();
    if (step && ['[data-spot="explain"]', '[data-spot="reader-text"]'].includes(step.target)) setView('pages');
  }, [guide?.id]);

  // By page: the first time, a tip points out the highlight menu (Explain, Make card, Ask).
  useEffect(() => { if (view === 'pages' && guide) requestTip('highlight'); }, [view, guide?.id]);

  // NCLEX practice appears only for nursing material, so say so the first time it does.
  const nursing = isNursing(guide);
  const [nclexNew, setNclexNew] = useState(false);
  useEffect(() => {
    if (!nursing || !guide?.id) return;
    const seen = readUserValue('cordiaNclexSeen', []) || [];
    if (seen.includes(guide.id)) return;
    setNclexNew(true);
    writeUserValue('cordiaNclexSeen', [...seen, guide.id].slice(-200));
  }, [nursing, guide?.id]);

  async function loadSharing() {
    const data = await apiFetch('/sharing/guides/' + id);
    setSharing(data && 'visibility' in data ? data : null);
  }

  async function setVisibility(visibility) {
    const data = await apiFetch('/sharing/guides/' + id, { method: 'PUT', body: JSON.stringify({ visibility }) });
    if (data?.visibility) {
      setSharing(current => ({ ...current, visibility: data.visibility, status: data.status }));
      setToast(data.status === 'held' ? 'Held for review' : data.visibility === 'class' ? `Shared with ${sharing.class.code}` : 'Private');
    } else setToast(apiErrorMessage(data?.detail, 'Could not change sharing'));
  }

  async function pullUpdate() {
    const data = await apiFetch(`/sharing/guides/${id}/update`, { method: 'POST' });
    if (data?.ok) { await loadGuide(); setSharing(current => ({ ...current, update_available: false })); setToast('Updated'); }
  }

  async function loadGuide() {
    setLoadError('');
    loadSharing();
    const data = await apiFetch('/guides/' + id);
    if (data?.guide) {
      setGuide(data.guide);
      rememberLastGuide({ id: data.guide.id, title: data.guide.title, page: Number(router.query.page) > 0 ? Number(router.query.page) - 1 : 0 });
      walkthroughEvent('guide-open');
    } else {
      setLoadError(apiErrorMessage(data?.detail, 'This study guide could not be loaded.'));
    }
  }

  function changePage(next) {
    setPage(next);
    rememberGuidePage(id, next);
    router.replace({ pathname: router.pathname, query: { ...router.query, page: next + 1 } }, undefined, { shallow: true, scroll: false });
  }

  async function toggleStar() {
    setGuide(current => ({ ...current, is_bookmarked: !current.is_bookmarked }));
    const data = await apiFetch('/guides/' + id + '/bookmark', { method: 'PATCH' });
    if (data && typeof data.is_bookmarked === 'boolean') setGuide(current => ({ ...current, is_bookmarked: data.is_bookmarked }));
  }

  async function saveTitle(event) {
    event?.preventDefault();
    const title = renaming?.trim();
    setRenaming(null);
    if (!title || title === guide.title) return;
    const data = await apiFetch('/guides/' + id + '/rename', { method: 'PATCH', body: JSON.stringify({ title }) });
    if (data?.title) setGuide(current => ({ ...current, title: data.title }));
  }

  // The ⋯ menu's Add to class: file the guide in one of the student's classes (or none).
  async function moveToClass(folderId) {
    const data = await apiFetch('/guides/' + id + '/move', { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
    if (data && !data.detail) {
      setGuide(current => ({ ...current, folder_id: folderId }));
      const name = classLabel(classes.find(item => item.id === folderId)?.name).title;
      setToast(folderId ? `Added to ${name || 'class'}` : 'Removed from its class');
      loadSharing();
    } else setToast(apiErrorMessage(data?.detail, "That class change didn't save."));
  }

  async function deleteGuide() {
    setConfirmDelete(false);
    const data = await apiFetch('/guides/' + id, { method: 'DELETE' });
    if (!data?.deleted) { setToast(apiErrorMessage(data?.detail, "That didn't delete. Try again.")); return; }
    // A guide moved in from an old note (pages/smartnotes.js) takes that note with it, or the note
    // would show in Library again and come back as a new guide when opened.
    const noteId = String(guide?.source_type || '').startsWith('note:') ? guide.source_type.slice(5) : '';
    if (noteId) await apiFetch('/smart_notes/' + noteId, { method: 'DELETE' });
    router.push('/library');
  }

  async function saveCard(card) {
    const flashcards = [...(guide.flashcards || []), card];
    const data = await apiFetch('/guides/' + id, { method: 'PATCH', body: JSON.stringify({ title: guide.title, flashcards }) });
    if (data?.guide) {
      setGuide(current => ({ ...current, flashcards: data.guide.flashcards || flashcards }));
      setCardDraft(null);
      setToast('Card added');
      walkthroughEvent('card-made');
    } else setToast(apiErrorMessage(data?.detail, 'Card not saved.'));
  }

  // Notes the student typed (or any outline) rewritten as a tidy outline; their words are the source.
  // For a guide with material this is "Regenerate outline": written again from the material, with Undo.
  async function tidyOutline() {
    const before = guide.notes || '';
    setMaking('outline');
    const data = await fetch('/api/guide-notes', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ guide_id: guide.id, force: true }) })
      .then(response => (response.ok ? response.json() : null)).catch(() => null);
    setMaking('');
    if (data?.notes) {
      setGuide(current => ({ ...current, notes: data.notes }));
      setNotesVersion(value => value + 1);
      setUndoNotes(hasMaterial && before.trim() ? before : null);
      setToast(hasMaterial ? 'Outline regenerated' : 'Outline written');
    }
    else setToast(data?.reason === 'empty' ? 'Write a few more notes first' : "The outline wasn't written. Try again.");
  }

  async function undoRegenerate() {
    const notes = undoNotes;
    setUndoNotes(null);
    setToast('');
    const data = await apiFetch('/guides/' + guide.id, { method: 'PATCH', body: JSON.stringify({ title: guide.title, notes }) });
    if (data?.guide) { setGuide(current => ({ ...current, notes })); setNotesVersion(value => value + 1); setToast('Outline put back'); }
    else setToast(apiErrorMessage(data?.detail, "The old outline wasn't put back."));
  }

  // Flashcards and a quiz from the notes, for a guide that started as the student's own notes.
  async function makeStudySet() {
    const source = String(guide.notes || '').replace(/^(>|##|\s*-)\s?/gm, '').trim();
    if (source.length < 40) { setToast('Write a few more notes first'); return; }
    setMaking('cards');
    const generated = await apiFetch('/generate', { method: 'POST', body: JSON.stringify({ content: source, notes: false, study_guide: true, flashcards: true, request_id: newRequestId() }), timeoutMs: 6 * 60 * 1000 });
    if (!generated?.study_guide || generated.study_guide.startsWith('[Error')) {
      setMaking('');
      setToast(apiErrorMessage(generated?.detail, "Cards and quiz weren't made. Try again."));
      return;
    }
    const data = await apiFetch('/guides/' + guide.id, { method: 'PATCH', body: JSON.stringify({ title: guide.title, study_guide: generated.study_guide, flashcards: generated.flashcards || [] }) });
    setMaking('');
    if (data?.guide) { setGuide(current => ({ ...current, study_guide: data.guide.study_guide, flashcards: data.guide.flashcards })); setToast('Flashcards and quiz ready'); }
    else setToast("Cards and quiz weren't saved. Try again.");
  }

  function onSelection(kind, text) {
    if (kind === 'card') { setCardDraft(text); walkthroughEvent('make-card-open'); }
    else if (kind === 'explain') ask(id, `Explain this more simply: "${text}"`, true);
    else ask(id, `About "${text}": `);
  }

  if (loadError && !guide) return (
    <div className="c-empty" role="alert">
      <h1 className="c-title">Study guide unavailable</h1>
      <p>{loadError}</p>
      <div className="c-row">
        <button type="button" className="c-btn c-btn--primary" onClick={loadGuide}>Retry</button>
        <button type="button" className="c-btn c-btn--secondary" onClick={() => router.push('/library')}>Library</button>
      </div>
    </div>
  );

  if (!guide || gate === 'waiting' || gate === 'loader') return <LoadingArea phase={gate === 'waiting' ? 'waiting' : 'loader'} label="Loading guide" />;

  const pairs = parseQAPairs(guide.study_guide);
  const notes = guideNotes(guide);
  const notesWritten = hasStudyNotes(parseStudyNotes(guide.notes));
  const cardCount = guide.flashcards?.length || 0;
  // A guide with no material is the student's own notes until they make cards and a quiz from it.
  const hasMaterial = Boolean(String(guide.study_guide || '').trim());
  const sourceTitle = guide.source_title || (guide.source_url ? 'Source' : '');
  const externalSourceUrl = /^https?:\/\//i.test(guide.source_url || '') ? guide.source_url : '';
  const sourceHref = externalSourceUrl
    || (guide.source_type === 'study_guide' && guide.source_id ? `/guide/${guide.source_id}` : '');
  const explainWithAid = Boolean(learningStyle?.enabled);
  const tabs = [
    { key: 'outline', label: 'Outline', icon: NotebookText, view: true },
    ...(hasMaterial ? [
      { key: 'flashcards', label: 'Flashcards', icon: Layers, href: '/flashcards/study?guideId=' + id, count: cardCount, spot: 'cards-pill', event: 'cards-opened' },
      { key: 'quiz', label: 'Quiz', icon: Brain, href: '/quiz/' + id, spot: 'quiz-pill' },
      { key: 'practice', label: 'Practice', icon: PencilRuler, href: '/practice/' + id },
    ] : []),
    ...(nursing ? [{ key: 'nclex', label: 'NCLEX', icon: Stethoscope, href: '/nclex/' + id }] : []),
  ];
  const shareable = sharing?.class && !sharing.linked;
  const shared = shareable && sharing.visibility === 'class';

  return (
    <Reveal phase={gate}>
    <article className="c-page guide">
      <header className="guide-head">
        <button type="button" className="c-icon-btn" onClick={() => (window.history.length > 1 ? router.back() : router.push('/library'))} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        {renaming !== null ? (
          <form className="guide-rename" onSubmit={saveTitle}>
            <input className="c-input guide-title-input" value={renaming} onChange={event => setRenaming(event.target.value)} onBlur={saveTitle} onKeyDown={event => { if (event.key === 'Escape') setRenaming(null); }} aria-label="Guide title" autoFocus />
          </form>
        ) : (
          <h1 className="c-title guide-title">
            <button type="button" className="guide-title-btn" onClick={() => setRenaming(guide.title)}>{guide.title}</button>
            <button type="button" className="c-icon-btn guide-rename-btn" onClick={() => setRenaming(guide.title)} aria-label="Rename guide"><Pencil size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          </h1>
        )}
        <button type="button" className={'c-icon-btn' + (guide.is_bookmarked ? ' guide-starred' : '')} onClick={toggleStar} aria-pressed={Boolean(guide.is_bookmarked)} aria-label={guide.is_bookmarked ? 'Unstar' : 'Star'}>
          <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={guide.is_bookmarked ? 'currentColor' : 'none'} />
        </button>
        <Menu
          label="Guide actions"
          items={[
            { label: 'Edit', icon: SquarePen, onSelect: () => router.push('/create?editGuideId=' + id) },
            {
              label: guide.folder_id ? 'Move to class' : 'Add to class',
              icon: FolderInput,
              items: [
                ...classes.map(folder => ({ key: folder.id, label: classLabel(folder.name).title, meta: classLabel(folder.name).code, current: guide.folder_id === folder.id, onSelect: () => moveToClass(folder.id) })),
                ...(guide.folder_id ? [{ label: 'No class', onSelect: () => moveToClass(null) }] : []),
                ...(classes.length ? [] : [{ label: 'Make a class in Library', onSelect: () => router.push('/library') }]),
              ],
            },
            { label: 'Export', icon: Download, onSelect: () => exportGuide(guide) },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setConfirmDelete(true) },
          ]}
        />
        <Link href={'/session?guideId=' + id} className="c-btn c-btn--primary guide-study-now"><Play size={20} strokeWidth={1.75} aria-hidden="true" />Study now</Link>
      </header>
      {sharing?.update_available && (
        <button type="button" className="c-chip guide-update" onClick={pullUpdate}><RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />Update available</button>
      )}
      {!sharing?.linked && <ClassChip guideId={id} onFiled={() => loadSharing()} />}
      <div className="guide-meta">
        {sourceTitle && (sourceHref || sourceTitle.trim().toLowerCase() !== (guide.title || '').trim().toLowerCase()) && (
          <span className="guide-src">
            {sourceHref
              ? <a href={sourceHref} target={externalSourceUrl ? '_blank' : undefined} rel={externalSourceUrl ? 'noopener noreferrer' : undefined}><ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />{sourceTitle}</a>
              : sourceTitle}
          </span>
        )}
        {shareable && (sharing.class.sharing_blocked
          ? <span className="c-chip guide-share"><Lock size={16} strokeWidth={1.75} aria-hidden="true" />Sharing off for {sharing.class.code}</span>
          : (
            <Menu
              label={shared ? `Shared with ${sharing.class.code}` : 'Private'}
              trigger={<span className="guide-share-label">{shared ? <Users size={16} strokeWidth={1.75} aria-hidden="true" /> : <Lock size={16} strokeWidth={1.75} aria-hidden="true" />}{shared ? `Shared with ${sharing.class.code}` : 'Private'}</span>}
              align="left"
              items={[
                { label: 'Private', icon: Lock, current: !shared, onSelect: () => setVisibility('private') },
                { label: `Share with ${sharing.class.code}`, icon: Users, current: shared, onSelect: () => setVisibility('class') },
              ]}
            />
          ))}
      </div>

      {nclexNew && (
        <div className="guide-nclex" role="status">
          <Stethoscope size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>Nursing material detected: NCLEX practice added.</span>
          <span className="c-spacer" />
          <Link href={'/nclex/' + id} className="c-btn c-btn--quiet">Try it</Link>
          <button type="button" className="c-icon-btn" onClick={() => setNclexNew(false)} aria-label="Dismiss"><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>
      )}

      <div className="guide-tabs-row">
        <nav className="c-pills" aria-label="Study this guide">
          {tabs.map(tab => {
            const content = <><tab.icon size={20} strokeWidth={1.75} aria-hidden="true" />{tab.label}{tab.count !== undefined && <span className="c-meta">{tab.count}</span>}</>;
            if (tab.view) return <span key={tab.key} className="c-pill" aria-current="page">{content}</span>;
            return <Link key={tab.key} className="c-pill" href={tab.href} data-spot={tab.spot} onClick={tab.event ? () => walkthroughEvent(tab.event) : undefined}>{content}</Link>;
          })}
        </nav>
        <button type="button" className="c-btn c-btn--secondary guide-ask" data-spot="ask-pill" onClick={() => { walkthroughEvent('ask'); ask(id, ''); }}>
          <MessageCircle size={20} strokeWidth={1.75} aria-hidden="true" />Ask Tutor about this guide
        </button>
      </div>

      {hasMaterial && <div className="c-seg guide-view" role="tablist" aria-label="Outline view">
        <button type="button" role="tab" aria-selected={view === 'outline'} className={view === 'outline' ? 'is-active' : ''} onClick={() => setView('outline')}>Outline</button>
        <button type="button" role="tab" aria-selected={view === 'pages'} className={view === 'pages' ? 'is-active' : ''} onClick={() => setView('pages')}>By page</button>
      </div>}

      {view === 'outline' || !hasMaterial ? (
        <section className="c-card guide-notes" aria-label="Outline" aria-busy={notesState === 'making' && !notesWritten}>
          {!hasMaterial && (
            <div className="guide-make">
              <p className="c-meta">Your notes. Turn them into a tidy outline, or into flashcards and a quiz, whenever you're ready.</p>
              <div className="c-row c-row--wrap">
                <button type="button" className="c-btn c-btn--secondary c-btn--sm" disabled={Boolean(making)} onClick={tidyOutline}>{making === 'outline' ? 'Writing the outline…' : 'Make it an outline'}</button>
                <button type="button" className="c-btn c-btn--primary c-btn--sm" disabled={Boolean(making)} onClick={makeStudySet}>{making === 'cards' ? 'Making cards and quiz…' : 'Make flashcards and quiz'}</button>
              </div>
            </div>
          )}
          {(notesState === 'making' && !notesWritten) || (making === 'outline' && hasMaterial)
            ? <SectionLoader height={160} label="Writing the outline" />
            : <OutlineEditor guide={guide} version={notesVersion}
                tools={hasMaterial && (
                  <button type="button" className="c-btn c-btn--quiet c-btn--sm" onMouseDown={event => event.preventDefault()} disabled={Boolean(making)} onClick={tidyOutline}>
                    <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />Regenerate outline
                  </button>
                )} onSaved={saved => setGuide(current => ({ ...current, notes: saved }))} onAction={onSelection} placeholder={hasMaterial ? 'Add your own notes anywhere…' : 'Type your notes… Use Heading for a new topic and Bullet for points.'} />}
        </section>
      ) : (
        <>
      <StudyDocument
        key={guide.id}
        guide={guide}
        page={page}
        onPageChange={changePage}
        readSections={revealed}
        onRead={index => setRevealed(previous => new Set([...previous, index]))}
        onExplain={index => {
          if (explainWithAid) setOpenAid(current => (current === pairs[index].index ? null : pairs[index].index));
          else ask(id, `Explain this more simply: ${pairs[index].question}`, true);
        }}
        renderAid={index => (explainWithAid && openAid && pairs[index]?.index === openAid
          ? <StudyAidPanel guideId={id} number={openAid} style={learningStyle.style} onClose={() => setOpenAid(null)} section={{ ...pairs[index], before: pairs[index - 1], after: pairs[index + 1], guideTitle: guide.title }} />
          : null)}
        onSelection={onSelection}
        />
        </>
      )}

      {cardDraft !== null && <MakeCard front={cardDraft} onSave={saveCard} onClose={() => setCardDraft(null)} />}
      {confirmDelete && <ConfirmDialog title={`Delete ${guide.title}?`} onConfirm={deleteGuide} onCancel={() => setConfirmDelete(false)} />}
      {toast && (
        <div className="c-toast" role="status">
          <span>{toast}</span>
          {undoNotes !== null && <button type="button" className="c-btn c-btn--quiet c-btn--sm" onClick={undoRegenerate}>Undo</button>}
        </div>
      )}

      <style jsx>{`
        .guide { gap: 16px; }
        .guide-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .guide-title { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 4px; overflow-wrap: anywhere; }
        .guide-title :global(.guide-rename-btn) { flex: 0 0 auto; color: var(--muted); }
        .guide-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin: -8px 0 0 48px; }
        .guide-share-label { display: inline-flex; align-items: center; gap: 6px; font: 600 13px/1 var(--font-sans); white-space: nowrap; }
        .guide-meta :global(.c-menu-wrap > .c-icon-btn) { width: auto; height: 32px; padding: 0 12px; border-radius: var(--r-pill); border: 1px solid var(--line); }
        .guide-nclex { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; border-radius: var(--r-row); background: var(--olive-tint); font: 600 15px/1.4 var(--font-sans); }
        .guide-nclex :global(.lucide) { color: var(--olive-ink); flex: 0 0 auto; }
        .guide-tabs-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .guide-tabs-row .c-pills { flex: 1 1 auto; min-width: 0; max-width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
        .guide-tabs-row .c-pills::-webkit-scrollbar { display: none; }
        .guide-tabs-row .c-pills :global(.c-pill) { flex: 0 0 auto; }
        .guide-tabs-row, .guide-head { min-width: 0; max-width: 100%; }
        .guide-view { justify-self: start; }
        .guide-title-btn { max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; letter-spacing:-0.015em; text-align: left; cursor: text; border-radius:var(--r-input); }
        .guide-title-btn:hover { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 6px; }
        .guide-rename { flex: 1 1 auto; min-width: 0; }
        .guide-title-input { font:600 28px/1.15 var(--font-display); height: 52px; }
        .guide-head :global(.guide-starred) { color: var(--olive-ink); }
        .guide-src { font:600 13px/1.5 var(--font-sans); }
        .guide-src a { display: inline-flex; align-items: center; gap: 6px; }
        .guide-notes { display: grid; gap: 16px; padding: 32px 40px; }
        .guide-notes :global(.c-section-title) { margin: 0; }
        .guide-notes { gap: 32px; }
        .guide-outline-section { display: grid; gap: 16px; }
        .guide-outline-body { display: grid; gap: 16px; min-width: 0; }
        .guide-outline-section.has-visual { grid-template-columns: minmax(0, 1fr) minmax(320px, 48%); gap: 28px; align-items: start; }
        @media (max-width: 1099px) { .guide-outline-section.has-visual { grid-template-columns: minmax(0, 1fr); } }
        .guide-notes ul { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
        .guide-notes .guide-sub { margin-top: 6px; gap: 4px; list-style: circle; color: var(--muted-ink); }
        .guide-notes :global(strong) { font-weight: 600; color: var(--ink); }
        .guide-overview { margin: 0; padding-bottom: 24px; border-bottom: 1px solid var(--line); font: 400 var(--fs-20)/1.5 var(--font-sans); color: var(--ink); }
        .guide-make { display: grid; gap: 10px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
        .guide-make p { margin: 0; }
        .guide-outline-num { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-right: 10px; border-radius: 50%; background: var(--olive-tint); color: var(--olive-ink); font: 600 var(--fs-13)/1 var(--font-sans); vertical-align: 3px; }
        .guide-key { display: grid; gap: 16px; padding: 24px 28px; border-radius: 16px; background: var(--olive-tint); }
        @media (max-width: 767px) {
          .guide-meta { margin-left: 0; }
          .guide-notes { padding: 24px 18px; }
          .guide-head :global(.guide-study-now) { order: 5; width: 100%; justify-content: center; }
          .guide-ask { width: 100%; justify-content: center; }
        }
      `}</style>
    </article>
    </Reveal>
  );
}
