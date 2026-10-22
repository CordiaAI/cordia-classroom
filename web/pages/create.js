import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Download, Plus, Upload, X } from 'lucide-react';
import { apiFetch, getToken, responseJson } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';
import { dismissGuideJob, startGuideJob, useGuideJobs } from '../lib/guideJobs';
import { MAX_SOURCE_CHARS, baseName, combinedSource, fileKey, generateAndSave, newRequestId, pairsToCards, pairsToGuide } from '../lib/guideCreate';
import { newGuideHref } from '../lib/checkYourself';
import QuizletImport from '../components/QuizletImport';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MANUAL_DRAFT_KEY = 'autostudy_manual_draft';
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';
const MAX_FILES = 5;
const PASTED_KEY = 'pasted-notes';
const EMPTY_PAIRS = () => [{ term: '', definition: '' }, { term: '', definition: '' }];

export default function CreateGuidePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const isEdit = Boolean(router.query.editGuideId);
  const [lastWindow, setLastWindow] = useState('file');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [externalSourceId, setExternalSourceId] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  // Several sources are combined into guides in rounds: pick some, queue a guide, pick from the rest.
  const [batch, setBatch] = useState(null); // { items, selected: Set<key>, includeManual, queued }
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [quizletOpen, setQuizletOpen] = useState(false);
  const fileTexts = useRef(new Map());
  const [manualPairs, setManualPairs] = useState(EMPTY_PAIRS);
  const [cardCount, setCardCount] = useState('');
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [generateNotes, setGenerateNotes] = useState(true);
  const [generateFlashcards, setGenerateFlashcards] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const uploadBoxRef = useRef(null);
  const pageRef = useRef(null);
  const startedJobs = useRef(new Set());
  const termInputs = useRef([]);
  const answerInputs = useRef([]);
  const [focusTerm, setFocusTerm] = useState(null);
  // Reused when the same source is retried so one guide is never charged twice.
  const requestRef = useRef({ source: null, id: null });
  const jobs = useGuideJobs();

  function requestIdFor(source) {
    if (requestRef.current.source !== source) requestRef.current = { source, id: newRequestId() };
    return requestRef.current.id;
  }

  useEffect(() => {
    if (router.query.editGuideId) return;
    try {
      const manualDraft = JSON.parse(localStorage.getItem(MANUAL_DRAFT_KEY) || 'null');
      if (manualDraft?.pairs?.length) {
        setManualPairs(manualDraft.pairs);
        if (manualDraft.title) setTitle(manualDraft.title);
        setLastWindow('manual');
      }
      const sourceDraft = JSON.parse(localStorage.getItem(SOURCE_DRAFT_KEY) || 'null');
      if (sourceDraft) {
        if (!manualDraft?.title && sourceDraft.title) setTitle(sourceDraft.title);
        setContent(sourceDraft.content || '');
        setSourceUrl(sourceDraft.source_url || '');
        setExternalSourceId(sourceDraft.external_source_id || '');
        if (sourceDraft.content && !manualDraft?.pairs?.length) setLastWindow('file');
      }
    } catch { /* no readable draft: start empty */ }
  }, []);

  useEffect(() => {
    if (isEdit) return;
    try {
      if (manualPairs.some(pair => pair.term.trim() || pair.definition.trim())) {
        localStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify({ title, pairs: manualPairs }));
      } else {
        localStorage.removeItem(MANUAL_DRAFT_KEY);
      }
      if (content.trim()) {
        localStorage.setItem(SOURCE_DRAFT_KEY, JSON.stringify({ title, content, source_url: sourceUrl, external_source_id: externalSourceId }));
      } else {
        localStorage.removeItem(SOURCE_DRAFT_KEY);
      }
    } catch { /* storage blocked: drafts are a convenience */ }
  }, [content, externalSourceId, isEdit, manualPairs, sourceUrl, title]);

  useEffect(() => {
    const editId = router.query.editGuideId;
    if (!ready || !editId) return;
    apiFetch('/guides/' + editId).then(data => {
      if (!data?.guide) return;
      setTitle(data.guide.title || '');
      setLastWindow('manual');
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
    setLastWindow('manual');
  }

  useEffect(() => {
    if (!ready) return;
    apiFetch('/folders').then(data => {
      const nextFolders = data?.folders || [];
      setFolders(nextFolders);
      const folderId = router.query.folder;
      if (folderId && nextFolders.some(folder => folder.id === folderId)) setSelectedFolder(folderId);
    });
  }, [ready, router.query.folder]);

  const completePairs = manualPairs.filter(pair => pair.term.trim() && pair.definition.trim());
  const manualReady = completePairs.length > 0;
  const fileReady = uploadFiles.length > 0 || content.trim().length >= 10;
  const pageIdle = !manualReady && !fileReady && !batch && !choiceOpen;

  // Still on this page when the guides it queued finish: open the result, as before.
  useEffect(() => {
    const mine = jobs.filter(job => startedJobs.current.has(job.id));
    if (!mine.length || mine.some(job => job.status === 'running') || !pageIdle) return;
    const done = mine.filter(job => job.status === 'done');
    if (!done.length) return;
    done.forEach(job => { startedJobs.current.delete(job.id); dismissGuideJob(job.id); });
    router.push(done.length === 1 ? newGuideHref(done[0].guideId) : '/dashboard?view=guides');
  }, [jobs, pageIdle, router]);

  const applyCardCount = useCallback(count => {
    const size = Math.min(parseInt(count, 10) || 0, 100);
    if (size < 1) return;
    setManualPairs(previous => previous.length < size
      ? [...previous, ...Array.from({ length: size - previous.length }, () => ({ term: '', definition: '' }))]
      : previous.slice(0, size));
  }, []);

  function selectFiles(list) {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    const problems = [];
    const readable = picked.filter(file => {
      const unsupported = unsupportedFileMessage(file);
      if (unsupported) problems.push(unsupported);
      return !unsupported;
    });
    const seen = new Set(uploadFiles.map(fileKey));
    const merged = [...uploadFiles, ...readable.filter(file => !seen.has(fileKey(file)))];
    if (merged.length > MAX_FILES) problems.push(`Up to ${MAX_FILES} files.`);
    setError(problems.join(' '));
    setLastWindow('file');
    const next = merged.slice(0, MAX_FILES);
    if (next.length) setUploadFiles(next);
  }

  function removeFile(file) {
    setUploadFiles(current => current.filter(item => fileKey(item) !== fileKey(file)));
  }

  const busy = status === 'extracting' || status === 'saving';
  const uploadDropActive = useFileDropZone({
    enabled: ready && !isEdit,
    priority: 2,
    getElement: () => uploadBoxRef.current || pageRef.current,
    onFiles: files => {
      if (!busy && !batch && !choiceOpen) selectFiles(files);
    },
  });

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

  async function extractText(file) {
    const key = fileKey(file);
    if (fileTexts.current.has(key)) return fileTexts.current.get(key);
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(API + '/extract-file-text', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (getToken() || '') },
      body: formData,
    });
    const data = await responseJson(response);
    if (!response.ok || !data.text) throw new Error(`${file.name}: ${data.detail || 'Could not read this file.'}`);
    fileTexts.current.set(key, data.text);
    return data.text;
  }

  // Queues one guide in the background; the student can keep working or leave the page.
  function queueGuide(items, { includeManual, guideTitle }) {
    const source = combinedSource(items);
    const pasted = items.every(item => item.key === PASTED_KEY);
    const jobTitle = guideTitle || items.map(item => baseName(item.name)).join(' + ').slice(0, 120);
    const requestId = requestIdFor(source);
    const id = startGuideJob({
      title: jobTitle,
      run: () => generateAndSave({
        source,
        requestId,
        title: jobTitle,
        sourceTitle: items.map(item => item.name).join(', ').slice(0, 300),
        sourceType: pasted ? (sourceUrl ? 'webpage' : 'pasted_text') : 'file',
        sourceUrl: pasted ? sourceUrl : '',
        externalSourceId: pasted ? externalSourceId : '',
        folderId: selectedFolder,
        notes: generateNotes,
        flashcards: generateFlashcards,
        manualPairs: includeManual ? completePairs : null,
      }),
    });
    startedJobs.current.add(id);
    const usedFiles = new Set(items.map(item => item.key));
    setUploadFiles(current => current.filter(file => !usedFiles.has(fileKey(file))));
    if (usedFiles.has(PASTED_KEY)) {
      setContent('');
      setSourceUrl('');
      setExternalSourceId('');
    }
    if (includeManual) setManualPairs(EMPTY_PAIRS());
  }

  async function createFromSources({ includeManual }) {
    setError('');
    try {
      setStatus('extracting');
      const items = [];
      for (const file of uploadFiles) items.push({ key: fileKey(file), name: file.name, text: await extractText(file) });
      setStatus('');
      if (content.trim().length >= 10) {
        const firstLine = content.split('\n').map(line => line.trim()).find(Boolean) || 'Pasted notes';
        items.push({ key: PASTED_KEY, name: uploadFiles.length ? 'Pasted notes' : firstLine.slice(0, 72), text: content.trim() });
      }
      if (items.length > 1) {
        setBatch({ items, selected: new Set(items.map(item => item.key)), includeManual, queued: [] });
        return;
      }
      const source = combinedSource(items);
      if (source.length > MAX_SOURCE_CHARS) {
        setError(`This material is too long for one study guide (${source.length.toLocaleString()} of ${MAX_SOURCE_CHARS.toLocaleString()} characters). Split it into smaller parts.`);
        return;
      }
      queueGuide(items, { includeManual, guideTitle: title.trim() });
      setTitle('');
    } catch (caught) {
      setError(caught.message || 'Something went wrong. Please try again.');
      setStatus('');
    }
  }

  function handleCreate() {
    setError('');
    if (isEdit) return saveManualGuide();
    if (manualReady && fileReady) return setChoiceOpen(true);
    if (fileReady) return createFromSources({ includeManual: false });
    if (manualReady) return saveManualGuide();
    setError(lastWindow === 'manual'
      ? 'Add one full card.'
      : 'Add a file or notes.');
  }

  function chooseSource(option) {
    setChoiceOpen(false);
    if (option === 'manual') return saveManualGuide();
    return createFromSources({ includeManual: option === 'both' });
  }

  function toggleBatchItem(key) {
    setBatch(current => {
      const selected = new Set(current.selected);
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      return { ...current, selected };
    });
  }

  function queueBatchGuide() {
    const chosen = batch.items.filter(item => batch.selected.has(item.key));
    const rest = batch.items.filter(item => !batch.selected.has(item.key));
    if (combinedSource(chosen).length > MAX_SOURCE_CHARS) return;
    const allAtOnce = !rest.length && !batch.queued.length;
    const guideTitle = allAtOnce && title.trim() ? title.trim() : chosen.map(item => baseName(item.name)).join(' + ').slice(0, 120);
    queueGuide(chosen, { includeManual: batch.includeManual && !batch.queued.length, guideTitle });
    if (!rest.length) {
      setBatch(null);
      setTitle('');
      return;
    }
    setBatch({ ...batch, items: rest, selected: new Set(rest.map(item => item.key)), queued: [...batch.queued, guideTitle] });
  }

  if (!ready) return null;

  const batchChosen = batch ? batch.items.filter(item => batch.selected.has(item.key)) : [];
  const batchChars = batch ? combinedSource(batchChosen).length : 0;
  const createFrom = isEdit ? 'manual'
    : manualReady && fileReady ? 'both'
      : fileReady ? 'file'
        : manualReady ? 'manual' : lastWindow;
  // Create study guide
  const createLabel = status === 'extracting' ? 'Reading…'
    : status === 'saving' ? 'Saving…'
      : isEdit ? 'Update' : 'Create';

  return (
    <div ref={pageRef} className="fade-in create-split-page">
      <header className="c-page-head create-head">
        <div className="c-row">
          <button type="button" className="c-icon-btn" onClick={() => router.push(isEdit ? '/guide/' + router.query.editGuideId : '/library')} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
          <h1 className="c-title">{isEdit ? 'Edit guide' : 'New guide'}</h1>
        </div>
        <button type="button" className="c-btn c-btn--primary create-split-submit" onClick={handleCreate} disabled={busy || Boolean(batch)}>{createLabel}</button>
      </header>

      {error && <div className="create-banner create-banner-error" role="alert">
        <span>{error}</span>
      </div>}

      <div className={'create-split-grid' + (isEdit ? ' is-single' : '')}>
        <section
          className={'create-window' + (createFrom === 'manual' || createFrom === 'both' ? ' is-active' : '')}
          onFocusCapture={() => setLastWindow('manual')}
          onPointerDown={() => setLastWindow('manual')}
        >
          <div className="create-window-head">
            <h2 className="c-section-title create-window-title">Write cards</h2>
            {!isEdit && <button type="button" className="c-btn c-btn--quiet create-import" onClick={() => setQuizletOpen(true)}><Download size={18} strokeWidth={1.75} aria-hidden="true" />Import from Quizlet</button>}
          </div>
          <div className="create-manual-header"><span className="c-meta">{completePairs.length} cards</span><label>Size <input className="c-input" type="number" min="1" max="100" value={cardCount} onChange={event => setCardCount(event.target.value)} onBlur={() => applyCardCount(cardCount)} /></label></div>
          <div className="create-cards-list">
            {manualPairs.map((pair, index) => (
              <div className="create-card" key={index}>
                <div className="create-card-num">{index + 1}</div>
                <div className="create-card-body">
                  <input ref={element => { termInputs.current[index] = element; }} onKeyDown={event => handleCardKey(event, index, 'term')} className="create-card-input create-card-term" value={pair.term} onChange={event => updatePair(index, 'term', event.target.value)} placeholder="Term" aria-label={`Term ${index + 1}`} />
                  <div className="create-card-divider" />
                  <input ref={element => { answerInputs.current[index] = element; }} onKeyDown={event => handleCardKey(event, index, 'definition')} className="create-card-input create-card-def" value={pair.definition} onChange={event => updatePair(index, 'definition', event.target.value)} placeholder="Definition" aria-label={`Definition ${index + 1}`} />
                </div>
                {manualPairs.length > 1 && <button type="button" className="create-card-remove" onClick={() => setManualPairs(pairs => pairs.filter((_, pairIndex) => pairIndex !== index))} aria-label={`Remove card ${index + 1}`}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>}
              </div>
            ))}
          </div>
          <button type="button" className="c-btn c-btn--quiet create-add-card" onClick={() => setManualPairs(pairs => [...pairs, { term: '', definition: '' }])}><Plus size={20} strokeWidth={1.75} aria-hidden="true" />Add card</button>
        </section>

        {!isEdit && (
          <section
            className={'create-window' + (createFrom === 'file' || createFrom === 'both' ? ' is-active' : '')}
            onFocusCapture={() => setLastWindow('file')}
            onPointerDown={() => setLastWindow('file')}
          >
            <h2 className="c-section-title create-window-title">Upload</h2>
            <button
              ref={uploadBoxRef}
              type="button"
              className={'create-dropbox' + (uploadDropActive ? ' drop-target-active' : '')}
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploadFiles.length >= MAX_FILES}
            >
              <Upload size={32} strokeWidth={1.75} aria-hidden="true" />
              <strong>{uploadDropActive ? 'Drop' : uploadFiles.length >= MAX_FILES ? `${MAX_FILES} / ${MAX_FILES}` : 'Choose files'}</strong>
            </button>
            <input ref={fileInputRef} type="file" accept="*" multiple onChange={event => { selectFiles(event.target.files); event.target.value = ''; }} hidden />
            {uploadFiles.length > 0 && (
              <ul className="create-file-list">
                {uploadFiles.map(file => (
                  <li key={fileKey(file)}>
                    <span>{file.name}</span>
                    <button type="button" className="c-icon-btn" onClick={() => removeFile(file)} disabled={busy} aria-label={`Remove ${file.name}`}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
            <label className="create-paste">
              <span>Paste</span>
              <textarea className="c-input create-textarea" value={content} onChange={event => setContent(event.target.value)} placeholder="Paste notes" disabled={busy} />
            </label>
          </section>
        )}
      </div>

      <section className="create-split-settings">
        <label><span>Title</span><input className="c-input create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Auto" disabled={busy} /></label>
        <label><span>Class</span><select className="c-select create-select" value={selectedFolder} onChange={event => setSelectedFolder(event.target.value)} disabled={busy}><option value="">No class</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        {!isEdit && (
          <div className="create-checks">
            <label className="create-check-label"><input type="checkbox" checked={generateNotes} onChange={event => setGenerateNotes(event.target.checked)} /> Notes</label>
            <label className="create-check-label"><input type="checkbox" checked={generateFlashcards} onChange={event => setGenerateFlashcards(event.target.checked)} /> Cards</label>
          </div>
        )}
      </section>

      {quizletOpen && <QuizletImport onImport={importQuizlet} onCancel={() => setQuizletOpen(false)} />}

      {choiceOpen && (
        <div className="c-scrim">
          <div className="c-sheet create-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="create-choice-title">
            <h2 id="create-choice-title" className="c-section-title">Add your cards?</h2>
            <div className="create-choice-actions">
              <button type="button" className="c-btn c-btn--primary" onClick={() => chooseSource('both')}>Combine</button>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => chooseSource('manual')}>Cards only</button>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => chooseSource('file')}>File only</button>
              <button type="button" className="c-btn c-btn--quiet" onClick={() => setChoiceOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {batch && (
        <div className="c-scrim">
          <div className="c-sheet create-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="create-batch-title">
            <h2 id="create-batch-title" className="c-section-title">Pick files</h2>
            {batch.queued.length > 0 && <p className="c-meta" role="status">Building: {batch.queued.join(', ')}</p>}
            <ul className="create-batch-list">
              {batch.items.map(item => (
                <li key={item.key}>
                  <label>
                    <input type="checkbox" checked={batch.selected.has(item.key)} onChange={() => toggleBatchItem(item.key)} />
                    <span>{item.name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {batchChars > MAX_SOURCE_CHARS && <p className="create-batch-warning" role="alert">Too long: {batchChars.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} characters</p>}
            <div className="confirm-actions">
              <button type="button" className="c-btn c-btn--secondary" onClick={() => setBatch(null)}>{batch.queued.length ? 'Done' : 'Cancel'}</button>
              <button type="button" className="c-btn c-btn--primary" disabled={!batchChosen.length || batchChars > MAX_SOURCE_CHARS} onClick={queueBatchGuide}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
