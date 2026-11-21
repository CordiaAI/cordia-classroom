// F11 Tutor voice mode: the rules in lib/voiceMode.mjs, the Whisper path's transcribe action, and the
// promises the view makes (one Tutor client, the microphone only after start, copy and tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVACY_NOTE, PUT_IN_CHAT, SILENCE_MS, cloudVoiceAllowed, createBargeIn, createTurnDetector, fallbackNote, levelFrom,
  micHelp, micProblem, pickBrowserVoice, recordingType, speakableReply, splitSentences,
} from '../lib/voiceMode.mjs';
import { createLectureService } from '../lib/server/lectures.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a reply is spoken without markdown, and links and code are left in the chat', () => {
  const reply = [
    '## Osmosis',
    'Osmosis is **water** moving toward the side with *more* solute.',
    '- First, water crosses the membrane.',
    '- Then the levels even out.',
    'Read more at https://example.edu/osmosis.',
    '```python',
    'print("water")',
    '```',
  ].join('\n');
  const spoken = speakableReply(reply);
  assert.equal(spoken, `Osmosis. Osmosis is water moving toward the side with more solute. First, water crosses the membrane. Then the levels even out. Read more at ${PUT_IN_CHAT}`);
  assert.doesNotMatch(spoken, /https?:|print|[*#`]/);
});

test('the chat line is said once per reply, and not at all when the reply already says it', () => {
  assert.equal(speakableReply('See https://a.edu and https://b.edu for more.'), `See ${PUT_IN_CHAT} and for more.`);
  assert.equal(speakableReply("Here is the code. I've put that in the chat.\n```js\nlet x = 1;\n```"), "Here is the code. I've put that in the chat.");
  assert.equal(speakableReply('Use the `len` function, or `sorted(items, key=lambda x: x[1])`.'), `Use the len function, or ${PUT_IN_CHAT}`);
});

test('markdown links keep their words, tables are read as sentences, diagrams are left out', () => {
  assert.equal(speakableReply('Read [chapter 4 of the textbook](https://x.edu/ch4) first.'), 'Read chapter 4 of the textbook first.');
  assert.equal(speakableReply('| Term | Meaning |\n| --- | --- |\n| Tort | A civil wrong |'), 'Term, Meaning. Tort, A civil wrong.');
  assert.equal(speakableReply('Here is the cycle.\n```mermaid\ngraph TD; A-->B\n```'), `Here is the cycle. ${PUT_IN_CHAT}`);
});

test('every word spoken is the reply’s own, in order (what /tutor/speak checks)', () => {
  const reply = 'In *Beloved*, Toni Morrison uses **memory** as a character: see https://lit.edu/beloved and `notes.md`.';
  const words = text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const spoken = words(speakableReply(reply).replace(PUT_IN_CHAT, ' '));
  const source = words(reply);
  let at = 0;
  for (const word of spoken) { at = source.indexOf(word, at); assert.notEqual(at, -1, word); at += 1; }
});

test('sentences come out one at a time, short pieces join the next, long ones are cut to fit', () => {
  assert.deepEqual(splitSentences('Yes. The heart has four chambers. Blood enters the right atrium first!'), [
    'Yes. The heart has four chambers.', 'Blood enters the right atrium first!',
  ]);
  assert.deepEqual(splitSentences('Courts weigh many factors, e.g. intent and harm. Then they decide.'), [
    'Courts weigh many factors, e.g. intent and harm.', 'Then they decide.',
  ]);
  assert.deepEqual(splitSentences('The value is 3.14 in most cases. Next comes radius.'), ['The value is 3.14 in most cases.', 'Next comes radius.']);
  const long = `${'The Renaissance changed painting, sculpture and architecture across Italy, '.repeat(6)}and then Europe.`;
  const parts = splitSentences(long);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 280, part.length);
  assert.equal(parts.join(' '), long);
  assert.deepEqual(splitSentences(''), []);
});

test('the turn ends after about 800ms of silence once the student has talked', () => {
  assert.equal(SILENCE_MS, 800);
  const vad = createTurnDetector();
  const events = [];
  let now = 0;
  const run = (level, ms) => { for (let t = 0; t < ms; t += 50) { now += 50; const event = vad.step(level, now); if (event) events.push([event, now]); } };
  run(0.004, 1000); // a quiet room: nothing
  assert.deepEqual(events, []);
  run(0.12, 600); // talking
  assert.equal(events[0][0], 'start');
  run(0.004, 700); // a pause shorter than 800ms keeps the turn going
  assert.equal(events.length, 1);
  run(0.12, 300);
  const before = now;
  run(0.004, 1000);
  assert.equal(events[1][0], 'end');
  assert.ok(events[1][1] - before >= 800 && events[1][1] - before <= 900, String(events[1][1] - before));
});

test('a click or a cough is not a turn, and a noisy room raises the bar', () => {
  const vad = createTurnDetector();
  let now = 0;
  const step = level => vad.step(level, (now += 50));
  assert.equal(step(0.3), null); // 50ms blip
  for (let i = 0; i < 20; i += 1) assert.equal(step(0.002), null);
  const noisy = createTurnDetector();
  let t = 0;
  for (let i = 0; i < 200; i += 1) noisy.step(0.03, (t += 50)); // a steady fan, just over the base threshold
  let started = false;
  for (let i = 0; i < 10; i += 1) started = started || noisy.step(0.035, (t += 50)) === 'start';
  assert.equal(started, false);
});

test('talking over the Tutor stops it only when it is clearly the student', () => {
  const barge = createBargeIn();
  let now = 0;
  assert.equal(barge.step(0.04, (now += 50)), false); // echo the microphone let through
  let fired = 0;
  for (let i = 0; i < 10; i += 1) if (barge.step(0.2, (now += 50))) fired += 1;
  assert.equal(fired, 1);
});

test('levels, recording types and microphone problems', () => {
  assert.equal(levelFrom(new Uint8Array(512).fill(128)), 0);
  assert.ok(levelFrom(Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 200 : 56))) > 0.5);
  assert.equal(recordingType(type => type === 'audio/mp4'), 'audio/mp4');
  assert.equal(recordingType(type => type.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(recordingType(() => false), '');
  assert.equal(micProblem({ name: 'NotAllowedError' }), 'blocked');
  assert.equal(micProblem({ name: 'NotFoundError' }), 'missing');
  assert.equal(micProblem({ name: 'NotReadableError' }), 'busy');
  assert.equal(micProblem(new Error('x')), 'failed');
  const safari = micHelp('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15');
  assert.match(safari.join(' '), /Settings for this website/);
  assert.match(micHelp('Mozilla/5.0 Chrome/131.0 Safari/537.36').join(' '), /address bar/);
  assert.match(micHelp('Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1').join(' '), /Settings app/);
});

test('the browser voice is the best English one, never a novelty voice', () => {
  const voices = [
    { name: 'Zarvox', lang: 'en-US' }, { name: 'Albert', lang: 'en-US' },
    { name: 'Thomas', lang: 'fr-FR' }, { name: 'Fred', lang: 'en-US', default: true },
    { name: 'Daniel', lang: 'en-GB' }, { name: 'Samantha', lang: 'en-US' },
    { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US' },
  ];
  assert.equal(pickBrowserVoice(voices, 'en-US').name, 'Microsoft Aria Online (Natural) - English (United States)');
  assert.equal(pickBrowserVoice(voices.slice(0, 6), 'en-US').name, 'Samantha');
  assert.equal(pickBrowserVoice(voices.slice(0, 6), 'en-GB').name, 'Daniel');
  assert.equal(pickBrowserVoice([{ name: 'Thomas', lang: 'fr-FR' }]), null);
});

test('the cloud voice is for accounts with voice characters left; the notes are one line each', () => {
  assert.equal(cloudVoiceAllowed({ features: { voice_characters: { limit: 0, remaining: 0 } } }), false);
  assert.equal(cloudVoiceAllowed({ features: { voice_characters: { limit: 150000, remaining: 12 } } }), true);
  assert.equal(cloudVoiceAllowed({ features: { voice_characters: { limit: 150000, remaining: 0 } } }), false);
  assert.equal(cloudVoiceAllowed({ unlimited: true }), true);
  assert.equal(cloudVoiceAllowed(null), false);
  for (const reason of ['limit', 'unavailable']) {
    const line = fallbackNote(reason);
    assert.ok(line && !line.includes('\n') && !line.includes('!'), line);
  }
  assert.equal(PRIVACY_NOTE, 'Voice audio is transcribed and not stored.');
});

// ---- The Whisper path's transcribe action (lib/server/lectures.mjs) ----

const USER = '11111111-2222-4333-8444-555555555555';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function transcriber({ env = { GROQ_API_KEY: 'gsk-test' }, tutorLeft = 5 } = {}) {
  const state = { calls: [] };
  const fetch = async (url, init = {}) => {
    state.calls.push(url);
    if (url.endsWith('/billing/status')) return init.headers.Authorization === AUTH ? json({ plan: 'free', features: { tutor: { remaining: tutorLeft, limit: 10 } } }) : json({}, 401);
    if (url.endsWith('/audio/transcriptions')) {
      state.model = init.body.get('model');
      state.file = init.body.get('file');
      return json({ text: ' Why does water follow salt? ', segments: [{ text: ' Why does water follow salt? ', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] });
    }
    if (url.includes('/storage/') || url.includes('/rpc/')) throw new Error(`voice audio must never be stored or metered: ${url}`);
    throw new Error(`unexpected ${url}`);
  };
  const service = createLectureService({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...env }, fetch, sleep: async () => {} });
  return { service, state };
}

test('a spoken turn is written down by the same Whisper call, never stored and never lecture minutes', async () => {
  const { service, state } = transcriber();
  const result = await service.transcribe(AUTH, { audio: Buffer.alloc(4000), contentType: 'audio/webm;codecs=opus' });
  assert.equal(result.status, 200);
  assert.equal(result.body.text, 'Why does water follow salt?');
  assert.equal(state.model, 'whisper-large-v3-turbo');
  assert.equal(state.file.name, 'turn.webm');
  assert.ok(state.calls.every(url => !url.includes('/storage/') && !url.includes('/rpc/')));
});

test('the transcribe action needs a sign-in, Tutor messages left, a real recording, and a set-up provider', async () => {
  assert.equal((await transcriber().service.transcribe('Bearer nope', { audio: Buffer.alloc(4000), contentType: 'audio/webm' })).status, 401);
  const limited = await transcriber({ tutorLeft: 0 }).service.transcribe(AUTH, { audio: Buffer.alloc(4000), contentType: 'audio/webm' });
  assert.equal(limited.status, 402);
  assert.equal(limited.body.detail.feature, 'tutor');
  assert.equal((await transcriber().service.transcribe(AUTH, { audio: Buffer.alloc(4000), contentType: 'text/html' })).status, 415);
  assert.equal((await transcriber().service.transcribe(AUTH, { audio: Buffer.alloc(2_000_001), contentType: 'audio/webm' })).status, 413);
  const off = await transcriber({ env: {} }).service.transcribe(AUTH, { audio: Buffer.alloc(4000), contentType: 'audio/webm' });
  assert.equal(off.status, 503);
  assert.equal(off.body.code, 'not_configured');
});

// ---- What the view and its engine promise ----

const view = read('../components/VoiceMode.js');
const engine = read('../lib/useVoiceMode.js');
const client = read('../lib/useTutorChat.js');
const composer = read('../components/Composer.js');
const settings = read('../components/TutorSettings.js');

test('one Tutor client: voice turns go through useTutorChat sendVoice with voice: true', () => {
  assert.match(client, /function sendVoice\(text\)/);
  assert.match(client, /\.\.\.\(voice \? \{ voice: true \} : \{\}\)/);
  assert.match(client, /rich_text: !voice/);
  assert.match(engine, /tutorRef\.current\.sendVoice\(text\)/);
  for (const source of [view, engine]) assert.doesNotMatch(source, /['"`]\/chat['"`]/);
});

test('the microphone goes on only in start(), after the student opens voice mode, and off at End', () => {
  assert.equal((engine.match(/getUserMedia\(/g) || []).length, 1);
  const start = engine.slice(engine.indexOf('const start = useCallback'));
  assert.match(start, /getUserMedia\(/);
  assert.match(engine, /const end = useCallback[\s\S]*?getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(composer, /\{voiceOpen && <VoiceMode tutor=\{tutor\} onClose=\{closeVoice\} \/>\}/);
  assert.doesNotMatch(composer, /getUserMedia\(/);
});

test('the view: dialog, Space and tap interrupt, Escape ends, live state, indicator, privacy line, T4b captions', () => {
  assert.match(view, /role="dialog" aria-modal="true"/);
  assert.match(view, /event\.key === ' '/);
  assert.match(view, /event\.key === 'Escape'/);
  assert.match(view, /onClick=\{onClick\}/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /Microphone on/);
  assert.match(view, /PRIVACY_NOTE/);
  assert.match(view, /<TutorThinking steps=\{tutor\.thinking\?\.steps\} lines=\{tutor\.thinking\?\.lines\} mark=\{false\} \/>/);
  assert.match(view, /prefers-reduced-motion: reduce/);
  assert.match(settings, /PRIVACY_NOTE/);
});

test('voice copy is sentence case with no exclamation marks, and every colour is a token', () => {
  const copy = [...view.matchAll(/'([^'\n]{4,})'|"([^"\n]{4,})"|>([^<>{}\n]{4,})</g)].map(match => match[1] || match[2] || match[3]).filter(text => /\s/.test(text) && /^[A-Z]/.test(text));
  for (const text of copy) {
    assert.doesNotMatch(text, /!/, text);
    assert.doesNotMatch(text, /\s(?:The|Tutor Voice|Voice Mode|Microphone On)\b/, text);
  }
  for (const source of [view, settings, engine, read('../lib/voiceMode.mjs')]) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    assert.doesNotMatch(source, /transition:\s*all/);
  }
});
