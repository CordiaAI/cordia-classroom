// Saved chats (docs/redesign/PLAN.md T5): the one data module (lib/chatStore.mjs, wired up in
// lib/chats.js) against the backend in each of its three states, and every "another tab changed
// it" case: a chat deleted elsewhere, a conversation that moved on, an edit to a chat that is
// already gone, and Undo on a chat that was purged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIST_LIMIT, MAX_LIMIT, MESSAGES, createChatStore, outcome, sameConversation, tutorChatList } from '../lib/chatStore.mjs';
import { recentChats, sidebarCurrent } from '../lib/shellTools.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const CALC = 'f-ma125';
const BUS = 'f-bus101';
const at = minutes => new Date(Date.UTC(2026, 10, 17, 15, minutes)).toISOString();

// A small backend: 'tutor' (today's: /chats answers 404), 'fallback' (the /chats API before its
// migration) or 'full'. Every answer carries its HTTP status, as apiFetch's withStatus does.
function backend(mode) {
  const server = {
    mode,
    calls: [],
    down: false,
    guides: [{ id: 'g-derivs', folder_id: CALC }, { id: 'g-ethics', folder_id: BUS }],
    session: { id: 's-1', status: 'idle', conversation_version: 4, active_guide_id: 'g-derivs', updated_at: at(50),
      messages: [{ role: 'user', text: 'Why does the chain rule work?' }, { role: 'ai', text: 'Because the inner function changes the rate.' }] },
    saved: [
      { id: 'c-2', title: 'Career portfolio outline', guide_id: 'g-ethics', class_id: BUS, updated_at: at(40), messages: [{ role: 'user', text: 'Career portfolio outline' }] },
      { id: 'c-1', title: 'Thesis for the EH 101 essay', guide_id: null, class_id: null, updated_at: at(10), messages: [{ role: 'user', text: 'Thesis for the EH 101 essay' }] },
    ],
    liveId: 'c-live',
  };
  const ok = body => ({ ...body, httpStatus: 200 });
  const status = (code, body = {}) => ({ ...body, httpStatus: code });
  const liveSummary = () => ({ id: mode === 'full' ? server.liveId : server.session.id, title: server.session.messages[0]?.text || '', guide_id: server.session.active_guide_id, class_id: CALC, live: true, updated_at: server.session.updated_at });
  const summary = row => ({ id: row.id, title: row.title, guide_id: row.guide_id, class_id: row.class_id, live: false, updated_at: row.updated_at });
  const visible = () => server.saved.filter(row => !row.deleted_at);
  server.request = async (path, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    server.calls.push(`${method} ${path}`);
    await tick();
    if (server.down) return { failed: 'network', detail: "Couldn't reach Classroom." };
    const [route, search = ''] = path.split('?');
    const query = new URLSearchParams(search);
    const forced = server.fail?.[`${method} ${route.replace(/^\/chats\/[^/]+/, '/chats/:id')}`];
    if (forced) return status(forced[0], { detail: forced[1] });
    if (route === '/guides') return ok({ guides: server.guides });
    if (route === '/tutor/session') return ok({ ...server.session });
    if (route === '/tutor/chats') return ok({ chats: visible().map(({ messages, class_id, ...row }) => row) });
    if (route === '/tutor/session/new') {
      const resumed = body.resume_id ? visible().find(row => row.id === body.resume_id) : null;
      if (body.resume_id && !resumed) return status(404, { detail: 'Chat not found' });
      if (server.session.messages.length) server.saved.unshift({ id: `c-saved-${server.saved.length}`, title: server.session.messages[0].text, guide_id: server.session.active_guide_id, class_id: null, updated_at: at(55), messages: server.session.messages });
      if (resumed) server.saved = server.saved.filter(row => row !== resumed);
      server.session = { ...server.session, messages: resumed ? resumed.messages : [], conversation_version: server.session.conversation_version + 1 };
      return ok({ ...server.session });
    }
    if (!route.startsWith('/chats')) return status(404, { detail: 'Not Found' });
    if (mode === 'tutor') return status(404, { detail: 'Not Found' });
    if (server.conflict) return status(409, { detail: 'Tutor conversation changed. Refresh and try again.' });
    const editable = mode === 'full';
    const unavailable = status(503, { detail: "Saved chats aren't set up yet.", code: 'chats_not_available' });
    let match;
    if (route === '/chats' && method === 'GET') {
      let chats = [...visible().map(summary), ...(server.session.messages.length ? [liveSummary()] : [])];
      if (query.get('class_id')) chats = chats.filter(chat => chat.class_id === query.get('class_id'));
      return ok({ chats: chats.slice(0, Number(query.get('limit')) || 30), editable });
    }
    if (route === '/chats' && method === 'POST') {
      server.session = { ...server.session, messages: [], conversation_version: server.session.conversation_version + 1 };
      server.liveId = 'c-new';
      return ok({ chat: { ...liveSummary(), class_id: body.class_id }, session: { ...server.session } });
    }
    if ((match = route.match(/^\/chats\/([^/]+)\/open$/))) {
      const row = visible().find(item => item.id === match[1]);
      if (!row) return status(404, { detail: 'That chat is already gone.' });
      server.session = { ...server.session, messages: row.messages, conversation_version: server.session.conversation_version + 1 };
      return ok({ chat: { ...summary(row), live: true, id: mode === 'full' ? row.id : server.session.id }, session: { ...server.session } });
    }
    if ((match = route.match(/^\/chats\/([^/]+)\/restore$/))) {
      if (!editable) return unavailable;
      const row = server.saved.find(item => item.id === match[1] && item.deleted_at);
      if (!row) return status(404, { detail: 'That chat is already gone.' });
      row.deleted_at = null;
      return ok({ chat: summary(row), editable });
    }
    if ((match = route.match(/^\/chats\/([^/]+)$/))) {
      const id = match[1];
      const row = visible().find(item => item.id === id);
      const live = id === (mode === 'full' ? server.liveId : server.session.id);
      if (method === 'GET') {
        if (live) return ok({ chat: { ...liveSummary(), messages: server.session.messages, session_id: server.session.id, conversation_version: server.session.conversation_version }, editable });
        return row ? ok({ chat: { ...summary(row), messages: row.messages }, editable }) : status(404, { detail: 'That chat is already gone.' });
      }
      if (!editable) return unavailable;
      if (!row) return status(404, { detail: 'That chat is already gone.' });
      if (method === 'PATCH') { Object.assign(row, body); return ok({ chat: summary(row), editable }); }
      if (method === 'DELETE') { row.deleted_at = at(59); return ok({ chat: { ...summary(row), deleted_at: row.deleted_at }, editable }); }
    }
    return status(404, { detail: 'Not Found' });
  };
  return server;
}

function storeFor(mode, account = { id: 'user-a' }) {
  const server = backend(mode);
  let tutorChanges = 0;
  const store = createChatStore({ request: server.request, identify: () => account.id, onTutorChanged: () => { tutorChanges += 1; } });
  return { server, store, account, tutorChanges: () => tutorChanges };
}

// Every 404 and 409 another tab can cause, with the backend's own words (docs/redesign/T5-backend-notes.md, "Stale tabs").
const STALE_TABLE = [
  ['POST /chats', 409, 'Wait for Cordia Tutor to finish before starting a new chat', 'busy'],
  ['POST /chats', 409, 'Tutor conversation changed. Refresh and try again.', 'moved'],
  ['POST /chats', 404, 'Class not found', 'missing'],
  ['POST /chats', 404, 'Guide not found', 'missing'],
  ['POST /chats/:id/open', 404, 'Chat not found', 'gone'],
  ['POST /chats/:id/open', 404, 'That chat was deleted in another tab.', 'gone'],
  ['POST /chats/:id/open', 409, 'Wait for Cordia Tutor to finish before starting a new chat', 'busy'],
  ['POST /chats/:id/open', 409, 'Tutor conversation changed. Refresh and try again.', 'moved'],
  ['DELETE /chats/:id', 404, 'That chat is already gone.', 'gone'],
  ['DELETE /chats/:id', 409, 'Wait for Cordia Tutor to finish before deleting this chat', 'busy'],
  ['DELETE /chats/:id', 409, 'Tutor conversation changed. Refresh and try again.', 'moved'],
  ['PATCH /chats/:id', 404, 'Chat not found', 'gone'],
  ['PATCH /chats/:id', 404, 'Class not found', 'missing'],
  ['GET /chats/:id', 404, 'Chat not found', 'gone'],
  ['POST /chats/:id/restore', 404, 'Chat not found', 'gone'],
  ['POST /chat', 409, 'Tutor conversation changed. Refresh and try again.', 'moved'],
  ['POST /chat', 409, 'Cordia Tutor is already working on a request.', 'busy'],
  ['POST /chat', 409, 'Cordia Tutor received another request first. Refresh and try again.', 'busy'],
  ['POST /chat', 404, 'Class not found', 'missing'],
  ['POST /chat', 404, 'Tutor session not found', 'gone'],
  ['POST /tutor/session/new', 409, 'Wait for Cordia Tutor to finish before starting a new chat', 'busy'],
  ['POST /tutor/session/new', 404, 'Chat not found', 'gone'],
  ['POST /tutor/session/new', 404, 'Guide not found', 'missing'],
];

test('every 404 and 409 in the backend notes means one thing, and each has plain words and no jargon', () => {
  for (const [route, httpStatus, detail, reason] of STALE_TABLE) {
    assert.equal(outcome({ httpStatus, detail }), reason, `${route} ${httpStatus} ${detail}`);
  }
  for (const reason of ['gone', 'moved', 'busy', 'missing']) {
    assert.match(MESSAGES[reason], /^[A-Z][^!]*\.$/, reason);
    assert.doesNotMatch(MESSAGES[reason], /error|exception|\b(404|409)\b|undefined|null/i, reason);
  }
  assert.equal(MESSAGES.busy, 'The Tutor is still answering. Wait for it to finish, then try again.');
  assert.equal(MESSAGES.missing, 'The class or material you picked was deleted in another tab. Pick another and try again.');
});

test('responses mean the same thing whatever the backend: 404 gone, 409 moved on, 503 not set up yet', () => {
  assert.equal(outcome({ httpStatus: 200 }), 'ok');
  assert.equal(outcome({ httpStatus: 404, detail: 'That chat is already gone.' }), 'gone');
  assert.equal(outcome({ httpStatus: 409 }), 'moved');
  assert.equal(outcome({ httpStatus: 402 }), 'limit');
  assert.equal(outcome({ httpStatus: 503, code: 'chats_not_available' }), 'unavailable');
  assert.equal(outcome({ failed: 'network' }), 'network');
  assert.equal(outcome(null), 'network');
  assert.equal(MESSAGES.gone, 'This chat was deleted or moved in another tab.');
  for (const text of Object.values(MESSAGES)) assert.doesNotMatch(text, /!|error|exception|\b(404|409|503)\b/i, text);
});

test("today's backend: the list comes from the Tutor's own calls, and /chats is asked once per page load", async () => {
  const { server, store } = storeFor('tutor');
  const first = await store.load();
  assert.equal(first.editable, false);
  assert.deepEqual(first.chats.map(chat => [chat.id, chat.live]), [['s-1', true], ['c-2', false], ['c-1', false]]);
  assert.equal(first.chats[0].title, 'Why does the chain rule work?');
  await store.load({ fresh: true });
  await store.getChat('c-1');
  assert.equal(server.calls.filter(call => call.startsWith('GET /chats')).length, 1, 'the state is found once, from the first answer');
});

test("existing history is all there in every state: per-guide and general chats and the live one", async () => {
  for (const mode of ['tutor', 'fallback', 'full']) {
    const { store } = storeFor(mode);
    const { chats } = await store.load();
    assert.deepEqual(chats.map(chat => chat.title).sort(), ['Career portfolio outline', 'Thesis for the EH 101 essay', 'Why does the chain rule work?'], mode);
    assert.ok(chats.some(chat => chat.guide_id === 'g-ethics') && chats.some(chat => !chat.guide_id), mode);
  }
});

test('before the migration nothing can be renamed, moved or deleted, and nothing is asked', async () => {
  for (const mode of ['tutor', 'fallback']) {
    const { server, store } = storeFor(mode);
    await store.load();
    assert.equal(store.editable, false, mode);
    const before = server.calls.length;
    for (const result of [await store.rename('c-2', 'Portfolio'), await store.move('c-2', CALC), await store.remove('c-2')]) {
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'unavailable');
    }
    assert.equal(server.calls.length, before, mode);
    assert.equal(store.snapshot().chats.length, 3, mode);
  }
});

test('a 503 chats_not_available turns editing off rather than showing an error', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  server.mode = 'fallback';
  const request = server.request;
  server.request = async (path, options) => (options?.method === 'PATCH' ? { detail: "Saved chats aren't set up yet.", code: 'chats_not_available', httpStatus: 503 } : request(path, options));
  const store2 = createChatStore({ request: server.request });
  await store2.load();
  const result = await store2.rename('c-2', 'Portfolio draft');
  assert.equal(result.reason, 'unavailable');
  assert.equal(store2.editable, false);
  assert.equal(store2.snapshot().chats.find(chat => chat.id === 'c-2').title, 'Career portfolio outline');
});

test('rename shows at once, keeps the server title, and ignores an empty or unchanged title', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  const pending = store.rename('c-2', '  Portfolio   draft  ');
  assert.equal(store.snapshot().chats.find(chat => chat.id === 'c-2').title, 'Portfolio draft', 'optimistic');
  assert.equal((await pending).ok, true);
  assert.equal(server.saved.find(row => row.id === 'c-2').title, 'Portfolio draft');
  const calls = server.calls.length;
  assert.equal((await store.rename('c-2', '   ')).unchanged, true);
  assert.equal((await store.rename('c-2', 'Portfolio draft')).unchanged, true);
  assert.equal(server.calls.length, calls);
});

test('a chat moved to a class shows in that class, and the class list reads the same data', async () => {
  const { store } = storeFor('full');
  await store.load();
  assert.deepEqual((await store.classChats(CALC)).chats.map(chat => chat.id), ['c-live']);
  assert.equal((await store.move('c-1', CALC)).ok, true);
  const calc = await store.classChats(CALC);
  assert.equal(calc.editable, true);
  assert.deepEqual(calc.chats.map(chat => chat.id).sort(), ['c-1', 'c-live']);
  assert.equal(store.snapshot().chats.find(chat => chat.id === 'c-1').class_id, CALC);
});

test("today's backend: a class's chats are its guides' chats", async () => {
  const { server, store } = storeFor('tutor');
  const calc = await store.classChats(CALC);
  assert.deepEqual(calc.chats.map(chat => chat.id), ['s-1'], 'the live chat is about g-derivs, in MA 125');
  assert.deepEqual((await store.classChats(BUS)).chats.map(chat => chat.id), ['c-2']);
  assert.equal(calc.editable, false);
  assert.ok(server.calls.includes('GET /guides?fields=summary&limit=200'));
});

test('delete leaves the list at once, then Undo puts it back where it was', async () => {
  const { store } = storeFor('full');
  await store.load();
  const order = store.snapshot().chats.map(chat => chat.id);
  const pending = store.remove('c-2');
  assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-2'), 'gone before the server answers');
  assert.equal((await pending).ok, true);
  const toast = store.snapshot().toast;
  assert.equal(toast.kind, 'deleted');
  assert.equal(toast.chatId, 'c-2');
  assert.equal((await store.restore('c-2')).ok, true);
  assert.deepEqual(store.snapshot().chats.map(chat => chat.id), order);
  assert.equal(store.snapshot().toast, null);
});

test('another tab: opening a chat that was deleted elsewhere says so in plain words and refreshes the list', async () => {
  for (const mode of ['tutor', 'fallback', 'full']) {
    const { server, store } = storeFor(mode);
    await store.load();
    server.saved = server.saved.filter(row => row.id !== 'c-1');
    const result = await store.getChat('c-1');
    assert.equal(result.ok, false, mode);
    assert.equal(result.reason, 'gone', mode);
    assert.equal(result.message, 'This chat was deleted or moved in another tab.', mode);
    assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-1'), mode);
  }
});

test('another tab: carrying on a chat whose conversation moved on answers "moved", and the change is noticed', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  server.conflict = true;
  const opened = await store.openChat('c-1', { session: server.session });
  assert.equal(opened.reason, 'moved');
  assert.equal(opened.message, 'This conversation moved on in another tab.');
  // The chat page compares the Tutor's conversation with the chat it shows.
  const chat = [{ role: 'user', text: 'Why does the chain rule work?' }];
  assert.equal(sameConversation(chat, [...chat, { role: 'ai', text: 'Because…' }, { role: 'user', text: 'And for sin(x²)?' }]), true, 'more messages in the same chat');
  assert.equal(sameConversation(chat, []), false, 'another tab started a new chat');
  assert.equal(sameConversation(chat, [{ role: 'user', text: 'Thesis for the EH 101 essay' }]), false, 'another tab opened a different chat');
  assert.equal(sameConversation([], [{ role: 'user', text: 'Anything' }]), true, 'a new chat takes its first message');
});

test('another tab: rename, move or delete a chat that is already gone puts nothing back and says so', async () => {
  for (const action of ['rename', 'move', 'remove']) {
    const { server, store } = storeFor('full');
    await store.load();
    server.saved.find(row => row.id === 'c-1').deleted_at = at(58);
    const result = action === 'rename' ? await store.rename('c-1', 'Essay thesis') : action === 'move' ? await store.move('c-1', BUS) : await store.remove('c-1');
    assert.equal(result.ok, false, action);
    assert.equal(result.reason, 'gone', action);
    assert.equal(result.message, MESSAGES.gone, action);
    assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-1'), action);
    assert.equal(store.snapshot().toast, null, `${action}: no Undo for a chat that was never deleted here`);
  }
});

test('another tab: Undo on a chat that was purged meanwhile says it is gone for good', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  await store.remove('c-1');
  server.saved = server.saved.filter(row => row.id !== 'c-1');
  const result = await store.restore('c-1');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'purged');
  assert.equal(store.snapshot().toast.text, "This chat can't come back. It was deleted for good.");
  assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-1'));
});

test("a refused rename keeps the old title; a network failure says so plainly", async () => {
  const { server, store } = storeFor('full');
  await store.load();
  server.down = true;
  const result = await store.rename('c-2', 'Portfolio draft');
  assert.equal(result.reason, 'network');
  assert.equal(result.message, "Couldn't reach Classroom, so the chat keeps its old title.");
  assert.equal(store.snapshot().chats.find(chat => chat.id === 'c-2').title, 'Career portfolio outline');
  const missing = await store.getChat('c-2');
  assert.equal(missing.reason, 'network');
});

test('opening a saved chat: with /chats it is read first; with only the Tutor it opens through resume', async () => {
  const full = storeFor('full');
  const read = await full.store.getChat('c-1');
  assert.equal(read.ok, true);
  assert.equal(read.mustOpen, false);
  assert.deepEqual(read.chat.messages, [{ role: 'user', text: 'Thesis for the EH 101 essay' }]);
  const today = storeFor('tutor');
  const saved = await today.store.getChat('c-1');
  assert.equal(saved.mustOpen, true);
  const opened = await today.store.openChat('c-1', {});
  assert.equal(opened.ok, true);
  assert.equal(opened.chat.id, 's-1', 'the chat now lives at the session id');
  assert.equal(opened.chat.live, true);
  assert.equal(today.tutorChanges(), 1);
  const live = await today.store.getChat('s-1');
  assert.equal(live.chat.session_id, 's-1');
  assert.equal(live.chat.conversation_version, 5);
});

test('starting a chat: /chats when it exists; otherwise the Tutor saves the conversation and the session is the chat', async () => {
  const full = storeFor('full');
  const started = await full.store.start({ session: full.server.session, classId: CALC });
  assert.equal(started.chat.id, 'c-new');
  assert.equal(started.chat.class_id, CALC);
  assert.equal(started.session.messages.length, 0);
  const today = storeFor('tutor');
  const fresh = await today.store.start({ session: today.server.session });
  assert.equal(fresh.chat.id, 's-1');
  assert.ok(today.server.calls.includes('POST /tutor/session/new'));
  assert.equal(today.server.saved.length, 3, 'the conversation before was saved, nothing lost');
  const empty = storeFor('tutor');
  empty.server.session.messages = [];
  const calls = (await empty.store.start({ session: empty.server.session })).chat.id;
  assert.equal(calls, 's-1');
  assert.ok(!empty.server.calls.includes('POST /tutor/session/new'), 'an empty conversation is reused');
});

test('the open chat is always in Recent chats and is the one current sidebar item', async () => {
  const { store } = storeFor('full');
  await store.load();
  store.keepOpen({ id: 'c-new', title: 'Why is the sky blue?', live: true });
  const rows = recentChats(store.snapshot().chats);
  assert.equal(rows[0].href, '/chat/c-new');
  const current = sidebarCurrent('/chat/[id]', { id: 'c-new' }, { classIds: [CALC] });
  assert.equal(current, 'chat:c-new');
  assert.equal(rows.filter(row => row.key === current).length, 1);
  assert.equal(sidebarCurrent('/home'), 'new');
  store.keepOpen(null);
  assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-new'));
});

test('the first state lists the live conversation once, newest first, titled by its first question', () => {
  const list = tutorChatList(
    [{ id: 'c-1', title: 'Older', updated_at: at(1) }],
    { id: 's-1', updated_at: at(30), messages: [{ role: 'user', text: '  What   is opportunity cost? ' }] },
    {},
  );
  assert.deepEqual(list.map(chat => [chat.id, chat.title]), [['s-1', 'What is opportunity cost?'], ['c-1', 'Older']]);
  assert.deepEqual(tutorChatList([], { id: 's-1', messages: [] }), []);
});

test('the wiring: one page for /home and /chat/[id], one Tutor client, one data module', () => {
  assert.match(read('pages/chat/[id].js'), /export \{ default \} from '\.\.\/home';/);
  const layout = read('components/Layout.js');
  assert.match(layout, /CHAT_ROUTES = \['\/home', '\/chat\/\[id\]'\]/);
  assert.match(layout, /CHAT_ROUTES\.includes\(router\.pathname\) \? 'chat'/);
  const home = read('pages/home.js');
  assert.match(home, /useTutorChat\(\{/);
  assert.match(home, /from '\.\.\/lib\/chats'/);
  assert.doesNotMatch(home, /apiFetch|\/tutor\/chats|\/chats\//, 'the page never calls chat routes itself');
  for (const file of ['components/Sidebar.js', 'components/SidebarChats.js', 'components/ChatToast.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /['"`]\/chats|\/tutor\/chats|editable === |mode ===/, file);
    if (file !== 'components/Sidebar.js') assert.doesNotMatch(source, /apiFetch\(/, file);
  }
  assert.match(read('components/Sidebar.js'), /useChats\(\)/);
  // Only the data module tells the backend's states apart.
  assert.match(read('lib/chatStore.mjs'), /mode = 'tutor'/);
  assert.doesNotMatch(read('lib/chats.js'), /mode/);
});

test('another tab: starting a chat while the Tutor is answering, or after the class was deleted, fails with plain words and the list is refreshed', async () => {
  for (const [route, httpStatus, detail, reason] of STALE_TABLE.filter(row => row[0] === 'POST /chats')) {
    const { server, store } = storeFor('full');
    await store.load();
    server.fail = { 'POST /chats': [httpStatus, detail] };
    const before = server.calls.filter(call => call === 'GET /chats?limit=30').length;
    const result = await store.start({ session: server.session, classId: CALC });
    assert.equal(result.ok, false, detail);
    assert.equal(result.reason, reason, detail);
    assert.equal(result.message, MESSAGES[reason], detail);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(server.calls.filter(call => call === 'GET /chats?limit=30').length > before, `${detail}: the list was fetched again`);
  }
  // The first backend: the same answers from the Tutor's own new-chat call.
  const { server, store } = storeFor('tutor');
  server.fail = { 'POST /tutor/session/new': [409, 'Wait for Cordia Tutor to finish before starting a new chat'] };
  const result = await store.start({ session: server.session });
  assert.equal(result.reason, 'busy');
});

test('another tab: carrying on a chat that was deleted in the moment of the switch drops it from the list', async () => {
  for (const mode of ['full', 'tutor']) {
    const { server, store } = storeFor(mode);
    await store.load();
    server.fail = { [mode === 'full' ? 'POST /chats/:id/open' : 'POST /tutor/session/new']: [404, 'That chat was deleted in another tab.'] };
    const result = await store.openChat('c-1', { session: server.session });
    assert.equal(result.reason, 'gone', mode);
    assert.equal(result.message, MESSAGES.gone, mode);
    assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-1'), mode);
  }
});

test('another tab: a chat moved into a class that was deleted stays where it was, with a message about the class', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  server.fail = { 'PATCH /chats/:id': [404, 'Class not found'] };
  const result = await store.move('c-1', BUS);
  assert.equal(result.reason, 'missing');
  assert.equal(result.message, MESSAGES.missing);
  const row = store.snapshot().chats.find(chat => chat.id === 'c-1');
  assert.ok(row, 'the chat is still listed');
  assert.equal(row.class_id, null, 'and still has no class');
});

test('another tab: deleting a chat while the Tutor is answering, or after it moved on, puts it back and says so', async () => {
  for (const [detail, reason] of [['Wait for Cordia Tutor to finish before deleting this chat', 'busy'], ['Tutor conversation changed. Refresh and try again.', 'moved']]) {
    const { server, store } = storeFor('full');
    await store.load();
    server.fail = { 'DELETE /chats/:id': [409, detail] };
    const pending = store.remove('c-live');
    assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-live'), 'gone at once');
    const result = await pending;
    assert.equal(result.reason, reason);
    assert.equal(result.message, MESSAGES[reason]);
    assert.ok(store.snapshot().chats.some(chat => chat.id === 'c-live'), `${reason}: back in the list, nothing was deleted`);
    assert.equal(store.snapshot().toast, null, 'no Undo for a delete that did not happen');
  }
});

test('another tab: reading a chat that an empty new chat removed, or that was deleted, says it is gone and refreshes the list', async () => {
  const { server, store } = storeFor('full');
  await store.load();
  server.fail = { 'GET /chats/:id': [404, 'Chat not found'] };
  const result = await store.getChat('c-1');
  assert.equal(result.reason, 'gone');
  assert.ok(!store.snapshot().chats.some(chat => chat.id === 'c-1'));
});

test('the chat page answers a failed send from the same words, keeps the typed text, and reverses a first message that did not go', () => {
  const home = read('pages/home.js');
  assert.match(home, /outcome\(\{ httpStatus: status, detail \}\)/, 'a failed send is read through the data module');
  assert.match(home, /const STALE = \['gone', 'moved', 'busy', 'missing'\]/);
  const hook = read('lib/useTutorChat.js');
  assert.match(hook, /onSendFailed\?\.\(\{ status: data\?\.httpStatus \|\| 0, detail: data\?\.detail/);
  assert.match(hook, /setInput\(question\);\n      setLocalError\(data\?\.answer/, 'the question goes back in the box');
  assert.match(home, /goTo\(''\)/, 'a first message that fails (a plan limit) goes back to the home');
  assert.match(home, /moving\.current\?\.cancel\(\)/, 'the move back starts from where the composer is');
});

test('no connection on the first answer: nothing falls through to the Tutor-only calls, and the next try finds the state', async () => {
  const { server, store } = storeFor('full');
  server.down = true;
  for (const result of [await store.getChat('c-1'), await store.start({ session: server.session }), await store.openChat('c-1', {})]) {
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'network');
    assert.equal(result.message, MESSAGES.network);
  }
  assert.ok(!server.calls.some(call => call.includes('/tutor/')), 'no Tutor call was made');
  assert.equal((await store.classChats(CALC)).failed, true);
  assert.equal(store.snapshot().failed, true, 'the sidebar can offer a retry');
  server.down = false;
  assert.equal((await store.getChat('c-1')).ok, true);
  assert.equal(store.snapshot().failed, false);
});

// Two accounts in one tab (the Vercel Security Review on #273): the store belongs to the account.
const everyTitle = snapshots => JSON.stringify(snapshots.map(snap => [snap.chats, snap.toast]));

test("another account signing in empties the store before anything is asked, and a failed refresh never shows the earlier account's chats", async () => {
  const { server, store, account } = storeFor('full');
  const seen = [];
  store.subscribe(snap => seen.push(snap));
  await store.load();
  assert.ok(store.snapshot().chats.some(chat => chat.title === 'Career portfolio outline'));
  store.say('Chat deleted');
  account.id = 'user-b';
  server.down = true;
  // Rendering after the switch already reads an empty store: nothing was asked yet.
  const calls = server.calls.length;
  assert.deepEqual([store.snapshot().chats, store.snapshot().toast, store.snapshot().loaded], [null, null, false]);
  assert.equal(server.calls.length, calls);
  seen.length = 0;
  const after = await store.load();
  assert.equal(after.failed, true);
  assert.equal(after.chats, null);
  assert.doesNotMatch(everyTitle([...seen, store.snapshot()]), /Career portfolio|Thesis for the EH|chain rule/, 'no earlier title ever rendered');
  assert.equal((await store.classChats(CALC)).chats.length, 0);
  assert.equal((await store.getChat('c-1')).ok, false);
});

test('signing out empties the store at once and tells listeners; the earlier chats and toast are gone', async () => {
  const { store, account } = storeFor('full');
  const seen = [];
  await store.load();
  store.say('Chat deleted');
  store.subscribe(snap => seen.push(snap));
  account.id = '';
  store.check();
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].chats, seen[0].toast, seen[0].loaded, seen[0].more], [null, null, false, false]);
});

test("an answer to a question asked for the earlier account is dropped when it arrives", async () => {
  const { server, store, account } = storeFor('full');
  await store.load();
  const slow = store.load({ fresh: true });
  account.id = 'user-b';
  store.check();
  const answer = await slow;
  assert.equal(answer.chats, null, "the earlier account's list is not stored for the new one");
  assert.equal(store.snapshot().chats, null);
  // Mutations in flight drop the same way: Undo for the earlier account's chat shows no toast and puts nothing back.
  const { store: other, account: accountB } = storeFor('full');
  await other.load();
  await other.remove('c-1');
  assert.equal(other.snapshot().toast.kind, 'deleted');
  const undo = other.restore('c-1');
  accountB.id = 'user-b';
  other.check();
  const result = await undo;
  assert.equal(result.reason, 'stale');
  assert.equal(other.snapshot().toast, null);
  assert.equal(other.snapshot().chats, null);
});

test('a student with 45 chats reaches all 45: the sidebar starts with 30 and Show more asks for the most the backend lists', async () => {
  const { server, store } = storeFor('full');
  for (let index = 0; index < 42; index += 1) server.saved.push({ id: `bulk-${index}`, title: `Chat ${index}`, guide_id: null, class_id: null, updated_at: at(-index - 1), messages: [{ role: 'user', text: `Chat ${index}` }] });
  const first = await store.load();
  assert.equal(first.chats.length, LIST_LIMIT);
  assert.equal(first.more, true, 'Show more is offered');
  await store.showMore();
  const all = store.snapshot();
  assert.equal(all.chats.length, 45);
  assert.equal(all.more, false);
  assert.equal(all.limited, false);
  assert.ok(server.calls.includes(`GET /chats?limit=${MAX_LIMIT}`));
  await store.load({ fresh: true });
  assert.equal(store.snapshot().chats.length, 45, 'a later refresh keeps the longer list');
  // A class's Chats tab always lists the most the backend does.
  server.calls.length = 0;
  await store.classChats(BUS);
  assert.ok(server.calls.some(call => call.startsWith(`GET /chats?limit=${MAX_LIMIT}&class_id=`)));
});

test('Show more that cannot be read keeps the list and the button, with a plain line', async () => {
  const { server, store } = storeFor('full');
  for (let index = 0; index < 43; index += 1) server.saved.push({ id: `bulk-${index}`, title: `Chat ${index}`, guide_id: null, class_id: null, updated_at: at(-index - 1), messages: [] });
  await store.load();
  server.down = true;
  await store.showMore();
  const snap = store.snapshot();
  assert.equal(snap.chats.length, LIST_LIMIT);
  assert.equal(snap.more, true);
  assert.equal(snap.toast.text, MESSAGES.network);
});

test("only the Tutor's own calls (today's backend) list every chat it keeps, so there is no Show more", async () => {
  const { store } = storeFor('tutor');
  assert.equal((await store.load()).more, false);
});

test('the browser store is keyed to the signed-in account and hears sign-in, sign-out and another tab', () => {
  const chats = read('lib/chats.js');
  assert.match(chats, /createChatStore\(\{ request, identify: getUserId/);
  assert.match(chats, /CORDIA_AUTH_UPDATED/);
  assert.match(chats, /addEventListener\('storage'/);
});
