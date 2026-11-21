import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMIT_EVENT, apiFetch, authOnlyHeaders, authorizedFetch } from './api';
import { applyResults, dictationInterim, dictationText, finishDictation, startDictation } from './dictation.mjs';
import { tutorVoice } from './tutorPrefs';
import {
  cloudVoiceAllowed, createBargeIn, createTurnDetector, fallbackNote, levelFrom, micProblem, pickBrowserVoice,
  recordingType, speakableReply, splitSentences,
} from './voiceMode.mjs';

// Tutor voice mode's engine (components/VoiceMode.js draws it; the rules are in lib/voiceMode.mjs).
// The microphone goes on only in start() (the student opened voice mode) and off in end(). Each turn:
//   listening: the turn is recorded for the Whisper path and, where the browser has speech recognition, heard
//     live for the caption (and written down by it when the Whisper path isn't there); about 800ms of silence
//     after the student talks, or a tap, ends the turn;
//   thinking: the words go to the Tutor through useTutorChat's sendVoice (the one Tutor client), so the turn
//     is saved in the chat as a normal message, and T4b's lines show as captions;
//   speaking: the reply sentence by sentence, the next sentence fetched while one plays; the cloud voice for
//     Pro and trial accounts (POST /tutor/speak), the browser's voice otherwise or when the cloud voice can't;
//   talking over the Tutor, a tap or Space stops the voice at once and listens again.
// Nothing is kept: audio goes to the Whisper path and is dropped; sentences are fetched and played, never cached.
// Returns { phase, heard, said, cue, note, error, problem, micOn, meterRef, start, interrupt, end }.
//   phase: starting | listening | thinking | speaking | blocked; cue: '' | 'stopped' | 'missed'.

const FRAME_MS = 50;
const MAX_TURN_MS = 60000; // one turn is at most a minute of talking
const IDLE_RESTART_MS = 20000; // nobody talking: the recording starts over, so it never grows
const SETTLE_MS = 700; // speech recognition's last words arrive after it is told to stop
const MIN_AUDIO_BYTES = 1200;

export default function useVoiceMode({ tutor, onClose }) {
  const [phase, setPhase] = useState('starting');
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const [cue, setCue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [micOn, setMicOn] = useState(false);
  const meterRef = useRef(null);
  const tutorRef = useRef(tutor);
  tutorRef.current = tutor;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const live = useRef(null);
  if (!live.current) live.current = { turn: 0, phase: 'starting', cloud: false, whisper: true, fetches: new Map(), aborts: new Set() };

  const go = useCallback(next => { live.current.phase = next; setPhase(next); }, []);

  // ---- Speaking ----

  const stopSpeaking = useCallback(() => {
    const s = live.current;
    s.aborts.forEach(controller => controller.abort());
    s.aborts.clear();
    s.fetches.forEach(item => item.then(result => result?.url && URL.revokeObjectURL(result.url)).catch(() => {}));
    s.fetches.clear();
    if (s.audio) { s.audio.pause(); s.audio.removeAttribute('src'); }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    const done = s.speechDone;
    s.speechDone = null;
    done?.();
  }, []);

  // One sentence from the cloud voice: { url } to play, or { fail: 'limit' | 'unavailable' }.
  const fetchSentence = useCallback(text => {
    const s = live.current;
    const controller = new AbortController();
    s.aborts.add(controller);
    return authorizedFetch('/tutor/speak', {
      method: 'POST', quietLimit: true, signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: tutorRef.current.session?.id, text, voice: tutorVoice() }),
    }).then(async response => {
      if (response.status === 402) return { fail: 'limit' };
      if (!response.ok) return { fail: 'unavailable' };
      return { url: URL.createObjectURL(await response.blob()) };
    }).catch(() => ({ fail: controller.signal.aborted ? 'stopped' : 'unavailable' }))
      .finally(() => s.aborts.delete(controller));
  }, []);

  const playUrl = useCallback(url => new Promise(resolve => {
    const s = live.current;
    if (!s.audio) s.audio = new Audio();
    const audio = s.audio;
    const finish = () => { audio.onended = null; audio.onerror = null; URL.revokeObjectURL(url); if (s.speechDone === finish) s.speechDone = null; resolve(true); };
    s.speechDone = finish;
    audio.onended = finish;
    audio.onerror = finish;
    audio.src = url;
    audio.play().catch(finish);
  }), []);

  const sayInBrowser = useCallback(text => new Promise(resolve => {
    const s = live.current;
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickBrowserVoice(synth.getVoices(), navigator.language || 'en-US');
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = 'en-US';
    utterance.rate = 1;
    const finish = () => { if (s.speechDone === finish) s.speechDone = null; resolve(); };
    s.speechDone = finish;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
  }), []);

  // ---- Listening ----

  const startRecorder = useCallback(() => {
    const s = live.current;
    s.recorder = null;
    if (!s.whisper || !s.stream || typeof MediaRecorder === 'undefined' || !s.type) return;
    try {
      const recorder = new MediaRecorder(s.stream, { mimeType: s.type });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.start();
      s.recorder = { recorder, chunks };
    } catch { s.recorder = null; }
  }, []);

  // The turn's audio, or null; `keep` false drops it.
  const stopRecorder = useCallback((keep = true) => new Promise(resolve => {
    const s = live.current;
    const current = s.recorder;
    s.recorder = null;
    if (!current || current.recorder.state === 'inactive') { resolve(null); return; }
    current.recorder.onstop = () => resolve(keep ? new Blob(current.chunks, { type: s.type }) : null);
    try { current.recorder.stop(); } catch { resolve(null); }
  }), []);

  const startRecognition = useCallback(() => {
    const s = live.current;
    const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
    if (!Recognition) { s.recognition = null; return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = Boolean(s.analyser);
    recognition.interimResults = true;
    const item = { recognition, state: startDictation(''), ended: false, onEnded: null };
    recognition.onresult = event => {
      if (s.recognition !== item) return;
      item.state = applyResults(item.state, event);
      const words = [dictationText(item.state), dictationInterim(item.state)].filter(Boolean).join(' ');
      if (words && s.phase === 'listening') { setHeard(words); setCue(''); }
    };
    recognition.onerror = () => {};
    recognition.onend = () => {
      item.ended = true;
      item.onEnded?.();
      if (s.recognition !== item || s.phase !== 'listening') return;
      // No level meter: the recognizer's own end is the end of the turn. Otherwise it timed out: start again.
      if (!s.analyser) s.finishTurn?.();
      else s.startRecognition?.();
    };
    s.recognition = item;
    try { recognition.start(); } catch { s.recognition = null; }
  }, []);

  // What speech recognition heard this turn, once it has finished.
  const stopRecognition = useCallback(() => new Promise(resolve => {
    const s = live.current;
    const item = s.recognition;
    s.recognition = null;
    if (!item) { resolve(''); return; }
    const done = () => { clearTimeout(timer); resolve(dictationText(finishDictation(item.state)).trim()); };
    const timer = setTimeout(done, SETTLE_MS);
    if (item.ended) { done(); return; }
    item.onEnded = done;
    try { item.recognition.stop(); } catch { done(); }
  }), []);

  const listen = useCallback((nextCue = '') => {
    const s = live.current;
    if (s.closed) return;
    go('listening');
    setCue(nextCue);
    setHeard('');
    setSaid('');
    s.vad?.reset();
    s.turnStart = Date.now();
    s.heardAt = null;
    startRecorder();
    startRecognition();
  }, [go, startRecorder, startRecognition]);

  // The audio, written down by the Whisper path; '' when it can't (and the recognizer's words are used).
  const transcribe = useCallback(async blob => {
    const s = live.current;
    if (!s.whisper || !blob || blob.size < MIN_AUDIO_BYTES) return '';
    try {
      const response = await fetch('/api/lectures/transcribe', {
        method: 'POST', headers: { ...authOnlyHeaders(), 'Content-Type': blob.type || s.type }, body: blob,
      });
      const data = await response.json().catch(() => null);
      if (response.status === 503 || response.status === 415) { s.whisper = false; return ''; }
      if (response.status === 402) return { limit: data?.detail };
      return response.ok ? String(data?.text || '').trim() : '';
    } catch {
      return '';
    }
  }, []);

  // ---- One turn ----

  const end = useCallback(() => {
    const s = live.current;
    if (s.closed) return;
    s.closed = true;
    s.turn += 1;
    stopSpeaking();
    clearInterval(s.timer);
    stopRecorder(false);
    try { s.recognition?.recognition.abort(); } catch { /* already stopped */ }
    s.recognition = null;
    s.stream?.getTracks().forEach(track => track.stop());
    s.stream = null;
    s.context?.close().catch(() => {});
    s.context = null;
    s.analyser = null;
    setMicOn(false);
    closeRef.current?.();
  }, [stopSpeaking, stopRecorder]);

  const speak = useCallback(async (answer, turn) => {
    const s = live.current;
    const sentences = splitSentences(speakableReply(answer));
    if (!sentences.length) { listen(); return; }
    go('speaking');
    s.barge?.reset();
    const stale = () => s.turn !== turn || s.phase !== 'speaking';
    const cloudAudio = index => {
      if (!s.fetches.has(index)) s.fetches.set(index, fetchSentence(sentences[index]));
      return s.fetches.get(index);
    };
    for (let index = 0; index < sentences.length; index += 1) {
      if (stale()) return;
      setSaid(sentences[index]);
      let spoken = false;
      if (s.cloud) {
        const result = await cloudAudio(index);
        s.fetches.delete(index);
        if (stale()) { if (result?.url) URL.revokeObjectURL(result.url); return; }
        if (result?.url) {
          if (index + 1 < sentences.length) cloudAudio(index + 1); // the next one is ready when this one ends
          spoken = await playUrl(result.url);
        } else if (result?.fail !== 'stopped') {
          s.cloud = false;
          stopSpeaking();
          setNote(fallbackNote(result?.fail));
        }
      }
      if (stale()) return;
      if (!spoken) await sayInBrowser(sentences[index]);
    }
    if (!stale()) listen();
  }, [fetchSentence, go, listen, playUrl, sayInBrowser, stopSpeaking]);

  const finishTurn = useCallback(async () => {
    const s = live.current;
    if (s.phase !== 'listening' || s.closed) return;
    const turn = s.turn;
    go('thinking');
    setError('');
    const [blob, recognized] = await Promise.all([stopRecorder(true), stopRecognition()]);
    if (s.turn !== turn) return;
    const written = await transcribe(blob);
    if (s.turn !== turn) return;
    if (written?.limit) {
      window.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail: written.limit }));
      end();
      return;
    }
    const text = (written || recognized || '').trim();
    if (!text) { listen('missed'); return; }
    setHeard(text);
    const result = await tutorRef.current.sendVoice(text);
    if (s.turn !== turn) return;
    if (!result?.ok) {
      // A plan limit: voice mode closes so the upgrade window shows over the chat.
      if (result?.status === 402) { end(); return; }
      setError(result?.message || 'Cordia could not answer that yet.');
      listen();
      return;
    }
    speak(result.answer, turn);
  }, [end, go, listen, speak, stopRecognition, stopRecorder, transcribe]);

  // Talking over the Tutor, a tap or Space: the voice stops at once and Cordia listens. While listening, a tap
  // after the student has talked sends the turn without waiting for the silence.
  const interrupt = useCallback(() => {
    const s = live.current;
    if (s.phase === 'speaking') {
      s.turn += 1;
      stopSpeaking();
      listen('stopped');
    } else if (s.phase === 'listening' && (s.heardAt !== null || s.vad?.talking)) {
      finishTurn();
    }
  }, [finishTurn, listen, stopSpeaking]);

  const frame = useCallback(() => {
    const s = live.current;
    if (!s.analyser) return;
    s.analyser.getByteTimeDomainData(s.samples);
    const level = levelFrom(s.samples);
    const now = Date.now();
    meterRef.current?.style.setProperty('--voice-level', Math.min(1, level * 6).toFixed(3));
    if (s.phase === 'listening') {
      const event = s.vad.step(level, now);
      if (event === 'start') { s.heardAt = now; setCue(''); }
      if (event === 'end') s.finishTurn();
      else if (s.heardAt === null && now - s.turnStart > IDLE_RESTART_MS) {
        s.turnStart = now;
        stopRecorder(false).then(() => { if (s.phase === 'listening' && !s.closed) startRecorder(); });
      } else if (s.heardAt !== null && now - s.heardAt > MAX_TURN_MS) s.finishTurn();
    } else if (s.phase === 'speaking' && s.barge.step(level, now)) {
      s.interrupt();
    }
  }, [startRecorder, stopRecorder]);

  live.current.finishTurn = finishTurn;
  live.current.interrupt = interrupt;
  live.current.startRecognition = startRecognition;

  const start = useCallback(async () => {
    const s = live.current;
    s.closed = false;
    const turn = ++s.turn;
    setProblem('');
    setNote('');
    setError('');
    go('starting');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    s.type = recordingType(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
    if (!navigator.mediaDevices?.getUserMedia || (!s.type && !Recognition)) { setProblem('unsupported'); go('blocked'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (failure) {
      if (s.turn === turn) { setProblem(micProblem(failure)); go('blocked'); }
      return;
    }
    if (s.turn !== turn || s.closed) { stream.getTracks().forEach(track => track.stop()); return; }
    s.stream = stream;
    setMicOn(true);
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) {
      try {
        s.context = new Context();
        const analyser = s.context.createAnalyser();
        analyser.fftSize = 1024;
        s.context.createMediaStreamSource(stream).connect(analyser);
        s.analyser = analyser;
        s.samples = new Uint8Array(analyser.fftSize);
        s.context.resume?.().catch(() => {});
      } catch { s.analyser = null; }
    }
    s.vad = createTurnDetector();
    s.barge = createBargeIn();
    clearInterval(s.timer);
    s.timer = setInterval(frame, FRAME_MS);
    // Pro and trial accounts with voice characters left hear the cloud voice; everyone else the browser's.
    apiFetch('/billing/status').then(status => { s.cloud = cloudVoiceAllowed(status); });
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.getVoices(); // loads the list early
    listen();
  }, [frame, go, listen]);

  // Leaving the page (or the chat) turns everything off without closing anything else.
  useEffect(() => () => {
    const s = live.current;
    s.closed = true;
    s.turn += 1;
    stopSpeaking();
    clearInterval(s.timer);
    try { s.recognition?.recognition.abort(); } catch { /* already stopped */ }
    if (s.recorder?.recorder.state !== 'inactive') { try { s.recorder?.recorder.stop(); } catch { /* already stopped */ } }
    s.stream?.getTracks().forEach(track => track.stop());
    s.context?.close().catch(() => {});
  }, [stopSpeaking]);

  return { phase, heard, said, cue, note, error, problem, micOn, meterRef, start, interrupt, end };
}
