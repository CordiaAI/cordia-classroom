import { LIMIT_EVENT, authOnlyHeaders } from './api';

const DB = 'cordia-lectures';
const STORE = 'chunks';
export const CONCURRENCY = 3;

// IndexedDB holds every chunk until the server has it, so a dropped connection (or a
// closed laptop lid) loses nothing; uploads resume when the network is back.
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result?.result ?? result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

const save = item => withStore('readwrite', store => store.put(item)).catch(() => {});
const remove = key => withStore('readwrite', store => store.delete(key)).catch(() => {});

export async function savedChunks(recordingId) {
  try {
    const all = await withStore('readonly', store => store.getAll());
    return (all || []).filter(item => item.recordingId === recordingId).sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

function base64(text) {
  const bytes = new TextEncoder().encode(text || '');
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

// Uploads chunks as they are recorded, up to CONCURRENCY at a time, so a backlog after an
// offline stretch catches up fast. Each chunk is transcribed on its own; the browser removes
// the overlap between neighbouring chunks (lib/lectureText.mjs).
//   onText({ seq, startMs, text })   a chunk's words
//   onState({ waiting, uploading, offline, error })   for the status line
//   onLimit()   out of recording minutes
export class ChunkUploader {
  constructor({ recordingId, getPrompt, keepAudio = false, onText, onState, onLimit }) {
    this.recordingId = recordingId;
    this.getPrompt = getPrompt;
    this.keepAudio = keepAudio;
    this.onText = onText;
    this.onState = onState;
    this.onLimit = onLimit;
    this.queue = [];          // waiting chunks, oldest first
    this.inFlight = new Set();
    this.retryAt = 0;
    this.failures = 0;
    this.error = null;        // a problem the student should see ('unavailable', 'auth', 'retrying')
    this.stopped = false;
    this.offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.onOnline = () => { this.offline = false; this.retryAt = 0; this.report(); this.pump(); };
    this.onOffline = () => { this.offline = true; this.report(); };
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.timer = setInterval(() => this.pump(), 1000);
  }

  report() {
    this.onState?.({ waiting: this.queue.length, uploading: this.inFlight.size, offline: this.offline, error: this.error });
  }

  async add({ seq, startMs, durationMs, blob }) {
    const item = { key: `${this.recordingId}:${seq}`, recordingId: this.recordingId, seq, startMs, durationMs, blob, type: blob.type || 'audio/webm' };
    this.queue.push(item);
    this.queue.sort((a, b) => a.seq - b.seq);
    this.report();
    save(item); // in IndexedDB until uploaded
    this.pump();
  }

  pump() {
    if (this.stopped || this.offline || Date.now() < this.retryAt) return;
    while (this.inFlight.size < CONCURRENCY && this.queue.length) {
      const item = this.queue.shift();
      this.inFlight.add(item);
      this.upload(item).finally(() => { this.inFlight.delete(item); this.report(); this.pump(); });
    }
    this.report();
  }

  async upload(item) {
    const params = new URLSearchParams({
      recording_id: this.recordingId, seq: String(item.seq), start_ms: String(Math.round(item.startMs)),
      duration_ms: String(Math.round(item.durationMs)), keep: this.keepAudio ? '1' : '0',
    });
    let response;
    let data = null;
    try {
      response = await fetch(`/api/lectures/chunk?${params}`, {
        method: 'POST',
        headers: { ...authOnlyHeaders(), 'Content-Type': item.type, 'X-Prompt': base64(this.getPrompt?.(item.seq) || '') },
        body: item.blob,
      });
      data = await response.json().catch(() => null);
    } catch {
      response = null;
    }
    if (response?.ok) {
      this.failures = 0;
      if (this.error === 'retrying') this.error = null;
      remove(item.key);
      this.onText?.({ seq: item.seq, startMs: item.startMs, text: data?.text || '' });
      return;
    }
    const status = response?.status || 0;
    if (status === 402) {
      window.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail: data?.detail || { feature: 'lecture_minute' } }));
      this.stopped = true;
      this.onLimit?.();
      return;
    }
    if (status === 401 || status === 503) {
      // Not signed in, or transcription isn't set up: retrying won't help. Keep the audio saved.
      this.queue.unshift(item);
      this.error = status === 401 ? 'auth' : 'unavailable';
      this.retryAt = Date.now() + 15000;
      return;
    }
    if (status === 400 || status === 413 || status === 415) {
      remove(item.key); // this piece can never be transcribed; skip it, keep going
      return;
    }
    // Network trouble or a server hiccup: try again soon, backing off up to 15 s.
    this.failures += 1;
    this.queue.unshift(item);
    this.queue.sort((a, b) => a.seq - b.seq);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) this.offline = true;
    if (this.failures >= 2) this.error = 'retrying';
    this.retryAt = Date.now() + Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4));
  }

  // Waits until every chunk is uploaded or `timeoutMs` passes; never hangs.
  drained({ timeoutMs = 45000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    this.retryAt = 0;
    return new Promise(resolve => {
      const check = () => {
        if (this.stopped || (!this.queue.length && !this.inFlight.size)) { clearInterval(timer); resolve({ ok: true, missing: 0 }); return; }
        // Retrying can't fix these; say so now instead of waiting out the timer.
        if ((this.error === 'unavailable' || this.error === 'auth') && !this.inFlight.size) { clearInterval(timer); resolve({ ok: false, missing: this.queue.length }); return; }
        if (Date.now() >= deadline) { clearInterval(timer); resolve({ ok: false, missing: this.queue.length + this.inFlight.size }); return; }
        this.pump();
      };
      const timer = setInterval(check, 250);
      check();
    });
  }

  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }
}
