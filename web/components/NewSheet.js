import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  ArrowLeft, ClipboardPaste, FileImage, FileText, Link as LinkIcon, Mic, Presentation, Square, Upload, X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';
import { dismissGuideJob, startGuideJob, useGuideJobs } from '../lib/guideJobs';
import { MAX_SOURCE_CHARS, baseName, combinedSource, extractFileText, fileKey, generateAndSave, newRequestId } from '../lib/guideCreate';
import { NEW_SHEET_EVENT } from '../lib/newSheet';

const MAX_FILES = 5;
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp,.heic,image/*';

export const NEW_OPTIONS = [
  { mode: 'upload', label: 'Upload', icon: Upload },
  { mode: 'paste', label: 'Paste', icon: ClipboardPaste },
  { mode: 'link', label: 'Link', icon: LinkIcon },
  { mode: 'record', label: 'Record', icon: Mic },
];

const FORMATS = [
  { label: 'PDF', icon: FileText },
  { label: 'DOCX', icon: FileText },
  { label: 'PPTX', icon: Presentation },
  { label: 'Image', icon: FileImage },
];

// The four big ways in. Used by the sheet and by the first-run screen.
export function NewOptions({ onPick }) {
  return (
    <div className="new-options">
      {NEW_OPTIONS.map(option => (
        <button key={option.mode} type="button" className="new-option" onClick={() => onPick(option.mode)}>
          <option.icon size={28} strokeWidth={1.75} aria-hidden="true" />
          <span>{option.label}</span>
        </button>
      ))}
      <style jsx>{`
        .new-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .new-option { display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 128px; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); font: 600 17px/1 var(--font-sans); cursor: pointer; transition: border-color 150ms, transform 90ms; }
        .new-option:hover { border-color: var(--olive); }
        .new-option:active { transform: scale(.98); }
        .new-option :global(.lucide) { color: var(--olive-ink); }
      `}</style>
    </div>
  );
}

// Section names the student will recognize, pulled from their own material, so the
// wait shows their headings arriving instead of a spinner.
export function sourceHeadings(text) {
  const seen = new Set();
  const lines = String(text || '').split('\n').map(line => line.replace(/^[#>*\-\d.)\s]+/, '').trim());
  const headings = lines.filter(line => {
    const words = line.split(/\s+/).length;
    if (line.length < 3 || line.length > 70 || words > 9) return false;
    if (/[.,;]$/.test(line) || !/^[A-Z0-9]/.test(line)) return false;
    const keyName = line.toLowerCase();
    if (seen.has(keyName)) return false;
    seen.add(keyName);
    return true;
  });
  if (headings.length >= 3) return headings.slice(0, 14);
  return String(text || '').split(/(?<=[.!?])\s+/).map(sentence => sentence.split(/\s+/).slice(0, 6).join(' ')).filter(Boolean).slice(0, 8);
}

async function readLink(url) {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error('unreadable');
  const type = response.headers.get('content-type') || '';
  if (/pdf|officedocument|msword|presentation/.test(type)) {
    const blob = await response.blob();
    const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Linked file');
    return { title: baseName(name), text: await extractFileText(new File([blob], name, { type })) };
  }
  const body = await response.text();
  if (/html/.test(type)) {
    const doc = new DOMParser().parseFromString(body, 'text/html');
    doc.querySelectorAll('script, style, noscript, nav, footer, header, aside, form').forEach(node => node.remove());
    const main = doc.querySelector('main, article') || doc.body;
    const text = (main?.innerText || main?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title: doc.title || new URL(url).hostname, text };
  }
  return { title: new URL(url).hostname, text: body };
}

export default function NewSheet() {
  const router = useRouter();
  const jobs = useGuideJobs();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('');
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState('');
  const [status, setStatus] = useState('idle'); // idle | reading | building
  const [error, setError] = useState('');
  const [headings, setHeadings] = useState([]);
  const [shown, setShown] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [recording, setRecording] = useState(false);
  const fileInput = useRef(null);
  const dropRef = useRef(null);
  const sheetRef = useRef(null);
  const recognition = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    function onOpen(event) {
      openerRef.current = document.activeElement;
      setOpen(true);
      setMode(event.detail?.mode || '');
      setError('');
    }
    window.addEventListener(NEW_SHEET_EVENT, onOpen);
    return () => window.removeEventListener(NEW_SHEET_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    apiFetch('/folders').then(data => setFolders(data?.folders || []));
    const onKey = event => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.querySelector('button, input, textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode]);

  // Headings appear one by one while the guide is written.
  useEffect(() => {
    if (status !== 'building' || !headings.length) return undefined;
    const timer = setInterval(() => setShown(count => Math.min(headings.length, count + 1)), 900);
    return () => clearInterval(timer);
  }, [status, headings.length]);

  // Land on the new guide when it is ready, if the sheet is still open.
  useEffect(() => {
    if (!jobId) return;
    const job = jobs.find(item => item.id === jobId);
    if (!job || job.status === 'running') return;
    if (job.status === 'done') {
      dismissGuideJob(job.id);
      reset();
      setOpen(false);
      router.push('/guide/' + job.guideId);
    } else {
      setStatus('idle');
      setError(job.error || 'This guide could not be built.');
      setJobId(null);
      dismissGuideJob(job.id);
    }
  }, [jobs, jobId]);

  const dropActive = useFileDropZone({
    enabled: open && status === 'idle',
    priority: 5,
    getElement: () => dropRef.current || sheetRef.current,
    onFiles: picked => { setMode('upload'); addFiles(picked); },
  });

  function reset() {
    recognition.current?.stop();
    setMode(''); setFiles([]); setText(''); setUrl(''); setStatus('idle'); setError(''); setHeadings([]); setShown(0); setJobId(null);
  }

  function close() {
    recognition.current?.stop();
    setOpen(false);
    // A guide still building keeps going in the background (top-right indicator).
    if (status !== 'building') reset();
    else { setStatus('idle'); setJobId(null); setHeadings([]); setMode(''); }
    openerRef.current?.focus?.();
  }

  function addFiles(list) {
    const problems = [];
    const readable = Array.from(list || []).filter(file => {
      const unsupported = unsupportedFileMessage(file);
      if (unsupported) problems.push(unsupported);
      return !unsupported;
    });
    setFiles(current => {
      const seen = new Set(current.map(fileKey));
      const merged = [...current, ...readable.filter(file => !seen.has(fileKey(file)))];
      if (merged.length > MAX_FILES) problems.push(`Up to ${MAX_FILES} files.`);
      return merged.slice(0, MAX_FILES);
    });
    setError(problems.join(' '));
  }

  function toggleRecording() {
    if (recording) { recognition.current?.stop(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError('Recording needs Chrome or Edge.'); return; }
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = event => {
      const said = Array.from(event.results).slice(event.resultIndex).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim();
      if (said) setText(current => (current ? current + ' ' : '') + said);
    };
    rec.onerror = event => { if (event.error === 'not-allowed') setError('Microphone blocked.'); setRecording(false); };
    rec.onend = () => setRecording(false);
    recognition.current = rec;
    setError('');
    setRecording(true);
    rec.start();
  }

  async function create() {
    setError('');
    setStatus('reading');
    try {
      let source = '';
      let title = '';
      let sourceTitle = '';
      let sourceType = 'pasted_text';
      let sourceUrl = '';
      if (mode === 'upload') {
        const items = [];
        for (const file of files) items.push({ key: fileKey(file), name: file.name, text: await extractFileText(file) });
        source = combinedSource(items);
        title = items.map(item => baseName(item.name)).join(' + ').slice(0, 120);
        sourceTitle = items.map(item => item.name).join(', ').slice(0, 300);
        sourceType = 'file';
      } else if (mode === 'link') {
        const href = url.trim();
        let read;
        try { read = await readLink(href); } catch { throw new Error("Can't read this link. Try Upload or Paste."); }
        source = read.text;
        title = read.title.slice(0, 120);
        sourceTitle = read.title.slice(0, 300);
        sourceType = 'webpage';
        sourceUrl = href;
      } else {
        recognition.current?.stop();
        source = text.trim();
        const firstLine = source.split('\n').map(line => line.trim()).find(Boolean) || '';
        title = mode === 'record'
          ? `Recording ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`
          : firstLine.slice(0, 72) || 'Pasted notes';
        sourceTitle = title;
      }
      if (source.trim().length < 10) throw new Error('Not enough text to build a guide.');
      if (source.length > MAX_SOURCE_CHARS) throw new Error(`Too long: ${source.length.toLocaleString()} of ${MAX_SOURCE_CHARS.toLocaleString()} characters.`);
      const requestId = newRequestId();
      setHeadings(sourceHeadings(source));
      setShown(1);
      setStatus('building');
      const id = startGuideJob({
        title,
        run: () => generateAndSave({
          source, requestId, title, sourceTitle, sourceType, sourceUrl,
          externalSourceId: '', folderId, notes: true, flashcards: true, manualPairs: null,
        }),
      });
      setJobId(id);
    } catch (caught) {
      setStatus('idle');
      setError(caught.message || 'Something went wrong.');
    }
  }

  if (!open) return null;
  const ready = mode === 'upload' ? files.length > 0
    : mode === 'link' ? /^https?:\/\/\S+\.\S+/.test(url.trim())
      : text.trim().length >= 10;
  const option = NEW_OPTIONS.find(item => item.mode === mode);

  return (
    <div className="c-scrim" onClick={close}>
      <section ref={sheetRef} className="c-sheet new-sheet" role="dialog" aria-modal="true" aria-labelledby="new-sheet-title" onClick={event => event.stopPropagation()}>
        <header className="c-sheet-head">
          <div className="c-row">
            {mode && status === 'idle' && <button type="button" className="c-icon-btn" onClick={() => { setMode(''); setError(''); }} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>}
            <h2 id="new-sheet-title" className="c-title">{status === 'building' ? 'Building' : 'New guide'}</h2>
          </div>
          <button type="button" className="c-icon-btn" onClick={close} aria-label="Close"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>

        {status === 'building' ? (
          <ol className="new-headings" aria-live="polite">
            {headings.slice(0, shown).map((heading, index) => (
              <li key={heading + index} className={index === shown - 1 ? 'is-current' : ''}>{heading}</li>
            ))}
          </ol>
        ) : !mode ? (
          <NewOptions onPick={setMode} />
        ) : (
          <div className="new-panel">
            {mode === 'upload' && (
              <>
                <button ref={dropRef} type="button" className={'new-drop' + (dropActive ? ' is-over' : '')} onClick={() => fileInput.current?.click()} disabled={status !== 'idle'}>
                  <Upload size={32} strokeWidth={1.75} aria-hidden="true" />
                  <strong>{dropActive ? 'Drop' : 'Choose files'}</strong>
                  <span className="new-formats" aria-label="PDF, DOCX, PPTX, images">
                    {FORMATS.map(format => <span key={format.label}><format.icon size={20} strokeWidth={1.75} aria-hidden="true" />{format.label}</span>)}
                  </span>
                </button>
                <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
                {files.length > 0 && (
                  <ul className="new-files">
                    {files.map(file => (
                      <li key={fileKey(file)}>
                        <FileText size={20} strokeWidth={1.75} aria-hidden="true" />
                        <span className="c-truncate">{file.name}</span>
                        <button type="button" className="c-icon-btn" onClick={() => setFiles(current => current.filter(item => fileKey(item) !== fileKey(file)))} aria-label={`Remove ${file.name}`}><X size={18} strokeWidth={1.75} aria-hidden="true" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {mode === 'paste' && (
              <label className="c-field">
                <span className="sr-only">Text</span>
                <textarea className="c-input new-text" value={text} onChange={event => setText(event.target.value)} placeholder="Paste notes" autoFocus />
              </label>
            )}
            {mode === 'link' && (
              <label className="c-field">
                <span className="sr-only">Link</span>
                <input className="c-input" type="url" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" autoFocus onKeyDown={event => { if (event.key === 'Enter' && ready) create(); }} />
              </label>
            )}
            {mode === 'record' && (
              <>
                <button type="button" className={'new-record' + (recording ? ' is-on' : '')} onClick={toggleRecording} aria-pressed={recording}>
                  {recording ? <Square size={28} strokeWidth={1.75} aria-hidden="true" /> : <Mic size={28} strokeWidth={1.75} aria-hidden="true" />}
                  <span>{recording ? 'Stop' : 'Record'}</span>
                </button>
                {(text || recording) && (
                  <label className="c-field">
                    <span className="sr-only">Transcript</span>
                    <textarea className="c-input new-text" value={text} onChange={event => setText(event.target.value)} aria-label="Transcript" />
                  </label>
                )}
              </>
            )}
            {folders.length > 0 && (
              <label className="c-field new-class">
                <span>Class</span>
                <select className="c-select" value={folderId} onChange={event => setFolderId(event.target.value)}>
                  <option value="">None</option>
                  {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {error && <p className="new-error" role="alert">{error}</p>}

        {mode && status !== 'building' && (
          <div className="new-foot">
            <button type="button" className="c-btn c-btn--quiet" onClick={() => { close(); router.push('/create'); }}>Write cards</button>
            <button type="button" className="c-btn c-btn--primary" onClick={create} disabled={!ready || status !== 'idle'}>
              {option && <option.icon size={20} strokeWidth={1.75} aria-hidden="true" />}
              {status === 'reading' ? 'Reading…' : 'Create'}
            </button>
          </div>
        )}
      </section>
      <style jsx>{`
        .new-sheet { width: min(560px, 100%); }
        .new-panel { display: grid; gap: 16px; }
        .new-drop { display: grid; justify-items: center; gap: 12px; width: 100%; padding: 32px 16px; border: 2px dashed var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); cursor: pointer; font: 600 17px/1.2 var(--font-sans); }
        .new-drop:hover, .new-drop.is-over { border-color: var(--olive); background: var(--olive-tint); }
        .new-drop :global(.lucide) { color: var(--olive-ink); }
        .new-formats { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; font: 600 13px/1 var(--font-sans); color: var(--muted); }
        .new-formats > span { display: inline-flex; align-items: center; gap: 6px; }
        .new-formats :global(.lucide) { color: var(--muted); }
        .new-files { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .new-files li { display: flex; align-items: center; gap: 10px; padding-left: 12px; border: 1px solid var(--line); border-radius: var(--r-input); background: var(--card); }
        .new-files li span { flex: 1; min-width: 0; }
        .new-text { min-height: 200px; }
        .new-record { display: grid; justify-items: center; gap: 10px; justify-self: center; width: 128px; height: 128px; align-content: center; border: 0; border-radius: 50%; background: var(--olive); color: var(--on-olive); font: 600 15px/1 var(--font-sans); cursor: pointer; }
        .new-record.is-on { background: var(--error); }
        .new-class { max-width: 280px; }
        .new-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 20px; }
        .new-error { margin: 16px 0 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .new-headings { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; min-height: 160px; }
        .new-headings li { padding: 10px 14px; border-radius: var(--r-input); font: 600 19px/1.3 var(--font-display); color: var(--ink); animation: c-rise 300ms var(--ease) both; }
        .new-headings li.is-current { background: var(--olive-tint); }
      `}</style>
    </div>
  );
}
