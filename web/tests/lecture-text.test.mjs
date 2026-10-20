// Lecture transcript helpers and the /api/lectures service with a fake network.
import assert from 'node:assert/strict';
import { cleanSpokenText, mergeOverlap, mergedSegments, transcriptText } from '../lib/lectureText.mjs';
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
console.log('lecture recording service ok');
