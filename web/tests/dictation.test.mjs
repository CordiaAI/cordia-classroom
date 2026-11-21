// Dictation (lib/dictation.mjs, lib/useDictation.js): a spoken phrase lands in the box once, whether
// the recognizer reports it Chrome's way or Safari's, and what the student already typed stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyResults, dictationError, dictationHeard, dictationInterim, dictationText, finishDictation, startDictation } from '../lib/dictation.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// One recognizer result: { isFinal, 0: { transcript } }.
const heard = (transcript, isFinal = false) => ({ isFinal, 0: { transcript } });
// One result event: the whole list so far, and the index the news starts at.
const event = (resultIndex, ...results) => ({ resultIndex, results });
// Plays events into a fresh dictation at the given caret; the box and the interim line after each.
function play(text, caret, events) {
  let state = startDictation(text, ...caret);
  return events.map(next => {
    state = applyResults(state, next);
    return { text: dictationText(state), interim: dictationInterim(state) };
  }).concat([{ state }]);
}
const final = steps => steps.at(-1).state;

// "What time is it right now" is the owner's phrase; the old handler produced "What What time What
// time is What time is it...".
const PHRASE = 'What time is it right now';
const GROWING = ['What', 'What time', 'What time is', 'What time is it', 'What time is it right', PHRASE];

test('Chrome: interim results grow in place and the final lands once', () => {
  const events = [...GROWING.slice(0, -1).map(words => event(0, heard(words))), event(0, heard(PHRASE, true))];
  const steps = play('', [0, 0], events);
  GROWING.slice(0, -1).forEach((words, at) => {
    assert.equal(steps[at].text, '', 'the box holds finals only while a phrase is interim');
    assert.equal(steps[at].interim, words, 'the interim line is replaced, not added to');
  });
  assert.equal(steps[GROWING.length - 1].text, PHRASE);
  assert.equal(steps[GROWING.length - 1].interim, '');
  assert.equal(dictationText(final(steps)), PHRASE);
});

test('Chrome: a second phrase from the next index is added after the first, each word once', () => {
  const steps = play('', [0, 0], [
    event(0, heard('What time')),
    event(0, heard('What time is it', true)),
    event(1, heard('What time is it', true), heard('and where')),
    event(1, heard('What time is it', true), heard('and where is class')),
    event(1, heard('What time is it', true), heard('and where is class', true)),
  ]);
  assert.deepEqual(steps.slice(0, 5).map(step => step.text), ['', 'What time is it', 'What time is it', 'What time is it', 'What time is it and where is class']);
  assert.deepEqual(steps.slice(0, 5).map(step => step.interim), ['What time', '', 'and where', 'and where is class', '']);
});

test('Safari: cumulative interims from index 0, then the same final sent twice', () => {
  const events = [
    ...GROWING.slice(0, -1).map(words => event(0, heard(words))),
    event(0, heard(PHRASE, true)),
    event(0, heard(PHRASE, true)),
  ];
  const steps = play('', [0, 0], events);
  assert.equal(dictationText(final(steps)), PHRASE);
  assert.equal(steps[steps.length - 2].text, PHRASE, 'a repeated final does not repeat the words');
  assert.equal(steps[steps.length - 2].interim, '');
});

test('Safari: a later phrase arrives with resultIndex 0 and the earlier final repeated', () => {
  const first = heard('What time is it', true);
  const steps = play('', [0, 0], [
    event(0, first),
    event(0, first, heard('and')),
    event(0, first, heard('and where')),
    event(0, first, heard('and where is class', true)),
    event(0, first, heard('and where is class', true)),
  ]);
  assert.equal(dictationText(final(steps)), 'What time is it and where is class');
  assert.deepEqual(steps.slice(0, 5).map(step => step.interim), ['', 'and', 'and where', '', '']);
});

test('what was typed before and after the caret stays, with one space at each seam', () => {
  const steps = play('Explain after class', [8, 8], [event(0, heard('the chain rule')), event(0, heard('the chain rule', true))]);
  assert.equal(steps[0].text, 'Explain after class', 'nothing is typed in while words are interim');
  assert.equal(steps[1].text, 'Explain the chain rule after class');
  // Already-broken seams get no second space; a new line counts.
  assert.equal(dictationText(final(play('Notes:\n', [7, 7], [event(0, heard('mitosis', true))]))), 'Notes:\nmitosis');
  assert.equal(dictationText(final(play('Notes: ', [7, 7], [event(0, heard('mitosis', true))]))), 'Notes: mitosis');
  assert.equal(dictationText(final(play('and more', [0, 0], [event(0, heard('First', true))]))), 'First and more');
});

test('with no caret it goes at the end, and a selection is replaced', () => {
  assert.equal(dictationText(final(play('Tell me about', [undefined, undefined], [event(0, heard('osmosis', true))]))), 'Tell me about osmosis');
  assert.equal(dictationText(final(play('Tell me about XX now', [14, 16], [event(0, heard('osmosis', true))]))), 'Tell me about osmosis now');
  assert.equal(dictationText(final(play('short', [99, 99], [event(0, heard('end', true))]))), 'short end');
});

test('Stop or silence keeps the words that were heard; Send, or the student typing, drops the interim', () => {
  let state = startDictation('', 0, 0);
  state = applyResults(state, event(0, heard('What time is it', true), heard('right')));
  assert.equal(dictationText(state), 'What time is it');
  assert.equal(dictationInterim(state), 'right');
  const kept = finishDictation(state);
  assert.equal(dictationText(kept), 'What time is it right', 'the last words were said, so they stay');
  assert.equal(dictationInterim(kept), '', 'no interim text is left behind');
  const dropped = finishDictation(state, { keepInterim: false });
  assert.equal(dictationText(dropped), 'What time is it');
  assert.equal(dictationInterim(dropped), '');
  // Nothing interim: nothing changes.
  assert.equal(finishDictation(kept), kept);
});

test('empty and odd events change nothing', () => {
  const state = startDictation('typed', 5, 5);
  assert.equal(dictationText(applyResults(state, undefined)), 'typed');
  assert.equal(dictationText(applyResults(state, event(0, heard('  ', true), heard(''))) ), 'typed');
  assert.equal(dictationText(applyResults(state, { resultIndex: 3, results: [] })), 'typed');
});

test('a new results list (resultIndex goes back) with other words is added after what is held, not over it', () => {
  const steps = play('', [0, 0], [
    event(0, heard('first part', true)),
    event(1, heard('first part', true), heard('second', true)),
    event(0, heard('third bit', true)),
    event(1, heard('third bit', true), heard('fourth', true)),
  ]);
  assert.deepEqual(steps.slice(0, 4).map(step => step.text), ['first part', 'first part second', 'first part second third bit', 'first part second third bit fourth']);
  // Back at an index already held with the same words, or the same words carried on: nothing is added.
  const same = play('', [0, 0], [event(0, heard('hello', true)), event(1, heard('hello', true), heard('and', true)), event(0, heard('hello', true), heard('and bye', true))]);
  assert.equal(same.at(-2).text, 'hello and bye');
  const grown = play('', [0, 0], [event(0, heard('what time', true)), event(1, heard('what time', true), heard('is it', false)), event(0, heard('what time is', true))]);
  assert.equal(grown.at(-2).text, 'what time is', 'a longer version of the same words replaces it');
});

test('Android Chrome: finals that repeat the one before and go on keep one copy', () => {
  const steps = play('', [0, 0], [
    event(0, heard('hello', true)),
    event(1, heard('hello', true), heard('hello world', true)),
    event(1, heard('hello', true), heard('hello world', true), heard('hello world how are you', true)),
    event(0, heard('hello', true), heard('hello world', true), heard('hello world how are you', true)),
  ]);
  assert.deepEqual(steps.slice(0, 4).map(step => step.text), ['hello', 'hello world', 'hello world how are you', 'hello world how are you']);
  // The same words said twice, apart, are two phrases; a word that merely starts the next one is not a repeat.
  assert.equal(dictationText(final(play('', [0, 0], [event(0, heard('no', true)), event(1, heard('no', true), heard('no', true))]))), 'no no');
  assert.equal(dictationText(final(play('', [0, 0], [event(0, heard('I', true)), event(1, heard('I', true), heard('Iceland is cold', true))]))), 'I Iceland is cold');
  assert.equal(dictationText(final(play('', [0, 0], [event(0, heard('Hello', true)), event(1, heard('Hello', true), heard('hello, world', true))]))), 'hello, world');
});

test('a box that holds only so much gets the words cut to fit, never what was typed', () => {
  const state = final(play('Typed before', [12, 12], [event(0, heard('one two three four five', true))]));
  assert.equal(dictationText(state, 1000), 'Typed before one two three four five');
  assert.equal(dictationText(state, 25), 'Typed before one two', 'cut at a whole word');
  assert.equal(dictationText(state, 26), 'Typed before one two three');
  assert.equal(dictationText(state, 8), 'Typed before', 'no room: what was typed alone');
  const after = final(play('Start end', [5, 5], [event(0, heard('middle words here', true))]));
  assert.equal(dictationText(after, 16), 'Start middle end');
  assert.equal(dictationText(after, 15), 'Start end', 'a word that does not fit whole is left out; the typed text stays');
  assert.equal(dictationText(after, 9), 'Start end', 'no room: the typed text alone');
  const long = dictationText(final(play('', [0, 0], [event(0, heard(Array.from({ length: 600 }, (_, at) => `word${at}`).join(' '), true))])), 2000);
  assert.ok(long.length <= 2000 && long.length > 1980, 'a long dictation fills the box without going over: ' + long.length);
  assert.ok(dictationText(final(play('', [0, 0], [event(0, heard('x'.repeat(3000), true))])), 2000).length <= 2000);
});

test('the recognizer errors say one plain thing', () => {
  assert.equal(dictationError('not-allowed'), 'Allow the mic in your browser.');
  assert.equal(dictationError('network'), 'No connection. Try again.');
  assert.equal(dictationError('audio-capture'), 'No microphone found.');
  assert.equal(dictationError('service-not-allowed'), dictationError('not-allowed'));
  assert.equal(dictationError('no-speech'), "Didn't hear that. Try again.");
  assert.equal(dictationError('no-speech', true), '', 'words were heard, so "nothing" would be wrong');
  // The narrowest place an error shows is the study aid at a 360px viewport: its line is 212px wide at
  // 14px/500, about 34 characters. The Tutor drawer (312px) is wider. tests/qa/dictation-check.cjs
  // measures the real line at 360 and 390; this is the cheap guard on the text.
  const STUDY_AID_SLOT_360 = 212;
  const AVERAGE_CHARACTER = 6.2; // px per character, 14px/500 sans, a mixed-case sentence
  const MAX_CHARACTERS = Math.floor(STUDY_AID_SLOT_360 / AVERAGE_CHARACTER);
  assert.equal(MAX_CHARACTERS, 34);
  for (const code of ['not-allowed', 'service-not-allowed', 'no-speech', 'network', 'audio-capture', 'something-new']) assert.ok(dictationError(code).length <= MAX_CHARACTERS, `${code}: ${dictationError(code).length} characters, ${MAX_CHARACTERS} fit the study aid at 360px`);
  assert.equal(dictationError('aborted'), '', 'we stopped it ourselves');
  assert.ok(dictationError('something-new'), 'any other error still says something');
  assert.equal(dictationHeard(startDictation('', 0, 0)), false);
  assert.equal(dictationHeard(applyResults(startDictation('', 0, 0), event(0, heard('hi')))), true);
});

test('every dictation box shares the one handler, with no per-event appending left', () => {
  for (const file of ['lib/useTutorChat.js', 'components/StudyAidPanel.js']) {
    const source = read(file);
    assert.match(source, /useDictation\(/, `${file} dictates through useDictation`);
    assert.doesNotMatch(source, /new Recognition\(/, `${file} has no handler of its own`);
    assert.doesNotMatch(source, /Array\.from\(event\.results\)/, `${file} does not join the whole result list again`);
  }
  assert.match(read('lib/useTutorChat.js'), /stopDictation\(\);\s*walkthroughEvent\('ask'\)/, 'Send stops the mic before the message goes');
  assert.match(read('components/StudyAidPanel.js'), /stopListening\(\);\s*setBusy\(true\)/, 'Check my answer stops the mic first');
  assert.match(read('lib/useDictation.js'), /interimResults = true/);
  assert.match(read('lib/useDictation.js'), /onerror = event =>[\s\S]*dictationError\(event\?\.error/, 'a recognizer error is read, not just ended');
  assert.match(read('lib/useDictation.js'), /useState\(\{ Recognition: null \}\)/, 'the recognizer class is held in an object: a class given to a state setter is called as an updater');
});

test('New chat and switching chats stop the mic; the Tutor panel and page show the interim line and use the caret', () => {
  const tutor = read('lib/useTutorChat.js');
  assert.match(tutor, /async function startChat[\s\S]*?stopDictation\(\);/, 'starting a chat stops dictation');
  assert.match(tutor, /const onNew = \(\) => \{\s*stopDictation\(\);/, "the sidebar's New chat stops dictation");
  assert.match(tutor, /stopDictation\(\); \}, \[router\.asPath/, 'moving to another chat stops dictation');
  const widget = read('components/AIChatWidget.js');
  assert.match(widget, /<DictationLine /, 'the panel and the Tutor page show what is being heard');
  assert.doesNotMatch(widget, /onClick=\{toggleMic\}/, 'the click event is not the caret');
  assert.match(widget, /toggleMic\(touchedRef\.current && boxRef\.current \? \{ start: boxRef\.current\.selectionStart, end: boxRef\.current\.selectionEnd \} : \{\}\)/);
  for (const file of ['components/Composer.js', 'components/StudyAidPanel.js', 'components/AIChatWidget.js']) assert.match(read(file), /<DictationLine /, `${file} shows the one line`);
  assert.match(read('components/StudyAidPanel.js'), /maxLength: ATTEMPT_MAX/, 'dictated words stop at what the answer box holds');
});

test('the dictation line holds one line, on one line, and never uses a raw colour', () => {
  const css = read('styles/system.css');
  assert.match(css, /\.dictation-slot \{[^}]*min-height: 1\.225rem/, 'the slot keeps its line');
  assert.match(css, /\.dictation-interim \{[^}]*white-space: nowrap; overflow: hidden/, 'interim words stay on one line');
  assert.match(css, /\.dictation-interim\.is-error \{[^}]*color: var\(--error\)/);
  assert.doesNotMatch(css.match(/\.dictation-slot[^\n]*\n(?:\.dictation-interim[^\n]*\n)+/)?.[0] || '', /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test('a restarted recognizer says the same final in another case: it is the same words, once', () => {
  const steps = play('', [0, 0], [
    event(0, heard('what time', true)),
    event(1, heard('what time', true), heard('is it', true)),
    event(0, heard('What time', true)),
  ]);
  assert.equal(dictationText(final(steps)), 'What time is it');
  const again = play('', [0, 0], [event(0, heard('hello there', true)), event(0, heard('Hello there', true))]);
  assert.equal(dictationText(final(again)), 'Hello there');
  const other = play('', [0, 0], [event(0, heard('hello there', true)), event(1, heard('hello there', true), heard('more', true)), event(0, heard('Good morning', true))]);
  assert.equal(dictationText(final(other)), 'hello there more Good morning', 'other words after a restart are still added');
});

test('an error stays until the next mic press or a keystroke: no timer', () => {
  const source = read('lib/useDictation.js');
  assert.doesNotMatch(source, /setTimeout|ERROR_SHOWN/, 'nothing clears the error on its own');
  assert.match(source, /if \(text !== errorTextRef\.current\) setError\(''\)/, 'typing clears it');
  assert.match(source, /if \(active\) \{ active\.recognition\.stop\(\); return; \}\s*if \(!Recognition\) return;\s*setError\(''\)/, 'the next mic press clears it');
  assert.match(read('styles/system.css'), /\.dictation-interim\.is-error \{[^}]*\}/);
  assert.doesNotMatch(read('styles/system.css').match(/\.dictation-interim\.is-error \{[^}]*\}/)[0], /white-space: normal/, 'an error line does not wrap');
});
