// Lecture transcript helpers and the /api/lectures service with a fake network.
import assert from 'node:assert/strict';
import { cleanSpokenText, collapseLoops, keepWhisperSegment, mergeOverlap, mergedSegments, transcriptText, whisperText } from '../lib/lectureText.mjs';
import { createLectureService, minutesTouched } from '../lib/server/lectures.mjs';

// Overlap between neighbouring chunks is removed, keeping the new chunk's own spelling.
assert.equal(mergeOverlap('the mitochondria makes ATP for the cell', 'for the cell, which then uses it'), 'which then uses it');
assert.equal(mergeOverlap('completely different words', 'nothing in common here'), 'nothing in common here');
assert.equal(cleanSpokenText('So, um, the the cell uh divides.'), 'So the cell divides.');

// Chunks arriving out of order still read in order, with no repeated overlap.
const segments = [
  { seq: 2, start_ms: 24000, text: 'and that ends the first part of today.' },
  { seq: 0, start_ms: 0, text: 'Welcome back. Today we cover cell energy and ATP' },
  { seq: 1, start_ms: 6000, text: 'energy and ATP. The mitochondria makes ATP, and that ends' },
];
const merged = mergedSegments(segments);
assert.deepEqual(merged.map(item => item.seq), [0, 1, 2]);
assert.equal(merged[1].text, 'The mitochondria makes ATP, and that ends');
assert.equal(merged[2].text, 'the first part of today.');
assert.equal(transcriptText(segments), 'Welcome back. Today we cover cell energy and ATP The mitochondria makes ATP, and that ends the first part of today.');
console.log('ok   overlap merge, filler clean-up, out-of-order chunks');

// Minutes charged per chunk: each minute once, overlap and retries dedupe by key.
assert.deepEqual(minutesTouched(0, 8000), [0]);
assert.deepEqual(minutesTouched(54000, 20000), [0, 1]);
assert.deepEqual(minutesTouched(120000, 20000), [2]);
console.log('ok   minutes touched');

const USER = '11111111-2222-4333-8444-555555555555';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function world({ env = {}, used = 0, failFirst = false } = {}) {
  const state = { calls: [], records: [], openai: 0 };
  const fetch = async (url, init = {}) => {
    state.calls.push(url);
    if (url.endsWith('/billing/status')) return init.headers.Authorization === AUTH ? json({ plan: 'free', features: { lecture_minute: { limit: 120 } } }) : json({}, 401);
    if (url.endsWith('/rpc/feature_usage_counts')) return json([{ feature: 'lecture_minute', used }]);
    if (url.endsWith('/rpc/record_feature_usage')) { state.records.push(JSON.parse(init.body).p_request_key); return json(true); }
    if (url === 'https://api.openai.com/v1/audio/transcriptions') {
      state.openai += 1;
      assert.equal(init.headers.Authorization, 'Bearer sk-test');
      assert.equal(init.body.get('model'), 'gpt-4o-mini-transcribe');
      state.prompt = init.body.get('prompt');
      if (failFirst && state.openai === 1) return json({ error: 'busy' }, 500);
      return json({ text: ' The cell makes energy. ' });
    }
    if (url === 'https://api.openai.com/v1/chat/completions') {
      const body = JSON.parse(init.body);
      if (body.response_format) return json({ choices: [{ message: { content: JSON.stringify({ notes: [{ kind: 'exam', text: 'ATP is on the test', at_ms: 25000 }, { kind: 'bogus', text: 'x' }], class_id: 'f1' }) } }] });
      return json({ choices: [{ message: { content: '"Cell Energy and ATP."' } }] });
    }
    throw new Error(`unexpected ${url}`);
  };
  const service = createLectureService({ env: { OPENAI_API_KEY: 'sk-test', NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...env }, fetch, sleep: async () => {} });
  return { service, state };
}

const chunkArgs = { audio: Buffer.alloc(5000), contentType: 'audio/webm;codecs=opus', recordingId: 'rec_abcdefgh1234', seq: 3, startMs: 54000, durationMs: 20000, prompt: 'Terms: ATP\nthe cell' };

{
  const { service, state } = world();
  const result = await service.chunk(AUTH, chunkArgs);
  assert.equal(result.status, 200);
  assert.equal(result.body.text, 'The cell makes energy.');
  assert.equal(state.prompt, 'Terms: ATP\nthe cell');
  assert.deepEqual(state.records, ['lecture_minute:rec_abcdefgh1234:0', 'lecture_minute:rec_abcdefgh1234:1']);
  console.log('ok   chunk transcribes with prompt and charges each minute once');
}
{
  const { service, state } = world({ failFirst: true });
  assert.equal((await service.chunk(AUTH, chunkArgs)).status, 200);
  assert.equal(state.openai, 2);
  console.log('ok   one retry on a server error');
}
{
  const { service } = world({ env: { OPENAI_API_KEY: '' } });
  const result = await service.chunk(AUTH, chunkArgs);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not_configured');
  console.log('ok   503 (not retried forever) when the key is missing');
}
{
  const { service, state } = world({ used: 120 });
  assert.equal((await service.chunk(AUTH, chunkArgs)).status, 402);
  assert.equal(state.openai, 0);
  const usage = await world({ used: 36 }).service.usage(AUTH);
  assert.equal(usage.body.minutes_left, 84);
  console.log('ok   minute limit and "84 min left"');
}
{
  const { service, state } = world({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
  assert.equal((await service.chunk(AUTH, chunkArgs)).status, 200);
  assert.equal(state.records.length, 0);
  assert.equal((await service.usage(AUTH)).body.metered, false);
  console.log('ok   works without metering until Supabase is set up');
}
{
  const { service } = world();
  assert.equal((await service.chunk('Bearer nope', chunkArgs)).status, 401);
  assert.equal((await service.chunk(AUTH, { ...chunkArgs, contentType: 'text/plain' })).status, 415);
  assert.equal((await service.chunk(AUTH, { ...chunkArgs, recordingId: 'x' })).status, 400);
  console.log('ok   auth, type and id checks');
}
{
  const { service } = world();
  const notes = await service.notes(AUTH, { segments: [{ start_ms: 20000, text: 'ATP will be on the test.' }, { start_ms: 40000, text: 'Next topic.' }], classes: [{ id: 'f1', name: 'Biology' }] });
  assert.deepEqual(notes.body, { notes: [{ kind: 'exam', text: 'ATP is on the test', at_ms: 20000 }], class_id: 'f1' });
  const title = await service.title(AUTH, { text: 'The mitochondria makes ATP. '.repeat(5) });
  assert.equal(title.body.title, 'Cell Energy and ATP');
  console.log('ok   notes snap to timestamps; title is cleaned');
}
// Whisper's inventions over music, games and noise are dropped (a class review game played music).
assert.equal(collapseLoops('Tm. Tm. Tm. Tm. What is the king supposed to do? Tm. Tm. Tm.'), "Tm. What is the king supposed to do? Tm.");
assert.equal(collapseLoops('音楽 音楽 音楽 音楽音楽 音楽 So the point of that story'), 'So the point of that story');
assert.equal(collapseLoops('R. R. R. R. R. R. R. R.'), 'R.');
assert.equal(cleanSpokenText('No, no, no. It was in 1000 BC with 10000 people, Mississippi.'), 'No, no, no. It was in 1000 BC with 10000 people, Mississippi.');
assert.equal(keepWhisperSegment({ text: ' Hannah was Samuel’s mother.', avg_logprob: -0.25, compression_ratio: 1.2, no_speech_prob: 0.03 }), true);
assert.equal(keepWhisperSegment({ text: ' Tm. Tm. Tm. Tm. Tm.', avg_logprob: -0.3, compression_ratio: 3.9, no_speech_prob: 0.1 }), false, 'a loop');
assert.equal(keepWhisperSegment({ text: ' Good勢いのだと思っています。', avg_logprob: -1.3, compression_ratio: 1.1, no_speech_prob: 0.4 }), false, 'low confidence');
assert.equal(keepWhisperSegment({ text: ' I can do this.', avg_logprob: -0.4, compression_ratio: 1.0, no_speech_prob: 0.85 }), false, 'probably not speech');
assert.equal(keepWhisperSegment({ text: ' 音楽', avg_logprob: -0.2, compression_ratio: 0.4, no_speech_prob: 0.2 }), false, 'only a music marker');
assert.equal(whisperText({ text: 'ignored when segments come', segments: [
  { text: ' The cities of refuge protect someone who killed by accident.', avg_logprob: -0.2, compression_ratio: 1.3, no_speech_prob: 0.02 },
  { text: ' 音楽 音楽 音楽', avg_logprob: -0.3, compression_ratio: 0.6, no_speech_prob: 0.7 },
] }), 'The cities of refuge protect someone who killed by accident.');
assert.equal(whisperText({ text: ' Plain text from a model without segments. ' }), 'Plain text from a model without segments.');
console.log('ok   loops, music markers and low-confidence segments are dropped');

// With Groq's Whisper the service asks for segment confidence and strips a loop from the prompt,
// so a bad stretch is not copied into the next part.
{
  let sent = null;
  const fetch = async (url, init = {}) => {
    if (url.endsWith('/billing/status')) return json({ plan: 'free', features: { lecture_minute: { limit: 120 } } });
    if (url.endsWith('/rpc/feature_usage_counts')) return json([{ feature: 'lecture_minute', used: 0 }]);
    if (url.endsWith('/rpc/record_feature_usage')) return json(true);
    if (url === 'https://api.groq.com/openai/v1/audio/transcriptions') {
      sent = { model: init.body.get('model'), format: init.body.get('response_format'), prompt: init.body.get('prompt') };
      return json({ text: 'x', segments: [
        { text: ' Who was Israel’s first king? Saul.', avg_logprob: -0.3, compression_ratio: 1.2, no_speech_prob: 0.05 },
        { text: ' Juhlbam. Juhlbam. Juhlbam. Juhlbam. Juhlbam. Juhlbam.', avg_logprob: -0.5, compression_ratio: 5.2, no_speech_prob: 0.2 },
      ] });
    }
    throw new Error(`unexpected ${url}`);
  };
  const service = createLectureService({ env: { GROQ_API_KEY: 'gsk-test', NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' }, fetch, sleep: async () => {} });
  const result = await service.chunk(AUTH, { ...chunkArgs, prompt: 'Terms: covenant\nTm. Tm. Tm. Tm. Tm. Tm. so the point of that story' });
  assert.equal(result.status, 200);
  assert.equal(result.body.text, 'Who was Israel’s first king? Saul.');
  assert.deepEqual(sent, { model: 'whisper-large-v3-turbo', format: 'verbose_json', prompt: 'Terms: covenant\nTm. so the point of that story' });
  console.log('ok   Whisper chunks use segment confidence and a clean prompt');
}
console.log('lecture recording service ok');
