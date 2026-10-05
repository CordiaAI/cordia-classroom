import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { apiFetch, getToken, openUpgrade, responseJson } from '../lib/api';
import { useRequireAuth } from '../lib/auth';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MANUAL_DRAFT_KEY = 'autostudy_manual_draft';
const SOURCE_DRAFT_KEY = 'autostudy_text_draft';

export default function CreateGuidePage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [inputMode, setInputMode] = useState('text');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [externalSourceId, setExternalSourceId] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [manualPairs, setManualPairs] = useState([{ term: '', definition: '' }, { term: '', definition: '' }]);
  const [cardCount, setCardCount] = useState('');
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [generateNotes, setGenerateNotes] = useState(true);
  const [generateFlashcards, setGenerateFlashcards] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [upgradeUrl, setUpgradeUrl] = useState('');
  const fileInputRef = useRef(null);
  const uploadBoxRef = useRef(null);
  const formRef = useRef(null);
  // Reused when the same source is retried so one guide is never charged twice.
  const requestRef = useRef({ source: null, id: null });
  function requestIdFor(source) {
    if (requestRef.current.source !== source) {
      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
      requestRef.current = { source, id };
    }
    return requestRef.current.id;
  }

  useEffect(() => {
    if (router.query.editGuideId) return;
    try {
      const manualDraft = JSON.parse(localStorage.getItem(MANUAL_DRAFT_KEY) || 'null');
      if (manualDraft?.inputMode === 'manual') {
        setTitle(manualDraft.title || '');
        if (manualDraft.pairs?.length) setManualPairs(manualDraft.pairs);
        setInputMode('manual');
        return;
      }
      const sourceDraft = JSON.parse(localStorage.getItem(SOURCE_DRAFT_KEY) || 'null');
      if (sourceDraft) {
        setTitle(sourceDraft.title || '');
        setContent(sourceDraft.content || '');
        setSourceUrl(sourceDraft.source_url || '');
        setExternalSourceId(sourceDraft.external_source_id || '');
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (inputMode === 'manual') {
      if (title.trim() || manualPairs.some(pair => pair.term.trim() || pair.definition.trim())) {
        localStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify({ title, pairs: manualPairs, inputMode }));
      }
      return;
    }
    if (title.trim() || content.trim()) localStorage.setItem(SOURCE_DRAFT_KEY, JSON.stringify({ title, content, source_url: sourceUrl, external_source_id: externalSourceId }));
  }, [content, externalSourceId, inputMode, manualPairs, sourceUrl, title]);

  useEffect(() => {
    const editId = router.query.editGuideId;
    if (!ready || !editId) return;
    apiFetch('/guides/' + editId).then(data => {
      if (!data?.guide) return;
      setTitle(data.guide.title || '');
      setInputMode('manual');
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
      localStorage.removeItem(MANUAL_DRAFT_KEY);
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

  const applyCardCount = useCallback(count => {
    const size = Math.min(parseInt(count, 10) || 0, 100);
    if (size < 1) return;
    setManualPairs(previous => previous.length < size
      ? [...previous, ...Array.from({ length: size - previous.length }, () => ({ term: '', definition: '' }))]
      : previous.slice(0, size));
  }, []);

  function selectFile(file) {
    if (!file) return;
    const unsupported = unsupportedFileMessage(file);
    if (unsupported) {
      setError(unsupported);
      return;
    }
    setUploadFile(file);
    setInputMode('pdf');
    setError('');
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
  }

  const uploadDropActive = useFileDropZone({
    enabled: ready,
    priority: 2,
    getElement: () => uploadBoxRef.current || formRef.current,
    onFiles: files => {
      if (!['extracting', 'generating', 'saving'].includes(status)) selectFile(files[0]);
    },
  });

  function switchToManual() {
    setInputMode(mode => mode === 'manual' ? (uploadFile ? 'pdf' : 'text') : 'manual');
    setError('');
  }

  function updatePair(index, field, value) {
    setManualPairs(previous => previous.map((pair, pairIndex) => pairIndex === index ? { ...pair, [field]: value } : pair));
  }

  function resolvedTitle() {
    if (title.trim()) return title.trim();
    if (uploadFile?.name) return uploadFile.name.replace(/\.[^.]+$/, '');
    const firstLine = content.split('\n').map(line => line.trim()).find(Boolean);
    return firstLine?.slice(0, 72) || 'New Study Guide';
  }

  async function saveManualGuide() {
    const pairs = manualPairs.filter(pair => pair.term.trim() && pair.definition.trim());
    if (!pairs.length) {
      setError('Add at least one complete term and definition.');
      return;
    }
    setStatus('saving');
    const body = {
      title: resolvedTitle(),
      study_guide: pairs.map((pair, index) => `Q${index + 1}: ${pair.term.trim()}\nA${index + 1}: ${pair.definition.trim()}`).join('\n'),
      flashcards: pairs.map(pair => ({ front: pair.term.trim(), back: pair.definition.trim(), ...(pair.image ? { image: pair.image } : {}) })),
      ...(selectedFolder ? { folder_id: selectedFolder } : {}),
    };
    const editId = router.query.editGuideId;
    const saved = await apiFetch(editId ? '/guides/' + editId : '/guides', {
      method: editId ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    if (!saved?.guide) throw new Error('Failed to save guide.');
    localStorage.removeItem(MANUAL_DRAFT_KEY);
    router.push('/guide/' + saved.guide.id);
  }

  async function extractFile() {
    if (!uploadFile) return '';
    setStatus('extracting');
    const formData = new FormData();
    formData.append('file', uploadFile);
    const response = await fetch(API + '/extract-file-text', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (getToken() || '') },
      body: formData,
    });
    const data = await responseJson(response);
    if (!response.ok || !data.text) throw new Error(data.detail || 'Could not read this file.');
    return data.text;
  }

  async function handleCreate(event) {
    event.preventDefault();
    setError('');
    setUpgradeUrl('');
    try {
      if (inputMode === 'manual') return await saveManualGuide();
      const source = inputMode === 'pdf' ? await extractFile() : content.trim();
      if (source.length < 10) {
        setError('Add a little more study material before creating your guide.');
        return;
      }
      setStatus('generating');
      const generated = await apiFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({ content: source, notes: generateNotes, study_guide: true, flashcards: generateFlashcards, request_id: requestIdFor(source) }),
      });
      if (!generated) throw new Error('The guide took too long to come back. Try again; you will not be charged twice.');
      if (generated.detail) {
        const detail = typeof generated.detail === 'string' ? generated.detail : generated.detail.message;
        setUpgradeUrl(generated.detail.code === 'limit_reached' ? 'modal' : (generated.detail.upgrade_url || ''));
        throw new Error(detail || 'Study guide generation failed.');
      }
      if (!generated.study_guide || generated.study_guide.startsWith('[Error')) {
        throw new Error('CordiaClassroom could not build a guide from this material.');
      }

      setStatus('saving');
      const saved = await apiFetch('/guides', {
        method: 'POST',
        body: JSON.stringify({
          title: resolvedTitle(),
          notes: generated.notes || null,
          study_guide: generated.study_guide || null,
          flashcards: generated.flashcards || null,
          source_url: sourceUrl || null,
          external_source_id: externalSourceId || null,
          source_type: uploadFile ? 'file' : sourceUrl ? 'webpage' : 'pasted_text',
          source_title: uploadFile?.name || resolvedTitle(),
          source_id: externalSourceId || null,
          ...(selectedFolder ? { folder_id: selectedFolder } : {}),
        }),
      });
      if (!saved?.guide) throw new Error('Failed to save guide.');
      localStorage.removeItem(SOURCE_DRAFT_KEY);
      requestRef.current = { source: null, id: null };
      router.push('/guide/' + saved.guide.id);
    } catch (caught) {
      setError(caught.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  if (!ready) return null;

  const isLoading = ['extracting', 'generating', 'saving'].includes(status);
  const validManualPair = manualPairs.some(pair => pair.term.trim() && pair.definition.trim());
  const canSubmit = !isLoading && (inputMode === 'manual' ? validManualPair : inputMode === 'pdf' ? !!uploadFile : content.trim().length >= 10);
  const statusMessages = {
    extracting: 'Reading your file…',
    generating: 'Building your study guide…',
    saving: 'Saving your guide…',
  };

  return (
    <div className="fade-in create-page create-page-redesign">
      <button type="button" className="create-back-link" onClick={() => router.push('/dashboard?view=guides')}>Back to Study Guides</button>
      <header className="create-header create-hero">
        <h1 className="create-title">Turn material into something you can study.</h1>
        <p className="create-subtitle">Paste notes or add a file. CordiaClassroom handles the structure, title, and flashcards for you.</p>
      </header>

      {isLoading && <div className="create-banner create-banner-info">{statusMessages[status]}</div>}
      {error && <div className="create-banner create-banner-error" role="alert">
        <span>{error}</span>
        {upgradeUrl && <button type="button" onClick={() => (upgradeUrl === 'modal' ? openUpgrade({ feature: 'guide' }) : router.push(upgradeUrl))}>View plans</button>}
      </div>}

      <form ref={formRef} className={'create-flow-card' + (uploadDropActive && inputMode === 'manual' ? ' drop-target-active' : '')} onSubmit={handleCreate}>
        {inputMode !== 'manual' ? (
          <>
            <section className="create-source-section">
              <div className="create-step-heading"><span>1</span><div><h2>Add your study material</h2><p>Paste text below or choose a document—whichever is faster.</p></div></div>
              <textarea
                className="create-textarea create-source-textarea"
                placeholder="Paste lecture notes, textbook content, slides, or anything you need to learn…"
                value={content}
                onChange={event => { setContent(event.target.value); if (event.target.value.trim()) setInputMode('text'); }}
                disabled={isLoading}
              />
              <div className="create-source-divider"><span>or</span></div>
              <button ref={uploadBoxRef} type="button" className={'create-upload-button' + (uploadFile ? ' selected' : '') + (uploadDropActive ? ' drop-target-active' : '')} onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
                <span>{uploadDropActive ? 'Drop to add this file' : uploadFile ? uploadFile.name : 'Choose or drop a PDF, PowerPoint, Word file, image, or text file'}</span>
                <small>{uploadFile ? 'Click or drop to replace this file' : 'Drag a file anywhere on this page'}</small>
              </button>
              <input ref={fileInputRef} type="file" accept="*" onChange={event => { selectFile(event.target.files?.[0]); event.target.value = ''; }} hidden />
            </section>

            <section className="create-details-section">
              <div className="create-step-heading"><span>2</span><div><h2>Choose where it belongs</h2><p>Both fields are optional. The title is created automatically if left blank.</p></div></div>
              <div className="create-details-grid">
                <label><span>Title</span><input className="create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Automatic title" disabled={isLoading} /></label>
                <label><span>Class</span><select className="create-select" value={selectedFolder} onChange={event => setSelectedFolder(event.target.value)} disabled={isLoading}><option value="">No class</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
              </div>
              <div className="create-checks">
                <label className="create-check-label"><input type="checkbox" checked={generateNotes} onChange={event => setGenerateNotes(event.target.checked)} /> Include summary notes</label>
                <label className="create-check-label"><input type="checkbox" checked={generateFlashcards} onChange={event => setGenerateFlashcards(event.target.checked)} /> Include flashcards</label>
              </div>
            </section>
          </>
        ) : (
          <section className="create-manual-section">
            <div className="create-step-heading"><span>1</span><div><h2>Build manually</h2><p>Add the exact questions and answers you want to study.</p></div></div>
            <label className="create-manual-title"><span>Guide title</span><input className="create-input" value={title} onChange={event => setTitle(event.target.value)} placeholder="Custom study guide" /></label>
            <div className="create-manual-header"><span>{manualPairs.filter(pair => pair.term.trim() && pair.definition.trim()).length} complete cards</span><label>Set size <input type="number" min="1" max="100" value={cardCount} onChange={event => setCardCount(event.target.value)} onBlur={() => applyCardCount(cardCount)} /></label></div>
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
            <label className="create-manual-title"><span>Class</span><select className="create-select" value={selectedFolder} onChange={event => setSelectedFolder(event.target.value)}><option value="">No class</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          </section>
        )}

        <footer className="create-flow-footer">
          <button type="button" className="create-manual-toggle" onClick={switchToManual}>{inputMode === 'manual' ? 'Use AI from source material' : 'Build manually'}</button>
          <button type="submit" className="btn create-submit-btn" disabled={!canSubmit}>{isLoading ? statusMessages[status] : router.query.editGuideId ? 'Update study guide' : 'Create study guide'}</button>
        </footer>
      </form>
    </div>
  );
}
