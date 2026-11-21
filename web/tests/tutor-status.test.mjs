// The Tutor's thinking lines (T4b): lib/tutorStatus.mjs, components/TutorThinking.js, how lib/useTutorChat.js
// starts them. The browser behaviour (2.2 s cross-fade, gone on the answer, reduced motion) is in tests/qa/thinking-check.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FALLBACK_LINE, firstLine, LINE_MS, nextLine, pollSteps, requestStatusLines } from '../lib/tutorStatus.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const LINES = ['Tracing the Krebs cycle', 'Linking ATP to cell work', 'Mapping electron carriers'];

test('the line is "Reading your question" until something better arrives, and a real step shows first when there is one', () => {
  assert.equal(FALLBACK_LINE, 'Reading your question');
  assert.equal(firstLine([]), FALLBACK_LINE);
  assert.equal(firstLine(['Reading Cells']), 'Reading Cells');
  assert.equal(firstLine(['Reading Cells', 'Drawing a diagram']), 'Drawing a diagram');
  assert.equal(LINE_MS, 2200);
});

test('the lines go in order every time: fallback, then the question\'s lines round and round; steps are not shown again', () => {
  assert.equal(nextLine({ current: FALLBACK_LINE, steps: [], lines: LINES }), LINES[0]);
  assert.equal(nextLine({ current: LINES[0], steps: [], lines: LINES }), LINES[1]);
  assert.equal(nextLine({ current: LINES[2], steps: [], lines: LINES }), LINES[0]);
  assert.equal(nextLine({ current: FALLBACK_LINE, steps: [], lines: [] }), FALLBACK_LINE, 'nothing to move to: it stays');
  assert.equal(nextLine({ current: 'Reading Cells', steps: ['Reading Cells'], lines: [] }), 'Reading Cells', 'a real step stays while it is all there is');
  assert.equal(nextLine({ current: 'Reading Cells', steps: ['Reading Cells'], lines: LINES }), LINES[0], 'after a step, the question\'s lines');
  assert.equal(nextLine({ current: 'Reading Cells', steps: ['Reading Cells', 'Drawing a diagram'], lines: LINES }), 'Drawing a diagram');
  assert.equal(nextLine({ current: 'Drawing a diagram', steps: ['Reading Cells', 'Drawing a diagram'], lines: LINES }), LINES[0]);
  assert.equal(nextLine({ current: 'gone', steps: [], lines: LINES }), LINES[0]);
});

test('blank or non-text lines are ignored', () => {
  assert.equal(firstLine(['', '  ', null, 4]), FALLBACK_LINE);
  assert.equal(nextLine({ current: FALLBACK_LINE, steps: null, lines: ['', 'Tracing a proof'] }), 'Tracing a proof');
});

test('the status request carries the message, the guide and the class, and gives the lines when they arrive', async () => {
  const calls = [];
  const got = [];
  requestStatusLines({
    call: async (path, init) => { calls.push([path, init]); return { lines: LINES }; },
    question: 'Explain the Krebs cycle', title: 'Cell Biology Basics', className: 'Biology 101', onLines: lines => got.push(lines),
  });
  await wait(10);
  assert.equal(calls[0][0], '/tutor/status');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { question: 'Explain the Krebs cycle', title: 'Cell Biology Basics', class_name: 'Biology 101' });
  assert.deepEqual(got, [LINES]);
});

test('lines that arrive after the answer (cancel) are never shown, and a failed or empty call gives nothing', async () => {
  const got = [];
  const cancel = requestStatusLines({ call: async () => { await wait(30); return { lines: LINES }; }, question: 'q', onLines: lines => got.push(lines) });
  cancel();
  requestStatusLines({ call: async () => { throw new Error('offline'); }, question: 'q', onLines: lines => got.push(lines) });
  requestStatusLines({ call: async () => null, question: 'q', onLines: lines => got.push(lines) });
  requestStatusLines({ call: async () => ({ lines: [] }), question: 'q', onLines: lines => got.push(lines) });
  requestStatusLines({ call: async () => ({ detail: 'Too many requests' }), question: 'q', onLines: lines => got.push(lines) });
  await wait(80);
  assert.deepEqual(got, []);
});

test('steps are read for the session while the answer is pending, every one so far, until cancel', async () => {
  const asked = [];
  const got = [];
  let n = 0;
  const cancel = pollSteps({
    call: async path => { asked.push(path); n += 1; return { steps: n < 2 ? [] : ['Reading Cells', ...(n > 2 ? ['Drawing a diagram'] : [])] }; },
    sessionId: 'a b', onSteps: steps => got.push(steps), everyMs: 20,
  });
  await wait(120);
  cancel();
  const seen = asked.length;
  await wait(60);
  assert.equal(asked.length, seen, 'no more polls after the answer');
  assert.equal(asked[0], '/tutor/steps?session_id=a%20b');
  assert.deepEqual(got[0], ['Reading Cells']);
  assert.deepEqual(got.at(-1), ['Reading Cells', 'Drawing a diagram']);
});

test('a missed poll does not stop the next one', async () => {
  let n = 0;
  const got = [];
  const cancel = pollSteps({ call: async () => { n += 1; if (n === 1) throw new Error('offline'); return { steps: ['Drawing a diagram'] }; }, sessionId: 's', onSteps: steps => got.push(steps), everyMs: 20 });
  await wait(100);
  cancel();
  assert.ok(got.length >= 1);
});

test('the Tutor starts the lines beside the answer: not awaited, and the old "Explaining material…" is gone', () => {
  const hook = read('lib/useTutorChat.js');
  assert.ok(!hook.includes('Explaining material'));
  assert.ok(!hook.includes('progressLabel'));
  assert.match(hook, /stopStatus\.current\.push\(requestStatusLines\(/);
  assert.match(hook, /stopStatus\.current\.push\(pollSteps\(/);
  assert.ok(!/await\s+requestStatusLines|await\s+pollSteps/.test(hook), 'the answer never waits for the status');
  // They stop when the answer is in or the send is given up.
  assert.ok((hook.match(/endStatus\(\);/g) || []).length >= 3);
  const messages = read('components/TutorMessages.js');
  assert.ok(!messages.includes('Explaining material') && !messages.includes('progressLabel'));
  assert.match(messages, /<TutorThinking /);
});

test('TutorThinking: one mark that does not announce, one line, the first line alone is live, reduced motion is plain', () => {
  const source = read('components/TutorThinking.js');
  assert.equal((source.match(/<CordiaLoader /g) || []).length, 2, 'one mark in either place: beside the line, or as the avatar');
  assert.ok(!/<(img|svg)\b/.test(source) && !/lucide/.test(source), 'no second icon');
  assert.equal((source.match(/aria-live="polite"/g) || []).length, 1);
  assert.match(source, /aria-hidden="true">\s*\n\s*\{\/\*/, 'the changing lines are hidden from readers');
  assert.match(source, /setAnnounced\(view\.text\);\s*\}, \[\]\)/, 'the live region is set once, on the first line');
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /\.tutor-line\.is-out \{ display: none; \}/);
  assert.match(source, /LINE_MS/);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(source), 'tokens only, no raw colours');
});

// ---- Contrast: the line sweeps between --muted-strong and --ink, so both read 4.5:1 on what the line sits on ----

const css = read('styles/tokens.css');
const block = (start, from = 0) => { const at = css.indexOf(start, from); assert.ok(at >= 0, start); return css.slice(at, css.indexOf('}', at)); };
const token = (text, name) => text.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
const rgb = value => {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  return hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : value.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
};
const over = ([r, g, b, a = 1], under) => [r, g, b].map((channel, i) => channel * a + under[i] * (1 - a));
const luminance = color => { const [r, g, b] = color.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the shimmer line reads 4.5:1 in light, dark and Paper & Clay (light and dark), on the canvas and on the card', () => {
  const light = block(':root {');
  const dark = block("[data-theme='dark'] {");
  const paper = block(":root[data-look='paper-clay'] {");
  const paperDark = block("[data-theme='dark'][data-look='paper-clay'] {");
  const lightCanvas = rgb(token(light, '--canvas'));
  const darkCanvas = rgb(token(dark, '--canvas'));
  const cases = {
    light: [light, lightCanvas, over(rgb(token(light, '--glass-fill')), lightCanvas)],
    dark: [dark, darkCanvas, over(rgb(token(dark, '--glass-fill')), darkCanvas)],
    'paper & clay': [paper, rgb('#FAF9F5'), rgb(token(paper, '--glass-solid'))],
    'paper & clay dark': [paperDark, rgb('#262624'), rgb(token(paperDark, '--glass-solid'))],
  };
  for (const [name, [tokens, canvas, card]] of Object.entries(cases)) {
    for (const [surfaceName, surface] of [['canvas', canvas], ['card', card]]) {
      for (const text of ['--muted-strong', '--ink']) {
        const colour = rgb(token(tokens, text) || token(css.slice(css.indexOf(':root {')), text));
        assert.ok(ratio(over(colour, surface), surface) >= 4.5, `${name}: ${text} on the ${surfaceName}: ${ratio(over(colour, surface), surface).toFixed(2)}`);
      }
    }
  }
});
