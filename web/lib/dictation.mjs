// Dictation: how speech-recognition results become text in a box. Pure, so it can be tested in Node
// (web/tests/dictation.test.mjs); lib/useDictation.js wires it to the browser's recognizer.
//
// The recognizer's event.results is the whole list for the session, and a result can arrive many
// times as it firms up: Chrome sends one interim result that grows ("What", "What time", ...) and
// marks it final once, from event.resultIndex on; Safari's webkitSpeechRecognition sends cumulative
// interims, often from index 0 again, and sometimes the same final twice. So:
//   - finals are kept by their index in the list, which makes a repeated final harmless; a final
//     that comes in again from an earlier index with other words is a new list (the recognizer
//     restarted), so it is added after what is held instead of replacing it;
//   - a final that repeats the one before it and goes on ("hello", then "hello world": Android
//     Chrome sends its finals cumulatively) takes the place of the one before it;
//   - the interim text is whatever the latest event says is not final yet, and replaces the last one;
//   - the box gets the finals only, at the place the student started dictating from; the interim
//     text is shown apart from it (see dictationInterim) so it is never typed into their message.

// A dictation that inserts at [start, end) of `text` (the caret, or the selection to be replaced).
// Without a caret it goes at the end.
export function startDictation(text, start, end) {
  const value = String(text || '');
  const from = Number.isInteger(start) ? Math.min(Math.max(start, 0), value.length) : value.length;
  const to = Number.isInteger(end) ? Math.min(Math.max(end, from), value.length) : from;
  return { before: value.slice(0, from), after: value.slice(to), finals: {}, interim: '', base: 0, dropped: {}, lastIndex: null };
}

const words = value => String(value || '').replace(/\s+/g, ' ').trim();
const spoken = state => Object.keys(state.finals).map(Number).sort((a, b) => a - b).map(index => state.finals[index]).filter(Boolean).join(' ');
// The key after every one used so far, dropped ones included.
const nextKey = state => Math.max(-1, ...Object.keys(state.finals).map(Number), ...Object.keys(state.dropped || {}).map(Number)) + 1;
// The same words, whatever the case ("what time" and "What time").
const sameWords = (next, held) => next.toLowerCase() === held.toLowerCase();
// `next` is `held` and goes on ("hello" -> "hello world", "hello" -> "Hello, world").
const goesOn = (next, held) => next.length > held.length && next.toLowerCase().startsWith(held.toLowerCase()) && /^[\s,.;:!?]/.test(next.slice(held.length));

// The next state after one result event ({ resultIndex, results }). Results from resultIndex on are
// read; each is { isFinal, 0: { transcript } }.
export function applyResults(state, event) {
  const results = event?.results || [];
  const from = Number(event?.resultIndex) || 0;
  const finals = { ...state.finals };
  const dropped = { ...state.dropped };
  let base = state.base || 0;
  const backwards = state.lastIndex != null && from < state.lastIndex;
  let interim = '';
  for (let index = from; index < results.length; index += 1) {
    const result = results[index];
    const transcript = words(result?.[0]?.transcript);
    if (!transcript) continue;
    if (!result?.isFinal) {
      interim = interim ? `${interim} ${transcript}` : transcript;
      continue;
    }
    let key = index + base;
    if (dropped[key] || finals[key] === transcript) continue;
    // Back at an index already held, with other words: a new list, so add after what is held. The
    // same words in another case are the same final said again (a restarted recognizer capitalizes
    // it): they replace it.
    if (backwards && finals[key] !== undefined && !sameWords(transcript, finals[key]) && !goesOn(transcript, finals[key])) {
      base = nextKey({ finals, dropped }) - index;
      key = index + base;
    }
    // The one before it, said again and carried on: only the longer one is kept.
    const earlier = Object.keys(finals).map(Number).filter(other => other < key).sort((a, b) => b - a)[0];
    if (earlier !== undefined && goesOn(transcript, finals[earlier])) { delete finals[earlier]; dropped[earlier] = true; }
    finals[key] = transcript;
  }
  return { ...state, finals, dropped, base, interim, lastIndex: from };
}

// The recognizer stopped: anything still interim was said, so it joins the text (a final that
// would have repeated it can no longer arrive). With keepInterim false (Send, or the student
// typing) it is dropped instead.
export function finishDictation(state, { keepInterim = true } = {}) {
  if (!state.interim) return state;
  if (!keepInterim) return { ...state, interim: '' };
  return { ...state, finals: { ...state.finals, [nextKey(state)]: state.interim }, interim: '' };
}

// What the box holds: what was there before the caret, the words heard so far, what was after it.
// One space goes between each part, unless the text there already breaks (a space or a new line).
// With maxLength (a box that holds only so much) the words heard are cut to fit, so what was typed
// before and after the caret stays whole.
export function dictationText(state, maxLength = Infinity) {
  let heard = spoken(state);
  if (!heard) return state.before + state.after;
  const gapBefore = state.before && !/\s$/.test(state.before) ? ' ' : '';
  const gapAfter = state.after && !/^\s/.test(state.after) ? ' ' : '';
  const room = maxLength - (state.before.length + gapBefore.length + gapAfter.length + state.after.length);
  if (heard.length > room) {
    // Cut at a whole word; a word that does not fit whole is left out.
    const cut = room > 0 ? heard.slice(0, room) : '';
    heard = (heard[room] === ' ' ? cut : cut.slice(0, Math.max(cut.lastIndexOf(' '), 0))).trimEnd();
  }
  if (!heard) return state.before + state.after;
  return state.before + gapBefore + heard + gapAfter + state.after;
}

// What the recognizer's error says, in plain words for the line under the box ('' for nothing to
// say). Each is short enough for one line in the narrowest box (the 360px Tutor drawer). `heardAnything`: words were heard before it stopped, so "no speech" would not be true.
export function dictationError(code, heardAnything = false) {
  switch (String(code || '')) {
    case 'aborted': return '';
    case 'not-allowed':
    case 'service-not-allowed': return 'Microphone blocked. Allow it in site settings.';
    case 'no-speech': return heardAnything ? '' : "Didn't catch anything. Try again.";
    case 'audio-capture': return 'No microphone found.';
    case 'network': return 'Voice needs a connection. Try again.';
    default: return 'Voice input stopped. Try again.';
  }
}

// Did the dictation hear anything (a final or interim words)?
export const dictationHeard = state => Boolean(state.interim) || Object.keys(state.finals).length > 0;

// The words still being recognized, shown apart from the box as "in progress".
export function dictationInterim(state) {
  return state.interim;
}
