// Which AI the web app's routes call: Groq when GROQ_API_KEY is set, otherwise OpenAI.
import assert from 'node:assert/strict';
import { aiProvider } from '../lib/server/aiProvider.mjs';
import { createGuideNotesService } from '../lib/server/guideNotes.mjs';
import { createLectureService } from '../lib/server/lectures.mjs';

assert.equal(aiProvider({ GROQ_API_KEY: 'gk', OPENAI_API_KEY: 'sk' }).name, 'groq', 'Groq first when both are set');
assert.deepEqual(aiProvider({ OPENAI_API_KEY: 'sk' }), { name: 'openai', key: 'sk', base: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', transcribeModel: 'gpt-4o-mini-transcribe' });
assert.equal(aiProvider({}).key, '', 'nothing set: not configured');
assert.equal(aiProvider({ GROQ_API_KEY: 'gk', GROQ_CHAT_MODEL: 'other' }).chatModel, 'other');
console.log('ok   provider choice');

const GID = 'a0000000-0000-4000-8000-000000000001';
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
{
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization, body: init.body });
    if (url.endsWith(`/guides/${GID}`) && (init.method || 'GET') === 'GET') return json({ guide: { id: GID, title: 'Cells', notes: '', study_guide: 'Q1: What makes ATP?\nA1: Mitochondria make ATP.' } });
    if (url.includes('/chat/completions')) return json({ choices: [{ message: { content: JSON.stringify({ sections: [{ heading: 'Energy', points: ['Mitochondria make ATP.'] }], key_points: ['Mitochondria make ATP.'] }) } }] });
    return json({ guide: {} });
  };
  const { body } = await createGuideNotesService({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', GROQ_API_KEY: 'gk' }, fetch }).make('Bearer t', GID);
  assert.ok(body.notes.includes('## Key points'));
  const chat = calls.find(call => call.url.includes('/chat/completions'));
  assert.equal(chat.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(chat.auth, 'Bearer gk');
  assert.equal(JSON.parse(chat.body).model, 'openai/gpt-oss-120b');
  console.log('ok   guide notes are written by Groq');
}
{
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: '11111111-2222-4333-8444-555555555555' })}.sig`;
  let transcription;
  const fetch = async (url, init = {}) => {
    if (url.endsWith('/billing/status')) return json({ plan: 'free' });
    if (url.endsWith('/audio/transcriptions')) { transcription = { url, auth: init.headers.Authorization, model: init.body.get('model') }; return json({ text: 'Cells make energy.' }); }
    throw new Error(`unexpected ${url}`);
  };
  const service = createLectureService({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', GROQ_API_KEY: 'gk' }, fetch });
  const { body } = await service.chunk(AUTH, { audio: Buffer.alloc(2000, 1), contentType: 'audio/webm', recordingId: 'rec-12345678', seq: 0, startMs: 0, durationMs: 20000 });
  assert.equal(body.text, 'Cells make energy.');
  assert.deepEqual(transcription, { url: 'https://api.groq.com/openai/v1/audio/transcriptions', auth: 'Bearer gk', model: 'whisper-large-v3-turbo' });
  assert.equal((await service.usage(AUTH)).body.ready, true, 'recording uses server transcription when Groq is set');
  console.log('ok   recordings are transcribed by Groq Whisper');
}
console.log('ai provider ok');
