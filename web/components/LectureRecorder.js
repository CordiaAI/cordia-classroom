import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play, RefreshCw, Square, Upload } from 'lucide-react';
import { apiFetch, authHeaders, authOnlyHeaders, getUserId, openUpgrade } from '../lib/api';
import { ChunkedRecorder, keepAwake, levelMeter, micPermission, openMicrophone, pickMimeType, recordingSupported } from '../lib/lectureRecorder';
import { ChunkUploader } from '../lib/lectureUploads';
import { audioDuration, fileKind, splitAudioFile } from '../lib/lectureFile';
import { fallbackTitle, mergedSegments, transcriptText } from '../lib/lectureText.mjs';
import CordiaLoader from './CordiaLoader';
import MicHelp from './MicHelp';

const NOTES_EVERY_MS = 3 * 60 * 1000;
const AUDIO_ACCEPT = '.mp3,.m4a,.wav,.webm,.ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm,audio/ogg';

const UPLOAD_PROBLEMS = {
  unavailable: "Transcription isn't set up on this site yet. Your audio is saved on this device.",
  auth: 'Sign in again to transcribe. Your audio is saved on this device.',
  retrying: 'Connection trouble. Retrying; your audio is saved on this device.',
};

// When server transcription isn't set up, the browser's own speech recognition is used instead
// (Apple's in Safari, Google's in Chrome). Free and live, a little less accurate; no audio leaves
// the page through Cordia. It stops on long pauses, so it restarts itself while recording.
function speechRecognition() {
  return typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;
}

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

async function postJson(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: controller.signal });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Lecture recording, start to finish. When the transcript is ready, onDone({ title, transcript, folderId })
// hands it to the New sheet, which builds the guide like any other upload.
export default function LectureRecorder({ folders = [], folderId, onFolder, onDone, onActiveChange }) {
  const [phase, setPhase] = useState('start'); // start | consent | asking | denied | recording | paused | finishing | stuck | unsupported
  const [consentChecked, setConsentChecked] = useState(false);
  const [usage, setUsage] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [segments, setSegments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [suggested, setSuggested] = useState('');
  const [upload, setUpload] = useState({ waiting: 0, uploading: 0, offline: false, error: null });
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const uploader = useRef(null);
  const cleanup = useRef([]);
  const segmentsRef = useRef([]);
  const termsRef = useRef('');
  const notesAt = useRef(NOTES_EVERY_MS);
  const notedUpTo = useRef(0);
  const fileInput = useRef(null);
  const transcriptEnd = useRef(null);
  const speech = useRef(null);       // browser speech recognition, when used
  const speechSeq = useRef(0);
  const speechPending = useRef('');  // words heard but not yet final
  const speechEnded = useRef(null);  // resolves when recognition has stopped
  const source = useRef('recording');
  const [interim, setInterim] = useState('');
  const active = ['recording', 'paused', 'finishing', 'stuck'].includes(phase);
  const shown = useMemo(() => mergedSegments(segments), [segments]);

  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  useEffect(() => {
    if (!recordingSupported() || !pickMimeType()) setPhase('unsupported');
    fetch('/api/lectures/usage', { headers: authOnlyHeaders() })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data && typeof data.minutes_left === 'number') setUsage(data); })
      .catch(() => {});
    return () => stopEverything();
  }, []);

  // Class name and its guide titles help the speech model with names and jargon.
  useEffect(() => {
    termsRef.current = '';
    if (!folderId) return;
    const folder = folders.find(item => item.id === folderId);
    apiFetch('/guides?fields=summary&limit=500').then(data => {
      const titles = (data?.guides || []).filter(guide => guide.folder_id === folderId).map(guide => guide.title).filter(Boolean).slice(0, 15);
      termsRef.current = [folder?.name, ...titles].filter(Boolean).join(', ').slice(0, 400);
    });
  }, [folderId]);

  // Warn before leaving the page mid-recording.
  useEffect(() => {
    if (!active) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'nearest' }); }, [shown.length]);

  // Browser speech: each final phrase becomes a timed segment. Words still pending when
  // recognition ends (Stop, Pause, or Chrome's own restart) are kept too, not dropped.
  function keepPending() {
    const text = speechPending.current.trim();
    speechPending.current = '';
    setInterim('');
    if (!text) return;
    const seq = speechSeq.current++;
    segmentsRef.current = [...segmentsRef.current, { seq, start_ms: Math.round(recorder.current?.elapsed() || segmentsRef.current.at(-1)?.start_ms || 0), text }];
    setSegments(segmentsRef.current);
  }

  function startSpeech() {
    const Recognition = speechRecognition();
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = event => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim();
        if (!text) continue;
        if (event.results[i].isFinal) {
          const seq = speechSeq.current++;
          segmentsRef.current = [...segmentsRef.current, { seq, start_ms: Math.round(recorder.current?.elapsed() || 0), text }];
          setSegments(segmentsRef.current);
        } else pending += `${text} `;
      }
      speechPending.current = pending.trim();
      setInterim(pending.trim());
    };
    rec.onend = () => {
      keepPending();
      speechEnded.current?.();
      if (speech.current === rec && recorder.current && !recorder.current.paused) { try { rec.start(); } catch { /* already running */ } }
    };
    rec.onerror = event => { if (event.error === 'not-allowed') setError('Speech recognition was blocked.'); };
    speech.current = rec;
    try { rec.start(); } catch { /* already running */ }
  }

  // Stops recognition and waits (up to 3 s) for its last words, which arrive as it ends.
  function stopSpeech() {
    const rec = speech.current;
    speech.current = null;
    if (!rec) return Promise.resolve();
    const ended = new Promise(resolve => { speechEnded.current = resolve; setTimeout(resolve, 3000); });
    try { rec.stop(); } catch { /* not running */ }
    return ended.then(() => { speechEnded.current = null; keepPending(); });
  }

  function stopEverything() {
    stopSpeech();
    cleanup.current.forEach(fn => fn());
    cleanup.current = [];
    recorder.current?.stop().catch(() => {});
    uploader.current?.dispose();
  }

  // Speech-model prompt for a chunk: class terms plus the last ~200 characters said before it.
  function promptFor(seq) {
    const before = mergedSegments(segmentsRef.current.filter(item => item.seq < seq)).map(item => item.text).join(' ').slice(-200);
    return [termsRef.current && `Terms: ${termsRef.current}`, before].filter(Boolean).join('\n');
  }

  function makeUploader(recordingId) {
    return new ChunkUploader({
      recordingId,
      keepAudio: false, // transcript only: audio is never kept
      getPrompt: promptFor,
      onText: ({ seq, startMs, text }) => {
        if (!text) return;
        segmentsRef.current = [...segmentsRef.current.filter(item => item.seq !== seq), { seq, start_ms: Math.round(startMs), text }];
        setSegments(segmentsRef.current);
      },
      onState: setUpload,
      onLimit: () => { if (recorder.current) finish(); },
    });
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
      const blocked = caught?.name === 'NotAllowedError' || caught?.name === 'SecurityError';
      setPhase(blocked ? 'denied' : 'start');
      if (!blocked) setError('No microphone was found.');
      return;
    }
    segmentsRef.current = [];
    setSegments([]);
    setNotes([]);
    notesAt.current = NOTES_EVERY_MS;
    notedUpTo.current = 0;
    source.current = 'recording';
    const useBrowser = usage?.ready === false && Boolean(speechRecognition());
    uploader.current = useBrowser ? null : makeUploader(newRecordingId());
    recorder.current = new ChunkedRecorder(stream, { onChunk: chunk => uploader.current?.add(chunk) });
    recorder.current.start();
    if (useBrowser) startSpeech();
    cleanup.current.push(levelMeter(stream, setLevel), keepAwake());
    const clockTimer = setInterval(() => {
      const ms = recorder.current?.elapsed() || 0;
      setElapsed(ms);
      if (ms >= notesAt.current) { notesAt.current += NOTES_EVERY_MS; refreshNotes(); }
    }, 250);
    cleanup.current.push(() => clearInterval(clockTimer));
    setPhase('recording');
  }

  // Notes for what was said since the last update (plus a little before it for context).
  async function refreshNotes() {
    const recent = mergedSegments(segmentsRef.current).filter(item => item.start_ms >= notedUpTo.current - 30000);
    if (!recent.length) return;
    notedUpTo.current = recent[recent.length - 1].start_ms + 1;
    const data = await postJson('/api/lectures/notes', { segments: recent.map(({ start_ms, text }) => ({ start_ms, text })), classes: folders.map(folder => ({ id: folder.id, name: folder.name })) }, 30000);
    if (Array.isArray(data?.notes) && data.notes.length) {
      setNotes(current => {
        const seen = new Set(current.map(note => note.text.toLowerCase()));
        return [...current, ...data.notes.filter(note => !seen.has(note.text.toLowerCase()))];
      });
    }
    if (data?.class_id) setSuggested(data.class_id);
  }

  function pause() { recorder.current?.pause(); if (speech.current) { const rec = speech.current; try { rec.stop(); } catch { /* not running */ } } setElapsed(recorder.current?.elapsed() || 0); setPhase('paused'); }
  function resume() { recorder.current?.resume(); if (speech.current) { try { speech.current.start(); } catch { /* already running */ } } setPhase('recording'); }

  async function finish() {
    setPhase('finishing');
    setStep('Transcribing the last part');
    const current = recorder.current;
    const browser = Boolean(speech.current);
    const spoken = stopSpeech();
    if (browser) {
      // Browser speech has no uploads to wait for: wait for its last words, then build.
      await spoken;
      recorder.current = null;
      await current?.stop();
      cleanup.current.forEach(fn => fn());
      cleanup.current = [];
      setLevel(0);
      await build();
      return;
    }
    recorder.current = null;
    await current?.stop();
    cleanup.current.forEach(fn => fn());
    cleanup.current = [];
    setLevel(0);
    await settle();
  }

  // Wait for the last uploads (never forever), then build. If parts are still missing,
  // let the student retry or go ahead with what is transcribed.
  async function settle(timeoutMs = 25000) {
    setPhase('finishing');
    setStep('Transcribing the last part');
    const result = await uploader.current?.drained({ timeoutMs });
    if (result && !result.ok) { setPhase('stuck'); return; }
    await build();
  }

  async function build() {
    uploader.current?.dispose();
    const transcript = transcriptText(segmentsRef.current);
    if (transcript.length < 40) {
      setPhase('start');
      setError(segmentsRef.current.length ? 'The recording is too short to make a guide.' : 'Nothing was transcribed. Check the microphone and try again.');
      return;
    }
    setStep('Naming your lecture');
    const named = await postJson('/api/lectures/title', { text: transcript.slice(0, 6000) }, 10000);
    const timed = mergedSegments(segmentsRef.current);
    onDone?.({
      title: named?.title || fallbackTitle(),
      transcript,
      folderId: folderId || suggested || '',
      segments: timed.map(({ start_ms, text }) => ({ start_ms, text })),
      durationMs: Math.max(elapsed, timed.length ? timed[timed.length - 1].start_ms + 20000 : 0),
      source: source.current,
    });
  }

  // Upload recording: split the file, transcribe the pieces in parallel, then the same final steps.
  async function uploadRecording(file) {
    if (!file) return;
    setError('');
    if (!fileKind(file)) { setError('Use an mp3, m4a, wav or webm recording.'); return; }
    setPhase('finishing');
    setStep('Reading the recording');
    let pieces;
    try {
      pieces = await splitAudioFile(file, await audioDuration(file));
    } catch {
      setPhase('start');
      setError("This file couldn't be read here. Try an mp3 or wav.");
      return;
    }
    segmentsRef.current = [];
    setSegments([]);
    source.current = 'upload';
    uploader.current?.dispose();
    uploader.current = makeUploader(newRecordingId());
    setStep(pieces.length > 1 ? `Transcribing ${pieces.length} parts` : 'Transcribing');
    pieces.forEach((piece, seq) => uploader.current.add({ seq, ...piece }));
    await settle(Math.max(60000, pieces.length * 15000));
  }

  const minutesLeft = usage?.minutes_left;
  const outOfMinutes = typeof minutesLeft === 'number' && minutesLeft <= 0;
  const suggestion = suggested && suggested !== folderId ? folders.find(folder => folder.id === suggested) : null;
  const problem = upload.error ? UPLOAD_PROBLEMS[upload.error] : upload.offline ? 'Offline. Saving here and uploading when you are back.' : '';

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
    const left = upload.waiting + upload.uploading;
    return (
      <div className="rec rec-finishing">
        <CordiaLoader label={step || 'Finishing'} />
        <p className="rec-note" role="status">{problem || (left > 1 && step.startsWith('Transcrib') ? `${step} · ${left} left` : step)}</p>
        <RecorderStyle />
      </div>
    );
  }

  if (phase === 'stuck') {
    return (
      <div className="rec rec-finishing">
        <p className="rec-error" role="alert">{problem || "Some of the recording hasn't been transcribed yet."}</p>
        <p className="rec-note">{shown.length ? `${shown.length} part${shown.length === 1 ? ' is' : 's are'} ready.` : 'Nothing is transcribed yet.'} The rest is saved on this device.</p>
        <div className="rec-row">
          <button type="button" className="c-btn c-btn--secondary" onClick={() => settle()}><RefreshCw aria-hidden="true" />Try again</button>
          {shown.length > 0 && <button type="button" className="c-btn c-btn--primary" onClick={build}>Make guide from what's done</button>}
        </div>
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
          <p className="rec-note" role="status">{phase === 'paused' ? 'Paused' : 'Recording'}</p>
          {problem && <p className="rec-error" role="alert">{problem}</p>}
          <div className="rec-row">
            {phase === 'paused'
              ? <button type="button" className="c-btn c-btn--secondary" onClick={resume}><Play aria-hidden="true" />Resume</button>
              : <button type="button" className="c-btn c-btn--secondary" onClick={pause}><Pause aria-hidden="true" />Pause</button>}
            <button type="button" className="c-btn c-btn--primary" onClick={finish}><Square aria-hidden="true" />Stop</button>
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
          {shown.length || interim ? shown.map(segment => <p key={segment.seq} id={`rec-at-${segment.start_ms}`}>{segment.text}</p>) : <p className="rec-note">The transcript appears here a few seconds behind.</p>}
          {interim && <p className="rec-interim">{interim}</p>}
          <span ref={transcriptEnd} />
        </section>
        {notes.length > 0 && (
          <section className="rec-notes" aria-label="Notes so far">
            <h3 className="c-section-title">Notes so far</h3>
            <ul>
              {notes.map((note, index) => (
                <li key={index} className={`rec-note-item is-${note.kind}`}>
                  <a href={`#rec-at-${note.at_ms}`} className="c-meta">{clock(note.at_ms)}</a>
                  <span>{note.kind === 'exam' ? 'On the exam: ' : ''}{note.text}</span>
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
      {usage && usage.ready === false && (speechRecognition()
        ? <p className="rec-note rec-center">Transcribed by your browser's speech recognition.</p>
        : <p className="rec-error">Transcription isn't set up on this site yet.</p>)}
      <div className="rec-row rec-center">
        <button type="button" className="c-btn c-btn--secondary" onClick={() => fileInput.current?.click()} disabled={outOfMinutes || usage?.ready === false}><Upload aria-hidden="true" />Upload recording</button>
        <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} hidden onChange={event => { uploadRecording(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
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
      .rec-transcript p.rec-interim { color: var(--muted); }
      .rec-notes ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
      .rec-note-item { display: flex; gap: 8px; align-items: baseline; color: var(--ink); font: 500 var(--fs-15)/var(--lh-body) var(--font-sans); }
      .rec-note-item.is-heading span { font-weight: 600; }
      .rec-note-item a { flex: 0 0 auto; text-decoration: none; }
      .rec-finishing { justify-items: center; padding: 32px 0; }
      @media (prefers-reduced-motion: reduce) { .rec-level span { transition: none; } .rec-start { transition: none; } }
    `}</style>
  );
}
