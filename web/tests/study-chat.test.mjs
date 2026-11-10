// The chat workspace's tool loop (lib/server/studyChat.mjs): a tool call runs, its window is
// emitted, and the model's final words end the turn.
import assert from 'node:assert/strict';
import { runChatTurn, toolDefinitions } from '../lib/server/studyChat.mjs';

const names = toolDefinitions().map(tool => tool.name);
assert.ok(names.includes('show_quiz') && names.includes('get_study_set'));
assert.ok(!names.includes('get_progress'), 'connected-app-only tools stay out');

const quiz = { title: 'Check', questions: [{ question: 'Q?', options: ['a', 'b'], answer_index: 1, explanation: 'b.' }] };
const replies = [
  { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'show_quiz', input: quiz }], usage: { input_tokens: 10, output_tokens: 5 } },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here you go.' }], usage: { input_tokens: 12, output_tokens: 4 } },
];
const client = { messages: { create: async () => replies.shift() } };
const empty = { maybeSingle: async () => ({ data: null }) };
const db = { from: () => ({ select: () => ({ eq: () => empty }) }) };
const events = [];
await runChatTurn({ db, userId: 'u', timeZone: 'UTC' }, [{ role: 'user', content: 'quiz me' }], event => events.push(event), { client });

assert.deepEqual(events.map(event => event.type), ['tool', 'tool', 'window', 'text', 'done']);
assert.equal(events[2].kind, 'quiz');
assert.deepEqual(events[2].data, quiz);
assert.equal(events[4].usage.input_tokens, 22);
assert.equal(events[4].history.length, 4);
console.log('Study chat test passed');
