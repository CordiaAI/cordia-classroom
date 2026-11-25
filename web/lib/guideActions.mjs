// Moving a guide to another class and deleting one (feedback F3). The rules, with no browser in them so
// they can be tested: lib/guideActions.js wires them to the backend and to the pages.
//
// What went wrong before: a move or a delete that failed (offline, a slow first answer, an expired
// session, a class deleted in another tab) came back as nothing, and the page said nothing; a delete
// that did go through left the row in the page's list, so it came back when the Undo toast ended.
// Now every request is judged by its HTTP status and its body, and the answer is either done, or a
// plain sentence for the student.

// Every failure names what did not happen and why, so the student knows whether to try again.
export const SUBJECTS = {
  move: "That guide wasn't moved",
  delete: "That guide wasn't deleted",
  deleteNote: "That note wasn't deleted",
  deleteClass: "That class wasn't deleted",
};
export const CAUSES = {
  offline: "Classroom couldn't be reached.",
  slow: 'Classroom took too long to answer.',
  server: 'Classroom ran into a problem.',
};

const done = status => status >= 200 && status < 300;

// A server sentence made fit to follow a colon: one sentence, ending in a full stop, no exclamation.
const sentence = text => { const plain = String(text).trim().replace(/!+$/, ''); return /[.?]$/.test(plain) ? plain : `${plain}.`; };

// Why a request did not go through, as a sentence, or '' when nothing is known. The server's own words
// are used only for a 4xx (its detail is written for the student, lib/api.js); a 5xx says so plainly
// instead of showing whatever the server happened to print.
export function causeOf(data) {
  if (data?.failed === 'timeout') return CAUSES.slow;
  if (data?.failed === 'network') return CAUSES.offline;
  const status = Number(data?.httpStatus) || 0;
  if (status >= 500) return CAUSES.server;
  const detail = typeof data?.detail === 'string' ? data.detail.trim() : '';
  return status >= 400 && detail ? sentence(detail) : '';
}

// "<what did not happen>: <why> Try again." A 4xx reason is the server's, and retrying will not change it,
// so it ends there. `data` is { failed } or an answer with its httpStatus (or null when signed out).
export function failureMessage(data, subject, { retry = true } = {}) {
  const cause = causeOf(data);
  const status = Number(data?.httpStatus) || 0;
  const again = retry && !(status >= 400 && status < 500 && cause) ? ' Try again.' : '';
  return cause ? `${subject}: ${cause}${again}` : `${subject}.${again}`;
}

// The toast after a move. unsharedFrom: the shared class a shared guide stopped being shared with (the
// answer's unshared_from). Policy to confirm: it goes private, the new class's share default is not applied.
export function movedMessage(className, unsharedFrom) {
  return `Moved to ${className}${unsharedFrom ? `. No longer shared with ${unsharedFrom}.` : ''}`;
}

// How long a message stays: a long one (a reason, or a move that also changed sharing) takes longer to read.
export const toastMs = text => (String(text).length > 45 ? 6000 : 2500);

// request(path, options) resolves like apiFetch with reportFailure and withStatus: the body and its
// httpStatus, or { failed, detail } when there was no answer (or null when signed out).
export async function moveGuide(request, id, folderId) {
  const target = folderId || null;
  const data = await request(`/guides/${encodeURIComponent(id)}/move`, { method: 'PATCH', body: JSON.stringify({ folder_id: target }) });
  const status = Number(data?.httpStatus) || 0;
  // Only the server's own "updated, and to here" counts: an empty or odd body is not a move.
  if (done(status) && data?.updated === true && (data.folder_id || null) === target) {
    return { ok: true, folderId: target, unsharedFrom: typeof data.unshared_from === 'string' ? data.unshared_from : '' };
  }
  const folderMissing = status === 404 && /folder|class/i.test(String(data?.detail || ''));
  const gone = status === 404 && !folderMissing;
  return {
    ok: false, gone, folderMissing,
    message: folderMissing ? `${SUBJECTS.move} because that class no longer exists.` : gone ? `${SUBJECTS.move} because it no longer exists.` : failureMessage(data, SUBJECTS.move),
  };
}

// What a page does with a move: ask for it, then say what happened. Pages call this and only show the
// result: message for the toast, reload when what the page lists is out of date (the guide or the class
// is gone). className is what the student calls the place it went.
export async function moveAndReport(move, { id, folderId, className }) {
  const result = await move(id, folderId);
  if (!result.ok) return { ok: false, message: result.message, reload: Boolean(result.gone || result.folderMissing) };
  return { ok: true, folderId: result.folderId, message: movedMessage(className, result.unsharedFrom), unsharedFrom: result.unsharedFrom };
}

// One delete. A 404 means it is already gone (another tab, a second try after the first answer was
// lost): the student's goal is met, so it counts as done.
export async function deletePath(request, path, subject = SUBJECTS.delete, key = 'deleted') {
  const data = await request(path, { method: 'DELETE' });
  const status = Number(data?.httpStatus) || 0;
  if (done(status) && data?.[key] === true) return { ok: true };
  if (status === 404) return { ok: true, gone: true };
  return { ok: false, message: failureMessage(data, subject), cause: causeOf(data) };
}

export const deleteGuide = (request, id) => deletePath(request, `/guides/${encodeURIComponent(id)}`);

export const pathsOf = item => [item.path || `/guides/${item.id}`, ...(item.also || [])];

const subjectOf = path => (path.startsWith('/smart_notes/') ? SUBJECTS.deleteNote : SUBJECTS.delete);

// Delete an item with everything that goes with it (a guide moved in from an old note takes the note).
// The first path is the item itself. If it is gone but a part is not, the answer is `partial`: the item
// no longer exists, so the page must not stay open on it; the message says what is left.
export async function deleteItem(request, item) {
  const paths = pathsOf(item);
  const results = await Promise.all(paths.map(path => deletePath(request, path, subjectOf(path))));
  const [main, ...parts] = results;
  const failed = results.filter(result => !result.ok);
  if (!main.ok) return { ok: false, message: main.message, failedCount: failed.length };
  const left = parts.filter(result => !result.ok);
  if (!left.length) return { ok: true };
  const cause = left[0].cause;
  const subject = `That guide was deleted, but its note wasn't`;
  return { ok: false, partial: true, message: cause ? `${subject}: ${cause}` : `${subject}.`, failedCount: left.length };
}

// Delete a class: its Library folder first, then (when it has a course code) leaving the shared class, so a
// folder that could not be deleted is not left behind with its class already gone. If the folder is gone
// but the shared class was not left, the answer is `partial` (the class page no longer exists).
export async function removeClass(request, folder) {
  const gone = await deletePath(request, `/folders/${encodeURIComponent(folder.id)}`, SUBJECTS.deleteClass);
  if (!gone.ok) return gone;
  if (!folder.class_id) return { ok: true };
  const left = await deletePath(request, `/classes/${encodeURIComponent(folder.class_id)}`, SUBJECTS.deleteClass, 'ok');
  if (left.ok) return left;
  const subject = `${folder.name || 'That class'} was deleted, but you are still in its shared class`;
  return { ok: false, partial: true, message: left.cause ? `${subject}: ${left.cause}` : `${subject}.` };
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
    try { result = await send(item); } catch { result = { ok: false, message: failureMessage(null, SUBJECTS.delete) }; }
    sending.delete(item.id);
    publish();
    if (result?.ok) onDeleted(item); else onFailed(item, result?.message || failureMessage(null, SUBJECTS.delete));
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
