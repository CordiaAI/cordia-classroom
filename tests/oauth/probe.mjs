// End-to-end OAuth lockdown probe (run by tests/oauth/run_local_probe.sh against a LOCAL stack).
// A student signs up and fills Canvas, connector, Assistant, billing and Storage data; an OAuth
// client registers itself, the student approves, and the client's token then tries every surface.
// Every connected-app check must be refused; the app-token controls must succeed, which proves
// the data is really there. Exits 1 on any failure. Pass/fail lines never carry detail taken from
// the connected app's own responses (CodeQL treats anything derived from its token as sensitive).
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
check('hook: role is mcp_client', claims.role === 'mcp_client');
check('hook: aud is the MCP resource', claims.aud === MCP_AUDIENCE);
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
  // Realtime can take a moment to start sending a new subscription's changes: insert again (up to
  // three times) until the app's own copy arrives, then wait a moment more for any leak.
  for (let attempt = 0; attempt < 3 && !asApp.events.length; attempt++) {
    await student.from(table).insert(table === 'canvas_courses' ? { canvas_course_id: 2 + attempt, name: 'HIST 210' } : { title: 'Cells', source_title: 'HIST 210 · Module 1', source_url: 'https://school.instructure.com/x' });
    for (let i = 0; i < 32 && !asApp.events.length; i++) await sleep(250);
  }
  await sleep(1000);
  if (process.env.DEBUG_REALTIME) console.log(table, 'oauth events:', JSON.stringify(asOAuth.events).slice(0, 300));
  check(`control: app token gets ${table} changes`, asApp.events.length > 0, asApp.status());
  if (table === 'canvas_courses') {
    check(`Realtime ${table} changes: oauth gets no row data`, asOAuth.events.length === 0);
  } else {
    // The student's own guides are readable by connected apps now, but never their Canvas columns.
    // (Production publishes no table to Realtime; supabase/checks/oauth_lockdown.sql flags any.)
    const leaked = asOAuth.events.filter(event => event.new?.source_title || event.new?.source_url);
    check(`Realtime ${table} changes: oauth never gets the Canvas columns`, leaked.length === 0);
  }
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
const mcp = createMcpEndpoint({ supabaseUrl: API, issuer: `${API}/auth/v1`, audience: MCP_AUDIENCE, publishableKey: ANON, allowedOrigins: ['claude.ai'], apiUrl: process.env.BACKEND || 'http://127.0.0.1:9' });
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
check('MCP: connected-app token gets a session', withOAuth.status === 200 && session.includes('Cordia Classroom'));
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
// The read tools, with the connected app's real token: RLS and the column grants decide what they
// see. A Canvas-made course, a Canvas page guide (with Canvas columns filled in), an assignment guide,
// a lecture, and another student's guide.
const { data: folder } = await student.from('folders').insert({ name: 'BIO 101 Biology' }).select('id').single();
await service.from('folders').update({ lms_named: true }).eq('id', folder.id);
const { data: guideRows, error: guideError } = await student.from('study_guides').insert([
  { title: 'Cell biology', folder_id: folder.id, notes: '## Cells\n- The **mitochondria** makes ATP', study_guide: 'Q1: What makes ATP?\nA1: Mitochondria',
    flashcards: [{ front: 'What makes ATP?', back: 'Mitochondria' }], source_type: 'canvas_module', source_title: 'BIO 101 · Module 3', source_url: 'https://school.instructure.com/courses/1' },
  { title: 'Lab report guide', source_type: 'assignment', notes: 'mitochondria rubric points' },
]).select('id, title');
check('control: app token saves guides', !guideError && guideRows?.length === 2, guideError?.message);
const cellGuide = guideRows?.find(row => row.title === 'Cell biology')?.id;
await service.from('lectures').insert({ user_id: signUp.user.id, folder_id: folder.id, title: 'Lecture 4', transcript: 'Cells today. The mitochondria is on the exam.',
  segments: [{ start_ms: 0, text: 'Cells today.' }, { start_ms: 95000, text: 'The mitochondria is on the exam.' }],
  analysis: { summary: ['Cells'], watch_for: [{ point: 'Mitochondria', why: 'exam', quote: 'The mitochondria is on the exam.', at_ms: 95000 }] } });
const zone = await student.rpc('set_my_timezone', { tz: 'America/Chicago' });
check('control: app saves the time zone', !zone.error, zone.error?.message);
const otherEmail = `other${Date.now()}@example.test`;
const { data: other } = await app.auth.signUp({ email: otherEmail, password });
const { data: otherGuide } = await service.from('study_guides').insert({ user_id: other.user.id, title: 'Other mitochondria', notes: 'mitochondria' }).select('id').single();
let rpcId = 10;
async function callTool(name, args) {
  const response = await mcp(new Request('https://classroom.cordiacode.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${refreshed.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  }));
  const text = await response.text();
  const message = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data:')).slice(5));
  const result = message.result || { isError: true, content: [{ text: JSON.stringify(message.error) }] };
  toolOutputs.push(JSON.stringify(result));
  return result;
}
const toolOutputs = [];
const leaks = text => /instructure|BIO 101|Module 3|Lab report|Other mitochondria/.test(text);
const found = await callTool('search_my_materials', { query: 'mitochondria' });
const hits = found.structuredContent?.results || [];
check('tool search: own guide, card and lecture with its timestamp', hits.some(hit => hit.kind === 'study_guide' && hit.id === cellGuide) && hits.some(hit => hit.kind === 'flashcard')
  && hits.some(hit => hit.kind === 'lecture' && hit.timestamp_seconds === 95), JSON.stringify(hits.map(hit => [hit.kind, hit.title])));
check('tool search: no assignment guide, no other student, no Canvas names', !leaks(found.content?.[0]?.text || ''), (found.content?.[0]?.text || '').slice(0, 200));
const listed = await callTool('list_study_sets', {});
const listedSets = listed.structuredContent?.study_sets || [];
check('tool list_study_sets: own sets, no assignment guide, course "Course 1"', listedSets.length > 0 && !listedSets.some(set => set.title === 'Lab report guide')
  && listedSets.find(set => set.id === cellGuide)?.course?.name === 'Course 1' && !leaks(listed.content[0].text), listed.content?.[0]?.text?.slice(0, 200));
check('tool dates are in the student\'s time zone', /-0[56]:00"/.test(listed.content?.[0]?.text || ''));
const theirs = await callTool('get_study_set', { study_set_id: otherGuide.id });
const nowhere = await callTool('get_study_set', { study_set_id: crypto.randomUUID() });
check('tool get_study_set: another student\'s set looks exactly like a missing one', theirs.isError && nowhere.isError && theirs.content[0].text === nowhere.content[0].text);
const due = await callTool('get_due_cards', {});
check('tool get_due_cards: the new card is due', due.structuredContent?.cards?.some(card => card.front === 'What makes ATP?'), JSON.stringify(due.structuredContent || due.content).slice(0, 200));
const lectures = await callTool('list_lectures', {});
const lectureId = lectures.structuredContent?.lectures?.[0]?.id;
const lecture = lectureId ? await callTool('get_lecture', { lecture_id: lectureId }) : { structuredContent: null };
check('tool get_lecture: watch-for with its timestamp', lecture.structuredContent?.watch_for?.[0]?.timestamp_seconds === 95);
const direct = await fetch(`${API}/rest/v1/study_guides?select=source_title,source_url`, { headers: headers(refreshed.access_token) });
check('REST: the Canvas columns stay closed to the token', refused(direct.status), String(direct.status));
const folderName = await fetch(`${API}/rest/v1/folders?select=name`, { headers: headers(refreshed.access_token) });
check('REST: folder names stay closed to the token', refused(folderName.status), String(folderName.status));

// The write tools (Phase 3), with the same real token.
const asService = async (table, filter) => (await service.from(table).select('*').match(filter)).data || [];
const answer = { item_type: 'flashcard', item_id: `${cellGuide}:card:0`, correct: true, confidence: 'sure', idempotency_key: 'probe-answer-1', response_text: 'mitochondria' };
const first = await callTool('record_answer', answer);
const repeat = await callTool('record_answer', answer);
const [afterAnswer] = await asService('study_guides', { id: cellGuide });
check('tool record_answer: saved once, a repeat replays the first result', first.structuredContent?.replayed === false && repeat.structuredContent?.replayed === true
  && afterAnswer?.flashcard_progress?.schedule?.['0']?.box === 0 && first.structuredContent?.next_due_on === repeat.structuredContent?.next_due_on, JSON.stringify(first.structuredContent || first.content).slice(0, 200));
const [day] = await asService('study_days', { user_id: signUp.user.id });
check('tool record_answer: counted once in the study log', day?.cards === 1 && day?.right_count === 1, JSON.stringify(day));
const logged = await asService('learning_events', { user_id: signUp.user.id, mode: 'mcp' });
check('tool record_answer: answer logged once, as mode mcp, without the answer text', logged.length === 1 && logged[0].format === 'flashcard' && logged[0].outcome === 'got_it' && logged[0].answer_chars === 12, JSON.stringify(logged));
const theirAnswer = await callTool('record_answer', { ...answer, item_id: `${otherGuide.id}:card:0`, idempotency_key: 'probe-answer-2' });
const noAnswer = await callTool('record_answer', { ...answer, item_id: `${crypto.randomUUID()}:card:0`, idempotency_key: 'probe-answer-3' });
check('tool record_answer: another student\'s set looks exactly like a missing one', theirAnswer.isError && noAnswer.isError && theirAnswer.content[0].text === noAnswer.content[0].text);
const added = await callTool('add_flashcards', { study_set_id: cellGuide, cards: [{ front: 'what makes ATP?', back: 'mitochondria' }, { front: 'Krebs cycle', back: 'Citric acid cycle' }] });
const [withCards] = await asService('study_guides', { id: cellGuide });
check('tool add_flashcards: appended, duplicate skipped, labelled', added.structuredContent?.added_count === 1 && added.structuredContent?.skipped_duplicates === 1
  && withCards.flashcards.length === 2 && withCards.flashcards[0].front === 'What makes ATP?' && withCards.flashcards[1].added_by === 'Probe Client', JSON.stringify(added.structuredContent || added.content));
const toAssignment = await callTool('add_flashcards', { study_set_id: guideRows.find(row => row.title === 'Lab report guide').id, cards: [{ front: 'a', back: 'b' }] });
check('tool add_flashcards: never an assignment guide', toAssignment.isError === true);
const merged = await student.rpc('merge_study_progress', { guide: cellGuide, cards: { 1: { box: 0, due: '2030-01-01', known: false } } });
check('app save merges card by card: the answer from the connected app is kept', !merged.error && merged.data?.schedule?.['0']?.box === 0 && merged.data?.schedule?.['1']?.box === 0, merged.error?.message || JSON.stringify(merged.data).slice(0, 160));
const note = await callTool('save_note', { title: 'Probe note', content: '# Cells\n- ATP comes from the **mitochondria**', study_set_id: cellGuide });
const [noteRow] = note.structuredContent ? await asService('study_guides', { id: note.structuredContent.note_id }) : [];
check('tool save_note: a new labelled page in the Library', noteRow?.source_type === 'notes' && noteRow?.origin === 'mcp' && noteRow?.origin_client === 'Probe Client' && noteRow?.notes === '## Cells\n- ATP comes from the **mitochondria**', JSON.stringify(note.structuredContent || note.content));
if (process.env.BACKEND) {
  const queued = await callTool('create_study_set', { source: { type: 'text', text: 'Mitochondria make ATP through cellular respiration in the inner membrane.' }, title: 'Probe set' });
  const jobId = queued.structuredContent?.job_id;
  const status = jobId ? await callTool('get_job_status', { job_id: jobId }) : null;
  const [job] = jobId ? await asService('generation_jobs', { id: jobId }) : [];
  check('tool create_study_set: queued at once under the student, checked by get_job_status', status?.structuredContent?.status === 'queued' && job?.user_id === signUp.user.id && job?.source === 'mcp' && job?.client_name === 'Probe Client',
    JSON.stringify(queued.structuredContent || queued.content).slice(0, 200));
  const lms = await callTool('create_study_set', { source: { type: 'url', url: 'https://school.instructure.com/courses/1/pages/cells' } });
  check('tool create_study_set: LMS links refused with the extension hint', lms.isError && /extension/.test(lms.content[0].text), lms.content?.[0]?.text);
  const metadata = await callTool('create_study_set', { source: { type: 'url', url: 'http://169.254.169.254/latest/meta-data/' } });
  check('tool create_study_set: internal addresses refused', metadata.isError && /private or internal/.test(metadata.content[0].text), metadata.content?.[0]?.text);
}
// Isolation, tool by tool: another student's id gets exactly the answer a made-up id gets.
const { data: otherFolder } = await service.from('folders').insert({ user_id: other.user.id, name: 'Other course' }).select('id').single();
const { data: otherLecture } = await service.from('lectures').insert({ user_id: other.user.id, title: 'Other lecture', transcript: 'mitochondria' }).select('id').single();
const { data: otherJob } = await service.from('generation_jobs').insert({ user_id: other.user.id, status: 'done', source: 'app', title: 'Other job' }).select('id').single();
const made = crypto.randomUUID();
const isolation = [
  ['get_lecture', id => ({ lecture_id: id }), otherLecture.id],
  ['get_due_cards', id => ({ study_set_id: id }), otherGuide.id],
  ['get_job_status', id => ({ job_id: id }), otherJob.id],
  ['add_flashcards', id => ({ study_set_id: id, cards: [{ front: 'a', back: 'b' }] }), otherGuide.id],
  ['save_note', id => ({ title: 'x', content: 'y', study_set_id: id }), otherGuide.id],
  ['save_note', id => ({ title: 'x', content: 'y', course_id: id }), otherFolder.id],
  ...(process.env.BACKEND ? [['create_study_set', id => ({ source: { type: 'text', text: 'Mitochondria make ATP for the cell to use.' }, course_id: id }), otherFolder.id]] : []),
];
for (const [name, args, theirs] of isolation) {
  const asTheirs = await callTool(name, args(theirs));
  const asMissing = await callTool(name, args(made));
  check(`isolation ${name}: another student's id looks exactly like a missing one`, asTheirs.isError && asMissing.isError && asTheirs.content[0].text === asMissing.content[0].text,
    `${asTheirs.content?.[0]?.text} | ${asMissing.content?.[0]?.text}`);
}
const theirCourse = await callTool('list_study_sets', { course_id: otherFolder.id });
check('isolation list_study_sets: another student\'s course lists nothing', theirCourse.structuredContent?.study_sets?.length === 0);
check('no tool output ever held Canvas data or another student\'s material', !toolOutputs.some(text => leaks(text) || /Other lecture|Other course|Other job/.test(text)),
  toolOutputs.find(text => leaks(text) || /Other lecture|Other course|Other job/.test(text))?.slice(0, 160));

const directUpdate = await fetch(`${API}/rest/v1/study_guides?id=eq.${cellGuide}`, { method: 'PATCH', headers: { ...headers(refreshed.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ title: 'hijacked' }) });
check('REST: the token cannot edit a guide directly', refused(directUpdate.status), String(directUpdate.status));
const directProgress = await fetch(`${API}/rest/v1/rpc/merge_study_progress`, { method: 'POST', headers: { ...headers(refreshed.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ guide: cellGuide, cards: { 0: { box: 5, due: '2030-01-01', known: true } } }) });
check('RPC merge_study_progress: refused to the token (answers go through record_answer)', refused(directProgress.status), String(directProgress.status));
const audit = await asService('mcp_tool_calls', { user_id: signUp.user.id });
check('audit log: one metadata row per tool call, nothing else', audit.length >= 12 && audit.every(row => Object.keys(row).sort().join() === 'client_id,created_at,error_code,id,latency_ms,status,tool_name,user_id')
  && audit.some(row => row.tool_name === 'record_answer' && row.status === 'ok') && audit.some(row => row.tool_name === 'add_flashcards' && row.status === 'error' && row.error_code === 'not_found'), JSON.stringify(audit.slice(0, 3)));
const auditRead = await fetch(`${API}/rest/v1/mcp_tool_calls?select=*`, { headers: headers(refreshed.access_token) });
check('REST mcp_tool_calls: the token cannot read the audit log', refused(auditRead.status) || (await auditRead.clone().text()) === '[]', String(auditRead.status));
let allowed = 0;
for (let i = 0; i < 31; i += 1) {
  const take = await fetch(`${API}/rest/v1/rpc/mcp_take_call`, { method: 'POST', headers: { ...headers(refreshed.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'write' }) });
  if ((await take.text()).trim() === 'true') allowed += 1;
}
const limited = await callTool('save_note', { title: 'Over the limit', content: 'text' });
check('rate limit: writes stop at 30 a minute', allowed < 31 && limited.isError && /30 at most/.test(limited.content[0].text), `${allowed} allowed; ${limited.content?.[0]?.text}`);

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
