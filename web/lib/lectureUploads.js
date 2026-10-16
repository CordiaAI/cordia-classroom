import { LIMIT_EVENT, authOnlyHeaders, responseJson } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const DB = 'cordia-lectures';
const STORE = 'chunks';

// IndexedDB holds every chunk until the server has it, so a dropped connection (or a
// closed laptop lid) loses nothing; uploads resume in order when the network is back.
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

function extensionFor(type) {
  if (/mp4|m4a|aac/.test(type)) return 'm4a';
  if (/ogg/.test(type)) return 'ogg';
  return 'webm';
}

// Uploads chunks one at a time, in order, so each request can send the transcript tail
// that came before it (the server removes the ~2 s of overlap against that tail).
export class ChunkUploader {
  constructor({ recordingId, getTail, getTerms, keepAudio = false, onText, onState, onLimit }) {
    this.recordingId = recordingId;
    this.getTail = getTail;
    this.getTerms = getTerms;
    this.keepAudio = keepAudio;
    this.onText = onText;
    this.onState = onState;
    this.onLimit = onLimit;
    this.queue = [];
    this.busy = false;
    this.offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.failures = 0;
    this.stopped = false;
    this.onOnline = () => { this.offline = false; this.report(); this.pump(); };
    this.onOffline = () => { this.offline = true; this.report(); };
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.retry = setInterval(() => this.pump(), 5000);
  }

  report() {
    this.onState?.({ waiting: this.queue.length, offline: this.offline, busy: this.busy });
  }

  async add({ seq, startMs, durationMs, blob }) {
    const item = { key: `${this.recordingId}:${seq}`, recordingId: this.recordingId, seq, startMs, durationMs, blob, type: blob.type };
    await save(item);
    this.queue.push(item);
    this.queue.sort((a, b) => a.seq - b.seq);
    this.report();
    this.pump();
  }

  async pump() {
    if (this.busy || this.stopped || !this.queue.length) return;
    if (this.offline || (typeof navigator !== 'undefined' && navigator.onLine === false)) { this.offline = true; this.report(); return; }
    this.busy = true;
    this.report();
    const item = this.queue[0];
    try {
      const form = new FormData();
      form.append('audio', item.blob, `chunk-${item.seq}.${extensionFor(item.type)}`);
      form.append('recording_id', this.recordingId);
      form.append('seq', String(item.seq));
      form.append('start_ms', String(Math.round(item.startMs)));
      form.append('duration_ms', String(Math.round(item.durationMs)));
      form.append('previous_tail', (this.getTail?.() || '').slice(-200));
      form.append('terms', this.getTerms?.() || '');
      const response = await fetch(`${API}/lectures/chunk`, { method: 'POST', headers: authOnlyHeaders(), body: form });
      const data = await responseJson(response);
      if (response.status === 402) {
        window.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail: data?.detail || { feature: 'lecture_minute' } }));
        this.onLimit?.();
        this.stopped = true;
        return;
      }
      if (!response.ok) throw new Error('upload');
      if (this.keepAudio) {
        const keep = new FormData();
        keep.append('audio', item.blob, `chunk-${item.seq}.${extensionFor(item.type)}`);
        keep.append('recording_id', this.recordingId);
        keep.append('seq', String(item.seq));
        fetch(`${API}/lectures/audio`, { method: 'POST', headers: authOnlyHeaders(), body: keep }).catch(() => {});
      }
      this.queue.shift();
      this.failures = 0;
      await remove(item.key);
      this.onText?.({ seq: item.seq, startMs: item.startMs, text: data?.text || '' });
    } catch {
      // Network trouble: keep the chunk (it is already in IndexedDB) and try again shortly.
      this.failures += 1;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) this.offline = true;
    } finally {
      this.busy = false;
      this.report();
      if (!this.stopped && this.queue.length && !this.offline && this.failures < 3) setTimeout(() => this.pump(), this.failures ? 1500 * this.failures : 0);
    }
  }

  // Resolves once every chunk is uploaded (waits through an offline stretch).
  drained() {
    return new Promise(resolve => {
      const check = () => {
        if (this.stopped || (!this.queue.length && !this.busy)) { clearInterval(timer); resolve(); return; }
        this.failures = Math.min(this.failures, 2);
        this.pump();
      };
      const timer = setInterval(check, 500);
      check();
    });
  }

  dispose() {
    this.stopped = true;
    clearInterval(this.retry);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
  }
}
