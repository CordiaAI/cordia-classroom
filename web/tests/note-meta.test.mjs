// Note titles and Napkin covers (/api/notes) with a fake network: AI title saved to the note,
// first-line title without AI, typed titles kept, covers made once and remade when the note
// grows, short notes skipped, and only the student's own notes.
import assert from 'node:assert/strict';
import { createNoteMetaService, heuristicTitle, htmlToText, isDefaultTitle, needsCover } from '../lib/server/noteMeta.mjs';
import { sensibleTitle } from '../lib/noteMeta.mjs';
import { resetRateState } from '../lib/server/napkinVisual.mjs';

const USER = '11111111-2222-4333-8444-555555555555';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LONG = '<p>The earth is round and spins on its axis once a day.</p><p>It orbits the sun once a year, which gives us seasons because the axis is tilted.</p>';

function world({ note = { id: 'n1', title: 'Untitled Notes', content: LONG }, cover = null, env = {} } = {}) {
  const state = { puts: [], napkin: 0, saved: [], chat: 0 };
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url === 'https://api.example.com/smart_notes/n1' && method === 'GET') return init.headers.Authorization === AUTH ? json({ note }) : json({ detail: 'no' }, 401);
    if (url.startsWith('https://api.example.com/smart_notes/') && method === 'GET') return json({ detail: 'Note not found' }, 404);
    if (url === 'https://api.example.com/smart_notes/n1' && method === 'PUT') { state.puts.push(JSON.parse(init.body)); return json({ updated: true }); }
    if (url === 'https://api.example.com/billing/status') return json({ plan: 'free' });
    if (url === 'https://api.openai.com/v1/chat/completions') { state.chat += 1; return json({ choices: [{ message: { content: JSON.stringify({ title: 'Earth Rotation and Orbit', outline: 'Earth\n- spins daily\n- orbits yearly\n- tilt makes seasons' }) } }] }); }
    if (url.includes('/rest/v1/note_covers?note_id=')) return json(cover ? [cover] : []);
    if (url.endsWith('/rest/v1/note_covers')) { state.saved.push(JSON.parse(init.body)); return json(null, 201); }
    if (url.includes('/rpc/feature_usage_counts')) return json([]);
    if (url.includes('/rpc/record_feature_usage')) return json(true);
    if (url.includes('/rest/v1/visual_cache')) return json([]);
    if (url === 'https://api.napkin.ai/v1/visual') { state.napkin += 1; state.napkinBody = JSON.parse(init.body); return json({ id: 'r1', status: 'pending' }, 201); }
    if (url.endsWith('/v1/visual/r1/status')) return json({ status: 'completed', generated_files: [{ url: 'https://files.napkin.ai/r1/1.svg', width: 800, height: 600 }] });
    if (url.startsWith('https://files.napkin.ai/')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    if (url.includes('/storage/v1/object/visuals/')) return json({ Key: 'ok' });
    throw new Error(`unexpected ${method} ${url}`);
  };
  const service = createNoteMetaService({
    env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', NAPKIN_API_KEY: 'nk', OPENAI_API_KEY: 'sk', ...env },
    fetch, sleep: async () => {}, now: () => 0,
  });
  return { service, state };
}

resetRateState();
assert.equal(htmlToText('<p>A &amp; B</p><p>C</p>'), 'A & B\nC');
assert.equal(heuristicTitle('the earth is round. It spins.'), 'The earth is round');
assert.ok(isDefaultTitle('Untitled Notes') && isDefaultTitle('') && !isDefaultTitle('Biology week 3'));
assert.ok(needsCover(null, 200) && !needsCover(null, 50) && !needsCover({ url: 'x', content_length: 200 }, 250) && needsCover({ url: 'x', content_length: 200 }, 300));
const transcript = "particular job. I. Alright, so basically what they're gonna ask is about your experience.";
assert.equal(sensibleTitle('particular job. I. Alright', transcript), '', 'the opening words are not a title');
assert.equal(sensibleTitle('Answering Job Interview Questions', transcript), 'Answering Job Interview Questions');
assert.equal(sensibleTitle('"Cell Energy and ATP."', 'The mitochondria...'), 'Cell Energy and ATP');
assert.equal(sensibleTitle('one two three four five six seven eight nine ten eleven', ''), '');
console.log('ok   helpers');

{
  const { service, state } = world();
  const { status, body } = await service.meta(AUTH, { noteId: 'n1' });
  assert.equal(status, 200);
  assert.equal(body.title, 'Earth Rotation and Orbit');
  assert.deepEqual(state.puts, [{ title: 'Earth Rotation and Orbit' }]);
  assert.ok(body.cover.url.startsWith('https://db.example.co/storage/v1/object/public/visuals/'), 'cover not stored in our bucket');
  assert.equal(state.napkinBody.number_of_visuals, 1);
  assert.equal(state.napkinBody.color_mode, 'light');
  assert.equal(state.saved[0].note_id, 'n1');
  assert.equal(state.saved[0].user_id, USER);
  console.log('ok   AI title saved to the note; one-variation cover made and stored');
}
{
  const { service, state } = world({ env: { OPENAI_API_KEY: '' } });
  const { body } = await service.meta(AUTH, { noteId: 'n1', cover: false });
  assert.equal(body.title, 'The earth is round and spins');
  assert.equal(state.napkin, 0);
  console.log('ok   without AI, the first line becomes the title');
}
{
  const { service, state } = world({ note: { id: 'n1', title: 'Astronomy week 2', content: LONG } });
  const { body } = await service.meta(AUTH, { noteId: 'n1' });
  assert.equal(body.title, undefined);
  assert.equal(state.puts.length, 0, 'a typed title was replaced');
  assert.equal(state.napkinBody.content.includes('earth is round'), true, 'short note: the cover uses the note itself');
  console.log('ok   typed titles are kept');
}
{
  const { service, state } = world({ cover: { note_id: 'n1', url: 'https://db.example.co/x.svg', alt: 'Diagram', content_length: htmlToText(LONG).length } });
  const { body } = await service.meta(AUTH, { noteId: 'n1', title: false });
  assert.equal(state.napkin, 0, 'remade an up-to-date cover');
  assert.equal(body.cover.url, 'https://db.example.co/x.svg');
  console.log('ok   an up-to-date cover is not remade');
}
{
  const { service, state } = world({ note: { id: 'n1', title: 'Untitled Notes', content: '<p>Too short.</p>' } });
  assert.deepEqual((await service.meta(AUTH, { noteId: 'n1' })).body, { reason: 'short' });
  assert.equal(state.napkin + state.chat + state.puts.length, 0);
  const other = world();
  assert.equal((await other.service.meta(AUTH, { noteId: 'someone-elses' })).status, 404);
  assert.equal((await other.service.meta('Bearer bad', { noteId: 'n1' })).status, 401);
  console.log('ok   short notes skipped; only your own notes');
}
console.log('note titles and covers ok');
