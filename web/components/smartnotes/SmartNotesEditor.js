import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, ChevronDown, Keyboard, NotebookPen, Sparkles, Trash2 } from 'lucide-react';
import Menu from '../Menu';
import { requestTip } from '../../lib/tips';
import TypingShortcuts from './TypingShortcuts';
import CordiaLoader from '../CordiaLoader';
import MermaidDiagram from '../MermaidDiagram';
import NapkinVisual from '../NapkinVisual';
import { authHeaders, authorizedFetch } from '../../lib/api';
import { TYPING_CHARS, isDefaultTitle } from '../../lib/noteMeta.mjs';
import { cleanPastedHtml, formatOnKeyDown, plainTextToHtml } from '../../lib/notesEditing';
import { sanitizeHtml } from '../../lib/sanitizeHtml';
import { API, notesRequest, saveErrorMessage } from '../../lib/smartnotes';
import { walkthroughEvent } from '../../lib/walkthrough';
import MaterialPanel from './MaterialPanel';
import { StudyGuidePreviewModal, useGuidePreview } from './GuidePreview';

// The built-in diagram for a highlight, drawn only when no Napkin visual is available.
function BuiltInDiagram({ text, code, loading, draw }) {
  useEffect(() => { if (!code) draw(text); }, [text]);
  if (loading) return <div className="sn-diagram-placeholder"><CordiaLoader size={20} label="Drawing" /></div>;
  return code ? <MermaidDiagram code={code} label="SmartNotes diagram" className="sn-diagram-render" /> : null;
}

// One note: the paper on the left, class material and a diagram panel on the right.
export default function SmartNotesEditor() {
  const router = useRouter();
  const [noteId, setNoteId] = useState(null);
  const [title, setTitle] = useState('Untitled Notes');
  const [hasText, setHasText] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState('');
  const [actionError, setActionError] = useState(''); // a failed load, create, move, delete, or diagram
  const [notes, setNotes] = useState([]); // session list
  const [showNotesList, setShowNotesList] = useState(false);
  const notesPickerRef = useRef(null);
  const notesTriggerRef = useRef(null);
  // The notes dropdown closes on Escape (focus returns to its button) and on any outside click.
  useEffect(() => {
    if (!showNotesList) return undefined;
    function onKey(event) {
      if (event.key !== 'Escape') return;
      setShowNotesList(false);
      notesTriggerRef.current?.focus();
    }
    function onPointer(event) {
      if (!notesPickerRef.current?.contains(event.target)) setShowNotesList(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [showNotesList]);

  // Diagram / visualize
  const [mermaidCode, setMermaidCode] = useState(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [visualizeMode, setVisualizeMode] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  // First note: a one-time tip points at the typing shortcuts.
  useEffect(() => { requestTip('typing'); }, []);
  const [visualSource, setVisualSource] = useState(null); // { text, context, key }
  const visualAnchor = useRef(null);

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
  const titleRequested = useRef(false); // AI title asked for once per opened note

  // Multi-page illusion: how many "filled pages" are behind the front paper (0–2)
  const [pageCount, setPageCount] = useState(0);

  // ── Init: load existing note (parent only renders editor when ?id is present)
  useEffect(() => {
    const { id } = router.query;
    if (id === 'new') {
      if (noteIdRef.current || !paperRef.current?.innerHTML) startBlankNote();
    } else if (id && String(id) !== String(noteIdRef.current)) {
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

  // A blank editor with no saved note behind it yet.
  function startBlankNote() {
    noteIdRef.current = null;
    titleRequested.current = false;
    titleRef.current = 'Untitled Notes';
    folderIdRef.current = '';
    setNoteId(null);
    setTitle('Untitled Notes');
    setFolderId('');
    if (paperRef.current) {
      paperRef.current.innerHTML = '<p><br></p>';
      lastSavedRef.current = paperRef.current.innerHTML;
      setHasText(false);
    }
    lastSavedTitleRef.current = 'Untitled Notes';
  }

  // The note is created on the server the first time it has something in it.
  const creatingRef = useRef(null);
  function noteIsEmpty() {
    const text = paperRef.current?.innerText?.trim() || '';
    const title = (titleRef.current || '').trim();
    return !text && (!title || title === 'Untitled Notes');
  }
  async function ensureNote() {
    if (noteIdRef.current) return noteIdRef.current;
    if (noteIsEmpty()) return null;
    if (!creatingRef.current) {
      creatingRef.current = (async () => {
        try {
          const data = await notesRequest('/smart_notes', { method: 'POST', body: JSON.stringify({ title: titleRef.current || 'Untitled Notes' }) });
          noteIdRef.current = data.note.id;
          setNoteId(data.note.id);
          walkthroughEvent('note-written');
          if (folderIdRef.current) {
            await notesRequest('/smart_notes/' + data.note.id, { method: 'PUT', body: JSON.stringify({ folder_id: folderIdRef.current }) })
              .catch(caught => setActionError(caught.message));
          }
          window.history.replaceState(window.history.state, '', '/smartnotes?id=' + data.note.id);
          return data.note.id;
        } catch (caught) {
          setActionError(caught.message);
          return null;
        } finally {
          creatingRef.current = null;
        }
      })();
    }
    return creatingRef.current;
  }

  async function loadNote(id) {
    let data;
    try {
      data = await notesRequest('/smart_notes/' + id);
    } catch (caught) {
      // Only a link to a note that doesn't exist starts a new one; any other failure keeps
      // the student on this note and says why, so a blip never looks like lost notes.
      if (caught.status === 400 || caught.status === 404) startBlankNote();
      else setActionError(caught.message);
      return;
    }
    noteIdRef.current = data.note.id;
    titleRequested.current = false;
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
      setHasText(Boolean(paperRef.current.innerText.trim()));
    }
  }

  // ── Save helper — sends content to backend, updates lastSavedRef ────────
  // Resolves to '' when the note is saved (or unchanged), otherwise to a readable error.
  // A failed save leaves lastSavedRef untouched so the next autosave retries it.
  const doSave = useCallback(async (opts = {}) => {
    if (!paperRef.current) return '';
    if (!noteIdRef.current && !(await ensureNote())) return '';
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
    // Still "Untitled Notes" with real text: ask once for an AI title (saved to the note by the server).
    if (!titleRequested.current && isDefaultTitle(title) && (paperRef.current?.innerText || '').trim().length >= TYPING_CHARS) {
      titleRequested.current = true;
      const noteId = noteIdRef.current;
      fetch('/api/notes/meta', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ note_id: noteId, title: true, cover: false }) })
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
          if (!data?.title || noteIdRef.current !== noteId || !isDefaultTitle(titleRef.current)) return;
          titleRef.current = data.title;
          lastSavedTitleRef.current = data.title;
          setTitle(data.title);
          fetchNotes();
        })
        .catch(() => {});
    }
    setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1500);
    fetchNotes(); // refresh sidebar list so title changes appear immediately
    return '';
  }, [fetchNotes]);

  // ── Autosave (debounced 1s after a keypress) ────────────────────────────
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
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
      if (!paperRef.current) return;
      // A note that was never saved and has text: create it now (SPA navigation keeps this running).
      if (!noteIdRef.current) { if (!noteIsEmpty()) doSave(); return; }
      const content = paperRef.current.innerHTML;
      const title = titleRef.current;
      const contentChanged = content !== lastSavedRef.current;
      const titleChanged = title !== lastSavedTitleRef.current;
      if (!contentChanged && !titleChanged) return;
      const body = JSON.stringify({ title, content });
      // Browsers refuse keepalive bodies over 64 KB (notes with pasted images), so big notes
      // save with a normal request: it still completes on SPA navigation.
      fetch(API + '/smart_notes/' + noteIdRef.current, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body,
        keepalive: new Blob([body]).size < 60000,
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
    if (!noteIdRef.current) return; // saved with the note when it is first created
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

  // "Make diagram": a Napkin visual of the highlight (the rest of the note is context).
  // If no visual can be made, the built-in diagram is drawn instead.
  function handleCheckmark() {
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();
    if (!selectedText || selectedText.length < 5) return;
    const paperText = paperRef.current?.innerText || '';
    const at = paperText.indexOf(selectedText);
    const context = at >= 0
      ? `${paperText.slice(Math.max(0, at - 700), at)}\n${paperText.slice(at + selectedText.length, at + selectedText.length + 700)}`.trim()
      : '';
    let block = selection.rangeCount ? selection.getRangeAt(0).endContainer : null;
    while (block && block.parentNode !== paperRef.current) block = block.parentNode;
    visualAnchor.current = block || null;
    setVisualizeMode(false);
    setMermaidCode(null);
    setVisualSource({ text: selectedText, context, key: Date.now() });
  }

  async function drawBuiltInDiagram(text) {
    setDiagramLoading(true);
    setActionError('');
    try {
      const data = await notesRequest('/smart_notes/diagram', { method: 'POST', body: JSON.stringify({ content: text }) });
      setMermaidCode(data.mermaid || null);
    } catch (caught) {
      setActionError(caught.message);
    }
    setDiagramLoading(false);
  }

  // "Use this" puts the visual into the note, after the highlighted paragraph.
  function insertVisual(visual) {
    const paper = paperRef.current;
    if (!paper) return;
    const img = document.createElement('img');
    img.src = visual.url;
    img.alt = visual.alt || 'Diagram';
    img.className = `nv-inline nv-${visual.theme === 'dark' ? 'dark' : 'light'}`;
    const anchor = visualAnchor.current && paper.contains(visualAnchor.current) ? visualAnchor.current : paper.lastChild;
    if (anchor) anchor.parentNode.insertBefore(img, anchor.nextSibling);
    else paper.appendChild(img);
    setHasText(true);
    scheduleSave();
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
    setHasText(Boolean(paperRef.current?.innerText.trim()));
    scheduleSave();
  }

  // ── Paper keyboard handler ───────────────────────────────────────────────
  function onPaperKeyUp(e) {
    if (!paperRef.current) return;
    setHasText(Boolean(paperRef.current.innerText.trim()));
    scheduleSave();
  }

  // ── New session — flush current, then create+navigate to fresh note ──────
  async function handleNewNote() {
    setShowNotesList(false);
    await doSave();
    startBlankNote();
    router.push('/smartnotes?id=new');
  }

  async function handleSwitchNote(id) {
    setShowNotesList(false);
    await doSave(); // persist current note before switching
    router.push('/smartnotes?id=' + id);
  }

  async function handleConvertToGuide() {
    setShowNotesList(false);
    await ensureNote();
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
      {/* Header bar */}
      <div className="sn-header">
        <div className="sn-header-left">
          <input
            className="sn-title-input"
            value={title}
            onChange={e => { titleRef.current = e.target.value; setTitle(e.target.value); scheduleSave(); }}
            placeholder="Title"
            aria-label="Note title"
            spellCheck={false}
          />
          <span className={`sn-status ${actionError ? 'error' : saveStatus}`} role={actionError ? 'alert' : undefined}>
            {actionError || (saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? saveError : '')}
          </span>
        </div>
        <div className="sn-header-right">
          <select
            aria-label="Class"
            className="c-select sn-class-select"
            value={folderId}
            onChange={handleFolderChange}
          >
            <option value="">No class</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {hasText && (
            <button className="c-btn c-btn--secondary sn-convert-header-btn" onClick={handleConvertToGuide} disabled={convertingGuide}>
              <Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />{convertingGuide ? 'Building…' : 'Turn into guide'}
            </button>
          )}
          <button
            className={`c-btn c-btn--primary sn-save-btn${saveStatus === 'saving' ? ' saving' : saveStatus === 'saved' ? ' saved' : saveStatus === 'error' ? ' error' : ''}`}
            onClick={() => doSave({ force: true })}
          >
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? 'Error' : 'Save'}
          </button>
          <div className="sn-notes-picker" ref={notesPickerRef}>
            <button
              ref={notesTriggerRef}
              className={`c-btn c-btn--secondary sn-notes-dropdown-trigger${showNotesList ? ' open' : ''}`}
              onClick={() => setShowNotesList(v => !v)}
              aria-expanded={showNotesList}
            >
              <NotebookPen size={20} strokeWidth={1.75} aria-hidden="true" />Notes<ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {showNotesList && (
              <div className="sn-notes-dropdown">
                <div className="sn-notes-dropdown-header">
                  <span className="sn-panel-label">Notes</span>
                  <button className="c-btn c-btn--quiet sn-new-btn" onClick={handleNewNote}>New note</button>
                </div>
                <div
                  className={'sn-notes-item sn-notes-item--back'}
                  onClick={async () => { setShowNotesList(false); await doSave(); router.push('/smartnotes'); }}
                >
                  All notes
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
                {notes.length === 0 && <div className="sn-notes-item muted">0 notes</div>}
              </div>
            )}
          </div>
          <button type="button" className="c-btn c-btn--quiet" data-tip="typing" onClick={() => setShowTyping(true)}><Keyboard size={20} strokeWidth={1.75} aria-hidden="true" />Typing shortcuts</button>
          {noteId && noteId !== 'new' && (
            <Menu
              label="More for this note"
              // Library deletes it with the same 6-second Undo guides use.
              items={[{ label: 'Delete note', icon: Trash2, danger: true, onSelect: () => router.push('/library?filter=notes&delete=' + encodeURIComponent(noteId)) }]}
            />
          )}
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
            <span className="sn-panel-label">Notes</span>
            {visualizeMode && <span className="sn-visualize-hint" role="status">Highlight text, then press ✓</span>}
            {visualizeMode && (
              <button
                className="sn-visualize-confirm"
                onClick={handleCheckmark}
                title="Generate diagram from highlighted text"
                aria-label="Make diagram"
              >
                <Check aria-hidden="true" />
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
            data-placeholder="Start typing"
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
            <span className="sn-panel-label">Diagram</span>
            <button
              className={`c-btn c-btn--secondary sn-visualize-btn${visualizeMode ? ' active' : ''}`}
              onClick={handleVisualize}
            >
              {visualizeMode ? 'Cancel' : 'Visualize'}
            </button>
          </div>
          <div className="sn-diagram-body">
            {visualSource && (
              <NapkinVisual
                key={visualSource.key}
                auto
                text={visualSource.text}
                context={visualSource.context}
                useLabel="Use this"
                onUse={insertVisual}
                fallback={() => <BuiltInDiagram text={visualSource.text} code={mermaidCode} loading={diagramLoading} draw={drawBuiltInDiagram} />}
              />
            )}
            {!visualSource && (
              <div className="sn-diagram-placeholder">
                <p>Visualize → highlight → confirm</p>
              </div>
            )}
          </div>
        </div>

      </div>

      <StudyGuidePreviewModal {...guide.modal} />
      {showTyping && <TypingShortcuts onClose={() => setShowTyping(false)} />}
    </div>
  );
}
