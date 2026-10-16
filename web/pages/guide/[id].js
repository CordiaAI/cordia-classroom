import { useEffect, useRef, useState } from 'react';
import { LoadingArea, Reveal, useLoadGate } from '../../components/CordiaLoader';
import BodyPortal from '../../components/BodyPortal';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  ArrowLeft, BookOpen, Brain, Download, ExternalLink, Layers, MessageCircle, NotebookText, PencilRuler, Pencil, Star, Stethoscope, SquarePen, Trash2, X,
} from 'lucide-react';
import { apiErrorMessage, apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { parseQAPairs, parseNotes } from '../../lib/formatters';
import useSessionTracker from '../../lib/useSessionTracker';
import StudyAidPanel from '../../components/StudyAidPanel';
import StudyDocument from '../../components/StudyDocument';
import Menu from '../../components/Menu';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useLearningStyle } from '../../lib/learningStyle';
import { rememberGuidePage, rememberLastGuide } from '../../lib/userStore';
import { walkthroughEvent } from '../../lib/walkthrough';

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

function exportGuide(guide) {
  const pairs = parseQAPairs(guide.study_guide);
  const notes = parseNotes(guide.notes);
  const lines = [`# ${guide.title}`, ''];
  pairs.forEach((pair, index) => lines.push(`## ${index + 1}. ${pair.question}`, '', pair.answer, ''));
  if (notes.length) lines.push('## Notes', '', ...notes.map(note => `- ${note}`), '');
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
  const [view, setView] = useState('read');
  const [page, setPage] = useState(0);
  const [revealed, setRevealed] = useState(new Set());
  const [renaming, setRenaming] = useState(null);
  const [openAid, setOpenAid] = useState(null);
  const [cardDraft, setCardDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState('');
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
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadGuide() {
    setLoadError('');
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

  async function deleteGuide() {
    await apiFetch('/guides/' + id, { method: 'DELETE' });
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
  const notes = parseNotes(guide.notes);
  const cardCount = guide.flashcards?.length || 0;
  const sourceTitle = guide.source_title || (guide.source_url ? 'Source' : '');
  const externalSourceUrl = /^https?:\/\//i.test(guide.source_url || '') ? guide.source_url : '';
  const sourceHref = externalSourceUrl
    || (guide.source_type === 'smartnote' && guide.source_id ? `/smartnotes?id=${guide.source_id}` : '')
    || (guide.source_type === 'study_guide' && guide.source_id ? `/guide/${guide.source_id}` : '');
  const explainWithAid = Boolean(learningStyle?.enabled);
  const pills = [
    { key: 'read', label: 'Read', icon: BookOpen, view: 'read' },
    { key: 'quiz', label: 'Quiz', icon: Brain, href: '/quiz/' + id, spot: 'quiz-pill' },
    { key: 'cards', label: 'Cards', icon: Layers, href: '/flashcards/study?guideId=' + id, count: cardCount, spot: 'cards-pill' },
    { key: 'practice', label: 'Practice', icon: PencilRuler, href: '/practice/' + id },
    { key: 'notes', label: 'Notes', icon: NotebookText, view: 'notes' },
    ...(isNursing(guide) ? [{ key: 'nclex', label: 'NCLEX', icon: Stethoscope, href: '/nclex/' + id }] : []),
    { key: 'ask', label: 'Ask', icon: MessageCircle, spot: 'ask-pill', onClick: () => { walkthroughEvent('ask'); ask(id, ''); } },
  ];

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
            <button type="button" className="guide-title-btn" onClick={() => setRenaming(guide.title)} aria-label={`${guide.title}, rename`}>{guide.title}</button>
          </h1>
        )}
        <button type="button" className={'c-icon-btn' + (guide.is_bookmarked ? ' guide-starred' : '')} onClick={toggleStar} aria-pressed={Boolean(guide.is_bookmarked)} aria-label={guide.is_bookmarked ? 'Unstar' : 'Star'}>
          <Star size={20} strokeWidth={1.75} aria-hidden="true" fill={guide.is_bookmarked ? 'currentColor' : 'none'} />
        </button>
        <Menu
          label="Guide actions"
          items={[
            { label: 'Edit', icon: SquarePen, onSelect: () => router.push('/create?editGuideId=' + id) },
            { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(guide.title) },
            { label: 'Export', icon: Download, onSelect: () => exportGuide(guide) },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </header>
      {sourceTitle && (
        <span className="guide-src">
          {sourceHref
            ? <a href={sourceHref} target={externalSourceUrl ? '_blank' : undefined} rel={externalSourceUrl ? 'noopener noreferrer' : undefined}><ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />{sourceTitle}</a>
            : sourceTitle}
        </span>
      )}

      <nav className="c-pills" aria-label="Study this guide">
        {pills.map(pill => {
          const content = <><pill.icon size={20} strokeWidth={1.75} aria-hidden="true" />{pill.label}{pill.count !== undefined && <span className="c-meta">{pill.count}</span>}</>;
          if (pill.href) return <Link key={pill.key} className="c-pill" href={pill.href} data-spot={pill.spot}>{content}</Link>;
          if (pill.view) return <button key={pill.key} type="button" className="c-pill" aria-current={view === pill.view ? 'page' : undefined} onClick={() => setView(pill.view)}>{content}</button>;
          return <button key={pill.key} type="button" className="c-pill" data-spot={pill.spot} onClick={pill.onClick}>{content}</button>;
        })}
      </nav>

      {view === 'read' ? (
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
      ) : (
        <section className="c-card guide-notes" aria-label="Notes">
          {notes.length ? <ul className="c-study">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : <p className="c-meta">0 notes</p>}
        </section>
      )}

      {cardDraft !== null && <MakeCard front={cardDraft} onSave={saveCard} onClose={() => setCardDraft(null)} />}
      {confirmDelete && <ConfirmDialog title={`Delete ${guide.title}?`} onConfirm={deleteGuide} onCancel={() => setConfirmDelete(false)} />}
      {toast && <div className="c-toast" role="status"><span>{toast}</span></div>}

      <style jsx>{`
        .guide { gap: 16px; }
        .guide-head { display: flex; align-items: center; gap: 8px; }
        .guide-title { flex: 1 1 auto; min-width: 0; }
        .guide-title-btn { max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; letter-spacing:-0.015em; text-align: left; cursor: text; border-radius:var(--r-input); }
        .guide-title-btn:hover { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 6px; }
        .guide-rename { flex: 1 1 auto; min-width: 0; }
        .guide-title-input { font:600 28px/1.15 var(--font-display); height: 52px; }
        .guide-head :global(.guide-starred) { color: var(--olive-ink); }
        .guide-src { margin: -8px 0 0 48px; font:600 13px/1.5 var(--font-sans); }
        .guide-src a { display: inline-flex; align-items: center; gap: 6px; }
        .guide-notes { padding: 32px 40px; }
        .guide-notes ul { margin: 0; padding-left: 20px; display: grid; gap: 12px; }
        @media (max-width: 767px) { .guide-src { margin-left: 0; } .guide-notes { padding: 24px 18px; } }
      `}</style>
    </article>
    </Reveal>
  );
}
