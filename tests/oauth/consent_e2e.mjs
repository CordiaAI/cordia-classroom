// Browser end-to-end for MCP Phase 1, against a LOCAL Supabase stack and a local `next start` of
// web/ (run by `E2E_WEB=1 bash tests/oauth/run_local_probe.sh`). An app registers itself the way
// Claude does, a signed-out student is sent to sign in, then approves on the consent page; the
// app's token works on /mcp; Settings lists the app and Disconnect cuts it off. An app whose
// callback isn't on the allow-list can't be approved. Screenshots go to $SHOTS when set; CHROMIUM
// points at a browser binary when Playwright's own isn't installed.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const { createClient } = await import(new URL('../../web/node_modules/@supabase/supabase-js/dist/index.mjs', import.meta.url));

const { API, ANON, WEB, SHOTS } = process.env;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const b64u = buffer => Buffer.from(buffer).toString('base64url');
const INSPECTOR = 'http://localhost:6274/oauth/callback';

const app = createClient(API, ANON, { auth: { persistSession: false } });
const email = `consent${Date.now()}@example.test`;
const { data: signUp, error } = await app.auth.signUp({ email, password: 'correct-horse-9' });
if (error) throw error;

async function register(name, redirect) {
  const response = await fetch(`${API}/auth/v1/oauth/clients/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  return response.json();
}
async function authorize(client, redirect) {
  const verifier = b64u(crypto.randomBytes(32));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const response = await fetch(`${API}/auth/v1/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st', resource: `${WEB}/mcp` })}`, { redirect: 'manual' });
  return { verifier, consentUrl: response.headers.get('location') };
}

// CHROMIUM: a browser binary to use instead of Playwright's own download.
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// The local stack is plain http, which the production CSP (https Supabase only) would block.
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const browserLog = [];
page.on('pageerror', error => console.log(`page error: ${error.message}`));
page.on('console', message => browserLog.push(`console ${message.type()}: ${message.text().slice(0, 200)}`));
page.on('requestfailed', request => browserLog.push(`request failed: ${request.url()} ${request.failure()?.errorText}`));
page.on('response', response => { if (response.url().startsWith(API)) console.log(`  ${response.request().method()} ${response.url().replace(API, '')} -> ${response.status()}`); });
// On any failure, say where the page was and what it showed.
const onFailure = async error => {
  console.log(`FAIL  ${error.message.split('\n')[0]}`);
  try { console.log(`  at ${page.url()}\n  page says: ${(await page.locator('body').innerText()).slice(0, 400).replace(/\s+/g, ' ')}`); await shot('failure'); } catch { /* page gone */ }
  console.log(browserLog.slice(-25).map(line => `  ${line}`).join('\n'));
  process.exit(1);
};
process.on('uncaughtException', onFailure);
process.on('unhandledRejection', onFailure);
const shot = async (name, target = page) => { if (SHOTS) await target.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

// 1. Discovery and the 401 challenge on the real Next routes.
const metadata = await (await fetch(`${WEB}/.well-known/oauth-protected-resource/mcp`)).json();
check('discovery: resource and authorization server', metadata.resource === `${WEB}/mcp` && metadata.authorization_servers?.[0] === `${API}/auth/v1`, JSON.stringify(metadata));
const challenge = await fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
check('/mcp without a token: 401 + challenge', challenge.status === 401 && (challenge.headers.get('www-authenticate') || '').includes(`resource_metadata="${WEB}/.well-known/oauth-protected-resource/mcp"`), challenge.headers.get('www-authenticate'));

// 2. Signed out: the consent link goes through sign-in and back.
const inspector = await register('MCP Inspector', INSPECTOR);
const first = await authorize(inspector, INSPECTOR);
check('authorize sends the student to /oauth/consent', first.consentUrl?.startsWith(`${WEB}/oauth/consent?authorization_id=`), first.consentUrl);
await page.goto(first.consentUrl);
await page.waitForURL(/\/login\?next=/, { waitUntil: 'commit' });
check('signed out: sent to sign in with the way back', decodeURIComponent(page.url()).includes('/login?next=/oauth/consent?authorization_id='), page.url());

// Sign in (as the app's own sign-in does) and come back.
await page.evaluate(({ token, refresh, mail }) => { localStorage.setItem('authToken', token); localStorage.setItem('refreshToken', refresh); localStorage.setItem('userEmail', mail); }, { token: signUp.session.access_token, refresh: signUp.session.refresh_token, mail: email });
await page.goto(first.consentUrl);
await page.getByRole('heading', { name: 'Connect MCP Inspector to Cordia?' }).waitFor();
check('consent: client name, account and return host shown', await page.getByText(email).isVisible() && await page.getByText('localhost', { exact: true }).isVisible());
check('consent: what it can and can’t do', await page.getByText('See your Canvas or other LMS data').isVisible() && await page.getByText('Record your flashcard and quiz answers').isVisible());
await shot('consent-desktop');

let code = '';
await page.route('http://localhost:6274/**', route => { code = new URL(route.request().url()).searchParams.get('code') || ''; route.fulfill({ status: 200, body: 'ok' }); });
await page.getByRole('button', { name: 'Allow' }).click();
await page.waitForURL(/localhost:6274/, { waitUntil: 'commit' });
check('Allow: back to the app with a code', Boolean(code));
const tokens = await (await fetch(`${API}/auth/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: first.verifier, client_id: inspector.client_id, redirect_uri: INSPECTOR }) })).json();
check('token exchange', Boolean(tokens.access_token), JSON.stringify(tokens).slice(0, 120));

// 3. The token works on the real /mcp route.
const mcp = token => fetch(`${WEB}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } }) });
const connected = await mcp(tokens.access_token);
check('/mcp with the connected token: 200 Cordia Classroom', connected.status === 200 && (await connected.text()).includes('Cordia Classroom'), String(connected.status));
const appTokenTry = await mcp(signUp.session.access_token);
check('/mcp with the app sign-in token: 401', appTokenTry.status === 401, String(appTokenTry.status));

// 4. An app with a callback off the allow-list can't be approved.
const evil = await register('Totally Claude', 'https://evil.example/cb');
const second = await authorize(evil, 'https://evil.example/cb');
await page.goto(second.consentUrl);
await page.getByRole('heading', { name: 'Connect Totally Claude to Cordia?' }).waitFor();
check('consent: unknown host warned and Allow disabled', await page.getByRole('alert').isVisible() && await page.getByRole('button', { name: 'Allow' }).isDisabled());
await shot('consent-blocked');
let leftForEvil = false;
await page.route('https://evil.example/**', route => { leftForEvil = true; route.abort(); });
await page.getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('heading', { name: 'Can’t connect this app' }).waitFor();
check('Cancel on a blocked app never redirects there', !leftForEvil);

// 5. Phone, dark theme.
const phone = await browser.newContext({ bypassCSP: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const phonePage = await phone.newPage();
await phonePage.goto(`${WEB}/login`);
await phonePage.evaluate(({ token, refresh }) => { localStorage.setItem('authToken', token); localStorage.setItem('refreshToken', refresh); localStorage.setItem('theme', 'dark'); }, { token: signUp.session.access_token, refresh: signUp.session.refresh_token });
const third = await authorize(inspector, INSPECTOR);
await phonePage.goto(third.consentUrl);
await phonePage.getByRole('heading', { name: /Connect MCP Inspector/ }).waitFor().catch(() => {});
// Already approved once: Supabase may send the student straight back instead.
const overflow = await phonePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('phone: no sideways scroll', overflow <= 0, String(overflow));
await shot('consent-phone-dark', phonePage);
await phone.close();

// 6. Settings › Connectors lists the app; Disconnect cuts it off at once.
await page.goto(`${WEB}/settings?section=connectors`);
await page.getByRole('heading', { name: 'Connected AI apps' }).waitFor();
await page.getByText('MCP Inspector').waitFor();
check('Settings: app listed with last use', await page.getByText(/Last used/).isVisible());
await page.getByRole('heading', { name: 'Connected AI apps' }).scrollIntoViewIfNeeded();
await shot('settings-connected-apps');
await page.getByRole('button', { name: 'Disconnect MCP Inspector' }).click();
await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
await page.getByText('MCP Inspector was disconnected.').waitFor();
const after = await mcp(tokens.access_token);
check('/mcp right after Disconnect: 401', after.status === 401, String(after.status));

await browser.close();
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
