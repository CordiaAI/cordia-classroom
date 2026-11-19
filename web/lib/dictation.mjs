// Dictation: how speech-recognition results become text in a box. Pure, so it can be tested in Node
// (web/tests/dictation.test.mjs); lib/useDictation.js wires it to the browser's recognizer.
//
// The recognizer's event.results is the whole list for the session, and a result can arrive many
// times as it firms up: Chrome sends one interim result that grows ("What", "What time", ...) and
// marks it final once, from event.resultIndex on; Safari's webkitSpeechRecognition sends cumulative
// interims, often from index 0 again, and sometimes the same final twice. So:
//   - finals are kept by their index in the list, which makes a repeated final harmless;
//   - the interim text is whatever the latest event says is not final yet, and replaces the last one;
//   - the box gets the finals only, at the place the student started dictating from; the interim
//     text is shown apart from it (see dictationInterim) so it is never typed into their message.

// A dictation that inserts at [start, end) of `text` (the caret, or the selection to be replaced).
// Without a caret it goes at the end.
export function startDictation(text, start, end) {
  const value = String(text || '');
  const from = Number.isInteger(start) ? Math.min(Math.max(start, 0), value.length) : value.length;
  const to = Number.isInteger(end) ? Math.min(Math.max(end, from), value.length) : from;
  return { before: value.slice(0, from), after: value.slice(to), finals: {}, interim: '' };
}

const words = value => String(value || '').replace(/\s+/g, ' ').trim();
const spoken = state => Object.keys(state.finals).map(Number).sort((a, b) => a - b).map(index => state.finals[index]).filter(Boolean).join(' ');

// The next state after one result event ({ resultIndex, results }). Results from resultIndex on are
// read; each is { isFinal, 0: { transcript } }.
export function applyResults(state, event) {
  const results = event?.results || [];
  const finals = { ...state.finals };
  let interim = '';
  for (let index = Number(event?.resultIndex) || 0; index < results.length; index += 1) {
    const result = results[index];
    const transcript = words(result?.[0]?.transcript);
    if (result?.isFinal) {
      if (transcript) finals[index] = transcript;
    } else if (transcript) {
      interim = interim ? `${interim} ${transcript}` : transcript;
    }
  }
  return { ...state, finals, interim };
}

// The recognizer stopped: anything still interim was said, so it joins the text (a final that
// would have repeated it can no longer arrive). With keepInterim false (Send, or the student
// typing) it is dropped instead.
export function finishDictation(state, { keepInterim = true } = {}) {
  if (!state.interim) return state;
  if (!keepInterim) return { ...state, interim: '' };
  const next = Object.keys(state.finals).length ? Math.max(...Object.keys(state.finals).map(Number)) + 1 : 0;
  return { ...state, finals: { ...state.finals, [next]: state.interim }, interim: '' };
}

// What the box holds: what was there before the caret, the words heard so far, what was after it.
// One space goes between each part, unless the text there already breaks (a space or a new line).
export function dictationText(state) {
  const heard = spoken(state);
  if (!heard) return state.before + state.after;
  const gapBefore = state.before && !/\s$/.test(state.before) ? ' ' : '';
  const gapAfter = state.after && !/^\s/.test(state.after) ? ' ' : '';
  return state.before + gapBefore + heard + gapAfter + state.after;
}

// The words still being recognized, shown apart from the box as "in progress".
export function dictationInterim(state) {
  return state.interim;
}
