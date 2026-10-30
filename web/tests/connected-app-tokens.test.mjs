// Tokens issued to connected apps (Claude and other MCP clients) never reach the app's API routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConnectedAppToken, withAppTokensOnly } from '../lib/server/connectedApps.mjs';

const web = join(fileURLToPath(import.meta.url), '..', '..');
const jwt = claims => `Bearer x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

test('connected-app tokens are recognised by client_id or the mcp_client role', () => {
  assert.equal(isConnectedAppToken(jwt({ sub: 'u', role: 'authenticated' })), false);
  assert.equal(isConnectedAppToken(jwt({ sub: 'u', role: 'mcp_client', client_id: 'c', aud: 'cordia-mcp' })), true);
  assert.equal(isConnectedAppToken(jwt({ sub: 'u', role: 'authenticated', client_id: 'c' })), true, 'hook switched off');
  assert.equal(isConnectedAppToken(jwt({ sub: 'u', role: 'mcp_client' })), true);
  assert.equal(isConnectedAppToken(''), false);
  assert.equal(isConnectedAppToken('Bearer not-a-jwt'), false);
});

test('the wrapper answers 401 before the handler runs', async () => {
  let ran = false;
  const handler = withAppTokensOnly(() => { ran = true; });
  const res = { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ headers: { authorization: jwt({ sub: 'u', client_id: 'c' }) } }, res);
  assert.equal(res.code, 401);
  assert.equal(ran, false);
  await handler({ headers: { authorization: jwt({ sub: 'u', role: 'authenticated' }) } }, res);
  assert.equal(ran, true);
});

function* apiFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* apiFiles(path);
    else if (/\.(js|mjs)$/.test(name)) yield path;
  }
}

test('every API route that reads a bearer token is wrapped', () => {
  const unwrapped = [];
  for (const path of apiFiles(join(web, 'pages', 'api'))) {
    const source = readFileSync(path, 'utf8');
    if (!/authorization/i.test(source)) continue;
    // The MCP server: the one route that takes connected-app tokens, and only those.
    if (relative(web, path) === join('pages', 'api', 'mcp.js')) continue;
    if (!/export default withAppTokensOnly\(/.test(source)) unwrapped.push(relative(web, path));
  }
  assert.deepEqual(unwrapped, []);
});
