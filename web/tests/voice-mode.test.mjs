// F11 Tutor voice mode: the rules in lib/voiceMode.mjs, the Whisper path's transcribe action, and the
// promises the view makes (one Tutor client, the microphone only after start, copy and tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIVACY_NOTE, PUT_IN_CHAT, SILENCE_MS, cloudVoiceAllowed, createBargeIn, createTurnDetector, fallbackNote, levelFrom, listenFallback,
  micHelp, micProblem, pickBrowserVoice, recordingType, speakableReply, splitSentences,
} from '../lib/voiceMode.mjs';
import { VOICE_FEATURE, VOICE_TURN_LIMITS, VOICE_TURN_RATE, createLectureService, resetVoiceTurns } from '../lib/server/lectures.mjs';

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

function transcriber({ env = { GROQ_API_KEY: 'gsk-test' }, tutorLeft = 5, plan = 'free', tier, unlimited = false, used = 0, countFails = false, whisperFails = false, clock = { at: Date.UTC(2026, 10, 21, 12) } } = {}) {
  resetVoiceTurns();
  const state = { calls: [], rows: [], clock };
  const fetch = async (url, init = {}) => {
    state.calls.push(url);
    if (url.endsWith('/billing/status')) {
      return init.headers.Authorization === 'Bearer nope' ? json({}, 401) : json({ plan, tier, unlimited, features: { tutor: { remaining: tutorLeft, limit: 10 } } });
    }
    if (url.endsWith('/audio/transcriptions')) {
      state.whisper = (state.whisper || 0) + 1;
      if (whisperFails) return json({}, 400);
      state.model = init.body.get('model');
      state.file = init.body.get('file');
      return json({ text: ' Why does water follow salt? ', segments: [{ text: ' Why does water follow salt? ', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] });
    }
    if (url.includes('/rest/v1/usage_events')) {
      if (init.method === 'POST') { state.rows.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
      state.count = url;
      state.countHeaders = init.headers;
      if (countFails) return json({ message: 'boom' }, 500);
      return new Response('[]', { status: 206, headers: { 'content-range': used ? `0-0/${used}` : '*/0' } });
    }
    if (url.includes('/storage/') || url.includes('/rpc/')) throw new Error(`voice audio must never be stored or metered as lecture minutes: ${url}`);
    throw new Error(`unexpected ${url}`);
  };
  const service = createLectureService({
    env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...env },
    fetch, sleep: async () => {}, now: () => new Date(clock.at),
  });
  return { service, state };
}
const turn = (service, auth = AUTH) => service.transcribe(auth, { audio: Buffer.alloc(4000), contentType: 'audio/webm' });
const tokenFor = sub => `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub })}.sig`;

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

// ---- Review fixes: the transcribe action is limited (a rate, and a monthly cap per plan) ----

test('a loop of transcribe calls gets a 429 with Retry-After after 20 in a minute, and every try counts', async () => {
  assert.equal(VOICE_TURN_RATE.max, 20);
  const { service, state } = transcriber();
  const codes = [];
  for (let i = 0; i < 25; i += 1) codes.push((await turn(service)).status);
  assert.deepEqual(codes.slice(0, 20), Array(20).fill(200));
  assert.deepEqual(codes.slice(20), Array(5).fill(429));
  assert.equal(state.whisper, 20, 'a limited call never reaches Whisper');
  const limited = await turn(service);
  assert.equal(limited.body.detail.code, 'rate_limited');
  assert.match(limited.headers['Retry-After'], /^\d+$/);
  assert.ok(Number(limited.headers['Retry-After']) >= 1 && Number(limited.headers['Retry-After']) <= 60);
  // Bad recordings spend a Whisper call's worth of attention too, so they count (and are still refused as before).
  const bad = transcriber();
  const results = [];
  for (let i = 0; i < 21; i += 1) results.push((await bad.service.transcribe(AUTH, { audio: Buffer.alloc(4000), contentType: 'text/html' })).status);
  assert.deepEqual([results[0], results[20]], [415, 429]);
});

test('the rate is per student and a minute later they can talk again', async () => {
  const { service, state } = transcriber();
  for (let i = 0; i < 20; i += 1) await turn(service);
  assert.equal((await turn(service)).status, 429);
  assert.equal((await turn(service, tokenFor('99999999-2222-4333-8444-555555555555'))).status, 200);
  state.clock.at += 61_000;
  assert.equal((await turn(service)).status, 200);
});

test('each turn written down is one usage_events row for the student, with no audio or words in it', async () => {
  const { service, state } = transcriber();
  await turn(service);
  assert.equal(state.rows.length, 1);
  assert.deepEqual(state.rows[0], { user_id: USER, feature: VOICE_FEATURE, model: 'whisper-large-v3-turbo', prompt_tokens: 1, completion_tokens: 0, cached_tokens: 0 });
  assert.equal(VOICE_FEATURE, 'tutor_voice_turn');
  assert.doesNotMatch(JSON.stringify(state.rows), /water|salt/i);
  // A turn that fails at Whisper is not counted against the month.
  const failing = transcriber({ whisperFails: true });
  assert.equal((await turn(failing.service)).status, 502);
  assert.equal(failing.state.rows.length, 0);
});

test('the monthly cap: Free 40, Pro 600, Academic Weapon 2000 turns; at the cap the answer is a 402 before Whisper', async () => {
  assert.deepEqual(VOICE_TURN_LIMITS, { free: 40, pro: 600, weapon: 2000 });
  for (const [plan, tier, cap] of [['free', 'free', 40], ['classroom_plus', 'pro', 600], ['classroom_plus', 'weapon', 2000]]) {
    const under = transcriber({ plan, tier, used: cap - 1 });
    assert.equal((await turn(under.service)).status, 200, `${tier} one under the cap`);
    const at = transcriber({ plan, tier, used: cap });
    const stopped = await turn(at.service);
    assert.equal(stopped.status, 402, `${tier} at the cap`);
    assert.equal(stopped.body.detail.code, 'limit_reached');
    assert.equal(stopped.body.detail.feature, 'voice_turns');
    assert.equal(stopped.body.detail.limit, cap);
    assert.equal(at.state.whisper, undefined, 'no Whisper call at the cap');
    assert.equal(at.state.rows.length, 0);
  }
  // Counted for this student, this feature and this month.
  const { service, state } = transcriber({ used: 3 });
  await turn(service);
  assert.match(state.count, new RegExp(`user_id=eq\\.${USER}&feature=eq\\.tutor_voice_turn&created_at=gte\\.2026-11-01T00:00:00Z`));
  assert.equal(state.countHeaders.Prefer, 'count=exact');
});

test('Free can still use voice mode at a modest level, and the cap never blocks on a counting problem, an unlimited account or no metering', async () => {
  assert.ok(VOICE_TURN_LIMITS.free >= 30, 'Free keeps a modest level of voice');
  assert.equal((await turn(transcriber({ used: 39 }).service)).status, 200);
  assert.equal((await turn(transcriber({ countFails: true }).service)).status, 200);
  assert.equal((await turn(transcriber({ unlimited: true, used: 99999 }).service)).status, 200);
  const unmetered = transcriber({ env: { GROQ_API_KEY: 'gsk-test', SUPABASE_SERVICE_ROLE_KEY: '' } });
  assert.equal((await turn(unmetered.service)).status, 200);
  assert.equal(unmetered.state.rows.length, 0);
  // Tutor messages left are still checked first, as before.
  assert.equal((await turn(transcriber({ tutorLeft: 0, used: 99 }).service)).body.detail.feature, 'tutor');
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

// ---- Review fixes: what the view does when listening is limited, focus, the fade, the announcement, Free's picker ----

test('a limited transcribe call falls back to the browser listening, or says why in one line', () => {
  for (const reason of ['limit', 'rate']) {
    const heard = listenFallback(reason, true);
    const silent = listenFallback(reason, false);
    assert.ok(heard.note && !heard.error && silent.error && !silent.note, reason);
    for (const line of [heard.note, silent.error]) assert.ok(!line.includes('\n') && !line.includes('!') && /^[A-Z]/.test(line), line);
  }
  assert.match(listenFallback('limit', false).error, /Type your message instead\.$/);
  // The engine: 429 and the voice_turns 402 fall back; the Tutor's own 402 still closes voice mode with the upgrade window.
  assert.match(engine, /response\.status === 429\) return \{ fallback: 'rate' \}/);
  assert.match(engine, /response\.status === 402 && data\?\.detail\?\.feature === 'voice_turns'\) \{ s\.whisper = false;[^}]*return \{ fallback: 'limit' \}/);
  assert.match(engine, /if \(response\.status === 402\) return \{ limit: data\?\.detail \}/);
  assert.match(engine, /listenFallback\(written\.fallback, Boolean\(recognized\)\)/);
  assert.match(engine, /if \(fallback\?\.error\) \{ setError\(fallback\.error\); listen\(\); return; \}/);
  // The cap stays for the session: no more audio is sent once it is reached.
  assert.match(engine, /if \(!s\.whisper \|\| !blob/);
});

test('ending voice mode while the Tutor is busy never loses focus: the voice button is aria-disabled, never disabled', () => {
  const button = composer.slice(composer.indexOf('ref={voiceButtonRef}'));
  const tag = button.slice(0, button.indexOf('>\n'));
  assert.match(tag, /aria-disabled=\{blocked \|\| undefined\}/);
  assert.doesNotMatch(tag, /(?<![-\w])disabled=/);
  assert.match(composer, /function openVoice\(\) \{\s*if \(blocked\) return;/);
  assert.match(composer, /\(voiceButtonRef\.current \|\| boxRef\.current\)\?\.focus\(/);
  const css = read('../styles/system.css');
  assert.match(css, /\.composer-icon:disabled, \.composer-icon\[aria-disabled='true'\] \{ cursor: default; opacity: \.5; \}/);
  assert.match(css, /\.composer-icon:not\(:disabled\):not\(\[aria-disabled='true'\]\):not\(\.is-on\):hover/);
});

test('the view fades by an opacity transition both ways, so End during the entrance reverses from where it is', () => {
  assert.doesNotMatch(view, /@keyframes voice-in|@keyframes voice-out|animation: voice-in|animation: voice-out/);
  assert.match(view, /opacity: 0; transition: opacity var\(--dur-enter\) var\(--ease\);/);
  assert.match(view, /\.voice-view\.is-open \{ opacity: 1; \}/);
  assert.match(view, /\.voice-view\.is-leaving \{ opacity: 0; transition: opacity \$\{LEAVE_MS\}ms var\(--ease-exit\)/);
  assert.match(view, /\$\{open && !leaving \? ' is-open' : ''\}/);
  // Reduced motion: no transition at all, and the view is simply there (or gone).
  const reduced = view.slice(view.indexOf('@media (prefers-reduced-motion: reduce) {\n          .voice-view, .voice-view.is-leaving'));
  assert.match(reduced, /\.voice-view, \.voice-view\.is-leaving \{ transition: none; \}/);
  assert.match(reduced, /\.voice-view \{ opacity: 1; \}/);
  assert.match(view, /setTimeout\(onClose, still \? 0 : LEAVE_MS\)/);
});

test('what was heard is read to screen readers once, when Thinking starts', () => {
  assert.match(engine, /setHeard\(text\);\s*setSent\(text\);\s*const result = await tutorRef\.current\.sendVoice\(text\)/);
  assert.equal((engine.match(/setSent\(text\)/g) || []).length, 1);
  assert.match(engine, /setSent\(''\);/); // cleared when listening starts again
  assert.match(view, /<p className="sr-only" aria-live="polite" aria-atomic="true">\{sent \? `You said: \$\{sent\}` : ''\}<\/p>/);
  // The live captions themselves are not live regions.
  assert.doesNotMatch(view.slice(view.indexOf('className="voice-captions"'), view.indexOf('<footer')), /aria-live/);
});

test("Settings > Tutor: on Free the voice picker is preview-only, and at 390px it is two rows of two", () => {
  assert.match(settings, /const previewOnly = Boolean\(status\) && !paid;/);
  assert.match(settings, /aria-disabled=\{previewOnly \|\| undefined\}/);
  assert.match(settings, /if \(previewOnly\) return;/);
  assert.match(settings, /aria-describedby=\{previewOnly \? 'tutor-voice-note' : undefined\}/);
  assert.match(settings, /id="tutor-voice-note"/);
  assert.match(settings, /@media \(max-width: 520px\) \{\s*:global\(\.c-seg\.tutor-voice-picker\) \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
