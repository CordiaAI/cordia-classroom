// Photos on flashcards: only real images from a signed-in student, stored under their own folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardImages, sniffImage, MAX_BYTES } from '../lib/server/cardImages.mjs';

const USER = '11111111-2222-4333-8444-555555555555';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const AUTH = `Bearer ${b64({ alg: 'HS256' })}.${b64({ sub: USER })}.sig`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(20)]);
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;

function world({ storeStatus = 200, storeBody = '{}', signedIn = true } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/billing/status')) return new Response('{}', { status: signedIn ? 200 : 401 });
    if (url.includes('/storage/v1/object/card-images/')) return new Response(storeBody, { status: storeStatus });
    throw new Error(`unexpected ${url}`);
  };
  const service = createCardImages({ env: { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' }, fetch });
  return { service, calls };
}

test('the bytes decide the type, not the label', () => {
  assert.deepEqual(sniffImage(PNG), { type: 'image/png', ext: 'png' });
  assert.deepEqual(sniffImage(JPEG), { type: 'image/jpeg', ext: 'jpg' });
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('a photo is stored in the student\'s own folder and its public URL returned', async () => {
  const { service, calls } = world();
  // Labelled PNG, really a JPEG: stored as what it is.
  const result = await service.upload(AUTH, { image: dataUrl(JPEG, 'image/png') });
  assert.equal(result.status, 200);
  assert.match(result.body.url, new RegExp(`^https://db\\.example\\.co/storage/v1/object/public/card-images/${USER}/[0-9a-f-]{36}\\.jpg$`));
  const store = calls.find(call => call.url.includes('/storage/'));
  assert.equal(store.init.headers['Content-Type'], 'image/jpeg');
});

test('refuses strangers, non-images, SVG and oversized files', async () => {
  assert.equal((await world({ signedIn: false }).service.upload(AUTH, { image: dataUrl(PNG) })).status, 401);
  assert.equal((await world().service.upload('', { image: dataUrl(PNG) })).status, 401);
  assert.equal((await world().service.upload(AUTH, { image: 'https://example.com/x.png' })).status, 400);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  assert.equal((await world().service.upload(AUTH, { image: dataUrl(svg, 'image/svg+xml') })).status, 400);
  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_BYTES)]);
  assert.equal((await world().service.upload(AUTH, { image: dataUrl(huge) })).status, 413);
});

test('says photos are not set up until the bucket exists', async () => {
  const result = await world({ storeStatus: 400, storeBody: '{"error":"Bucket not found"}' }).service.upload(AUTH, { image: dataUrl(PNG) });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not_configured');
});
