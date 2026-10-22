// Records a lecture as standalone ~20 second audio files that overlap by about 2 seconds.
// Each file comes from its own MediaRecorder (a fresh one starts 2 s before the previous
// one stops), so every chunk can be transcribed on its own. Pausing stops the clock.

export const CHUNK_MS = 20000;
// The first chunk is shorter so the live transcript starts within seconds.
export const FIRST_CHUNK_MS = 8000;
export const OVERLAP_MS = 2000;

// Chrome and Firefox record Opus in WebM; Safari records AAC in MP4.
export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2'];
  return options.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
}

export function recordingSupported() {
  return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

// 'granted' | 'denied' | 'prompt' (Safari may not support the query: then 'prompt').
export async function micPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state;
  } catch {
    return 'prompt';
  }
}

// Set up for a teacher across a room, not a call: echo cancellation and noise suppression are
// built for a voice inches away and strip a distant one out with the background, so both are
// off. The browser's own gain control stays on.
export async function openMicrophone() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
}

// Lifts distant speech before it is recorded: low rumble (HVAC, desk taps) cut, quiet speech
// raised about 3x, loud and soft evened out, and peaks held under clipping. Returns the stream
// to record plus release() (closes the audio graph and the microphone). Falls back to the raw
// microphone where the browser can't process audio.
export const ROOM_GAIN = 3;
export async function roomVoice(stream) {
  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  const releaseMic = () => stream.getTracks().forEach(track => track.stop());
  if (!AudioContextClass) return { stream, release: releaseMic };
  let context;
  try {
    context = new AudioContextClass();
    if (context.state === 'suspended') await context.resume().catch(() => {});
    if (context.state !== 'running' || !context.createMediaStreamDestination) throw new Error('no audio processing');
    const source = context.createMediaStreamSource(stream);
    const rumble = context.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 90;
    const lift = context.createGain();
    lift.gain.value = ROOM_GAIN;
    const even = context.createDynamicsCompressor();
    even.threshold.value = -30;
    even.knee.value = 20;
    even.ratio.value = 6;
    even.attack.value = 0.005;
    even.release.value = 0.3;
    const ceiling = context.createDynamicsCompressor();
    ceiling.threshold.value = -2;
    ceiling.knee.value = 0;
    ceiling.ratio.value = 20;
    ceiling.attack.value = 0.001;
    ceiling.release.value = 0.1;
    const out = context.createMediaStreamDestination();
    source.connect(rumble).connect(lift).connect(even).connect(ceiling).connect(out);
    return {
      stream: out.stream,
      release: () => { out.stream.getTracks().forEach(track => track.stop()); releaseMic(); context.close().catch(() => {}); },
    };
  } catch {
    context?.close?.().catch(() => {});
    return { stream, release: releaseMic };
  }
}

export class ChunkedRecorder {
  // release: closes whatever feeds `stream` (see roomVoice), after the last chunk is written.
  constructor(stream, { mimeType = pickMimeType(), chunkMs = CHUNK_MS, firstChunkMs = FIRST_CHUNK_MS, overlapMs = OVERLAP_MS, onChunk, release } = {}) {
    this.stream = stream;
    this.release = release;
    this.mimeType = mimeType;
    this.chunkMs = chunkMs;
    this.firstChunkMs = firstChunkMs;
    this.overlapMs = overlapMs;
    this.onChunk = onChunk;
    this.seq = 0;
    this.active = [];
    this.pending = [];
    this.activeMs = 0;
    this.resumedAt = 0;
    this.paused = false;
    this.stopped = false;
    this.ticker = null;
  }

  elapsed() {
    return this.activeMs + (this.paused || this.stopped || !this.resumedAt ? 0 : Date.now() - this.resumedAt);
  }

  start() {
    this.resumedAt = Date.now();
    this.nextAt = this.firstChunkMs - this.overlapMs;
    this.startSegment();
    this.ticker = setInterval(() => this.tick(), 200);
  }

  startSegment() {
    const options = this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 48000 } : undefined;
    const recorder = new MediaRecorder(this.stream, options);
    const segment = { seq: this.seq, startMs: this.elapsed(), recorder, parts: [], stopAt: null };
    this.seq += 1;
    recorder.ondataavailable = event => { if (event.data?.size) segment.parts.push(event.data); };
    const done = new Promise(resolve => {
      recorder.onstop = () => {
        const blob = new Blob(segment.parts, { type: (recorder.mimeType || this.mimeType || 'audio/webm').split(';')[0] });
        const durationMs = Math.max(0, (segment.endMs ?? this.elapsed()) - segment.startMs);
        // stop() waits for onChunk too, so the last chunk is queued before anyone checks the queue.
        Promise.resolve(blob.size ? this.onChunk?.({ seq: segment.seq, startMs: segment.startMs, durationMs, blob }) : null).catch(() => {}).finally(resolve);
      };
    });
    this.pending.push(done);
    recorder.start();
    this.active.push(segment);
  }

  // Runs on the clock that pauses: rotate to a new recorder, then stop the old one after the overlap.
  tick() {
    if (this.paused || this.stopped) return;
    const now = this.elapsed();
    if (now >= this.nextAt) {
      const previous = this.active[this.active.length - 1];
      if (previous) previous.stopAt = now + this.overlapMs;
      this.startSegment();
      this.nextAt += this.chunkMs - this.overlapMs;
    }
    for (const segment of [...this.active]) {
      if (segment.stopAt !== null && now >= segment.stopAt) this.stopSegment(segment);
    }
  }

  stopSegment(segment) {
    segment.endMs = this.elapsed();
    this.active = this.active.filter(item => item !== segment);
    if (segment.recorder.state !== 'inactive') segment.recorder.stop();
  }

  pause() {
    if (this.paused || this.stopped) return;
    this.activeMs = this.elapsed();
    this.paused = true;
    this.active.forEach(segment => { if (segment.recorder.state === 'recording') segment.recorder.pause(); });
  }

  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    this.resumedAt = Date.now();
    this.active.forEach(segment => { if (segment.recorder.state === 'paused') segment.recorder.resume(); });
  }

  async stop() {
    if (this.stopped) return;
    const end = this.elapsed();
    this.activeMs = end;
    this.stopped = true;
    clearInterval(this.ticker);
    [...this.active].forEach(segment => { segment.endMs = end; this.stopSegment(segment); });
    await Promise.all(this.pending);
    this.stream.getTracks().forEach(track => track.stop());
    this.release?.();
  }
}

// Live input level (0..1) for the meter.
export function levelMeter(stream, onLevel) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return () => {};
  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const read = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += ((value - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
    frame = requestAnimationFrame(read);
  };
  read();
  return () => { cancelAnimationFrame(frame); source.disconnect(); context.close().catch(() => {}); };
}

// Keeps the screen awake while recording (re-requested when the tab comes back).
export function keepAwake() {
  let lock = null;
  let released = false;
  const request = async () => {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
  };
  const onVisible = () => { if (!released && document.visibilityState === 'visible') request(); };
  request();
  document.addEventListener('visibilitychange', onVisible);
  return () => { released = true; document.removeEventListener('visibilitychange', onVisible); lock?.release?.().catch(() => {}); };
}
