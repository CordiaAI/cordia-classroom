import { apiFetch } from './api';
import { guidesChanged } from './chats';
import { invalidateFolders } from './folders';
import * as actions from './guideActions.mjs';

export { MESSAGES, createLocalChanges, createUndoQueue, deleteItem, failureMessage, pathsOf } from './guideActions.mjs';

// Fired after a guide was moved to another class or deleted from any page, so what keeps its own copy
// of the guides (the Tutor's guide list, a class's Chats tab) can catch up without asking again.
// detail: { ids: [guide ids], folderId?: the class it went to (null: no class), deleted?: true,
// classDeleted?: a class was deleted: its guides are in no class now }
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

// { ok, folderId } or { ok: false, message, gone, folderMissing }.
export async function moveGuide(id, folderId) {
  const result = await actions.moveGuide(request, id, folderId);
  if (result.ok) announce({ ids: [id], folderId: result.folderId });
  // The class list we showed is out of date (the class was deleted somewhere else): look again next time.
  else if (result.folderMissing) invalidateFolders();
  return result;
}

// also: more paths that go with it (the note a guide was made from).
export async function deleteGuide(id, also = []) {
  const result = await actions.deleteItem(request, { id, also });
  if (result.ok) announce({ ids: [id], deleted: true });
  return result;
}

// Delete a class (and leave its shared class). { ok } or { ok: false, message }.
export async function removeClass(folder) {
  const result = await actions.removeClass(request, folder);
  // The class list we showed (the sidebar, Library) is out of date whatever happened.
  invalidateFolders();
  if (result.ok) announce({ ids: [], classDeleted: folder.id });
  return result;
}

// What the Undo queue sends: the item and the things that go with it.
export async function sendDelete(item) {
  const result = await actions.deleteItem(request, item);
  if (result.ok && (!item.path || item.path.startsWith('/guides/'))) announce({ ids: [item.id], deleted: true });
  return result;
}
