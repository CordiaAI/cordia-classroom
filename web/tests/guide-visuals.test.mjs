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
