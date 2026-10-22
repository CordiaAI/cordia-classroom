import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideVisualsService } from '../lib/server/guideVisuals.mjs';

const GUIDE = 'a0000000-0000-4000-8000-000000000001';
const USER = 'u0000000-0000-4000-8000-000000000001';
const SUPA = 'https://db.example.co';
const env = { NEXT_PUBLIC_SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'service', CLASSROOM_API_URL: 'https://api.example.com' };
const IMAGE = `${SUPA}/storage/v1/object/public/visuals/ab/abc/1.svg`;

function fakeFetch({ owns = true, table = true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (url.startsWith('https://api.example.com/guides/')) {
      return owns ? new Response(JSON.stringify({ guide: { id: GUIDE, user_id: USER } })) : new Response('{}', { status: 404 });
    }
    if (!table) return new Response('{"code":"PGRST205"}', { status: 404 });
    if ((init.method || 'GET') === 'POST') return new Response(JSON.stringify([{ id: 'v1', ...JSON.parse(init.body) }]), { status: 201 });
    if (init.method === 'DELETE') return new Response('', { status: 204 });
    return new Response(JSON.stringify([{ id: 'v1', section: 's0:Intro', url: IMAGE }]));
  };
  return { fetch, calls };
}

test('lists only after the Classroom API confirms the guide is the student\'s', async () => {
  const { fetch, calls } = fakeFetch();
  const out = await createGuideVisualsService({ env, fetch }).list({ authorization: 'Bearer t', guideId: GUIDE });
  assert.equal(out.body.stored, true);
  assert.equal(out.body.visuals.length, 1);
  assert.match(calls[1].url, new RegExp(`user_id=eq.${USER}&guide_id=eq.${GUIDE}`));
});

test('someone else\'s guide is not found and the table is never touched', async () => {
  const { fetch, calls } = fakeFetch({ owns: false });
  const out = await createGuideVisualsService({ env, fetch }).list({ authorization: 'Bearer t', guideId: GUIDE });
  assert.equal(out.httpStatus, 404);
  assert.equal(calls.length, 1);
});

test('keeps only images Cordia stored itself', async () => {
  const { fetch } = fakeFetch();
  const service = createGuideVisualsService({ env, fetch });
  const bad = await service.keep({ authorization: 'Bearer t', guideId: GUIDE, url: 'https://evil.example/x.svg' });
  assert.equal(bad.httpStatus, 400);
  const good = await service.keep({ authorization: 'Bearer t', guideId: GUIDE, section: 's1:Active transport', anchor: 'Uses ATP', url: IMAGE, theme: 'dark' });
  assert.equal(good.body.visual.user_id, USER);
  assert.equal(good.body.visual.theme, 'dark');
});

test('before the migration runs, answers stored: false so the browser keeps them', async () => {
  const { fetch } = fakeFetch({ table: false });
  const out = await createGuideVisualsService({ env, fetch }).list({ authorization: 'Bearer t', guideId: GUIDE });
  assert.deepEqual(out.body, { stored: false });
});

test('before the visuals bucket exists, the drawing itself (inline SVG) can be kept', async () => {
  const { fetch } = fakeFetch();
  const service = createGuideVisualsService({ env, fetch });
  const inline = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
  assert.equal((await service.keep({ authorization: 'Bearer t', guideId: GUIDE, anchor: 'Uses ATP', url: inline })).body.visual.url, inline);
  assert.equal((await service.keep({ authorization: 'Bearer t', guideId: GUIDE, url: 'data:text/html;base64,PHNjcmlwdD4=' })).httpStatus, 400);
});

const VISUAL = 'b0000000-0000-4000-8000-000000000002';

// A table with or without the width column (migration 20261022140000).
function patchFetch({ widthColumn = true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('https://api.example.com/guides/')) return new Response(JSON.stringify({ guide: { id: GUIDE, user_id: USER } }));
    const wantsWidth = method === 'PATCH' ? 'width' in JSON.parse(init.body) : /select=[^&]*width/.test(url);
    if (wantsWidth && !widthColumn) return new Response('{"code":"PGRST204"}', { status: 400 });
    if (method === 'PATCH') return new Response(JSON.stringify([{ id: VISUAL, ...JSON.parse(init.body) }]));
    return new Response(JSON.stringify([{ id: VISUAL, anchor: 'Diffusion', url: IMAGE }]));
  };
  return { fetch, calls };
}

test('a visual moves to another line and its size is kept, between 30% and 100%', async () => {
  const { fetch, calls } = patchFetch();
  const service = createGuideVisualsService({ env, fetch });
  const moved = await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL, anchor: 'Osmosis is diffusion of water', section: 'Passive transport' });
  assert.equal(moved.httpStatus, 200);
  assert.deepEqual(calls.at(-1).body, { anchor: 'Osmosis is diffusion of water', section: 'Passive transport' });
  assert.match(calls.at(-1).url, new RegExp(`id=eq.${VISUAL}&user_id=eq.${USER}&guide_id=eq.${GUIDE}`));
  const big = await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL, width: 140 });
  assert.equal(calls.at(-1).body.width, 100);
  assert.equal(big.body.widthStored, true);
  await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL, width: 5 });
  assert.equal(calls.at(-1).body.width, 30);
  assert.equal((await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: 'nope', width: 50 })).httpStatus, 400);
  assert.equal((await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL })).httpStatus, 400);
});

test('before the width column exists: moves still save, sizes are left to the browser, and listing works', async () => {
  const { fetch, calls } = patchFetch({ widthColumn: false });
  const service = createGuideVisualsService({ env, fetch });
  const both = await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL, anchor: 'Osmosis', width: 60 });
  assert.equal(both.httpStatus, 200);
  assert.equal(both.body.widthStored, false);
  assert.deepEqual(calls.at(-1).body, { anchor: 'Osmosis' }, 'the move is saved without the width');
  const sizeOnly = await service.update({ authorization: 'Bearer t', guideId: GUIDE, id: VISUAL, width: 60 });
  assert.equal(sizeOnly.httpStatus, 200);
  assert.equal(sizeOnly.body.widthStored, false);
  const listed = await service.list({ authorization: 'Bearer t', guideId: GUIDE });
  assert.equal(listed.body.stored, true);
  assert.equal(listed.body.visuals.length, 1);
});
