// Moving a guide to another class and deleting one (feedback F3). The rules, with no browser in them so
// they can be tested: lib/guideActions.js wires them to the backend and to the pages.
//
// What went wrong before: a move or a delete that failed (offline, a slow first answer, an expired
// session, a class deleted in another tab) came back as nothing, and the page said nothing; a delete
// that did go through left the row in the page's list, so it came back when the Undo toast ended.
// Now every request is judged by its HTTP status and its body, and the answer is either done, or a
// plain sentence for the student.

export const MESSAGES = {
  move: "That didn't move. Try again.",
  delete: "That didn't delete. Try again.",
  deleteClass: "That class didn't delete. Try again.",
  offline: "Couldn't reach Classroom. Check your connection and try again.",
  slow: 'Classroom took too long to answer. Try again.',
};

const done = status => status >= 200 && status < 300;

// The sentence for a request that did not go through. `detail` is already plain (lib/api.js).
export function failureMessage(data, fallback) {
  if (data?.failed === 'timeout') return MESSAGES.slow;
  if (data?.failed === 'network') return MESSAGES.offline;
  const detail = typeof data?.detail === 'string' ? data.detail.trim() : '';
  return detail || fallback;
}

// request(path, options) resolves like apiFetch with reportFailure and withStatus: the body and its
// httpStatus, or { failed, detail } when there was no answer (or null when signed out).
export async function moveGuide(request, id, folderId) {
  const target = folderId || null;
  const data = await request(`/guides/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ folder_id: target }) });
  const status = Number(data?.httpStatus) || 0;
  // Only the server's own "updated, and to here" counts: an empty or odd body is not a move.
  if (done(status) && data?.updated === true && (data.folder_id || null) === target) return { ok: true, folderId: target };
  const folderMissing = status === 404 && /folder|class/i.test(String(data?.detail || ''));
  const gone = status === 404 && !folderMissing;
  return {
    ok: false, gone, folderMissing,
    message: folderMissing ? 'That class no longer exists.' : gone ? 'That guide no longer exists.' : failureMessage(data, MESSAGES.move),
  };
}

// One delete. A 404 means it is already gone (another tab, a second try after the first answer was
// lost): the student's goal is met, so it counts as done.
export async function deletePath(request, path, fallback = MESSAGES.delete, key = 'deleted') {
  const data = await request(path, { method: 'DELETE' });
  const status = Number(data?.httpStatus) || 0;
  if (done(status) && data?.[key] === true) return { ok: true };
  if (status === 404) return { ok: true, gone: true };
  return { ok: false, message: failureMessage(data, fallback) };
}

export const deleteGuide = (request, id) => deletePath(request, `/guides/${encodeURIComponent(id)}`);

export const pathsOf = item => [item.path || `/guides/${item.id}`, ...(item.also || [])];

// Delete an item with everything that goes with it (a guide moved in from an old note takes the note).
export async function deleteItem(request, item) {
  const results = await Promise.all(pathsOf(item).map(path => deletePath(request, path)));
  const failed = results.filter(result => !result.ok);
  return failed.length ? { ok: false, message: failed[0].message, failedCount: failed.length } : { ok: true };
}

// Delete a class: its Library folder first, then (when it has a course code) leaving the shared class, so a
// folder that could not be deleted is not left behind with its class already gone.
export async function removeClass(request, folder) {
  const gone = await deletePath(request, `/folders/${encodeURIComponent(folder.id)}`, MESSAGES.deleteClass);
  if (!gone.ok) return gone;
  if (!folder.class_id) return { ok: true };
  return deletePath(request, `/classes/${encodeURIComponent(folder.class_id)}`, MESSAGES.deleteClass, 'ok');
}

// Delete with a few seconds to Undo. The row is hidden at once and stays hidden until the server has
// answered; then it is gone for good (onDeleted) or it comes back with the reason (onFailed), so the
// list never shows something the server deleted, or hides something it kept.
export function createUndoQueue({ send, delay = 6000, onChange = () => {}, onDeleted = () => {}, onFailed = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let pending = null;
  let timer = null;
  const sending = new Map(); // id -> item whose request is out
  let snapshot = { pending: null, hidden: new Set() };

  function publish() {
    snapshot = { pending, hidden: new Set([...(pending ? [pending.id] : []), ...sending.keys()]) };
    onChange(snapshot);
  }

  async function commit(item) {
    sending.set(item.id, item);
    publish();
    let result;
    try { result = await send(item); } catch { result = { ok: false, message: MESSAGES.delete }; }
    sending.delete(item.id);
    publish();
    if (result?.ok) onDeleted(item); else onFailed(item, result?.message || MESSAGES.delete);
    return result;
  }

  function flush() {
    clearTimer(timer);
    const item = pending;
    pending = null;
    if (!item) { publish(); return Promise.resolve(null); }
    return commit(item);
  }

  return {
    snapshot: () => snapshot,
    pendingItem: () => pending,
    remove(item) {
      const earlier = pending ? flush() : null;
      pending = item;
      publish();
      timer = setTimer(flush, delay);
      return earlier;
    },
    undo() {
      clearTimer(timer);
      const item = pending;
      pending = null;
      publish();
      return item;
    },
    // The page is closing: hand over what is waiting (the caller sends it with keepalive) and forget it.
    leave() {
      clearTimer(timer);
      const item = pending;
      pending = null;
      publish();
      return item;
    },
    flush,
  };
}

// Changes made on this page while a list was loading. A list that was asked for before a move or a
// delete answers after it; applying it as it is would put the row back where it was.
export function createLocalChanges() {
  let moved = new Map();
  let removed = new Set();
  return {
    // A load is about to start: only changes from now on can be older than its answer.
    begin() { moved = new Map(); removed = new Set(); },
    moved(id, folderId) { moved.set(String(id), folderId || null); },
    removed(ids) { for (const id of ids) removed.add(String(id)); },
    // The load's rows with the changes made since it began.
    apply(rows, { folderKey = 'folder_id' } = {}) {
      return (rows || []).filter(row => !removed.has(String(row.id))).map(row => (moved.has(String(row.id)) ? { ...row, [folderKey]: moved.get(String(row.id)) } : row));
    },
  };
}
