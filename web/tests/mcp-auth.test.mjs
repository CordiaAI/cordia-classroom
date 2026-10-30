// The MCP endpoint's token checks, 401 challenge, origin rule and discovery document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createTokenVerifier } from '../lib/mcp/auth.mjs';
import { connectedAppHosts, mcpConfig } from '../lib/mcp/config.mjs';
import { createMcpEndpoint, protectedResourceMetadata } from '../lib/mcp/endpoint.mjs';

const ISSUER = 'https://project.supabase.co/auth/v1';
const AUDIENCE = 'https://classroom.cordiacode.com/mcp';
const USER = '11111111-1111-4111-8111-111111111111';
const config = { ...mcpConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', VERCEL_ENV: 'production' }) };

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair('ES256');

function sign(claims = {}, { key = privateKey, exp = '1h' } = {}) {
  const jwt = new SignJWT({ role: 'mcp_client', client_id: 'c0ffee00-0000-4000-8000-000000000000', scope: '', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? AUDIENCE)
    .setSubject(claims.sub ?? USER)
    .setIssuedAt();
  if (exp) jwt.setExpirationTime(exp);
  return jwt.sign(key);
}

let grantActive = true;
const verifier = createTokenVerifier(config, { keys, checkGrant: async () => grantActive });

test('config: issuer, audience and app hosts', () => {
  assert.equal(config.issuer, ISSUER);
  assert.equal(config.audience, AUDIENCE);
  assert.deepEqual(config.allowedOrigins, ['claude.ai', 'chatgpt.com']);
  assert.deepEqual(connectedAppHosts('', { production: false }), ['claude.ai', 'chatgpt.com', 'localhost', '127.0.0.1', '[::1]']);
  assert.deepEqual(connectedAppHosts('claude.ai', { production: true }), ['claude.ai']);
});

test('a connected-app token passes and names the student and the app', async () => {
  const info = await verifier.verifyAccessToken(await sign());
  assert.equal(info.extra.userId, USER);
  assert.equal(info.clientId, 'c0ffee00-0000-4000-8000-000000000000');
  assert.equal(info.resource.href, AUDIENCE);
  assert.ok(info.expiresAt > Date.now() / 1000);
});

test('app sign-ins, other issuers, expired, forged and disconnected tokens are refused', async () => {
  const cases = {
    'app sign-in token': await sign({ aud: 'authenticated', role: 'authenticated', client_id: undefined }),
    'app token with the MCP audience': await sign({ role: 'authenticated', client_id: undefined }),
    'client_id but app role (hook off)': await sign({ aud: 'authenticated', role: 'authenticated' }),
    'mcp_client without client_id': await sign({ client_id: '' }),
    'another issuer': await sign({ iss: 'https://evil.example/auth/v1' }),
    'another audience': await sign({ aud: 'https://evil.example/mcp' }),
    expired: await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }),
    'no expiry': await sign({}, { exp: null }),
    'signed with another key': await sign({}, { key: other.privateKey }),
    'not a uuid subject': await sign({ sub: 'someone' }),
    garbage: 'not.a.token',
  };
  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(verifier.verifyAccessToken(token), { code: 'invalid_token' }, name);
  }
  grantActive = false;
  await assert.rejects(verifier.verifyAccessToken(await sign()), /disconnected/);
  grantActive = true;
});

const endpoint = createMcpEndpoint(config, { verifier });
const rpc = (body, headers = {}) => new Request('https://classroom.cordiacode.com/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
});
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };

test('no token or a bad token: 401 with the RFC 9728 challenge', async () => {
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: `Bearer ${await sign({ aud: 'authenticated', role: 'authenticated', client_id: undefined })}` }]) {
    const response = await endpoint(rpc(initialize, headers));
    assert.equal(response.status, 401);
    const challenge = response.headers.get('www-authenticate');
    assert.match(challenge, /^Bearer /);
    assert.match(challenge, /resource_metadata="https:\/\/classroom\.cordiacode\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
  }
});

test('a valid token gets an MCP session', async () => {
  const response = await endpoint(rpc(initialize, { authorization: `Bearer ${await sign()}` }));
  assert.equal(response.status, 200);
  const text = await response.text();
  const message = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:')).slice(5));
  assert.equal(message.result.serverInfo.name, 'Cordia Classroom');
});

test('browser origins: allowed apps pass, others are refused before the token is read', async () => {
  const token = await sign();
  const evil = await endpoint(rpc(initialize, { authorization: `Bearer ${token}`, origin: 'https://evil.example' }));
  assert.equal(evil.status, 403);
  const claude = await endpoint(rpc(initialize, { authorization: `Bearer ${token}`, origin: 'https://claude.ai' }));
  assert.equal(claude.status, 200);
  assert.equal(claude.headers.get('access-control-allow-origin'), 'https://claude.ai');
  const preflight = await endpoint(new Request('https://classroom.cordiacode.com/mcp', { method: 'OPTIONS', headers: { origin: 'https://claude.ai' } }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
});

test('discovery document points at Supabase Auth for the URL the client used', () => {
  const metadata = protectedResourceMetadata(new Request('https://preview-abc.vercel.app/.well-known/oauth-protected-resource/mcp'), config);
  assert.deepEqual(metadata, {
    resource: 'https://preview-abc.vercel.app/mcp',
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
    resource_name: 'Cordia Classroom',
    resource_policy_uri: 'https://preview-abc.vercel.app/privacy',
  });
});
