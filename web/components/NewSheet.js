import { useEffect, useRef, useState } from 'react';
import BodyPortal from './BodyPortal';
import { useRouter } from 'next/router';
import {
  ArrowLeft, Brain, Check, ClipboardPaste, FileImage, FileText, Layers, Link as LinkIcon, Mic, NotebookPen, PencilRuler, Presentation, Sparkles, Upload, X,
} from 'lucide-react';
import { apiFetch, authHeaders } from '../lib/api';
import { unsupportedFileMessage, useFileDropZone } from '../lib/fileDrop';
import { dismissGuideJob, startGuideJob, useGuideJobs } from '../lib/guideJobs';
import { newGuideHref } from '../lib/checkYourself';
import { MAX_SOURCE_CHARS, baseName, combinedSource, extractFileText, fileKey, generateAndSave, newRequestId } from '../lib/guideCreate';
import { NEW_SHEET_EVENT } from '../lib/newSheet';
import { SAMPLE_GUIDE, SAMPLE_HEADINGS } from '../lib/sampleGuide';
import { walkthroughEvent } from '../lib/walkthrough';
import { lastGuide } from '../lib/userStore';
import LectureRecorder from './LectureRecorder';
import CordiaLoader from './CordiaLoader';
import { heuristicTitle, sensibleTitle } from '../lib/noteMeta.mjs';
import { localDate, saveLecture, saveTranscriptNote } from '../lib/lectures';

const MAX_FILES = 5;
// What the build card shows while a guide is written: the real stages, not fragments of the source.
const BUILD_STEPS = ['Reading your material', 'Finding the key ideas', 'Writing questions and answers', 'Making flashcards'];
const STEP_MS = 7000;

// A short AI title for pasted text (10 s at most); otherwise its first sentence.
async function titleFor(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/lectures/title', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ text: source.slice(0, 6000) }), signal: controller.signal });
    const data = response.ok ? await response.json() : null;
    return sensibleTitle(data?.title, source) || heuristicTitle(source);
  } catch {
    return heuristicTitle(source);
  } finally {
    clearTimeout(timer);
  }
}

const AUDIO_FILE = /\.(mp3|m4a|wav|webm|ogg|aac)$/i;
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

// Study tools made from what's already in Classroom: a quiz on the last guide, cards, practice, a note.
function MakeOptions({ onGo }) {
  const guide = lastGuide();
  const items = [
    { label: 'Quiz', icon: Brain, href: guide ? `/quiz/${guide.id}` : '/library' },
    { label: 'Flashcards', icon: Layers, href: '/create' },
    { label: 'Practice', icon: PencilRuler, href: '/practice' },
    { label: 'Note', icon: NotebookPen, href: '/smartnotes?id=new', event: 'note-created', spot: 'new-note' },
  ];
  return (
    <section className="new-make" aria-labelledby="new-make-title">
      <h3 id="new-make-title" className="c-meta new-make-title">Or make a new</h3>
      <div className="new-make-row">
        {items.map(item => (
          <button key={item.label} type="button" className="new-make-btn" data-spot={item.spot} onClick={() => { if (item.event) walkthroughEvent(item.event); onGo(item.href); }}>
            <item.icon size={20} strokeWidth={1.75} aria-hidden="true" />{item.label}
          </button>
        ))}
      </div>
      <style jsx>{`
        .new-make { display: grid; gap: 8px; margin-top: 16px; }
        .new-make-title { margin: 0; font-weight: 600; }
        .new-make-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .new-make-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--r-card); background: var(--card); color: var(--ink); font: 600 15px/1 var(--font-sans); cursor: pointer; transition: border-color var(--dur); }
        .new-make-btn:hover { border-color: var(--olive); }
        .new-make-btn :global(.lucide) { color: var(--olive-ink); }
        @media (max-width: 520px) { .new-make-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
    </section>
  );
}

// The four big ways in. Used by the sheet and by the first-run screen.
export function NewOptions({ onPick, onSample }) {
  return (
    <div className="new-options" data-spot="new-options">
      {NEW_OPTIONS.map(option => (
        <button key={option.mode} type="button" className="new-option" onClick={() => onPick(option.mode)}>
          <option.icon size={28} strokeWidth={1.75} aria-hidden="true" />
          <span>{option.label}</span>
        </button>
      ))}
      {onSample && (
        <button type="button" className="new-sample" onClick={onSample}>
          <Sparkles size={20} strokeWidth={1.75} aria-hidden="true" />Try a sample
        </button>
      )}
      <style jsx>{`
        .new-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .new-option { display: grid; justify-items: center; align-content: center; gap: 10px; min-height: 128px; padding: 16px; border: 1px solid var(--line); border-radius:var(--r-card); background: var(--card); color: var(--ink); font:600 17px/1 var(--font-sans); cursor: pointer; transition: border-color var(--dur), transform var(--dur); }
        .new-option:hover { border-color: var(--olive); }
        .new-option:active { transform: scale(.98); }
        .new-option :global(.lucide) { color: var(--olive-ink); }
        .new-sample { grid-column: 1 / -1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 52px; border: 1px dashed var(--olive); border-radius:var(--r-card); background: var(--olive-tint); color: var(--ink); font:600 15px/1 var(--font-sans); cursor: pointer; }
      `}</style>
    </div>
  );
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
  const [buildTitle, setBuildTitle] = useState('');
  const [step, setStep] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [recording, setRecording] = useState(false);
  const fileInput = useRef(null);
  const dropRef = useRef(null);
  const sheetRef = useRef(null);
  const openerRef = useRef(null);
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  useEffect(() => {
    function onOpen(event) {
      openerRef.current = document.activeElement;
      setOpen(true);
      setMode(event.detail?.mode || '');
      setError('');
      if (event.detail?.files?.length) addFiles(event.detail.files);
      walkthroughEvent('new-opened');
    }
    window.addEventListener(NEW_SHEET_EVENT, onOpen);
    return () => window.removeEventListener(NEW_SHEET_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    apiFetch('/folders').then(data => setFolders(data?.folders || []));
    const onKey = event => { if (event.key === 'Escape' && !recordingRef.current) close(); };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.querySelector('button, input, textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode]);

  // The steps move on while the guide is written; the last one stays until it is saved.
  useEffect(() => {
    if (status !== 'building') return undefined;
    const timer = setInterval(() => setStep(current => Math.min(BUILD_STEPS.length - 1, current + 1)), mode === 'sample' ? 1500 : STEP_MS);
    return () => clearInterval(timer);
  }, [status, mode]);

  // Land on the new guide when it is ready, if the sheet is still open.
  useEffect(() => {
    if (!jobId) return;
    const job = jobs.find(item => item.id === jobId);
    if (!job || job.status === 'running') return;
    if (job.status === 'done') {
      dismissGuideJob(job.id);
      reset();
      setOpen(false);
      walkthroughEvent('guide-ready');
      router.push(newGuideHref(job.guideId));
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
    setMode(''); setFiles([]); setText(''); setUrl(''); setStatus('idle'); setError(''); setBuildTitle(''); setStep(0); setJobId(null);
  }

  function close() {
    // A recording in progress is never thrown away by a stray click or Escape.
    if (recording) return;
    setOpen(false);
    // A guide still building keeps going in the background (top-right indicator).
    if (status !== 'building') reset();
    else { setStatus('idle'); setJobId(null); setBuildTitle(''); setStep(0); setMode(''); }
    openerRef.current?.focus?.();
  }

  function addFiles(list) {
    const problems = [];
    const readable = Array.from(list || []).filter(file => {
      if (AUDIO_FILE.test(file.name) || /^audio\//.test(file.type)) { problems.push('For audio, use Record, then Upload recording.'); return false; }
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
        source = text.trim();
        title = (source.length >= 10 ? await titleFor(source) : '') || 'Pasted notes';
        sourceTitle = title;
      }
      startBuild({ source, title, sourceTitle, sourceType, sourceUrl, folderId });
    } catch (caught) {
      setStatus('idle');
      setError(caught.message || 'Something went wrong.');
    }
  }

  // Same build card for every source: the guide's name and the steps as it is written.
  function startBuild({ source, title, sourceTitle, sourceType, sourceUrl = '', folderId: classId = '' }) {
    if (source.trim().length < 10) throw new Error('Not enough text to build a guide.');
    if (source.length > MAX_SOURCE_CHARS) throw new Error(`Too long: ${source.length.toLocaleString()} of ${MAX_SOURCE_CHARS.toLocaleString()} characters.`);
    const requestId = newRequestId();
    setBuildTitle(title);
    setStep(0);
    setStatus('building');
    const id = startGuideJob({
      title,
      run: () => generateAndSave({
        source, requestId, title, sourceTitle, sourceType, sourceUrl,
        externalSourceId: '', folderId: classId, notes: true, flashcards: true, manualPairs: null,
      }),
    });
    setJobId(id);
    walkthroughEvent('guide-building');
  }

  // A finished recording is saved as a lecture (summary, what to watch for, to-dos, transcript)
  // and opens its page. Until Lectures storage is set up, it becomes a study guide instead.
  async function buildFromRecording({ title, transcript, folderId: classId, segments = [], durationMs = 0, source = 'recording' }) {
    const name = sensibleTitle(title, transcript) || `Lecture ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    setRecording(false);
    setError('');
    if (classId) setFolderId(classId);
    setBuildTitle(name);
    setStep(0);
    setStatus('building');
    const saved = await saveLecture({ title: name, transcript, segments, duration_ms: durationMs, source, folder_id: classId || folderId || '', lecture_date: localDate(), classes: folders.map(folder => ({ id: folder.id, name: folder.name })) });
    if (saved?.lecture?.id) {
      reset();
      setOpen(false);
      router.push('/lecture/' + saved.lecture.id);
      return;
    }
    // Lectures aren't available: keep the recording as a note (it can become a guide from there).
    const noteId = await saveTranscriptNote({ title: name, transcript, folderId: classId || folderId });
    if (noteId) {
      reset();
      setOpen(false);
      router.push('/smartnotes?id=' + noteId);
      return;
    }
    try {
      startBuild({ source: transcript, title: name.slice(0, 120), sourceTitle: name.slice(0, 300), sourceType: 'lecture', folderId: classId || folderId });
    } catch (caught) {
      setStatus('idle');
      setError(caught.message || 'Something went wrong.');
    }
  }

  // The sample needs no AI: the steps play through, then it is saved as a real guide.
  function trySample() {
    setError('');
    setMode('sample');
    setBuildTitle(SAMPLE_GUIDE.title);
    setStep(0);
    setStatus('building');
    walkthroughEvent('guide-building');
    const id = startGuideJob({
      title: SAMPLE_GUIDE.title,
      run: async () => {
        await new Promise(resolve => setTimeout(resolve, SAMPLE_HEADINGS.length * 900));
        const saved = await apiFetch('/guides', { method: 'POST', body: JSON.stringify({ ...SAMPLE_GUIDE, ...(folderId ? { folder_id: folderId } : {}) }) });
        if (!saved?.guide) throw new Error('The sample could not be saved.');
        return saved.guide;
      },
    });
    setJobId(id);
  }

  if (!open) return null;
  const ready = mode === 'upload' ? files.length > 0
    : mode === 'link' ? /^https?:\/\/\S+\.\S+/.test(url.trim())
      : text.trim().length >= 10;
  const option = NEW_OPTIONS.find(item => item.mode === mode);

  return (
    <BodyPortal>
    <div className="c-scrim" onClick={close}>
      <section ref={sheetRef} className="c-sheet new-sheet" role="dialog" aria-modal="true" aria-labelledby="new-sheet-title" onClick={event => event.stopPropagation()}>
        <header className="c-sheet-head">
          <div className="c-row">
            {mode && status === 'idle' && !recording && <button type="button" className="c-icon-btn" onClick={() => { setMode(''); setError(''); }} aria-label="Back"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>}
            <h2 id="new-sheet-title" className="c-title">{status === 'building' ? 'Building' : mode ? 'New guide' : 'New'}</h2>
          </div>
          <button type="button" className="c-icon-btn" onClick={close} aria-label="Close" disabled={recording} title={recording ? 'Stop the recording first' : undefined}><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>

        {status === 'building' ? (
          <div className="new-build" data-spot="new-headings">
            {buildTitle && <p className="new-build-title">{buildTitle}</p>}
            <ol className="new-steps" aria-live="polite">
              {BUILD_STEPS.map((label, index) => (
                <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}>
                  <span className="new-step-mark" aria-hidden="true">
                    {index < step ? <Check size={20} strokeWidth={1.75} /> : index === step ? <CordiaLoader size={20} label="In progress" /> : <span className="new-step-dot" />}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <p className="c-meta">You can close this. It keeps building and shows at the top right.</p>
          </div>
        ) : !mode ? (
          <>
            <NewOptions onPick={setMode} onSample={trySample} />
            <MakeOptions onGo={href => { close(); router.push(href); }} />
          </>
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
              <LectureRecorder folders={folders} folderId={folderId} onFolder={setFolderId} onActiveChange={setRecording} onDone={buildFromRecording} />
            )}
            {folders.length > 0 && mode !== 'record' && (
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

        {mode && mode !== 'sample' && mode !== 'record' && status !== 'building' && (
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
        .new-drop { display: grid; justify-items: center; gap: 12px; width: 100%; padding: 32px 16px; border: 2px dashed var(--line); border-radius:var(--r-card); background: var(--card); color: var(--ink); cursor: pointer; font:600 17px/1.15 var(--font-sans); }
        .new-drop:hover, .new-drop.is-over { border-color: var(--olive); background: var(--olive-tint); }
        .new-drop :global(.lucide) { color: var(--olive-ink); }
        .new-formats { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; font:600 13px/1 var(--font-sans); color: var(--muted); }
        .new-formats > span { display: inline-flex; align-items: center; gap: 6px; }
        .new-formats :global(.lucide) { color: var(--muted); }
        .new-files { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .new-files li { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 4px 4px 4px 12px; border: 1px solid var(--line); border-radius:var(--r-input); background: var(--card); }
        .new-files li :global(.c-icon-btn) { flex: none; width: 36px; height: 36px; min-width: 0; min-height: 0; }
        .new-files li span { flex: 1; min-width: 0; }
        .new-text { min-height: 200px; }
        .new-class { max-width: 280px; }
        .new-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 20px; }
        .new-error { margin: 16px 0 0; color: var(--error); font:600 15px/1.5 var(--font-sans); }
        .new-build { display: grid; gap: 16px; }
        .new-build-title { margin: 0; font: 600 var(--fs-20)/var(--lh-title) var(--font-sans); letter-spacing: var(--track-title); color: var(--ink); text-wrap: balance; }
        .new-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
        .new-steps li { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: var(--r-input); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); color: var(--muted); transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
        .new-steps li.is-current { background: var(--olive-tint); color: var(--ink); font-weight: 600; }
        .new-steps li.is-done { color: var(--ink); }
        .new-step-mark { display: inline-grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; }
        .new-steps li.is-done .new-step-mark :global(.lucide) { color: var(--olive-ink); }
        .new-step-dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--hairline); box-shadow: inset 0 0 0 1px var(--muted); opacity: .6; }
      `}</style>
    </div>
    </BodyPortal>
  );
}
