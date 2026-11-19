import { useCallback, useEffect, useRef, useState } from 'react';
import { applyResults, dictationInterim, dictationText, finishDictation, startDictation } from './dictation.mjs';

// Dictation into a text box (the Tutor's composer, a study-aid answer): the rules are in
// dictation.mjs. The box gets the words that are final, where the caret was when the mic went on;
// `interim` is what is still being recognized, to show apart from the box.
//   text, setText: the box's value and its setter.
// Returns { Recognition, listening, interim, toggle(caret), abort }. toggle takes the box's
// { start, end } selection (or nothing, to go at the end). Stop and silence keep what was heard;
// abort (Send, unmount) and the student typing while listening drop what was still interim and
// stop, so nothing lands in a message that has gone or been changed.
export default function useDictation({ text, setText, lang = 'en-US' }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  // Read after mount: the server render has no recognizer, and the first client render must match it.
  // (Held in an object: a class passed straight to a state setter would be called as an updater.)
  const [found, setFound] = useState({ Recognition: null });
  useEffect(() => setFound({ Recognition: window.SpeechRecognition || window.webkitSpeechRecognition || null }), []);
  const { Recognition } = found;
  const activeRef = useRef(null); // { recognition, state, written: texts this dictation put in the box }

  const abort = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    setListening(false);
    setInterim('');
    if (!active) return;
    try { active.recognition.abort(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => abort, [abort]);

  // The student typed (or Send cleared the box) while listening: the box is theirs again.
  useEffect(() => {
    const active = activeRef.current;
    if (active && !active.written.includes(text)) abort();
  }, [text, abort]);

  const toggle = useCallback((caret = {}) => {
    const active = activeRef.current;
    if (active) { active.recognition.stop(); return; }
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    const session = { recognition, state: startDictation(text, caret.start, caret.end), written: [text] };
    const show = () => {
      const next = dictationText(session.state);
      if (!session.written.includes(next)) session.written.push(next);
      setText(next);
      setInterim(dictationInterim(session.state));
    };
    recognition.onresult = event => {
      if (activeRef.current !== session) return;
      session.state = applyResults(session.state, event);
      show();
    };
    const end = () => {
      if (activeRef.current !== session) return;
      session.state = finishDictation(session.state);
      show();
      activeRef.current = null;
      setListening(false);
      setInterim('');
    };
    recognition.onerror = end;
    recognition.onend = end;
    activeRef.current = session;
    setListening(true);
    try { recognition.start(); } catch { abort(); }
  }, [Recognition, lang, text, setText, abort]);

  return { Recognition, listening, interim, toggle, abort };
}
