import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square, Upload } from 'lucide-react';
import { apiFetch, authOnlyHeaders, getUserId, LIMIT_EVENT, openUpgrade, responseJson } from '../lib/api';
import { ChunkedRecorder, keepAwake, levelMeter, micPermission, openMicrophone, pickMimeType, recordingSupported } from '../lib/lectureRecorder';
import { ChunkUploader } from '../lib/lectureUploads';
import CordiaLoader from './CordiaLoader';
import MicHelp from './MicHelp';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const NOTES_EVERY_MS = 3 * 60 * 1000;
const AUDIO_ACCEPT = '.mp3,.m4a,.wav,.webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm';

function clock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function newRecordingId() {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Math.random()).slice(2);
  return `rec_${random.slice(0, 24)}`;
}

function consentKey() { return `cordiaRecordConsent:${getUserId() || 'anon'}`; }
function hasConsent() { try { return localStorage.getItem(consentKey()) === '1'; } catch { return false; } }
function saveConsent() { try { localStorage.setItem(consentKey(), '1'); } catch { /* storage blocked */ } }

function audioDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0); URL.revokeObjectURL(audio.src); };
    audio.onerror = () => resolve(0);
    audio.src = URL.createObjectURL(file);
  });
}

// Lecture recording, start to finish. When the transcript is ready, onDone({ title, transcript, folderId })
// hands it to the New sheet, which builds the guide like any other upload.
export default function LectureRecorder({ folders = [], folderId, onFolder, onDone, onActiveChange }) {
  const [phase, setPhase] = useState('start'); // start | consent | asking | denied | recording | paused | finishing | unsupported
  const [consentChecked, setConsentChecked] = useState(false);
  const [keepAudio, setKeepAudio] = useState(false);
  const [usage, setUsage] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [segments, setSegments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [suggested, setSuggested] = useState('');
  const [upload, setUpload] = useState({ waiting: 0, offline: false });
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const uploader = useRef(null);
  const cleanup = useRef([]);
  const segmentsRef = useRef([]);
  const termsRef = useRef('');
  const notesAt = useRef(NOTES_EVERY_MS);
  const recordingId = useRef('');
  const fileInput = useRef(null);
  const transcriptEnd = useRef(null);
  const active = phase === 'recording' || phase === 'paused' || phase === 'finishing';

  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  useEffect(() => {
    if (!recordingSupported() || !pickMimeType()) setPhase('unsupported');
    apiFetch('/lectures/usage').then(data => { if (data && typeof data.minutes_left === 'number') setUsage(data); });
    return () => stopEverything();
  }, []);

  // Key terms from the chosen class's guides help the speech model with names and jargon.
  useEffect(() => {
    termsRef.current = '';
    if (!folderId) return;
    apiFetch(`/lectures/terms?folder_id=${encodeURIComponent(folderId)}`).then(data => { termsRef.current = (data?.terms || []).join(', '); });
  }, [folderId]);

  // Warn before leaving the page mid-recording.
  useEffect(() => {
    if (!active) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'nearest' }); }, [segments.length]);

  function stopEverything() {
    cleanup.current.forEach(fn => fn());
    cleanup.current = [];
    recorder.current?.stop().catch(() => {});
    uploader.current?.dispose();
  }

  function tail() {
    return segmentsRef.current.map(segment => segment.text).join(' ').slice(-200);
  }

  async function begin() {
    setError('');
    if (!hasConsent()) { setPhase('consent'); return; }
    if ((await micPermission()) === 'denied') { setPhase('denied'); return; }
    setPhase('asking');
    let stream;
    try {
      stream = await openMicrophone();
    } catch (caught) {
      setPhase(caught?.name === 'NotAllowedError' || caught?.name === 'SecurityError' ? 'denied' : 'start');
      if (caught?.name !== 'NotAllowedError' && caught?.name !== 'SecurityError') setError('No microphone was found.');
      return;
    }
    recordingId.current = newRecordingId();
    segmentsRef.current = [];
    setSegments([]);
    setNotes([]);
    notesAt.current = NOTES_EVERY_MS;
    uploader.current = new ChunkUploader({
      recordingId: recordingId.current,
      keepAudio,
      getTail: tail,
      getTerms: () => termsRef.current,
      onText: ({ seq, startMs, text }) => {
        if (!text) return;
        segmentsRef.current = [...segmentsRef.current, { seq, start_ms: Math.round(startMs), text }].sort((a, b) => a.seq - b.seq);
        setSegments(segmentsRef.current);
      },
      onState: setUpload,
      onLimit: () => finish(true),
    });
    recorder.current = new ChunkedRecorder(stream, { onChunk: chunk => uploader.current?.add(chunk) });
    recorder.current.start();
    cleanup.current.push(levelMeter(stream, setLevel), keepAwake());
    const clockTimer = setInterval(() => {
      const ms = recorder.current?.elapsed() || 0;
      setElapsed(ms);
      if (ms >= notesAt.current) { notesAt.current += NOTES_EVERY_MS; refreshNotes(); }
    }, 250);
    cleanup.current.push(() => clearInterval(clockTimer));
    setPhase('recording');
  }

  async function refreshNotes() {
    if (!segmentsRef.current.length) return;
    const data = await apiFetch('/lectures/notes', {
      method: 'POST',
      body: JSON.stringify({ segments: segmentsRef.current.map(({ start_ms, text }) => ({ start_ms, text })), classes: folders.map(folder => ({ id: folder.id, name: folder.name })) }),
    });
    if (Array.isArray(data?.notes)) setNotes(data.notes);
    if (data?.class_id) setSuggested(data.class_id);
  }

  function pause() { recorder.current?.pause(); setElapsed(recorder.current?.elapsed() || 0); setPhase('paused'); }
  function resume() { recorder.current?.resume(); setPhase('recording'); }

  async function finish(limitReached = false) {
    setPhase('finishing');
    await recorder.current?.stop();
    cleanup.current.forEach(fn => fn());
    cleanup.current = [];
    setLevel(0);
    if (!limitReached) await uploader.current?.drained();
    uploader.current?.dispose();
    await finalPass(segmentsRef.current);
  }

  async function finalPass(list) {
    if (!list.length) { setPhase('start'); setError('Nothing was heard. Check the microphone and try again.'); return; }
    const data = await apiFetch('/lectures/finish', { method: 'POST', body: JSON.stringify({ segments: list.map(({ start_ms, text }) => ({ start_ms, text })) }) });
    if (!data?.transcript) { setPhase('start'); setError(data?.detail && typeof data.detail === 'string' ? data.detail : "Couldn't finish the transcript. Try again."); return; }
    onDone?.({ title: data.title || '', transcript: data.transcript, folderId: folderId || suggested || '' });
  }

  // Upload recording: the same final pass for an mp3, m4a, wav or webm file.
  async function uploadRecording(file) {
    if (!file) return;
    setError('');
    if (!/\.(mp3|m4a|wav|webm)$/i.test(file.name) && !/^audio\//.test(file.type)) { setError('Use an mp3, m4a, wav or webm recording.'); return; }
    setPhase('finishing');
    const form = new FormData();
    form.append('audio', file, file.name);
    form.append('recording_id', newRecordingId());
    form.append('duration_ms', String(await audioDuration(file)));
    form.append('terms', termsRef.current);
    try {
      const response = await fetch(`${API}/lectures/transcribe-file`, { method: 'POST', headers: authOnlyHeaders(), body: form });
      const data = await responseJson(response);
      if (response.status === 402) { window.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail: data?.detail })); setPhase('start'); return; }
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : "Couldn't transcribe this recording.");
      await finalPass(data.segments || []);
    } catch (caught) {
      setPhase('start');
      setError(caught.message || "Couldn't transcribe this recording.");
    }
  }

  const minutesLeft = usage?.minutes_left;
  const outOfMinutes = typeof minutesLeft === 'number' && minutesLeft <= 0;
  const suggestion = suggested && suggested !== folderId ? folders.find(folder => folder.id === suggested) : null;

  if (phase === 'unsupported') {
    return <p className="rec-note" role="status">This browser can't record audio. Use Chrome, Edge, Safari or Firefox, or upload a recording.</p>;
  }

  if (phase === 'consent') {
    return (
      <div className="rec">
        <h3 className="c-section-title">Before you record</h3>
        <p className="rec-note">Many schools require the instructor's permission to record a class.</p>
        <label className="rec-check">
          <input type="checkbox" checked={consentChecked} onChange={event => setConsentChecked(event.target.checked)} />
          <span>I have permission to record this lecture</span>
        </label>
        <div className="rec-row">
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setPhase('start')}>Back</button>
          <button type="button" className="c-btn c-btn--primary" disabled={!consentChecked} onClick={() => { saveConsent(); begin(); }}><Mic aria-hidden="true" />Continue</button>
        </div>
        <RecorderStyle />
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="rec">
        <h3 className="c-section-title">Turn the microphone on</h3>
        <MicHelp />
        <p className="rec-note">Click the icon left of the address, then set Microphone to Allow.</p>
        <div className="rec-row">
          <button type="button" className="c-btn c-btn--secondary" onClick={() => setPhase('start')}>Back</button>
          <button type="button" className="c-btn c-btn--primary" onClick={begin}>Try again</button>
        </div>
        <RecorderStyle />
      </div>
    );
  }

  if (phase === 'finishing') {
    return (
      <div className="rec rec-finishing">
        <CordiaLoader label="Finishing the transcript" />
        <p className="rec-note" role="status">{upload.offline ? 'Waiting for the connection to upload the last part.' : upload.waiting ? `Uploading ${upload.waiting} part${upload.waiting === 1 ? '' : 's'}` : 'Cleaning the transcript'}</p>
        <RecorderStyle />
      </div>
    );
  }

  if (phase === 'recording' || phase === 'paused') {
    return (
      <div className="rec">
        <div className="rec-stage c-card">
          <div className="rec-timer" role="timer" aria-live="off">{clock(elapsed)}</div>
          <div className="rec-level" aria-hidden="true"><span style={{ transform: `scaleX(${phase === 'paused' ? 0 : Math.max(0.02, level)})` }} /></div>
          <p className="rec-note" role="status">
            {phase === 'paused' ? 'Paused' : 'Recording'}
            {upload.offline ? ' · Offline, saving here and uploading when you are back' : ''}
          </p>
          <div className="rec-row">
            {phase === 'paused'
              ? <button type="button" className="c-btn c-btn--secondary" onClick={resume}><Play aria-hidden="true" />Resume</button>
              : <button type="button" className="c-btn c-btn--secondary" onClick={pause}><Pause aria-hidden="true" />Pause</button>}
            <button type="button" className="c-btn c-btn--primary" onClick={() => finish(false)}><Square aria-hidden="true" />Stop</button>
          </div>
        </div>
        {folders.length > 0 && (
          <div className="rec-class">
            <label className="c-field">
              <span>Class</span>
              <select className="c-select" value={folderId} onChange={event => onFolder?.(event.target.value)}>
                <option value="">None</option>
                {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            {suggestion && <button type="button" className="c-chip" onClick={() => onFolder?.(suggestion.id)}>Suggested: {suggestion.name}</button>}
          </div>
        )}
        <section className="rec-transcript" aria-label="Live transcript" aria-live="polite">
          {segments.length ? segments.map(segment => <p key={segment.seq} id={`rec-at-${segment.start_ms}`}>{segment.text}</p>) : <p className="rec-note">The transcript appears here a few seconds behind.</p>}
          <span ref={transcriptEnd} />
        </section>
        {notes.length > 0 && (
          <section className="rec-notes" aria-label="Notes so far">
            <h3 className="c-section-title">Notes so far</h3>
            <ul>
              {notes.map((note, index) => (
                <li key={index} className={`rec-note-item is-${note.kind}`}>
                  <a href={`#rec-at-${note.at_ms}`} className="c-meta">{clock(note.at_ms)}</a>
                  <span>{note.kind === 'exam' ? 'On the exam: ' : note.kind === 'definition' ? '' : ''}{note.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <RecorderStyle />
      </div>
    );
  }

  // Start (and "asking" while the browser shows its microphone prompt)
  return (
    <div className="rec">
      <button type="button" className="rec-start" onClick={outOfMinutes ? () => openUpgrade({ feature: 'lecture_minute' }) : begin} disabled={phase === 'asking'}>
        <Mic aria-hidden="true" />
        <span>{phase === 'asking' ? 'Allow the microphone' : 'Record'}</span>
      </button>
      {typeof minutesLeft === 'number' && <p className="rec-note rec-center">{outOfMinutes ? 'No recording minutes left this month' : `${minutesLeft} min left`}</p>}
      <div className="rec-row rec-center">
        <button type="button" className="c-btn c-btn--secondary" onClick={() => fileInput.current?.click()} disabled={outOfMinutes}><Upload aria-hidden="true" />Upload recording</button>
        <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} hidden onChange={event => { uploadRecording(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      <label className="rec-check rec-center">
        <input type="checkbox" checked={keepAudio} onChange={event => setKeepAudio(event.target.checked)} />
        <span>Keep audio</span>
      </label>
      {error && <p className="rec-error" role="alert">{error}</p>}
      <RecorderStyle />
    </div>
  );
}

function RecorderStyle() {
  return (
    <style jsx global>{`
      .rec { display: grid; gap: 16px; }
      .rec-center { justify-self: center; text-align: center; }
      .rec-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .rec-note { margin: 0; color: var(--muted); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); }
      .rec-error { margin: 0; color: var(--error); font: 600 var(--fs-15)/var(--lh-body) var(--font-sans); text-align: center; }
      .rec-check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; color: var(--ink); font: 500 var(--fs-15)/1.5 var(--font-sans); cursor: pointer; }
      .rec-check input { width: 20px; height: 20px; accent-color: var(--olive); }
      .rec-start { display: grid; justify-items: center; align-content: center; gap: 8px; justify-self: center; width: 128px; height: 128px; border: 0; border-radius: 50%; background: var(--olive); color: var(--on-olive); font: 600 var(--fs-15)/1 var(--font-sans); cursor: pointer; box-shadow: var(--shadow-card); transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
      .rec-start svg.lucide { color: var(--on-olive); width: 28px; height: 28px; }
      .rec-start:disabled { opacity: 1; cursor: default; }
      @media (hover: hover) { .rec-start:not(:disabled):hover { box-shadow: var(--primary-glow); } }
      .rec-start:active { transform: scale(.98); }
      .rec-stage { display: grid; justify-items: center; gap: 16px; padding: 20px; }
      .rec-timer { font: 600 var(--fs-40)/1 var(--font-display); font-variant-numeric: tabular-nums; letter-spacing: var(--track-title); color: var(--ink); }
      .rec-level { width: min(280px, 100%); height: 8px; border-radius: var(--r-pill); background: var(--hairline); overflow: hidden; }
      .rec-level span { display: block; height: 100%; background: var(--olive-ink); transform-origin: left center; transition: transform 80ms linear; }
      .rec-class { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
      .rec-class .c-field { flex: 1 1 200px; }
      .rec-transcript { max-height: 220px; overflow: auto; padding: 16px 20px; border: 1px solid var(--hairline); border-radius: var(--r-row); background: var(--surface-card); }
      .rec-transcript p { margin: 0 0 8px; color: var(--ink); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); }
      .rec-notes ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
      .rec-note-item { display: flex; gap: 8px; align-items: baseline; color: var(--ink); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); }
      .rec-note-item.is-heading span { font-weight: 600; }
      .rec-note-item a { flex: 0 0 auto; text-decoration: none; }
      .rec-finishing { justify-items: center; padding: 32px 0; }
      @media (prefers-reduced-motion: reduce) { .rec-level span { transition: none; } .rec-start { transition: none; } }
    `}</style>
  );
}
