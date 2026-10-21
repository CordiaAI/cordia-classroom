import test from 'node:test';
import assert from 'node:assert/strict';
import { aiChat } from '../lib/server/aiChat.mjs';
import { aiProvider, chatProvider } from '../lib/server/aiProvider.mjs';

test('writing goes to Claude when ANTHROPIC_API_KEY is set; audio stays with Whisper', () => {
  const env = { ANTHROPIC_API_KEY: 'ak', GROQ_API_KEY: 'gk' };
  assert.deepEqual(chatProvider(env), { name: 'anthropic', key: 'ak', chatModel: 'claude-sonnet-5-5' });
  assert.equal(chatProvider({ ...env, ANTHROPIC_MODEL: 'claude-haiku-5-5' }).chatModel, 'claude-haiku-5-5');
  assert.equal(chatProvider({ ...env, ANTHROPIC_MODEL: 'claude-sonnet-5-5' }).chatModel, 'claude-sonnet-5-5', 'never Opus');
  assert.equal(aiProvider(env).name, 'groq', 'transcription keeps Groq');
  assert.equal(chatProvider({ GROQ_API_KEY: 'gk' }).name, 'groq', 'without the key nothing changes');
});

test('a Claude call sends the Messages API request and reads only the text', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body), headers: init.headers };
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '```json\n{"title":"Osmosis"}\n```' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await aiChat(chatProvider({ ANTHROPIC_API_KEY: 'ak' }), { system: 'Title it.', user: 'Water moves.', maxTokens: 200, json: true, fetchImpl });
  assert.equal(out.text, '{"title":"Osmosis"}');
  assert.match(sent.url, /\/v1\/messages/);
  assert.equal(sent.body.model, 'claude-sonnet-5-5');
  assert.equal(sent.body.fallbacks, undefined, 'server-side fallbacks only go to Opus, which Classroom never uses');
  assert.equal(sent.body.output_config.effort, 'low');
  assert.ok(sent.body.max_tokens > 200, 'headroom for thinking');
  assert.equal(sent.body.temperature, undefined, 'Claude takes no sampling settings');
  assert.equal(sent.body.system.length, 1);
  assert.match(sent.body.system[0].text, /only the JSON object/);
});

test('a refused or failed Claude call returns null', async () => {
  const refuse = async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal(await aiChat(chatProvider({ ANTHROPIC_API_KEY: 'ak' }), { system: 's', user: 'u', maxTokens: 10, fetchImpl: refuse }), null);
  const broken = async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}', { status: 400, headers: { 'content-type': 'application/json' } });
  assert.equal(await aiChat(chatProvider({ ANTHROPIC_API_KEY: 'ak' }), { system: 's', user: 'u', maxTokens: 10, fetchImpl: broken }), null);
});
