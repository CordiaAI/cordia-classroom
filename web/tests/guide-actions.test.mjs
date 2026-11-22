// Moving a guide to another class and deleting one (feedback F3: "often doesn't take"). lib/guideActions.mjs
// is the rules; these tests run it against a small backend that can fail the ways the real one does
// (offline, slow, a class deleted in another tab, a guide already gone), and then check each page
// is wired to it so a failure becomes a sentence and a success stays true after the lists are read again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MESSAGES, createLocalChanges, createUndoQueue, deleteItem, moveGuide, pathsOf, removeClass } from '../lib/guideActions.mjs';
import { createChatStore } from '../lib/chatStore.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const MGT = 'f-mgt300';
const FILM = 'f-film201';
const ok = body => ({ ...body, httpStatus: 200 });
const status = (code, detail) => ({ detail, httpStatus: code });

// The backend as routers/guides.py and routers/folders.py now answer: done, or a status and a reason.
function server() {
  const state = {
    calls: [],
    guides: [{ id: 'g1', folder_id: MGT }, { id: 'g2', folder_id: MGT }],
    notes: [{ id: 'n1', folder_id: null }],
    folders: [{ id: MGT, class_id: 'c-mgt' }, { id: FILM, class_id: null }],
    down: null, // 'network' | 'timeout': no answer at all
    fail: {}, // 'METHOD path' -> [status, detail]
  };
  state.request = async (path, options = {}) => {
    const method = options.method || 'GET';
    state.calls.push(`${method} ${path}`);
    await tick();
    if (state.down) return { failed: state.down, detail: 'no answer' };
    const forced = state.fail[`${method} ${path}`];
    if (forced) return status(...forced);
    let match;
    if ((match = path.match(/^\/guides\/([^/]+)\/move$/))) {
      const guide = state.guides.find(item => item.id === match[1]);
      if (!guide) return status(404, 'Guide not found');
      const { folder_id: target } = JSON.parse(options.body);
      if (target && !state.folders.some(folder => folder.id === target)) return status(404, 'Folder not found');
      guide.folder_id = target;
      return ok({ updated: true, folder_id: target });
    }
    if ((match = path.match(/^\/guides\/([^/]+)$/)) && method === 'DELETE') {
      const index = state.guides.findIndex(item => item.id === match[1]);
      if (index < 0) return status(404, 'Guide not found');
      state.guides.splice(index, 1);
      return ok({ deleted: true });
    }
    if ((match = path.match(/^\/smart_notes\/([^/]+)$/)) && method === 'DELETE') {
      const index = state.notes.findIndex(item => item.id === match[1]);
      if (index < 0) return status(404, 'Note not found');
      state.notes.splice(index, 1);
      return ok({ deleted: true });
    }
    if ((match = path.match(/^\/folders\/([^/]+)$/)) && method === 'DELETE') {
      const index = state.folders.findIndex(item => item.id === match[1]);
      if (index < 0) return status(404, 'Class not found');
      state.folders.splice(index, 1);
      return ok({ deleted: true });
    }
    if (path.startsWith('/classes/') && method === 'DELETE') return ok({ ok: true });
    return status(404, 'Not Found');
  };
  return state;
}

// Move -------------------------------------------------------------------------------------------------
test('a move is done only when the server says the guide is now in that class', async () => {
  const api = server();
  assert.deepEqual(await moveGuide(api.request, 'g1', FILM), { ok: true, folderId: FILM });
  assert.equal(api.guides[0].folder_id, FILM);
  assert.deepEqual(await moveGuide(api.request, 'g1', null), { ok: true, folderId: null });
  assert.equal(api.guides[0].folder_id, null);
  // 200 with the wrong class, or no body at all, is not a move.
  assert.equal((await moveGuide(async () => ok({ updated: true, folder_id: MGT }), 'g1', FILM)).ok, false);
  assert.equal((await moveGuide(async () => ok({}), 'g1', FILM)).ok, false);
  assert.equal((await moveGuide(async () => null, 'g1', FILM)).ok, false);
});

test('a move that did not go through says why, in plain words', async () => {
  const api = server();
  api.down = 'network';
  assert.equal((await moveGuide(api.request, 'g1', FILM)).message, MESSAGES.offline);
  api.down = 'timeout';
  assert.equal((await moveGuide(api.request, 'g1', FILM)).message, MESSAGES.slow);
  api.down = null;
  api.fail['PATCH /guides/g1/move'] = [500, 'Classroom hit a temporary problem. Please try again.'];
  const failed = await moveGuide(api.request, 'g1', FILM);
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'Classroom hit a temporary problem. Please try again.');
  // An error with no words falls back to the plain sentence, never to nothing.
  api.fail['PATCH /guides/g1/move'] = [502, ''];
  assert.equal((await moveGuide(api.request, 'g1', FILM)).message, MESSAGES.move);
  assert.equal(api.guides[0].folder_id, MGT);
});

test('a class deleted in another tab, or a guide already gone, is told apart', async () => {
  const api = server();
  const noClass = await moveGuide(api.request, 'g1', 'f-deleted');
  assert.deepEqual([noClass.ok, noClass.folderMissing, noClass.gone, noClass.message], [false, true, false, 'That class no longer exists.']);
  const noGuide = await moveGuide(api.request, 'g-gone', FILM);
  assert.deepEqual([noGuide.ok, noGuide.gone, noGuide.folderMissing, noGuide.message], [false, true, false, 'That guide no longer exists.']);
});

// Delete -----------------------------------------------------------------------------------------------
test('deleting a guide with its note: done only when every part is gone', async () => {
  const api = server();
  assert.deepEqual(pathsOf({ id: 'g1', also: ['/smart_notes/n1'] }), ['/guides/g1', '/smart_notes/n1']);
  assert.deepEqual(await deleteItem(api.request, { id: 'g1', also: ['/smart_notes/n1'] }), { ok: true });
  assert.deepEqual([api.guides.length, api.notes.length], [1, 0]);
  // Already gone (another tab): the goal is met.
  assert.equal((await deleteItem(api.request, { id: 'g1' })).ok, true);
  // One part fails: not done, and it says so.
  api.fail['DELETE /smart_notes/n9'] = [500, 'Classroom hit a temporary problem. Please try again.'];
  const partial = await deleteItem(api.request, { id: 'g2', also: ['/smart_notes/n9'] });
  assert.equal(partial.ok, false);
  assert.equal(partial.message, 'Classroom hit a temporary problem. Please try again.');
  api.down = 'network';
  assert.equal((await deleteItem(api.request, { id: 'g2' })).message, MESSAGES.offline);
});

test('deleting a class: the folder first, and a folder that stays keeps its shared class too', async () => {
  const api = server();
  api.fail['DELETE /folders/f-mgt300'] = [500, ''];
  const failed = await removeClass(api.request, { id: MGT, class_id: 'c-mgt' });
  assert.deepEqual([failed.ok, failed.message], [false, MESSAGES.deleteClass]);
  assert.ok(!api.calls.some(call => call.startsWith('DELETE /classes/')), 'the shared class is left only after the folder is gone');
  delete api.fail['DELETE /folders/f-mgt300'];
  assert.equal((await removeClass(api.request, { id: MGT, class_id: 'c-mgt' })).ok, true);
  assert.ok(api.calls.includes('DELETE /classes/c-mgt'));
  assert.equal((await removeClass(api.request, { id: FILM, class_id: null })).ok, true);
});

// Undo ---------------------------------------------------------------------------------------------------
function undoRig(api, delay = 6000) {
  const timers = [];
  const log = { deleted: [], failed: [] };
  const queue = createUndoQueue({
    send: item => deleteItem(api.request, item),
    delay,
    onDeleted: item => log.deleted.push(item.id),
    onFailed: (item, message) => log.failed.push([item.id, message]),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: handle => { if (handle) timers[handle - 1] = { fn: () => {}, ms: -1 }; },
  });
  const fire = () => timers.at(-1).fn();
  return { queue, log, fire, timers };
}

test('Undo: the row is hidden at once, nothing is sent until the time is up, and Undo sends nothing', async () => {
  const api = server();
  const { queue, log, fire, timers } = undoRig(api);
  queue.remove({ id: 'g1', title: 'Chain rule' });
  assert.deepEqual([...queue.snapshot().hidden], ['g1']);
  assert.equal(timers[0].ms, 6000);
  assert.deepEqual(api.calls, []);
  assert.equal(queue.undo().id, 'g1');
  assert.deepEqual([...queue.snapshot().hidden], []);
  fire();
  await tick(); await tick();
  assert.deepEqual(api.calls, []);
  assert.deepEqual(log, { deleted: [], failed: [] });
});

test('a delete that went through stays gone: hidden until the answer, then reported as deleted', async () => {
  const api = server();
  const { queue, log, fire } = undoRig(api);
  queue.remove({ id: 'g1', title: 'Chain rule' });
  fire();
  // The request is out: the row must not flash back into the list.
  assert.deepEqual([...queue.snapshot().hidden], ['g1']);
  await tick(); await tick();
  assert.deepEqual(api.guides.map(guide => guide.id), ['g2']);
  assert.deepEqual(log.deleted, ['g1']);
  assert.deepEqual([...queue.snapshot().hidden], []);
});

test('a delete that failed comes back with the reason, never silently', async () => {
  const api = server();
  const { queue, log, fire } = undoRig(api);
  api.down = 'network';
  queue.remove({ id: 'g1', title: 'Chain rule' });
  fire();
  assert.deepEqual([...queue.snapshot().hidden], ['g1']);
  await tick(); await tick();
  assert.deepEqual(log.deleted, []);
  assert.deepEqual(log.failed, [['g1', MESSAGES.offline]]);
  assert.deepEqual([...queue.snapshot().hidden], []);
  assert.equal(api.guides.length, 2);
});

test('deleting a second item sends the first right away and keeps both hidden', async () => {
  const api = server();
  const { queue, log, fire } = undoRig(api);
  queue.remove({ id: 'g1', title: 'One' });
  const first = queue.remove({ id: 'g2', title: 'Two' });
  assert.deepEqual([...queue.snapshot().hidden].sort(), ['g1', 'g2']);
  await first;
  assert.deepEqual(log.deleted, ['g1']);
  fire();
  await tick(); await tick();
  assert.deepEqual(log.deleted, ['g1', 'g2']);
  assert.equal(api.guides.length, 0);
});

test('leaving the page hands over what is waiting, once', () => {
  const { queue, fire } = undoRig(server());
  queue.remove({ id: 'g1', title: 'One' });
  assert.equal(queue.leave().id, 'g1');
  assert.equal(queue.leave(), null);
  fire();
  assert.deepEqual([...queue.snapshot().hidden], []);
});

// A list that loads while the student moves or deletes -------------------------------------------------
test('a list asked for before a move and answered after it does not undo the move', () => {
  const changes = createLocalChanges();
  const before = [{ id: 'g1', folder_id: MGT }, { id: 'g2', folder_id: MGT }, { id: 'g3', folder_id: MGT }];
  changes.begin(); // the load starts...
  changes.moved('g1', FILM); // ...the student files g1 in another class and deletes g3...
  changes.removed(['g3']);
  // ...and the load answers with how things were when it started.
  assert.deepEqual(changes.apply(before), [{ id: 'g1', folder_id: FILM }, { id: 'g2', folder_id: MGT }]);
  // A load that starts after the move reads it from the server: nothing left to apply.
  changes.begin();
  assert.deepEqual(changes.apply([{ id: 'g1', folder_id: FILM }]), [{ id: 'g1', folder_id: FILM }]);
});

// The Recent chats data module ---------------------------------------------------------------------------
test("a guide moved to another class moves its chats too, without waiting for the 30-second cache", async () => {
  const guides = [{ id: 'g-derivs', folder_id: MGT }];
  const saved = [{ id: 'c-1', title: 'Chain rule', guide_id: 'g-derivs', updated_at: '2026-11-17T15:10:00Z' }];
  const request = async path => {
    await tick();
    const route = path.split('?')[0];
    if (route === '/guides') return ok({ guides: guides.map(guide => ({ ...guide })) });
    if (route === '/tutor/chats') return ok({ chats: saved });
    if (route === '/tutor/session') return ok({ id: 's-1', messages: [], conversation_version: 1 });
    return status(404, 'Not Found');
  };
  const store = createChatStore({ request, identify: () => 'user-a', onTutorChanged() {} });
  assert.deepEqual((await store.classChats(MGT)).chats.map(chat => chat.id), ['c-1']);
  guides[0].folder_id = FILM; // moved on the Library page
  store.guidesChanged();
  assert.deepEqual((await store.classChats(MGT)).chats.map(chat => chat.id), []);
  assert.deepEqual((await store.classChats(FILM)).chats.map(chat => chat.id), ['c-1']);
});

test('guidesChanged tells whoever shows a class\'s chats to ask again', async () => {
  const store = createChatStore({ request: async () => status(404, 'Not Found'), identify: () => 'user-a', onTutorChanged() {} });
  let heard = 0;
  store.subscribe(() => { heard += 1; });
  store.guidesChanged();
  assert.equal(heard, 1);
});

// The pages use it ---------------------------------------------------------------------------------------
test('Library: a failed move shows its message; a deleted row leaves the lists; errors reload quietly', () => {
  const library = read('pages/library.js');
  assert.match(library, /const result = await moveGuide\(item\.id, folderId\)/);
  assert.match(library, /if \(!result\.ok\) \{\s*setToast\(result\.message\)/);
  assert.match(library, /onDeleted: item => \{[\s\S]*?setGuides\(current => current\.filter\(guide => !ids\.includes\(guide\.id\)\)\)/);
  assert.match(library, /onFailed: \(_item, message\) => \{ setToast\(message\); loadData\(\{ quiet: true \}\); \}/);
  assert.match(library, /rows\.filter\(row => !hidden\.has\(row\.id\)\)/);
  // An older answer never overwrites a newer one or a change made meanwhile.
  assert.match(library, /if \(mine !== loadSeq\.current\) return;/);
  assert.match(library, /setGuides\(local\.current\.apply\(guidesData\.guides\)\)/);
  // The message shows even while an Undo toast is waiting.
  assert.match(library, /\{toast \? <div className="c-toast" role="status"><span>\{toast\}<\/span><\/div> : pending && \(/);
  assert.doesNotMatch(library, /apiFetch\('\/guides\/' \+ item\.id \+ '\/move'/);
  assert.match(library, /const result = await removeClass\(folder\);[\s\S]*?if \(!result\.ok\) setToast\(result\.message\)/);
});

test("a class's page, a guide's page and the Tutor go through the same move and delete", () => {
  const folder = read('pages/folder/[id].js');
  assert.match(folder, /const result = await moveGuide\(item\.id, folderId\);\s*if \(!result\.ok\) \{\s*setToast\(result\.message\)/);
  assert.match(folder, /const result = await removeClass\(folder\);[\s\S]*?if \(!result\.ok\) \{ setToast\(result\.message\); return; \}\s*router\.push\('\/library'\)/);
  const guide = read('pages/guide/[id].js');
  assert.match(guide, /const result = await moveGuide\(id, folderId\)/);
  assert.match(guide, /\} else setToast\(result\.message\);/);
  assert.match(guide, /const result = await deleteGuideRequest\(id, noteId \? \['\/smart_notes\/' \+ noteId\] : \[\]\);\s*if \(!result\.ok\) \{ setToast\(result\.message\); return; \}/);
  const tutor = read('lib/useTutorChat.js');
  assert.match(tutor, /const done = await deleteGuide\(confirm\.guide_id\);\s*if \(!done\.ok\)/);
  assert.match(tutor, /if \(data\?\.action === 'organized_material'\) guidesReorganized\(\)/);
  assert.match(tutor, /window\.addEventListener\(GUIDES_ORGANIZED, onOrganized\)/);
  for (const [name, text] of [['library', read('pages/library.js')], ['folder', folder], ['guide', guide], ['tutor', tutor]]) {
    assert.doesNotMatch(text, /\/move', \{ method: 'PATCH'/, `${name} sends no move of its own`);
  }
});

test('the delete and move requests report failures (reportFailure) and their status', () => {
  const wiring = read('lib/guideActions.js');
  assert.match(wiring, /apiFetch\(path, \{ \.\.\.options, reportFailure: true, withStatus: true \}\)/);
  assert.match(wiring, /guidesChanged\(\);/);
  assert.match(read('lib/undoDelete.js'), /send: sendDelete/);
});
