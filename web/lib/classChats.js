import { apiFetch } from './api';
import { loadSavedChats } from './tutorChats';
import { classChatsFrom } from './classPage.mjs';

// The class page's Chats tab: the Tutor conversations that belong to one class.
//
// This is the one seam between the page and where chats come from. Until saved chats get their own
// pages (docs/redesign/PLAN.md T5), they come from what exists today: the saved Tutor chats about
// one of the class's guides (GET /tutor/chats) and the Tutor's open conversation when it is about
// this class (GET /tutor/session), worked out in lib/classPage.mjs classChatsFrom. T5 replaces the
// body with GET /chats?class_id=<folderId>; the page keeps calling this with the same arguments and
// reads the same shape: [{ key, id, title, href, updatedAt, live }], newest first.
export async function loadClassChats(folderId, { guideIds = [] } = {}) {
  if (!folderId) return [];
  const [saved, session] = await Promise.all([
    loadSavedChats(),
    apiFetch('/tutor/session').catch(() => null),
  ]);
  return classChatsFrom({ saved, session: session?.id ? session : null, folderId, guideIds });
}
