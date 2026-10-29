import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Download, Plus, Upload, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { loadFolders } from '../lib/folders';
import { useRequireAuth } from '../lib/auth';
import { pairsToCards, pairsToGuide } from '../lib/guideCreate';
import { openNewSheet } from '../lib/newSheet';
import QuizletImport from '../components/QuizletImport';
import CardPhoto from '../components/CardPhoto';

// Write cards by hand, edit a guide's cards, or import a Quizlet set. Guides from files, pasted
// text and links are made in the New sheet.
const MANUAL_DRAFT_KEY = 'autostudy_manual_draft';
// Pasted text from before uploads moved to the New sheet: handed to it once, then cleared.
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';
const EMPTY_PAIRS = () => [{ term: '', definition: '' }, { term: '', definition: '' }];

export default function CreateGuidePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const isEdit = Boolean(router.query.editGuideId);
  const [title, setTitle] = useState('');
  const [quizletOpen, setQuizletOpen] = useState(false);
  const [manualPairs, setManualPairs] = useState(EMPTY_PAIRS);
  const [cardCount, setCardCount] = useState('');
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const termInputs = useRef([]);
  const answerInputs = useRef([]);
  const [focusTerm, setFocusTerm] = useState(null);

  useEffect(() => {
    if (router.query.editGuideId) return;
    try {
      const manualDraft = JSON.parse(localStorage.getItem(MANUAL_DRAFT_KEY) || 'null');
      if (manualDraft?.pairs?.length) {
        setManualPairs(manualDraft.pairs);
        if (manualDraft.title) setTitle(manualDraft.title);
      }
    } catch { /* no readable draft: start empty */ }
  }, []);

  useEffect(() => {
    if (!ready || isEdit) return;
    try {
      const sourceDraft = JSON.parse(localStorage.getItem(SOURCE_DRAFT_KEY) || 'null');
      localStorage.removeItem(SOURCE_DRAFT_KEY);
      if (sourceDraft?.content?.trim()) openNewSheet('paste', { text: sourceDraft.content, title: sourceDraft.title });
    } catch { /* no readable draft */ }
  }, [ready, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    try {
      if (manualPairs.some(pair => pair.term.trim() || pair.definition.trim())) {
        localStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify({ title, pairs: manualPairs }));
      } else {
        localStorage.removeItem(MANUAL_DRAFT_KEY);
      }
    } catch { /* storage blocked: drafts are a convenience */ }
  }, [isEdit, manualPairs, title]);

  useEffect(() => {
    const editId = router.query.editGuideId;
    if (!ready || !editId) return;
    apiFetch('/guides/' + editId).then(data => {
      if (!data?.guide) return;
      setTitle(data.guide.title || '');
      const pairs = [];
      let question = '';
      for (const line of (data.guide.study_guide || '').split('\n')) {
        const questionMatch = line.match(/^Q\d+:\s*(.+)/);
        const answerMatch = line.match(/^A\d+:\s*(.+)/);
        if (questionMatch) question = questionMatch[1].trim();
        if (answerMatch && question) {
          pairs.push({ term: question, definition: answerMatch[1].trim() });
          question = '';
        }
      }
      // Photos live on the saved cards, not in the Q/A text.
      const cards = Array.isArray(data.guide.flashcards) ? data.guide.flashcards : [];
      pairs.forEach((pair, index) => {
        const card = cards.find(item => item?.front?.trim() === pair.term) || cards[index];
        if (card?.front_image) pair.frontImage = card.front_image;
        if (card?.image) pair.image = card.image;
      });
      if (pairs.length) setManualPairs(pairs);
    });
  }, [ready, router.query.editGuideId]);

  useEffect(() => {
    if (router.query.import === 'quizlet' && !router.query.editGuideId) setQuizletOpen(true);
  }, [router.query.import, router.query.editGuideId]);

  // Imported cards replace an empty editor, or follow the cards already written.
  function importQuizlet({ title: setTitleText, cards }) {
    setQuizletOpen(false);
    setError('');
    setManualPairs(current => {
      const kept = current.filter(pair => pair.term.trim() || pair.definition.trim());
      return [...kept, ...cards.map(card => ({ term: card.term, definition: card.definition }))];
    });
    if (setTitleText && !title.trim()) setTitle(setTitleText.slice(0, 120));
  }

  useEffect(() => {
    if (!ready) return;
    loadFolders().then(data => {
      const nextFolders = data?.folders || [];
      setFolders(nextFolders);
      const folderId = router.query.folder;
      if (folderId && nextFolders.some(folder => folder.id === folderId)) setSelectedFolder(folderId);
    });
  }, [ready, router.query.folder]);

  const completePairs = manualPairs.filter(pair => pair.term.trim() && pair.definition.trim());

  const applyCardCount = useCallback(count => {
    const size = Math.min(parseInt(count, 10) || 0, 100);
    if (size < 1) return;
    setManualPairs(previous => previous.length < size
      ? [...previous, ...Array.from({ length: size - previous.length }, () => ({ term: '', definition: '' }))]
      : previous.slice(0, size));
  }, []);

  useEffect(() => {
    if (focusTerm === null) return;
    termInputs.current[focusTerm]?.focus();
    setFocusTerm(null);
  }, [focusTerm, manualPairs.length]);

  // Enter in a question moves to its answer; Enter in an answer starts the next card.
  function handleCardKey(event, index, field) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (field === 'term') {
      answerInputs.current[index]?.focus();
      return;
    }
    const next = manualPairs[index + 1];
    if (!next || next.term.trim()) {
      setManualPairs(pairs => [...pairs.slice(0, index + 1), { term: '', definition: '' }, ...pairs.slice(index + 1)]);
    }
    setFocusTerm(index + 1);
  }

  function updatePair(index, field, value) {
    setManualPairs(previous => previous.map((pair, pairIndex) => pairIndex === index ? { ...pair, [field]: value } : pair));
  }

  async function saveManualGuide() {
    setError('');
    if (!completePairs.length) {
      setError('Add one full card.');
      return;
    }
    setStatus('saving');
    try {
      const editId = router.query.editGuideId;
      const saved = await apiFetch(editId ? '/guides/' + editId : '/guides', {
        method: editId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: title.trim() || 'Custom Study Guide',
          keep_title: Boolean(title.trim()),
          study_guide: pairsToGuide(completePairs),
          flashcards: pairsToCards(completePairs),
          ...(selectedFolder ? { folder_id: selectedFolder } : {}),
        }),
      });
      if (!saved?.guide) throw new Error('Failed to save guide.');
      localStorage.removeItem(MANUAL_DRAFT_KEY);
      router.push('/guide/' + saved.guide.id);
    } catch (caught) {
      setError(caught.message || 'Failed to save guide.');
      setStatus('');
    }
  }

  if (!ready) return null;

  const busy = status === 'saving';
  const createLabel = busy ? 'Saving…' : isEdit ? 'Update' : 'Create';

  return (
    <div className="fade-in create-split-page">
      <header className="c-page-head create-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push(isEdit ? '/guide/' + router.query.editGuideId : '/library')} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <h1 className="c-title">{isEdit ? 'Edit guide' : 'Write cards'}</h1>
        </div>
        <button type="button" className="c-btn c-btn--primary create-split-submit" onClick={saveManualGuide} disabled={busy}>{createLabel}</button>
      </header>

      {error && <div className="create-banner create-banner-error" role="alert">
        <span>{error}</span>
      </div>}

      <div className="create-split-grid is-single">
        <section className="create-window">
          <div className="create-window-head">
            <h2 className="c-section-title create-window-title">Cards</h2>
            {!isEdit && (
              <div className="c-row">
                <button type="button" className="c-btn c-btn--quiet create-import" onClick={() => setQuizletOpen(true)}><Download size={18} strokeWidth={1.75} aria-hidden="true" />Import from Quizlet</button>
                <button type="button" className="c-btn c-btn--quiet" onClick={() => openNewSheet('upload')}><Upload size={18} strokeWidth={1.75} aria-hidden="true" />Make from a file</button>
              </div>
            )}
          </div>
          <div className="create-manual-header"><span className="c-meta">{completePairs.length} cards</span><label>Card slots <input className="c-input" type="number" inputMode="numeric" min="1" max="100" placeholder={String(manualPairs.length)} value={cardCount} onChange={event => setCardCount(event.target.value)} onBlur={() => applyCardCount(cardCount)} /></label></div>
          <div className="create-cards-list">
            {manualPairs.map((pair, index) => (
              <div className="create-card" key={index}>
                <div className="create-card-num">{index + 1}</div>
                <div className="create-card-body">
                  <div className="create-card-side">
                    <input ref={element => { termInputs.current[index] = element; }} onKeyDown={event => handleCardKey(event, index, 'term')} className="create-card-input create-card-term" value={pair.term} onChange={event => updatePair(index, 'term', event.target.value)} placeholder="Term" aria-label={`Term ${index + 1}`} />
                    <CardPhoto value={pair.frontImage} onChange={url => updatePair(index, 'frontImage', url)} onError={setError} label={`Add photo to term ${index + 1}`} />
                  </div>
                  <div className="create-card-divider" />
                  <div className="create-card-side">
                    <input ref={element => { answerInputs.current[index] = element; }} onKeyDown={event => handleCardKey(event, index, 'definition')} className="create-card-input create-card-def" value={pair.definition} onChange={event => updatePair(index, 'definition', event.target.value)} placeholder="Definition" aria-label={`Definition ${index + 1}`} />
                    <CardPhoto value={pair.image} onChange={url => updatePair(index, 'image', url)} onError={setError} label={`Add photo to definition ${index + 1}`} />
                  </div>
                </div>
                {manualPairs.length > 1 && <button type="button" className="create-card-remove" onClick={() => setManualPairs(pairs => pairs.filter((_, pairIndex) => pairIndex !== index))} aria-label={`Remove card ${index + 1}`}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
              </div>
            ))}
          </div>
          <button type="button" className="c-btn c-btn--quiet create-add-card" onClick={() => setManualPairs(pairs => [...pairs, { term: '', definition: '' }])}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Add card</button>
        </section>
      </div>

      <section className="create-split-settings">
        <label><span>Title</span><input className="c-input create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Auto" disabled={busy} /></label>
        <label><span>Class</span><select className="c-select create-select" value={selectedFolder} onChange={event => setSelectedFolder(event.target.value)} disabled={busy}><option value="">No class</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
      </section>

      {quizletOpen && <QuizletImport initialUrl={typeof router.query.url === 'string' ? router.query.url : ''} onImport={importQuizlet} onCancel={() => setQuizletOpen(false)} />}
    </div>
  );
}
