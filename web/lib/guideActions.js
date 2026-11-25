import { apiFetch } from './api';
import { guidesChanged } from './chats';
import { invalidateFolders } from './folders';
import * as actions from './guideActions.mjs';

export { CAUSES, SUBJECTS, createLocalChanges, createUndoQueue, deleteItem, failureMessage, moveAndReport, movedMessage, pathsOf, toastMs } from './guideActions.mjs';

// Fired after a guide was moved to another class or deleted from any page, so what keeps its own copy
// of the guides (the Tutor's guide list, a class's Chats tab) can catch up without asking again.
// detail: { ids: [guide ids], folderId?: the class it went to (null: no class), deleted?: true,
// classDeleted?: a class was deleted: its guides are in no class now, source?: the page that made the
// change ('library'): that page already shows it and does not read its lists again }
export const GUIDES_ORGANIZED = 'cordia:guides-organized';

// Every request answers with its body and HTTP status, or { failed } when there was no answer.
export const request = (path, options = {}) => apiFetch(path, { ...options, reportFailure: true, withStatus: true });

function announce(detail) {
  guidesChanged();
  try { window.dispatchEvent(new CustomEvent(GUIDES_ORGANIZED, { detail })); } catch { /* not in a browser */ }
}

// Something changed guides without saying which (the Tutor filed one for the student): everything that
// keeps its own copy of the guides looks again.
export const guidesReorganized = () => announce({ ids: [] });

// { ok, folderId, unsharedFrom } or { ok: false, message, gone, folderMissing }. source: the page asking.
export async function moveGuide(id, folderId, { source } = {}) {
  const result = await actions.moveGuide(request, id, folderId);
  if (result.ok) announce({ ids: [id], folderId: result.folderId, source });
  // The class list we showed is out of date (the class was deleted somewhere else): look again next time.
  else if (result.folderMissing) invalidateFolders();
  return result;
}

// also: more paths that go with it (the note a guide was made from).
export async function deleteGuide(id, also = [], { source } = {}) {
  const result = await actions.deleteItem(request, { id, also });
  if (result.ok || result.partial) announce({ ids: [id], deleted: true, source });
  return result;
}

// Delete a class (and leave its shared class). { ok } or { ok: false, message, partial? }.
export async function removeClass(folder, { source } = {}) {
  const result = await actions.removeClass(request, folder);
  // The class list we showed (the sidebar, Library) is out of date whatever happened.
  invalidateFolders();
  if (result.ok || result.partial) announce({ ids: [], classDeleted: folder.id, source });
  return result;
}

// What the Undo queue sends: the item and the things that go with it. source: the page that owns the queue.
export const sendDeleteFrom = source => async item => {
  const result = await actions.deleteItem(request, item);
  if ((result.ok || result.partial) && (!item.path || item.path.startsWith('/guides/'))) announce({ ids: [item.id], deleted: true, source });
  return result;
};
export const sendDelete = sendDeleteFrom(undefined);

// A sentence to show on the page the student lands on next (a class deleted from its own page goes to
// Library; a partly done delete there still needs saying). Read once, by that page.
let carried = '';
export const carryNotice = message => { carried = message || ''; };
export const takeNotice = () => { const message = carried; carried = ''; return message; };
