// Outline notes for a guide (/api/guide-notes) with a fake network: written once, saved to the
// guide, older flat notes rewritten as an outline, outline notes kept.
import assert from 'node:assert/strict';
import { createGuideNotesService, needsOutline, outlineText } from '../lib/server/guideNotes.mjs';
import { guideOutline, parseOutline } from '../lib/formatters.js';

const GID = 'a0000000-0000-4000-8000-000000000001';
const AUTH = 'Bearer token';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function world({ guide = { id: GID, title: 'Cell Biology', notes: null, study_guide: 'Q1: What makes ATP?\nA1: The mitochondria make ATP through respiration.\nQ2: What is osmosis?\nA2: Water moving across a membrane.' }, env = {} } = {}) {
  const state = { patches: [], chat: 0 };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url === `https://api.example.com/guides/${GID}` && method === 'GET') return init.headers.Authorization === AUTH ? json({ guide }) : json({}, 401);
    if (url === `https://api.example.com/guides/${GID}` && method === 'PATCH') { state.patches.push(JSON.parse(init.body)); return json({ guide: {} }); }
    if (url.startsWith('https://api.example.com/guides/')) return json({ detail: 'Not found' }, 404);
    if (url === 'https://api.openai.com/v1/chat/completions') { state.chat += 1; state.prompt = JSON.parse(init.body).messages[1].content; return json({ choices: [{ message: { content: JSON.stringify({ sections: [{ heading: 'Cell energy', points: ['The mitochondria make ATP through respiration.'] }, { heading: 'Membranes', points: ['Osmosis is water moving across a membrane.'] }] }) } }] }); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { service: createGuideNotesService({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', OPENAI_API_KEY: 'sk', ...env }, fetch }), state };
}

assert.equal(outlineText([{ heading: ' Energy ', points: ['  One  point ', ''] }, { heading: 'Empty', points: [] }]), '## Energy\n- One point');
assert.ok(needsOutline('- flat note') && needsOutline('') && !needsOutline('## Topic\n- point'));
assert.deepEqual(parseOutline('- loose\n## A\n- one\n- two\n## B\n- three'), [{ heading: '', points: ['loose'] }, { heading: 'A', points: ['one', 'two'] }, { heading: 'B', points: ['three'] }]);

{
  const { service, state } = world();
  const { status, body } = await service.make(AUTH, GID);
  assert.equal(status, 200);
  assert.equal(body.notes, '## Cell energy\n- The mitochondria make ATP through respiration.\n\n## Membranes\n- Osmosis is water moving across a membrane.');
  assert.deepEqual(state.patches, [{ title: 'Cell Biology', notes: body.notes }]);
  assert.ok(state.prompt.includes('What makes ATP?'));
  console.log('ok   notes written from the guide and saved to it');
}
{
  const { service, state } = world({ guide: { id: GID, title: 'X', notes: '## Topic\n- Already here', study_guide: 'Q1: a\nA1: b' } });
  assert.equal((await service.make(AUTH, GID)).body.notes, '## Topic\n- Already here');
  assert.equal(state.chat + state.patches.length, 0);
  const flat = world({ guide: { id: GID, title: 'X', notes: '- Old flat note about ATP', study_guide: 'Q1: What makes ATP?\nA1: Mitochondria.' } });
  assert.ok((await flat.service.make(AUTH, GID)).body.notes.startsWith('## '));
  assert.ok(flat.state.prompt.includes('Old flat note about ATP'), 'old notes not used as material');
  console.log('ok   outline notes kept; flat notes rewritten as an outline');
}
{
  const { service, state } = world({ env: { OPENAI_API_KEY: '' } });
  assert.equal((await service.make(AUTH, GID)).body.reason, 'not_configured');
  assert.equal(state.patches.length, 0);
  assert.equal((await service.make('Bearer bad', GID)).status, 401);
  assert.equal((await service.make(AUTH, 'not-a-guide')).status, 400);
  console.log('ok   no key, wrong sign-in and bad ids handled');
}
console.log('guide notes ok');
// Without written notes, Notes shows the guide's key points rather than nothing.
assert.deepEqual(guideOutline({ notes: '', study_guide: 'Q1: What is ATP?\nA1: The cell\'s energy carrier.\nQ2: Where is it made?\nA2: In the mitochondria.' }), [{ heading: 'Key points', points: ["The cell's energy carrier.", 'In the mitochondria.'] }]);
assert.deepEqual(guideOutline({ notes: '## A\n- one', study_guide: 'Q1: x\nA1: y' }), [{ heading: 'A', points: ['one'] }]);
console.log('ok   Notes falls back to the key points');
