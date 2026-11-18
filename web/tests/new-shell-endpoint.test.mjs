// GET /api/new-shell (lib/server/newShell.mjs createShellRoute): the server checks the caller's
// access token with the Classroom API and answers one boolean. Sample ids and emails are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShellRoute } from '../lib/server/newShell.mjs';

const LISTED = { id: '6f1d2c3b-9a8e-4d7c-b6a5-0e1f2a3b4c5d', email: 'sample.student@example.edu' };
const UNLISTED = { id: '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d', email: 'another.student@example.edu' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const bearer = (claims = {}) => `Bearer ${b64({ alg: 'ES256' })}.${b64({ sub: 'claimed-by-browser', ...claims })}.sig`;
const TOKENS = { [bearer({ n: 1 })]: LISTED, [bearer({ n: 2 })]: UNLISTED };
const [LISTED_TOKEN, UNLISTED_TOKEN] = Object.keys(TOKENS);

// A Classroom API whose /auth/me knows the two tokens above; `down` answers 502.
function world(value, { vercelEnv = 'production', nodeEnv = 'production', down = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, authorization: init.headers?.Authorization });
    assert.equal(url, 'https://api.example.com/auth/me');
    if (down) return new Response('bad gateway', { status: 502 });
    const user = TOKENS[init.headers?.Authorization];
    if (!user) return new Response(JSON.stringify({ detail: 'Invalid token' }), { status: 401 });
    return new Response(JSON.stringify({ user_id: user.id, email: user.email, name: 'Sample Student' }), { status: 200 });
  };
  const env = { NEXT_PUBLIC_API_URL: 'https://api.example.com', CORDIA_NEW_SHELL: value, VERCEL_ENV: vercelEnv, NODE_ENV: nodeEnv };
  return { route: createShellRoute({ env, fetch }), env, calls };
}

async function call(route, { authorization, method = 'GET' } = {}) {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  await route({ method, headers: authorization ? { authorization } : {} }, res);
  return res;
}

const answer = async (value, authorization, options) => (await call(world(value, options).route, { authorization })).body.newShell;

test('the answer is exactly one boolean, never cached by a shared cache', async () => {
  for (const [value, authorization] of [[LISTED.id, LISTED_TOKEN], [LISTED.id, UNLISTED_TOKEN], ['all', ''], ['', LISTED_TOKEN]]) {
    const res = await call(world(value).route, { authorization });
    assert.deepEqual(Object.keys(res.body), ['newShell']);
    assert.equal(typeof res.body.newShell, 'boolean');
    assert.equal(res.headers['cache-control'], 'private, no-store');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(LISTED.id) && !text.includes(LISTED.email) && !text.includes(UNLISTED.id));
  }
  const post = await call(world('all').route, { authorization: LISTED_TOKEN, method: 'POST' });
  assert.equal(post.statusCode, 405);
  assert.deepEqual(post.body, { newShell: false });
});

test('unset is off for everyone in production, without a call to the API', async () => {
  const { route, calls } = world(undefined);
  const res = await call(route, { authorization: LISTED_TOKEN });
  assert.deepEqual([res.statusCode, res.body], [200, { newShell: false }]);
  assert.equal(calls.length, 0);
});

test('off is off everywhere, development and preview included', async () => {
  assert.equal(await answer('off', LISTED_TOKEN), false);
  assert.equal(await answer('off', LISTED_TOKEN, { vercelEnv: 'preview' }), false);
  assert.equal(await answer('off', LISTED_TOKEN, { nodeEnv: 'development' }), false);
});

test('all is on for every signed-in account', async () => {
  assert.equal(await answer('all', LISTED_TOKEN), true);
  assert.equal(await answer('all', UNLISTED_TOKEN), true);
});

test('a list is on for the accounts on it, by verified user id or email, and no one else', async () => {
  assert.equal(await answer(LISTED.id, LISTED_TOKEN), true);
  assert.equal(await answer(` ${LISTED.id.toUpperCase()} , someone@example.org`, LISTED_TOKEN), true);
  assert.equal(await answer(LISTED.email.toUpperCase(), LISTED_TOKEN), true);
  assert.equal(await answer(LISTED.id, UNLISTED_TOKEN), false);
  assert.equal(await answer(`${LISTED.id},${LISTED.email}`, UNLISTED_TOKEN), false);
  // The id the browser claims in its token is never what is compared: only /auth/me's answer.
  assert.equal(await answer('claimed-by-browser', UNLISTED_TOKEN), false);
});

test('development and preview deployments are on for every signed-in account', async () => {
  assert.equal(await answer('', UNLISTED_TOKEN, { nodeEnv: 'development' }), true);
  assert.equal(await answer('', UNLISTED_TOKEN, { vercelEnv: 'preview' }), true);
  assert.equal(await answer(LISTED.id, UNLISTED_TOKEN, { vercelEnv: 'preview' }), true);
});

test('signed-out, bad-token and connected-app callers get false', async () => {
  for (const value of [LISTED.id, 'all']) {
    const signedOut = await call(world(value).route, {});
    assert.deepEqual([signedOut.statusCode, signedOut.body], [401, { newShell: false }]);
    const forged = await call(world(value).route, { authorization: bearer({ sub: LISTED.id, email: LISTED.email }) });
    assert.deepEqual([forged.statusCode, forged.body], [401, { newShell: false }]);
    const { route, calls } = world(value);
    const app = await call(route, { authorization: bearer({ client_id: 'mcp-client', n: 1 }) });
    assert.deepEqual([app.statusCode, app.body], [401, { newShell: false }]);
    assert.equal(calls.length, 0);
  }
});

test('when the token cannot be checked the answer is false, marked as unchecked', async () => {
  const res = await call(world(LISTED.id, { down: true }).route, { authorization: LISTED_TOKEN });
  assert.deepEqual([res.statusCode, res.body], [503, { newShell: false }]);
  const thrown = createShellRoute({ env: { CORDIA_NEW_SHELL: 'all' }, fetch: async () => { throw new Error('offline'); } });
  const offline = await call(thrown, { authorization: LISTED_TOKEN });
  assert.deepEqual([offline.statusCode, offline.body], [503, { newShell: false }]);
});

test('the variable is read on every request, so a change needs no rebuild of the route', async () => {
  const { route, env } = world(UNLISTED.id);
  assert.equal((await call(route, { authorization: LISTED_TOKEN })).body.newShell, false);
  env.CORDIA_NEW_SHELL = LISTED.id;
  assert.equal((await call(route, { authorization: LISTED_TOKEN })).body.newShell, true);
  env.CORDIA_NEW_SHELL = 'off';
  assert.equal((await call(route, { authorization: LISTED_TOKEN })).body.newShell, false);
});
