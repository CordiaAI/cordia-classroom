import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import GuidedTour from '../GuidedTour';
import MermaidDiagram from '../MermaidDiagram';
import { authHeaders, authorizedFetch } from '../../lib/api';
import { cleanPastedHtml, formatOnKeyDown, plainTextToHtml } from '../../lib/notesEditing';
import { practiceTourUrl, saveOnboardingStep } from '../../lib/onboarding';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import { API, notesRequest, saveErrorMessage } from '../../lib/smartnotes';
import { SMARTNOTES_TOUR } from '../../lib/tours';
import MaterialPanel from './MaterialPanel';
import { StudyGuidePreviewModal, useGuidePreview } from './GuidePreview';

// One note: the paper on the left, class material and a diagram panel on the right.
export default function SmartNotesEditor() {
  const router = useRouter();
  const [noteId, setNoteId] = useState(null);
  const [title, setTitle] = useState('Untitled Notes');
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState('');
  const [actionError, setActionError] = useState(''); // a failed load, create, move, delete, or diagram
  const [notes, setNotes] = useState([]); // session list
  const [showNotesList, setShowNotesList] = useState(false);

  // Diagram / visualize
  const [mermaidCode, setMermaidCode] = useState(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [visualizeMode, setVisualizeMode] = useState(false);

  // "Turn into Study Guide" preview modal
  const [convertingGuide, setConvertingGuide] = useState(false);
  const guide = useGuidePreview();

  // Resize state
  const [colWidth, setColWidth] = useState(320);
  const [topPx, setTopPx] = useState(null); // null = CSS default 1fr
  const layoutRef = useRef(null);

  // Class/folder assignment
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState('');
  const folderIdRef = useRef('');

  // Paper (contenteditable)
  const paperRef = useRef(null);
  const saveTimer = useRef(null);
  const pollTimer = useRef(null);
  // Refs mirror state so timeout callbacks always read the latest values
  const noteIdRef = useRef(null);
  const titleRef  = useRef('Untitled Notes');
  const lastSavedRef = useRef('');       // last saved content snapshot
  const lastSavedTitleRef = useRef('Untitled Notes'); // last saved title snapshot

  // Multi-page illusion: how many "filled pages" are behind the front paper (0–2)
  const [pageCount, setPageCount] = useState(0);

  // ── Init: load existing note (parent only renders editor when ?id is present)
  useEffect(() => {
    const { id } = router.query;
    if (id && String(id) !== String(noteIdRef.current)) {
      loadNote(id);
    }
  }, [router.isReady, router.query.id]);

  // Load classes/folders for assignment
  useEffect(() => {
    notesRequest('/folders')
      .then(data => setFolders(data.folders || []))
      .catch(caught => setActionError(caught.message));
  }, []);

  // Load notes list (also callable after save to refresh titles)
  const fetchNotes = useCallback(() => {
    notesRequest('/smart_notes')
      .then(data => setNotes(data.notes || []))
      .catch(caught => setActionError(caught.message));
  }, []);

  useEffect(() => { fetchNotes(); }, [noteId, fetchNotes]);

  async function createNote() {
    let data;
    try {
      data = await notesRequest('/smart_notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Notes' }) });
    } catch (caught) {
      setActionError(caught.message);
      return;
    }
    noteIdRef.current = data.note.id;
    setNoteId(data.note.id);
    // Ensure the paper has a starting <p> block so first-line typing has a wrapper
    if (paperRef.current && !paperRef.current.innerHTML.trim()) {
      paperRef.current.innerHTML = '<p><br></p>';
    }
    lastSavedRef.current = paperRef.current?.innerHTML || '';
    lastSavedTitleRef.current = 'Untitled Notes';
    window.history.replaceState({}, '', '/smartnotes?id=' + data.note.id);
  }

  async function loadNote(id) {
    let data;
    try {
      data = await notesRequest('/smart_notes/' + id);
    } catch (caught) {
      // Only a link to a note that doesn't exist starts a new one; any other failure keeps
      // the student on this note and says why, so a blip never looks like lost notes.
      if (caught.status === 400 || caught.status === 404) createNote();
      else setActionError(caught.message);
      return;
    }
    noteIdRef.current = data.note.id;
    titleRef.current  = data.note.title || 'Untitled Notes';
    folderIdRef.current = data.note.folder_id || '';
    setNoteId(data.note.id);
    setTitle(data.note.title || 'Untitled Notes');
    setFolderId(data.note.folder_id || '');
    if (paperRef.current) {
      paperRef.current.innerHTML = data.note.content && data.note.content.trim()
        ? sanitizeHtml(data.note.content)
        : '<p><br></p>';
      lastSavedRef.current = paperRef.current.innerHTML;
      lastSavedTitleRef.current = data.note.title || 'Untitled Notes';
    }
  }

  // ── Save helper — sends content to backend, updates lastSavedRef ────────
  // Resolves to '' when the note is saved (or unchanged), otherwise to a readable error.
  // A failed save leaves lastSavedRef untouched so the next autosave retries it.
  const doSave = useCallback(async (opts = {}) => {
    if (!paperRef.current || !noteIdRef.current) return '';
    const content = paperRef.current.innerHTML;
    const title = titleRef.current;
    if (content === lastSavedRef.current && title === lastSavedTitleRef.current && !opts.force) return '';
    setSaveStatus('saving');
    let message = '';
    try {
      const response = await authorizedFetch('/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
      });
      if (!response.ok) message = saveErrorMessage(response.status);
    } catch {
      message = saveErrorMessage(0);
    }
    if (message) {
      setSaveStatus('error');
      setSaveError(message);
      return message;
    }
    lastSavedRef.current = content;
    lastSavedTitleRef.current = title;
    setSaveError('');
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1500);
    fetchNotes(); // refresh sidebar list so title changes appear immediately
    return '';
  }, [fetchNotes]);

  // ── Autosave (debounced 1s after a keypress) ────────────────────────────
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!noteIdRef.current) return;
    saveTimer.current = setTimeout(() => doSave(), 1000);
  }, [doSave]);

  // ── Live polling: every 3s, save if content changed (catches mouse-only edits)
  useEffect(() => {
    pollTimer.current = setInterval(() => { doSave(); }, 3000);
    return () => clearInterval(pollTimer.current);
  }, [doSave]);

  // ── Multi-page illusion — track scrollHeight, add ghost pages as content grows
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    function update() {
      const visible = paper.clientHeight || 1;
      // Each "filled page" = one extra visible-height of content beyond the first
      const filled = Math.max(0, Math.floor((paper.scrollHeight - 16) / visible) - 1);
      setPageCount(Math.min(filled, 2)); // cap at 2 ghost pages
    }
    update();
    const ro = new ResizeObserver(update);
    ro.observe(paper);
    const mo = new MutationObserver(update);
    mo.observe(paper, { childList: true, subtree: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  // ── Flush save on unmount (SPA navigation) and beforeunload (tab close) ──
  useEffect(() => {
    function flushSave() {
      clearTimeout(saveTimer.current);
      if (!noteIdRef.current || !paperRef.current) return;
      const content = paperRef.current.innerHTML;
      const title = titleRef.current;
      const contentChanged = content !== lastSavedRef.current;
      const titleChanged = title !== lastSavedTitleRef.current;
      if (!contentChanged && !titleChanged) return;
      fetch(API + '/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content }),
        keepalive: true,
      }).catch(() => { /* the page is closing; there is nowhere left to show the error */ });
      lastSavedRef.current = content;
      lastSavedTitleRef.current = title;
    }
    window.addEventListener('beforeunload', flushSave);
    return () => {
      window.removeEventListener('beforeunload', flushSave);
      flushSave(); // fires on SPA navigation (component unmount)
    };
  }, []);

  // ── Class/folder assignment — save immediately on change ────────────────
  async function handleFolderChange(e) {
    const newId = e.target.value;
    folderIdRef.current = newId;
    setFolderId(newId);
    if (!noteIdRef.current) return;
    setActionError('');
    try {
      await notesRequest('/smart_notes/' + noteIdRef.current, { method: 'PUT', body: JSON.stringify({ folder_id: newId || '' }) });
      fetchNotes();
    } catch (caught) {
      setActionError(caught.message);
    }
  }

  // ── Visualize: send highlighted text to diagram API ─────────────────────
  function handleVisualize() {
    setVisualizeMode(v => !v);
  }

  async function handleCheckmark() {
    const selectedText = window.getSelection()?.toString()?.trim();
    if (!selectedText || selectedText.length < 5) return;
    setVisualizeMode(false);
    setDiagramLoading(true);
    setActionError('');
    try {
      const data = await notesRequest('/smart_notes/diagram', { method: 'POST', body: JSON.stringify({ content: selectedText }) });
      setMermaidCode(data.mermaid || null);
    } catch (caught) {
      setActionError(caught.message);
    }
    setDiagramLoading(false);
  }

  // ── Resize handlers ──────────────────────────────────────────────────────
  function onVDragStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidth;
    const onMove = (me) => {
      if (!layoutRef.current) return;
      const dx = startX - me.clientX;
      const maxW = layoutRef.current.offsetWidth - 340;
      setColWidth(Math.max(200, Math.min(startWidth + dx, maxW)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onHDragStart(e) {
    e.preventDefault();
    const onMove = (me) => {
      if (!layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const newTop = Math.max(100, Math.min(me.clientY - rect.top, rect.height - 8 - 100));
      setTopPx(newTop);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onPaperPaste(event) {
    const data = event.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (!html && !text) return; // images and files keep the browser default
    event.preventDefault();
    const cleaned = (html && cleanPastedHtml(html)) || plainTextToHtml(text || '');
    if (cleaned) document.execCommand('insertHTML', false, cleaned);
    scheduleSave();
  }

  // ── Paper keyboard handler ───────────────────────────────────────────────
  function onPaperKeyUp(e) {
    if (!paperRef.current) return;
    scheduleSave();
  }

  // ── New session — flush current, then create+navigate to fresh note ──────
  async function handleNewNote() {
    await doSave();
    setActionError('');
    try {
      const data = await notesRequest('/smart_notes', { method: 'POST', body: JSON.stringify({ title: 'Untitled Notes' }) });
      router.push('/smartnotes?id=' + data.note.id);
    } catch (caught) {
      setActionError(caught.message);
    }
  }

  async function handleSwitchNote(id) {
    setShowNotesList(false);
    await doSave(); // persist current note before switching
    router.push('/smartnotes?id=' + id);
  }

  async function finishSmartNotesTour(outcome) {
    if (outcome === 'skipped') {
      await saveOnboardingStep('done');
      router.replace('/smartnotes?id=' + noteIdRef.current, undefined, { shallow: true });
      return;
    }
    await saveOnboardingStep('practice');
    router.push(await practiceTourUrl());
  }

  async function handleConvertToGuide() {
    setShowNotesList(false);
    if (!noteIdRef.current) return;
    setConvertingGuide(true);
    // The backend reads the saved note, so a failed save must stop here with its reason.
    const saveProblem = await doSave();
    if (saveProblem) guide.showError(saveProblem);
    else await guide.generate(noteIdRef.current, folderIdRef.current);
    setConvertingGuide(false);
  }

  return (
    <div className="sn-page">
      {router.query.tour === '1' && noteId && <GuidedTour steps={SMARTNOTES_TOUR} onFinish={finishSmartNotesTour} />}
      {/* Header bar */}
      <div className="sn-header">
        <div className="sn-header-left">
          <input
            className="sn-title-input"
            value={title}
            onChange={e => { titleRef.current = e.target.value; setTitle(e.target.value); scheduleSave(); }}
            placeholder="Note title..."
            spellCheck={false}
          />
          <span className={`sn-status ${actionError ? 'error' : saveStatus}`} role={actionError ? 'alert' : undefined}>
            {actionError || (saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? saveError : '')}
          </span>
        </div>
        <div className="sn-header-right">
          <select
            className="sn-class-select"
            value={folderId}
            onChange={handleFolderChange}
            title="Assign to class"
          >
            <option value="">No class</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <button
            className="btn sn-convert-header-btn"
            onClick={handleConvertToGuide}
            disabled={convertingGuide}
            title="Turn this note into a study guide"
          >
            {convertingGuide ? 'Generating…' : 'Turn into Study Guide'}
          </button>
          <button
            className={`btn sn-save-btn${saveStatus === 'saving' ? ' saving' : saveStatus === 'saved' ? ' saved' : saveStatus === 'error' ? ' error' : ''}`}
            onClick={() => doSave({ force: true })}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
          <div className="sn-notes-picker">
            <button
              className={`btn sn-open-btn sn-notes-dropdown-trigger${showNotesList ? ' open' : ''}`}
              onClick={() => setShowNotesList(v => !v)}
            >
              <span>My Notes</span>
              <svg className="sn-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {showNotesList && (
              <div className="sn-notes-dropdown">
                <div className="sn-notes-dropdown-header">
                  <span className="sn-panel-label">Sessions</span>
                  <button className="sn-new-btn" onClick={handleNewNote}>+ New</button>
                </div>
                <div
                  className={'sn-notes-item sn-notes-item--back'}
                  onClick={async () => { setShowNotesList(false); await doSave(); router.push('/smartnotes'); }}
                >
                  ← All notes
                </div>
                {notes.map(n => (
                  <div
                    key={n.id}
                    className={'sn-notes-item' + (n.id === noteId ? ' active' : '')}
                    onClick={() => handleSwitchNote(n.id)}
                  >
                    {n.title || 'Untitled Notes'}
                  </div>
                ))}
                {notes.length === 0 && <div className="sn-notes-item muted">No sessions yet</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3-panel resizable grid */}
      <div
        className="sn-layout"
        ref={layoutRef}
        style={{
          gridTemplateColumns: `1fr 8px ${colWidth}px`,
          gridTemplateRows: topPx !== null ? `${topPx}px 8px 1fr` : '1fr 8px 1fr',
        }}
      >
        {/* Left: notes paper — spans all 3 rows */}
        <div className="sn-paper-wrap">
          <div className="sn-paper-label-row">
            <span className="sn-panel-label">SmartNotes</span>
            {visualizeMode && (
              <button
                className="sn-visualize-confirm"
                onClick={handleCheckmark}
                title="Generate diagram from highlighted text"
              >
                ✓
              </button>
            )}
          </div>
          <div className={`sn-paper-stage sn-paper-stage--p${pageCount}`}>
            {/* Ghost pages behind — appear as content fills */}
            <div className="sn-ghost-page sn-ghost-page-3" aria-hidden="true" />
            <div className="sn-ghost-page sn-ghost-page-2" aria-hidden="true" />
          <div
            ref={paperRef}
            className={`sn-paper${visualizeMode ? ' sn-paper--visualize' : ''}`}
            contentEditable
            suppressContentEditableWarning
            onKeyDown={e => formatOnKeyDown(e, paperRef.current)}
            onKeyUp={onPaperKeyUp}
            onPaste={onPaperPaste}
            data-placeholder="Start typing your notes here…"
            spellCheck={false}
          />
          </div>
        </div>

        {/* Vertical drag divider */}
        <div className="sn-v-divider" onMouseDown={onVDragStart} />

        {/* Top-right: class material viewer */}
        <MaterialPanel onError={setActionError} />

        {/* Horizontal drag divider */}
        <div className="sn-h-divider" onMouseDown={onHDragStart} />

        {/* Bottom-right: diagram */}
        <div className="sn-diagram-wrap">
          <div className="sn-diagram-toolbar">
            <span className="sn-panel-label">Visual Diagram</span>
            <button
              className={`btn sn-open-btn sn-visualize-btn${visualizeMode ? ' active' : ''}`}
              onClick={handleVisualize}
            >
              {visualizeMode ? 'Cancel' : 'Visualize'}
            </button>
          </div>
          <div className="sn-diagram-body">
            {diagramLoading && (
              <div className="sn-diagram-placeholder">Generating diagram…</div>
            )}
            {!diagramLoading && mermaidCode && (
              <MermaidDiagram code={mermaidCode} label="SmartNotes diagram" className="sn-diagram-render" />
            )}
            {!diagramLoading && !mermaidCode && (
              <div className="sn-diagram-placeholder">
                <p>Click "Visualize", highlight text in your notes, then click ✓</p>
              </div>
            )}
          </div>
        </div>

      </div>

      <StudyGuidePreviewModal {...guide.modal} />
    </div>
  );
}
