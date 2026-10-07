import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, getToken, responseJson } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';
import { dismissGuideJob, startGuideJob, useGuideJobs } from '../lib/guideJobs';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MANUAL_DRAFT_KEY = 'autostudy_manual_draft';
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';
const MAX_FILES = 5;
// /generate keeps at most this much source text (MAX_CONTENT_LENGTH in backend/main.py).
const MAX_SOURCE_CHARS = 500_000;
const PASTED_KEY = 'pasted-notes';
const EMPTY_PAIRS = () => [{ term: '', definition: '' }, { term: '', definition: '' }];

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

function newRequestId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function combinedSource(items) {
  if (items.length === 1) return items[0].text;
  return items.map(item => `${baseName(item.name)}\n\n${item.text}`).join('\n\n');
}

function pairsToGuide(pairs, offset = 0) {
  return pairs.map((pair, index) => `Q${offset + index + 1}: ${pair.term.trim()}\nA${offset + index + 1}: ${pair.definition.trim()}`).join('\n');
}

function pairsToCards(pairs) {
  return pairs.map(pair => ({ front: pair.term.trim(), back: pair.definition.trim(), ...(pair.image ? { image: pair.image } : {}) }));
}

// Generates and saves one guide from source text. Runs as a background job, so it
// only uses the values passed in, never page state.
async function generateAndSave({ source, requestId, title, sourceTitle, sourceType, sourceUrl, externalSourceId, folderId, notes, flashcards, manualPairs }) {
  const generated = await apiFetch('/generate', {
    method: 'POST',
    body: JSON.stringify({ content: source, notes, study_guide: true, flashcards, request_id: requestId }),
  });
  if (!generated) throw new Error('The guide took too long to come back. Try again; you will not be charged twice.');
  if (generated.detail) {
    const detail = typeof generated.detail === 'string' ? generated.detail : generated.detail.message;
    const error = new Error(detail || 'Study guide generation failed.');
    error.upgrade = generated.detail.code === 'limit_reached' || Boolean(generated.detail.upgrade_url);
    throw error;
  }
  if (!generated.study_guide || generated.study_guide.startsWith('[Error')) {
    throw new Error(`CordiaClassroom could not build “${title}” from this material.`);
  }

  let studyGuide = generated.study_guide;
  let cards = generated.flashcards || null;
  if (manualPairs?.length) {
    const numbers = [...studyGuide.matchAll(/^Q(\d+):/gm)].map(match => Number(match[1]));
    studyGuide = `${studyGuide.trimEnd()}\n${pairsToGuide(manualPairs, numbers.length ? Math.max(...numbers) : 0)}`;
    if (flashcards) cards = [...(cards || []), ...pairsToCards(manualPairs)];
  }

  const saved = await apiFetch('/guides', {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes: generated.notes || null,
      study_guide: studyGuide,
      flashcards: cards,
      source_url: sourceUrl || null,
      external_source_id: externalSourceId || null,
      source_type: sourceType,
      source_title: sourceTitle,
      source_id: externalSourceId || null,
      ...(folderId ? { folder_id: folderId } : {}),
    }),
  });
  if (!saved?.guide) throw new Error(`Could not save “${title}”.`);
  return saved.guide;
}

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
    } catch {}
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
    } catch {}
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
    router.push(done.length === 1 ? '/guide/' + done[0].guideId : '/dashboard?view=guides');
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
    if (merged.length > MAX_FILES) problems.push(`You can add up to ${MAX_FILES} files at a time, so only the first ${MAX_FILES} were kept.`);
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

  function updatePair(index, field, value) {
    setManualPairs(previous => previous.map((pair, pairIndex) => pairIndex === index ? { ...pair, [field]: value } : pair));
  }

  async function saveManualGuide() {
    if (!completePairs.length) {
      setError('Add at least one complete question and answer in the Manual Study Guide.');
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
      ? 'Add at least one complete question and answer in the Manual Study Guide.'
      : 'Add a file or paste some notes in Upload Files first.');
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
  const createLabel = status === 'extracting' ? (uploadFiles.length > 1 ? 'Reading your files…' : 'Reading your file…')
    : status === 'saving' ? 'Saving your guide…'
      : isEdit ? 'Update study guide' : 'Create study guide';
  const createHint = createFrom === 'both' ? 'From the Manual Study Guide and Upload Files'
    : createFrom === 'manual' ? 'From the Manual Study Guide' : 'From Upload Files';

  return (
    <div ref={pageRef} className="fade-in create-split-page">
      <button type="button" className="create-back-link" onClick={() => router.push('/dashboard?view=guides')}>Back to Study Guides</button>

      <div className="create-split-top">
        <button type="button" className="btn create-split-submit" onClick={handleCreate} disabled={busy || Boolean(batch)}>{createLabel}</button>
        <span className="create-split-hint">{createHint}</span>
      </div>

      {error && <div className="create-banner create-banner-error" role="alert">
        <span>{error}</span>
      </div>}

      <div className={'create-split-grid' + (isEdit ? ' is-single' : '')}>
        <section
          className={'create-window' + (createFrom === 'manual' || createFrom === 'both' ? ' is-active' : '')}
          onFocusCapture={() => setLastWindow('manual')}
          onPointerDown={() => setLastWindow('manual')}
        >
          <h2 className="create-window-title">Manual Study Guide</h2>
          <p className="create-window-sub">Type the exact questions and answers you want to study.</p>
          <div className="create-manual-header"><span>{completePairs.length} complete cards</span><label>Set size <input type="number" min="1" max="100" value={cardCount} onChange={event => setCardCount(event.target.value)} onBlur={() => applyCardCount(cardCount)} /></label></div>
          <div className="create-cards-list">
            {manualPairs.map((pair, index) => (
              <div className="create-card" key={index}>
                <div className="create-card-num">{index + 1}</div>
                <div className="create-card-body">
                  <input className="create-card-input create-card-term" value={pair.term} onChange={event => updatePair(index, 'term', event.target.value)} placeholder="Question or term" />
                  <div className="create-card-divider" />
                  <input className="create-card-input create-card-def" value={pair.definition} onChange={event => updatePair(index, 'definition', event.target.value)} placeholder="Answer or definition" />
                </div>
                {manualPairs.length > 1 && <button type="button" className="create-card-remove" onClick={() => setManualPairs(pairs => pairs.filter((_, pairIndex) => pairIndex !== index))} aria-label="Remove card">×</button>}
              </div>
            ))}
          </div>
          <button type="button" className="create-add-card" onClick={() => setManualPairs(pairs => [...pairs, { term: '', definition: '' }])}>Add another card</button>
        </section>

        {!isEdit && (
          <section
            className={'create-window' + (createFrom === 'file' || createFrom === 'both' ? ' is-active' : '')}
            onFocusCapture={() => setLastWindow('file')}
            onPointerDown={() => setLastWindow('file')}
          >
            <h2 className="create-window-title">Upload Files</h2>
            <p className="create-window-sub">PDFs, PowerPoints, Word files, images, or text. Up to {MAX_FILES} at once.</p>
            <button
              ref={uploadBoxRef}
              type="button"
              className={'create-dropbox' + (uploadDropActive ? ' drop-target-active' : '')}
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploadFiles.length >= MAX_FILES}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <strong>{uploadDropActive ? 'Drop to add files' : uploadFiles.length >= MAX_FILES ? `${MAX_FILES} files added` : 'Click to choose files'}</strong>
              <span>or drag and drop them anywhere on this page</span>
            </button>
            <input ref={fileInputRef} type="file" accept="*" multiple onChange={event => { selectFiles(event.target.files); event.target.value = ''; }} hidden />
            {uploadFiles.length > 0 && (
              <ul className="create-file-list">
                {uploadFiles.map(file => (
                  <li key={fileKey(file)}>
                    <span>{file.name}</span>
                    <button type="button" onClick={() => removeFile(file)} disabled={busy} aria-label={`Remove ${file.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <label className="create-paste">
              <span>Or paste notes</span>
              <textarea className="create-textarea" value={content} onChange={event => setContent(event.target.value)} placeholder="Lecture notes, textbook passages, slide text…" disabled={busy} />
            </label>
          </section>
        )}
      </div>

      <section className="create-split-settings">
        <label><span>Title</span><input className="create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Automatic title" disabled={busy} /></label>
        <label><span>Class</span><select className="create-select" value={selectedFolder} onChange={event => setSelectedFolder(event.target.value)} disabled={busy}><option value="">No class</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        {!isEdit && (
          <div className="create-checks">
            <label className="create-check-label"><input type="checkbox" checked={generateNotes} onChange={event => setGenerateNotes(event.target.checked)} /> Include summary notes</label>
            <label className="create-check-label"><input type="checkbox" checked={generateFlashcards} onChange={event => setGenerateFlashcards(event.target.checked)} /> Include flashcards</label>
          </div>
        )}
      </section>

      {choiceOpen && (
        <div className="confirm-overlay">
          <div className="confirm-dialog create-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="create-choice-title">
            <h3 id="create-choice-title">Include your manual cards?</h3>
            <p>You may have uploaded a file AND written text in manual study guide. Would you like to include the manual study guide text in the same study guide as the file upload?</p>
            <div className="create-choice-actions">
              <button type="button" className="btn" onClick={() => chooseSource('both')}>Yes, include it</button>
              <button type="button" className="btn-outline" onClick={() => chooseSource('manual')}>Generate from manual creator</button>
              <button type="button" className="btn-outline" onClick={() => chooseSource('file')}>Generate from uploaded file</button>
              <button type="button" className="create-choice-cancel" onClick={() => setChoiceOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {batch && (
        <div className="confirm-overlay">
          <div className="confirm-dialog create-batch-dialog" role="dialog" aria-modal="true" aria-labelledby="create-batch-title">
            <h3 id="create-batch-title">Select files you want to combine into a study guide</h3>
            {batch.queued.length > 0 && <p>Building {batch.queued.map(name => `“${name}”`).join(', ')} in the background. Choose files for the next guide.</p>}
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
            {batchChars > MAX_SOURCE_CHARS && <p className="create-batch-warning" role="alert">These files are too long to combine into one guide ({batchChars.toLocaleString()} of {MAX_SOURCE_CHARS.toLocaleString()} characters). Select fewer files; the rest will be offered next.</p>}
            <div className="confirm-actions">
              <button type="button" className="btn-outline" onClick={() => setBatch(null)}>{batch.queued.length ? 'Done' : 'Cancel'}</button>
              <button type="button" className="btn" disabled={!batchChosen.length || batchChars > MAX_SOURCE_CHARS} onClick={queueBatchGuide}>
                {batchChosen.length === batch.items.length ? 'Create study guide' : `Create guide from ${batchChosen.length} file${batchChosen.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
