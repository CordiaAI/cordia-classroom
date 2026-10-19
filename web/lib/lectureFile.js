// Upload recording: split an audio file into pieces small enough to send one at a time
// (each under the server's 4.3 MB limit), so any length works and pieces transcribe in parallel.
//   mp3: byte ranges (MP3 decoders resync on frame headers), ~2 s overlap.
//   wav: PCM ranges, each with its own header, ~2 s overlap.
//   other (m4a, webm, ogg): small files go as is; larger ones are decoded in the browser and
//   re-encoded as 16 kHz mono WAV pieces.
import { OVERLAP_MS } from './lectureRecorder';

export const PIECE_BYTES = 3_500_000;
const DIRECT_MAX = 4_000_000;
const DECODE_RATE = 16000;
const DECODED_PIECE_MS = 90_000;

export function fileKind(file) {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();
  if (/\.mp3$/.test(name) || /mpeg|mp3/.test(type)) return 'mp3';
  if (/\.wav$/.test(name) || /wav/.test(type)) return 'wav';
  if (/\.(m4a|mp4|aac)$/.test(name) || /mp4|m4a|aac/.test(type)) return 'm4a';
  if (/\.webm$/.test(name) || /webm/.test(type)) return 'webm';
  if (/\.ogg$/.test(name) || /ogg/.test(type)) return 'ogg';
  return '';
}

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' };

export function audioDuration(file) {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const done = ms => { URL.revokeObjectURL(url); resolve(ms); };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

function wavHeader({ dataBytes, sampleRate, channels, bitsPerSample }) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  const blockAlign = channels * bitsPerSample / 8;
  text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bitsPerSample, true);
  text(36, 'data'); view.setUint32(40, dataBytes, true);
  return header;
}

// Byte ranges [start, end) of `size` bytes in pieces of `piece`, each starting `overlap` early.
export function ranges(size, piece, overlap) {
  const out = [];
  for (let start = 0; start < size; start += piece) {
    out.push({ from: Math.max(0, start - (start ? overlap : 0)), start, end: Math.min(size, start + piece) });
  }
  return out;
}

async function wavInfo(file) {
  const head = new DataView(await file.slice(0, 4096).arrayBuffer());
  const tag = offset => String.fromCharCode(...[0, 1, 2, 3].map(i => head.getUint8(offset + i)));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= head.byteLength) {
    const id = tag(offset);
    const size = head.getUint32(offset + 4, true);
    if (id === 'fmt ') fmt = { channels: head.getUint16(offset + 10, true), sampleRate: head.getUint32(offset + 12, true), bitsPerSample: head.getUint16(offset + 22, true) };
    if (id === 'data') return fmt && { ...fmt, dataStart: offset + 8, dataBytes: Math.min(size, file.size - offset - 8) };
    offset += 8 + size + (size % 2);
  }
  return null;
}

function encodeWav(samples, sampleRate) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  return new Blob([wavHeader({ dataBytes: pcm.byteLength, sampleRate, channels: 1, bitsPerSample: 16 }), pcm.buffer], { type: 'audio/wav' });
}

async function decodedPieces(file) {
  const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const context = new Context(1, 1, DECODE_RATE);
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  const rate = buffer.sampleRate;
  const step = Math.round((DECODED_PIECE_MS / 1000) * rate);
  const overlap = Math.round((OVERLAP_MS / 1000) * rate);
  return ranges(length, step, overlap).map(({ from, end }) => ({
    blob: encodeWav(mono.subarray(from, end), rate),
    startMs: Math.round((from / rate) * 1000),
    durationMs: Math.round(((end - from) / rate) * 1000),
  }));
}

// Returns [{ blob, startMs, durationMs }] in order. Throws Error('unsupported') for other files.
export async function splitAudioFile(file, durationMs) {
  const kind = fileKind(file);
  if (!kind) throw new Error('unsupported');
  const type = MIME[kind];
  if (file.size <= DIRECT_MAX) return [{ blob: file.slice(0, file.size, type), startMs: 0, durationMs: durationMs || 60000 }];
  if (kind === 'mp3') {
    const msPerByte = durationMs ? durationMs / file.size : 1000 / 16000; // ~128 kbps if unknown
    const overlap = Math.round(OVERLAP_MS / msPerByte);
    return ranges(file.size, PIECE_BYTES, overlap).map(({ from, end }) => ({
      blob: file.slice(from, end, type), startMs: Math.round(from * msPerByte), durationMs: Math.round((end - from) * msPerByte),
    }));
  }
  if (kind === 'wav') {
    const info = await wavInfo(file);
    if (info) {
      const blockAlign = info.channels * info.bitsPerSample / 8;
      const bytesPerMs = (info.sampleRate * blockAlign) / 1000;
      const piece = Math.floor(PIECE_BYTES / blockAlign) * blockAlign;
      const overlap = Math.floor((OVERLAP_MS * bytesPerMs) / blockAlign) * blockAlign;
      return ranges(info.dataBytes, piece, overlap).map(({ from, end }) => ({
        blob: new Blob([wavHeader({ ...info, dataBytes: end - from }), file.slice(info.dataStart + from, info.dataStart + end)], { type }),
        startMs: Math.round(from / bytesPerMs), durationMs: Math.round((end - from) / bytesPerMs),
      }));
    }
  }
  return decodedPieces(file);
}
