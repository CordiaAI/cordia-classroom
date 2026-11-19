// Dictation (lib/dictation.mjs, lib/useDictation.js): a spoken phrase lands in the box once, whether
// the recognizer reports it Chrome's way or Safari's, and what the student already typed stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyResults, dictationInterim, dictationText, finishDictation, startDictation } from '../lib/dictation.mjs';

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
});
