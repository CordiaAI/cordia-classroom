import { useEffect, useRef, useState } from 'react';
import ExplanationPreference from './ExplanationPreference';
import { DEFAULT_TUTOR_VOICE, TUTOR_MODES, TUTOR_VOICES, setTutorMode, setTutorVoice, tutorMode, tutorVoice } from '../lib/tutorPrefs';
import { apiFetch, authorizedFetch } from '../lib/api';
import { PRIVACY_NOTE } from '../lib/voiceMode.mjs';
import SegmentedControl from './SegmentedControl';

const SAMPLE_FAILED = "Couldn't play this voice right now. Try again later.";

// Settings › Tutor: how the Tutor works in every chat, and the voice it speaks with in voice mode.
export default function TutorSettings() {
  const [mode, setMode] = useState('');
  const [voice, setVoice] = useState(DEFAULT_TUTOR_VOICE);
  const [status, setStatus] = useState(null);
  const [sample, setSample] = useState({ state: 'idle', message: '' }); // idle | loading | playing | failed
  const audioRef = useRef(null);
  useEffect(() => { setMode(tutorMode()); setVoice(tutorVoice()); }, []);
  useEffect(() => {
    let live = true;
    apiFetch('/billing/status').then(data => { if (live && data && typeof data === 'object') setStatus(data); });
    return () => { live = false; audioRef.current?.pause(); };
  }, []);

  function pick(id) {
    setMode(id);
    setTutorMode(id);
  }

  function pickVoice(id) {
    if (previewOnly) return; // aria-disabled: Free speaks with the browser's own voice, so the choice would change nothing
    setVoice(id);
    setTutorVoice(id);
    audioRef.current?.pause();
    setSample({ state: 'idle', message: '' });
  }

  // "Hear Matilda": the voice saying a fixed sentence (POST /tutor/speak with sample: true), nothing of the student's.
  async function hear() {
    if (sample.state === 'loading') return;
    if (sample.state === 'playing') { audioRef.current?.pause(); return; }
    setSample({ state: 'loading', message: '' });
    let response = null;
    try {
      response = await authorizedFetch('/tutor/speak', {
        method: 'POST', quietLimit: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample: true, voice }),
      });
    } catch { response = null; }
    if (!response?.ok) {
      setSample({ state: 'failed', message: response?.status === 402 ? "You've used this month's Tutor voice." : SAMPLE_FAILED });
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    const done = () => { URL.revokeObjectURL(url); setSample(current => (current.state === 'playing' ? { state: 'idle', message: '' } : current)); };
    audio.onended = done;
    audio.onpause = done;
    audio.src = url;
    setSample({ state: 'playing', message: '' });
    audio.play().catch(() => { URL.revokeObjectURL(url); setSample({ state: 'failed', message: SAMPLE_FAILED }); });
  }

  const chosen = TUTOR_VOICES.find(item => item.id === voice) || TUTOR_VOICES[0];
  const allowance = status?.features?.voice_characters;
  const paid = Boolean(status?.unlimited) || Number(allowance?.limit) > 0;
  // On Free these voices come with Pro and the trial: the picker is shown, not usable, and the note above says why.
  const previewOnly = Boolean(status) && !paid;
  const left = Number(allowance?.remaining);
  const limit = Number(allowance?.limit);

  return (
    <>
      <div className="c-card settings-card">
        <h2 className="c-section-title">Tutor mode</h2>
        <p className="c-meta settings-note">Used in every chat. The Tutor opens on a new chat each time; earlier ones are under Past chats.</p>
        <SegmentedControl kind="radio" label="Tutor mode" className="tutor-mode-picker">
          {TUTOR_MODES.map(item => (
            <button key={item.id || 'auto'} type="button" role="radio" aria-checked={mode === item.id} onClick={() => pick(item.id)} title={item.detail}>
              {item.label}
            </button>
          ))}
        </SegmentedControl>
        <p className="c-meta settings-note">{TUTOR_MODES.find(item => item.id === mode)?.detail}</p>
      </div>
      <div className="c-card settings-card">
        <h2 className="c-section-title" id="tutor-voice-title">Voice</h2>
        <p className="c-meta settings-note" id="tutor-voice-note">
          {previewOnly
            ? "How the Tutor sounds in voice mode. On Free it speaks with your browser's own voice; these voices come with Pro and the free trial."
            : 'How the Tutor sounds in voice mode. Start voice mode from the sound wave button in the message box.'}
        </p>
        <SegmentedControl kind="radio" labelledBy="tutor-voice-title" className={`tutor-voice-picker${previewOnly ? ' is-preview' : ''}`} aria-describedby={previewOnly ? 'tutor-voice-note' : undefined}>
          {TUTOR_VOICES.map(item => (
            <button key={item.id} type="button" role="radio" aria-checked={voice === item.id} aria-disabled={previewOnly || undefined} onClick={() => pickVoice(item.id)} title={item.detail}>
              {item.label}
            </button>
          ))}
        </SegmentedControl>
        <p className="c-meta settings-note">{chosen.detail}</p>
        {paid && (
          <div className="tutor-voice-row">
            <button type="button" className="c-btn c-btn--secondary" onClick={hear} aria-busy={sample.state === 'loading' || undefined}>
              {sample.state === 'playing' ? 'Stop' : `Hear ${chosen.label}`}
            </button>
            {Number.isFinite(left) && limit > 0 && !status?.unlimited && (
              <span className="c-meta tutor-voice-left">{left.toLocaleString('en-US')} of {limit.toLocaleString('en-US')} voice characters left this month</span>
            )}
          </div>
        )}
        {sample.message && <p className="c-meta settings-note tutor-voice-error" role="alert">{sample.message}</p>}
        <p className="c-meta settings-note">{PRIVACY_NOTE}</p>
      </div>
      <div className="c-card settings-card"><ExplanationPreference /></div>
      <style jsx>{`
        .settings-note { margin: 0; }
        :global(.tutor-mode-picker) { justify-self: start; flex-wrap: wrap; }
        :global(.tutor-voice-picker) { justify-self: start; flex-wrap: wrap; }
        /* Free: the voices are there to see, not to choose. The buttons stay focusable so a screen reader finds them and the note. */
        :global(.tutor-voice-picker.is-preview) { opacity: .6; }
        :global(.tutor-voice-picker.is-preview > button) { cursor: default; }
        /* At phone width the four voices make two rows of two (never three and one on its own). */
        @media (max-width: 520px) {
          :global(.c-seg.tutor-voice-picker) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-self: stretch; border-radius: var(--r-card); }
          :global(.c-seg.tutor-voice-picker > button) { padding: 0 12px; }
        }
        .tutor-voice-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
        .tutor-voice-left { font-variant-numeric: tabular-nums; }
        .tutor-voice-error { color: var(--error); }
      `}</style>
    </>
  );
}
