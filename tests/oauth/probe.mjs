// End-to-end OAuth lockdown probe (run by tests/oauth/run_local_probe.sh against a LOCAL stack).
// A student signs up and fills Canvas, connector, Assistant, billing and Storage data; an OAuth
// client registers itself, the student approves, and the client's token then tries every surface.
// Every connected-app check must be refused; the app-token controls must succeed, which proves
// the data is really there. Exits 1 on any failure.
import crypto from 'node:crypto';

// The web app's own supabase-js (this script lives outside web/).
const { createClient } = await import(new URL('../../web/node_modules/@supabase/supabase-js/dist/index.mjs', import.meta.url));

const { API, ANON, SERVICE } = process.env;
const MCP_AUDIENCE = 'https://classroom.cordiacode.com/mcp';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const claimsOf = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const b64u = buffer => Buffer.from(buffer).toString('base64url');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = token => ({ apikey: ANON, Authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation' });
const refused = status => status === 401 || status === 403 || status === 404 || (status >= 400 && status < 500);

// The student, with data in every sensitive place.
const email = `student${Date.now()}@example.test`;
const password = 'correct-horse-9';
const app = createClient(API, ANON, { auth: { persistSession: false } });
const { data: signUp, error: signUpError } = await app.auth.signUp({ email, password });
if (signUpError) throw signUpError;
const appToken = signUp.session.access_token;
const student = createClient(API, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${appToken}` } } });
await student.auth.setSession({ access_token: appToken, refresh_token: signUp.session.refresh_token });
const SENSITIVE = {
  canvas_courses: { canvas_course_id: 1, name: 'BIO 101 Biology', current_grade: 'B+' },
  canvas_assignments: { title: 'Lab report', due_at: new Date().toISOString(), rubric: { points: 10 } },
  connector_settings: { connector: 'gmail', stats: { watch: true } },
  assistant_links: { phone: '+15555550100' },
  user_subscriptions: { plan: 'pro', stripe_customer_id: 'cus_test' },
};
for (const [table, row] of Object.entries(SENSITIVE)) {
  const { error } = await student.from(table).insert(row);
  check(`control: app token writes ${table}`, !error, error?.message);
}
const service = createClient(API, SERVICE, { auth: { persistSession: false } });
const objectPath = `${signUp.user.id}/card.png`;
const upload = await student.storage.from('card-images').upload(objectPath, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
check('control: app token uploads to Storage', !upload.error, upload.error?.message);

// An OAuth client registers itself (as Claude does), the student approves, the client gets a token.
const register = await fetch(`${API}/auth/v1/oauth/clients/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'Probe Client', redirect_uris: ['http://localhost:9999/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
const client = await register.json();
const verifier = b64u(crypto.randomBytes(32));
const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
const authorize = await fetch(`${API}/auth/v1/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'http://localhost:9999/cb', code_challenge: challenge, code_challenge_method: 'S256', state: 's' })}`, { redirect: 'manual' });
const authorizationId = new URL(authorize.headers.get('location'), 'http://x').searchParams.get('authorization_id');
// What the consent page does: load the request, then approve it.
const details = await student.auth.oauth.getAuthorizationDetails(authorizationId);
if (details.error) throw details.error;
const approved = await student.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
if (approved.error) throw approved.error;
const code = new URL(approved.data.redirect_url || approved.data.redirect_to).searchParams.get('code');
const exchange = await fetch(`${API}/auth/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: 'http://localhost:9999/cb' }) });
const tokens = await exchange.json();
const oauthToken = tokens.access_token;
const claims = claimsOf(oauthToken);
check('hook: role is mcp_client', claims.role === 'mcp_client', claims.role);
check('hook: aud is the MCP resource', claims.aud === MCP_AUDIENCE, claims.aud);
check('hook: client_id kept', Boolean(claims.client_id));
const refreshed = await (await fetch(`${API}/auth/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id }) })).json();
check('hook: refreshed token keeps mcp_client', refreshed.access_token && claimsOf(refreshed.access_token).role === 'mcp_client');

// REST: read and write every sensitive table.
for (const table of [...Object.keys(SENSITIVE), 'canvas_tokens', 'user_profiles', 'study_guides']) {
  const appRead = await fetch(`${API}/rest/v1/${table}?select=*`, { headers: headers(appToken) });
  const read = await fetch(`${API}/rest/v1/${table}?select=*`, { headers: headers(oauthToken) });
  const write = await fetch(`${API}/rest/v1/${table}`, { method: 'POST', headers: headers(oauthToken), body: JSON.stringify({}) });
  check(`REST ${table}: oauth read refused`, refused(read.status), `${read.status}; app read ${appRead.status}`);
  check(`REST ${table}: oauth write refused`, refused(write.status), String(write.status));
}
const appCanvas = await (await fetch(`${API}/rest/v1/canvas_courses?select=name`, { headers: headers(appToken) })).json();
check('control: app token reads its Canvas rows', Array.isArray(appCanvas) && appCanvas.length === 1);

// user_profiles: the app token can no longer create someone else's profile.
const otherProfile = await fetch(`${API}/rest/v1/user_profiles`, { method: 'POST', headers: headers(appToken), body: JSON.stringify({ id: crypto.randomUUID(), email: 'x@example.test' }) });
check('user_profiles: app token cannot insert another id', refused(otherProfile.status), String(otherProfile.status));

// RPC: a SECURITY DEFINER function and the hook itself.
for (const [fn, body] of [['is_class_member', { target_class: crypto.randomUUID() }], ['custom_access_token_hook', { event: {} }]]) {
  const call = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(oauthToken), body: JSON.stringify(body) });
  check(`RPC ${fn}: oauth refused`, refused(call.status), String(call.status));
}

// Storage: list, download, upload, list buckets.
const listObjects = await fetch(`${API}/storage/v1/object/list/card-images`, { method: 'POST', headers: headers(oauthToken), body: JSON.stringify({ prefix: signUp.user.id }) });
const download = await fetch(`${API}/storage/v1/object/authenticated/card-images/${objectPath}`, { headers: headers(oauthToken) });
const put = await fetch(`${API}/storage/v1/object/card-images/${signUp.user.id}/x.png`, { method: 'POST', headers: { ...headers(oauthToken), 'content-type': 'image/png' }, body: new Uint8Array([1]) });
const buckets = await fetch(`${API}/storage/v1/bucket`, { headers: headers(oauthToken) });
const appDownload = await fetch(`${API}/storage/v1/object/authenticated/card-images/${objectPath}`, { headers: headers(appToken) });
check('Storage list: oauth refused', refused(listObjects.status) || (await listObjects.clone().text()) === '[]', String(listObjects.status));
check('Storage download: oauth refused', refused(download.status), String(download.status));
check('Storage upload: oauth refused', refused(put.status), String(put.status));
check('Storage buckets: oauth refused', refused(buckets.status), String(buckets.status));
check('control: app token downloads its object', appDownload.status === 200, String(appDownload.status));

// GraphQL.
const graphql = await fetch(`${API}/graphql/v1`, { method: 'POST', headers: headers(oauthToken), body: JSON.stringify({ query: '{ __typename }' }) });
check('GraphQL: oauth refused', refused(graphql.status), String(graphql.status));

// Realtime: Postgres changes and a private broadcast channel.
async function changesFor(token, table) {
  const listener = createClient(API, ANON, { auth: { persistSession: false } });
  await listener.realtime.setAuth(token);
  const events = [];
  const denied = [];
  let status = '';
  const channel = listener.channel(`probe-${table}-${Math.random()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, payload => { if (!payload.errors?.length && Object.keys(payload.new || {}).length) events.push(payload); else denied.push(payload); })
    .subscribe(next => { status = next; });
  for (let i = 0; i < 40 && status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR'; i++) await sleep(250);
  await sleep(1000);
  return { events, denied, status: () => status, stop: () => listener.removeChannel(channel) };
}
for (const table of ['canvas_courses', 'study_guides']) {
  const asApp = await changesFor(appToken, table);
  const asOAuth = await changesFor(oauthToken, table);
  if (process.env.DEBUG_REALTIME && process.env.DB_URL) {
    const { execFileSync } = await import('node:child_process');
    console.log(execFileSync('psql', [process.env.DB_URL, '-At', '-c', "select entity::regclass, claims_role::text, claims->>'role', claims->>'client_id' is not null from realtime.subscription"]).toString());
  }
  await student.from(table).insert(table === 'canvas_courses' ? { canvas_course_id: 2, name: 'HIST 210' } : { title: 'Cells' });
  // Wait for the app's own copy of the change (up to 10s), then a moment more for any leak.
  for (let i = 0; i < 40 && !asApp.events.length; i++) await sleep(250);
  await sleep(1000);
  if (process.env.DEBUG_REALTIME) console.log(table, 'oauth events:', JSON.stringify(asOAuth.events).slice(0, 300));
  check(`control: app token gets ${table} changes`, asApp.events.length > 0, asApp.status());
  check(`Realtime ${table} changes: oauth gets no row data`, asOAuth.events.length === 0, `${asOAuth.status()}, ${asOAuth.events.length} with data, ${asOAuth.denied.length} denied notices`);
  await asApp.stop(); await asOAuth.stop();
}
{
  const listener = createClient(API, ANON, { auth: { persistSession: false } });
  await listener.realtime.setAuth(oauthToken);
  let status = '';
  const channel = listener.channel('private-room', { config: { private: true } }).subscribe(next => { status = next; });
  for (let i = 0; i < 40 && status !== 'SUBSCRIBED' && status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT'; i++) await sleep(250);
  check('Realtime private channel: oauth refused', status !== 'SUBSCRIBED', status);
  await listener.removeChannel(channel);
}

// Supabase Auth endpoints: the detached session makes all of these refuse.
const authCalls = [
  ['GET /user', 'GET', '/auth/v1/user'],
  ['PUT /user password', 'PUT', '/auth/v1/user', { password: 'stolen-pass-123' }],
  ['PUT /user email', 'PUT', '/auth/v1/user', { email: `changed${Date.now()}@example.test` }],
  ['PUT /user metadata', 'PUT', '/auth/v1/user', { data: { cordia: { hacked: true } } }],
  ['GET grants', 'GET', '/auth/v1/user/oauth/grants'],
  ['POST logout (global)', 'POST', '/auth/v1/logout?scope=global'],
];
for (const [name, method, path, body] of authCalls) {
  const response = await fetch(`${API}${path}`, { method, headers: headers(oauthToken), body: body ? JSON.stringify(body) : undefined });
  check(`Auth ${name}: oauth refused`, refused(response.status), String(response.status));
}
const signIn = await app.auth.signInWithPassword({ email, password });
check('control: original password still works', !signIn.error, signIn.error?.message);
const stillIn = await fetch(`${API}/auth/v1/user`, { headers: headers(appToken) });
check('control: app session survives', stillIn.status === 200, String(stillIn.status));

// The MCP endpoint itself (web/lib/mcp/endpoint.mjs, run in-process against this stack): real
// signing keys, issuer, audience and the per-request grant check.
const { createMcpEndpoint } = await import(new URL('../../web/lib/mcp/endpoint.mjs', import.meta.url));
const mcp = createMcpEndpoint({ supabaseUrl: API, issuer: `${API}/auth/v1`, audience: MCP_AUDIENCE, publishableKey: ANON, allowedOrigins: ['claude.ai'] });
const initialize = token => mcp(new Request('https://classroom.cordiacode.com/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }),
}));
const noToken = await initialize('');
check('MCP: no token gets 401 with resource_metadata', noToken.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/.test(noToken.headers.get('www-authenticate') || ''), noToken.headers.get('www-authenticate'));
const withApp = await initialize(appToken);
check('MCP: app sign-in token refused', withApp.status === 401, String(withApp.status));
const withOAuth = await initialize(refreshed.access_token);
const session = await withOAuth.text();
check('MCP: connected-app token gets a session', withOAuth.status === 200 && session.includes('Cordia Classroom'), `${withOAuth.status} ${session.slice(0, 120)}`);
const sessionCheck = await fetch(`${API}/rest/v1/rpc/mcp_session_check`, { method: 'POST', headers: headers(refreshed.access_token), body: '{}' });
check('RPC mcp_session_check: connected app gets true', sessionCheck.status === 200 && (await sessionCheck.text()).trim() === 'true', String(sessionCheck.status));
const appCheck = await fetch(`${API}/rest/v1/rpc/mcp_session_check`, { method: 'POST', headers: headers(appToken), body: '{}' });
check('RPC mcp_session_check: app token refused', refused(appCheck.status), String(appCheck.status));
const activity = await (await fetch(`${API}/rest/v1/mcp_connection_activity?select=client_id,last_used_at`, { headers: headers(appToken) })).json();
check('Connected apps: last use recorded for the student', Array.isArray(activity) && activity.some(row => row.client_id === client.client_id), JSON.stringify(activity).slice(0, 120));
const directActivity = await fetch(`${API}/rest/v1/mcp_connection_activity?select=*`, { headers: headers(refreshed.access_token) });
check('REST mcp_connection_activity: oauth read refused', refused(directActivity.status), String(directActivity.status));
const grants = await (await fetch(`${API}/auth/v1/user/oauth/grants`, { headers: headers(appToken) })).json();
check('Connected apps: grant listed for the student', Array.isArray(grants) && grants.some(grant => grant.client?.id === client.client_id && grant.client?.name === 'Probe Client'), JSON.stringify(grants).slice(0, 160));
// Disconnect in Settings: the still-unexpired access token stops working at once.
const revoke = await fetch(`${API}/auth/v1/user/oauth/grants?client_id=${client.client_id}`, { method: 'DELETE', headers: headers(appToken) });
check('Connected apps: Disconnect revokes the grant', revoke.status < 300, String(revoke.status));
const afterRevoke = await initialize(refreshed.access_token);
check('MCP: token refused right after Disconnect', afterRevoke.status === 401 && /disconnected/i.test(await afterRevoke.text()), String(afterRevoke.status));
const refreshAfter = await fetch(`${API}/auth/v1/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshed.refresh_token, client_id: client.client_id }) });
check('Connected apps: refresh token dead after Disconnect', refreshAfter.status >= 400, String(refreshAfter.status));

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await service.removeAllChannels?.();
process.exit(failed.length ? 1 : 0);
