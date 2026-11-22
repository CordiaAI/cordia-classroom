import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, X } from 'lucide-react';
import TutorThinking from './TutorThinking';
import useVoiceMode from '../lib/useVoiceMode';
import { PRIVACY_NOTE, micHelp } from '../lib/voiceMode.mjs';

// Tutor voice mode (F11): a full-screen view over the chat, started from the composer. The breathing Cordia mark,
// live captions of both sides (T4b's thinking line while the Tutor works, never spoken), a microphone indicator
// while the microphone is on, End, and the privacy line. Tap anywhere or press Space to interrupt; Escape or End
// returns to the chat, where every turn is already saved as a normal message. The engine is lib/useVoiceMode.js.
// tutor: lib/useTutorChat.js (the one Tutor client). onClose: back to the chat.

const STATE = {
  starting: 'Turning on the microphone',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  blocked: '', // the problem card says what is wrong
};
const CUE = { stopped: 'Stopped. Go ahead.', missed: "Didn't catch that. Go ahead." };
const HINT = {
  listening: 'Pause when you finish, or tap anywhere to send now.',
  speaking: 'Tap anywhere or press Space to interrupt.',
};
const PROBLEM = {
  blocked: { title: "Cordia can't hear you", text: 'The microphone is blocked for this site.' },
  missing: { title: 'No microphone found', text: 'Plug in or turn on a microphone.', steps: ['Then press Try again.'] },
  busy: { title: 'The microphone is busy', text: 'Another app is using it. Close that app.', steps: ['Then press Try again.'] },
  unsupported: { title: "Voice mode doesn't work in this browser", text: 'Try the latest Chrome, Edge or Safari.', steps: [] },
  failed: { title: "The microphone didn't start", text: 'Check that a microphone is connected.', steps: ['Then press Try again.'] },
};

const LEAVE_MS = 180; // the view fades out over the chat (DESIGN-SPEC 6.1: exits a quarter shorter than enters)

export default function VoiceMode({ tutor, onClose }) {
  // End turns the microphone and voice off at once (useVoiceMode end()); the view then fades out and the chat is back.
  const [leaving, setLeaving] = useState(false);
  // The view fades in by a transition (not a keyframe animation), so End during the fade-in turns it around from
  // wherever its opacity is now instead of jumping to full first.
  const [open, setOpen] = useState(false);
  const leave = () => {
    setLeaving(true);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setTimeout(onClose, still ? 0 : LEAVE_MS);
  };
  const voice = useVoiceMode({ tutor, onClose: leave });
  const { phase, heard, sent, said, cue, note, error, problem, micOn, meterRef, start, interrupt, end } = voice;
  const rootRef = useRef(null);

  // The microphone goes on now, after the student opened voice mode, and off when it closes.
  useEffect(() => { start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Two frames after it is on the page at opacity 0, so the browser has drawn the start of the fade.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setOpen(true)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, []);

  // The view holds focus (so Space interrupts), keeps Tab inside it, and stops the page under it scrolling.
  useEffect(() => {
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  // The view is drawn in a portal, but React still passes its events up to the composer's form: they stop here.
  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); end(); return; }
    if (event.key === ' ' && !event.target.closest?.('button, a, input, textarea')) { event.preventDefault(); interrupt(); return; }
    if (event.key === 'Tab') {
      const items = [...rootRef.current.querySelectorAll('button:not(:disabled), a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  function onClick(event) {
    event.stopPropagation();
    if (event.target.closest('button, a')) return;
    interrupt();
  }

  const help = PROBLEM[problem] || PROBLEM.failed;
  const steps = help.steps || micHelp(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const stateLine = phase === 'listening' && CUE[cue] ? CUE[cue] : STATE[phase];

  const view = (
    <div ref={node => { rootRef.current = node; meterRef.current = node; }} className={`voice-view is-${phase}${open && !leaving ? ' is-open' : ''}${leaving ? ' is-leaving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="voice-title" aria-describedby="voice-privacy"
      tabIndex={-1} onKeyDown={onKeyDown} onClick={onClick}>
      <header className="voice-top">
        <h2 id="voice-title" className="voice-title">Voice mode</h2>
        {micOn
          ? <span className="voice-mic"><Mic size={18} strokeWidth={1.75} aria-hidden="true" /><span>Microphone on</span><span className="voice-meter" aria-hidden="true" /></span>
          : <span className="voice-mic is-off"><MicOff size={18} strokeWidth={1.75} aria-hidden="true" /><span>Microphone off</span></span>}
      </header>

      <div className="voice-stage">
        <div className="voice-orb" aria-hidden="true">
          <span className="voice-ring" />
          <img className="voice-mark" src="/academic-butterfly-open-book.png" alt="" />
        </div>
        <p className="voice-state" aria-live="polite">{stateLine || ''}</p>
        {/* What was heard, read out once when Thinking starts (the captions below change too often to be live). */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">{sent ? `You said: ${sent}` : ''}</p>

        {phase === 'blocked' ? (
          <div className="voice-problem" role="alert">
            <h3 className="voice-problem-title">{help.title}</h3>
            <p className="voice-problem-text">{help.text}</p>
            {steps.length > 0 && <ol className="voice-problem-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol>}
            {problem !== 'unsupported' && <button type="button" className="c-btn c-btn--primary voice-retry" onClick={start}>Try again</button>}
          </div>
        ) : (
          <div className="voice-captions">
            {/* Each side is labelled only once it has something to show; the space stays reserved, so nothing moves. */}
            <p className="voice-caption is-you">
              {heard && <span className="voice-who">You</span>}
              {heard && <span className="voice-heard">{heard}</span>}
            </p>
            <p className="voice-caption is-tutor">
              {(phase === 'thinking' || said) && <span className="voice-who">Tutor</span>}
              {phase === 'thinking'
                ? <span className="voice-thinking"><TutorThinking steps={tutor.thinking?.steps} lines={tutor.thinking?.lines} mark={false} /></span>
                : said && <span key={said} className="voice-said">{said}</span>}
            </p>
          </div>
        )}
      </div>

      <footer className="voice-bottom">
        {note && <p className="voice-note" role="status">{note}</p>}
        {error && <p className="voice-note is-error" role="alert">{error}</p>}
        <p className="voice-hint">{HINT[phase] || ''}</p>
        <button type="button" className="c-btn c-btn--secondary voice-end" onClick={end}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />End
        </button>
        <p id="voice-privacy" className="voice-privacy">{PRIVACY_NOTE}</p>
      </footer>

      <style jsx>{`
        .voice-view {
          position: fixed; inset: 0; z-index: 300; isolation: isolate;
          display: grid; grid-template-rows: auto 1fr auto; justify-items: center;
          padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
          background: var(--glass-sheen), var(--glass-fill-strong);
          -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur);
          color: var(--ink); font-family: var(--font-sans); cursor: default; overflow-y: auto;
          opacity: 0; transition: opacity var(--dur-enter) var(--ease);
        }
        .voice-view.is-open { opacity: 1; }
        .voice-view::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: var(--glass-grain) repeat; background-size: 180px 180px; opacity: var(--glass-grain-opacity); }
        .voice-view.voice-view:focus-visible { outline: none !important; }
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .voice-view { background: var(--surface-raised); } }
        @media (prefers-reduced-transparency: reduce) { .voice-view { background: var(--surface-raised); -webkit-backdrop-filter: none; backdrop-filter: none; } }

        .voice-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; max-width: 760px; min-height: 52px; }
        .voice-title { margin: 0; font: 600 var(--fs-17)/1.3 var(--font-sans); color: var(--ink); }
        .voice-mic {
          display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 12px; border-radius: var(--r-pill);
          background: var(--selected-glass); box-shadow: var(--selected-glass-shadow); color: var(--olive-ink);
          font: 600 var(--fs-13)/1 var(--font-sans); white-space: nowrap;
        }
        .voice-mic.is-off { background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); color: var(--muted-strong); }
        /* The live level: a short olive bar that follows the microphone (set each frame by lib/useVoiceMode.js). */
        .voice-meter { position: relative; width: 22px; height: 6px; border-radius: var(--r-pill); background: var(--olive-tint); overflow: hidden; }
        .voice-meter::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--olive); transform-origin: left center; transform: scaleX(calc(0.15 + var(--voice-level, 0) * 0.85)); transition: transform 80ms linear; }

        /* Anchored from the top, not centred: a longer caption grows downward and the mark never moves between states. */
        .voice-stage { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 20px; width: 100%; max-width: 640px; padding: clamp(24px, 12vh, 132px) 0 24px; text-align: center; }
        .voice-orb { position: relative; display: grid; place-items: center; width: 160px; height: 160px; }
        .voice-ring {
          position: absolute; inset: 16px; border-radius: 50%;
          background: var(--glass-inner); box-shadow: var(--glass-inner-shadow), 0 0 0 1.5px var(--olive-tint);
          transform: scale(1); transition: transform 120ms linear, box-shadow var(--dur) var(--ease);
        }
        .voice-view.is-listening .voice-ring { box-shadow: var(--glass-inner-shadow), 0 0 0 1.5px var(--olive); }
        .voice-mark { position: relative; width: 72px; height: auto; }
        /* Breathing while the Tutor thinks or speaks: the same breath as the app's loading mark. */
        .voice-view.is-starting .voice-mark, .voice-view.is-thinking .voice-mark, .voice-view.is-speaking .voice-mark { animation: voice-breathe 2.4s var(--ease) infinite; }
        :global([data-theme='dark']) .voice-mark { filter: brightness(0) invert(1); }

        .voice-state { margin: 0; min-height: 1.3em; color: var(--muted-strong); font: 600 var(--fs-15)/1.3 var(--font-sans); font-variant-numeric: tabular-nums; }

        .voice-captions { display: grid; gap: 16px; width: 100%; }
        .voice-caption { display: grid; gap: 6px; margin: 0; }
        .voice-caption.is-you { min-height: calc(13px + 6px + 1.5em * 2); }
        .voice-who { color: var(--muted); font: 600 var(--fs-13)/1 var(--font-sans); }
        .voice-said { color: var(--ink); font: 500 1.375rem/1.45 var(--font-reply, var(--font-sans)); overflow-wrap: anywhere; text-wrap: balance; animation: voice-said-in 150ms var(--ease) both; }
        .voice-heard { color: var(--muted-strong); font: 500 var(--fs-17)/1.5 var(--font-sans); overflow-wrap: anywhere; text-wrap: pretty; }
        .voice-thinking { display: flex; justify-content: center; gap: 8px; min-width: 0; font: 500 1.375rem/1.45 var(--font-reply, var(--font-sans)); }

        .voice-problem { display: grid; justify-items: center; gap: 10px; max-width: 460px; padding: 20px 24px; border-radius: var(--r-card); background: var(--glass-inner); box-shadow: var(--glass-inner-shadow); }
        .voice-problem-title { margin: 0; font: 600 var(--fs-20)/1.3 var(--font-sans); color: var(--ink); }
        .voice-problem-text { margin: 0; color: var(--muted-strong); font: 500 var(--fs-15)/1.5 var(--font-sans); }
        .voice-problem-steps { margin: 0; padding-left: 1.25em; text-align: left; color: var(--ink); font: 500 var(--fs-15)/1.5 var(--font-sans); }
        .voice-retry { margin-top: 6px; background-color: var(--olive); background-image: var(--olive-glass-sheen); box-shadow: var(--olive-glass-shadow); }

        .voice-bottom { display: grid; justify-items: center; gap: 10px; width: 100%; max-width: 640px; text-align: center; }
        .voice-note { margin: 0; color: var(--muted-strong); font: 500 var(--fs-13)/1.4 var(--font-sans); }
        .voice-note.is-error { color: var(--error); }
        .voice-hint { margin: 0; min-height: 1.4em; color: var(--muted-strong); font: 500 var(--fs-13)/1.4 var(--font-sans); }
        .voice-end { min-width: 120px; height: 48px; min-height: 48px; }
        .voice-privacy { margin: 0; color: var(--muted-strong); font: 500 var(--fs-13)/1.4 var(--font-sans); }

        @media (hover: hover) {
          .voice-end:hover { transform: var(--lift); box-shadow: var(--lift-shadow); }
          .voice-retry:hover { transform: var(--lift); box-shadow: var(--olive-glass-shadow-hover); }
        }
        .voice-end:active, .voice-retry:active { transform: var(--press); }

        @media (max-width: 520px) {
          .voice-orb { width: 128px; height: 128px; }
          .voice-mark { width: 60px; }
          .voice-said, .voice-thinking { font-size: var(--fs-20); }
        }
        .voice-view.is-leaving { opacity: 0; transition: opacity ${LEAVE_MS}ms var(--ease-exit); pointer-events: none; }
        /* Each new sentence fades in, so the eye sees the caption move on (live captions change every few seconds). */
        @keyframes voice-said-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes voice-breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .voice-view, .voice-view.is-leaving { transition: none; }
          .voice-view { opacity: 1; }
          .voice-view.is-leaving { opacity: 0; }
          .voice-said { animation: none; }
          .voice-view .voice-mark { animation: none !important; opacity: 1; }
          .voice-ring, .voice-meter::after { transition: none; }
        }
      `}</style>
      <style jsx>{`
        /* While the student talks, the ring grows with their voice (live, so it moves only when they do). */
        .voice-view.is-listening .voice-ring { transform: scale(calc(1 + var(--voice-level, 0) * 0.22)); }
        @media (prefers-reduced-motion: reduce) { .voice-view.is-listening .voice-ring { transform: none; } }
      `}</style>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(view, document.body);
}
