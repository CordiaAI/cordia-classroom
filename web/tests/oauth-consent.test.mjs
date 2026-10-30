// The consent page's rules: which apps can be approved, and the Supabase Auth calls behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientName, oauthApi, redirectAllowed, redirectHostOf, redirectHosts } from '../lib/oauthConsent.mjs';
import { safeReturnTo } from '../lib/returnTo.mjs';

const production = redirectHosts({ configured: '', vercelEnv: 'production', nodeEnv: 'production' });
const preview = redirectHosts({ configured: '', vercelEnv: 'preview', nodeEnv: 'production' });

test('only Claude and ChatGPT callbacks can be approved in production', () => {
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback', production), true);
  assert.equal(redirectAllowed('https://chatgpt.com/connector_platform_oauth_redirect', production), true);
  for (const bad of [
    'http://claude.ai/api/mcp/auth_callback', // not https
    'https://claude.ai.evil.example/cb', // look-alike host
    'https://evil.example/claude.ai', // host in the path
    'https://user@evil.example/cb',
    'http://localhost:6274/oauth/callback', // MCP Inspector: preview only
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'javascript:alert(1)',
    '',
    undefined,
  ]) assert.equal(redirectAllowed(bad, production), false, String(bad));
});

test('preview and local builds also allow localhost, for MCP Inspector', () => {
  assert.equal(redirectAllowed('http://localhost:6274/oauth/callback', preview), true);
  assert.equal(redirectAllowed('http://127.0.0.1:6274/oauth/callback', preview), true);
  assert.equal(redirectAllowed('https://evil.example/cb', preview), false);
  assert.deepEqual(redirectHosts({ configured: 'claude.ai', vercelEnv: 'production' }), ['claude.ai']);
  assert.equal(redirectHosts({ configured: '', vercelEnv: '', nodeEnv: 'development' }).includes('localhost'), true);
});

test('labels shown on the page', () => {
  assert.equal(redirectHostOf('https://claude.ai/api/mcp/auth_callback'), 'claude.ai');
  assert.equal(redirectHostOf('nonsense'), '');
  assert.equal(clientName({ name: '  Claude ' }), 'Claude');
  assert.equal(clientName({}), 'This app');
  assert.equal(clientName({ name: 'x'.repeat(200) }).length, 60);
});

test('the consent page is a sign-in return path; nothing else new is', () => {
  assert.equal(safeReturnTo('/oauth/consent?authorization_id=abc-123_DEF'), '/oauth/consent?authorization_id=abc-123_DEF');
  for (const bad of ['/oauth/consent', '/oauth/consent?authorization_id=a&next=//evil.example', '/oauth/consent?authorization_id=<x>', '//evil.example/oauth/consent?authorization_id=a']) {
    assert.equal(safeReturnTo(bad), null, bad);
  }
});

test('calls go to Supabase Auth as the student, retrying once after a refresh', async () => {
  const calls = [];
  let token = 'old';
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
    return new Response(init.headers.Authorization === 'Bearer old' ? '{"msg":"expired"}' : '{"redirect_url":"https://claude.ai/api/mcp/auth_callback?code=x"}', { status: init.headers.Authorization === 'Bearer old' ? 401 : 200 });
  };
  const api = oauthApi({ supabaseUrl: 'https://p.supabase.co', publishableKey: 'pk', getToken: () => token, refresh: async () => { token = 'new'; return true; } });
  const result = await api.decide('abc', 'approve');
  assert.equal(result.ok, true);
  assert.equal(result.data.redirect_url, 'https://claude.ai/api/mcp/auth_callback?code=x');
  assert.deepEqual(calls.map(call => [call.url, call.method, call.auth]), [
    ['https://p.supabase.co/auth/v1/oauth/authorizations/abc/consent', 'POST', 'Bearer old'],
    ['https://p.supabase.co/auth/v1/oauth/authorizations/abc/consent', 'POST', 'Bearer new'],
  ]);
  assert.equal(calls[1].body, '{"action":"approve"}');
  calls.length = 0;
  await api.revoke('c/1');
  assert.equal(calls[0].url, 'https://p.supabase.co/auth/v1/user/oauth/grants?client_id=c%2F1');
  assert.equal(calls[0].method, 'DELETE');
});

test('the consent page and the Connected apps list are wired up', () => {
  const page = readFileSync(new URL('../pages/oauth/consent.js', import.meta.url), 'utf8');
  assert.match(page, /disabled=\{Boolean\(busy\) \|\| !state\.allowed\}/, 'Allow is disabled for hosts off the list');
  assert.match(page, /if \(redirectAllowed\(redirectUrl, HOSTS\)\) window\.location\.assign\(redirectUrl\)/, 'never redirects off the list');
  assert.match(page, /process\.env\.NEXT_PUBLIC_OAUTH_REDIRECT_HOSTS/);
  const app = readFileSync(new URL('../pages/_app.js', import.meta.url), 'utf8');
  assert.match(app, /'\/oauth\/consent'\]\.includes\(router\.pathname\)/, 'no app shell around the consent page');
  const settings = readFileSync(new URL('../pages/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /<ConnectedApps \/>/);
});
