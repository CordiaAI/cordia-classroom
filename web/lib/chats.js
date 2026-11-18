import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from './api';
import { onTutorChats } from './tutorChats';
import { createChatStore } from './chatStore.mjs';

// Saved chats in the browser: one store for this page load (the rules: lib/chatStore.mjs). The chat
// page (pages/home.js, also at /chat/[id]), the sidebar's Recent chats (components/Sidebar.js) and a
// class page's Chats tab read and change chats only through here.
//
// For a class page's Chats tab:
//   classChats(classId) -> Promise<{ chats: Chat[], editable: boolean, failed: boolean }>
//   onChatsChanged(listener) -> unsubscribe; call classChats again when it fires.
//   Chat: { id, title, guide_id, class_id, live, created_at, updated_at }, newest activity first.
//   Each opens at chatHref(chat.id). title is '' until the chat has a first message ("Tutor chat").

// Every request answers with its body and HTTP status, or { failed } when there was no answer.
const request = (path, options = {}) => apiFetch(path, { ...options, reportFailure: true, withStatus: true });

// Deleting the live chat, or starting or opening one, changes the Tutor's conversation: any Tutor
// on the page reloads its session (lib/useTutorChat.js listens).
const tutorChanged = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('cordia:tutor-refresh')); };

const store = createChatStore({ request, onTutorChanged: tutorChanged });

if (typeof window !== 'undefined') {
  // The Tutor panel or page started, resumed or deleted a chat, or its conversation grew.
  onTutorChats(() => store.refreshSoon());
  // Another tab may have changed things: look again when this one comes back (at most every 15s).
  const onBack = () => { if (!document.hidden) store.load({ maxAge: 15000 }); };
  window.addEventListener('focus', onBack);
  document.addEventListener('visibilitychange', onBack);
}

const serverSnapshot = { chats: null, editable: false, failed: false, loaded: false, toast: null };

// { chats, editable, failed, loaded, toast }, kept current. Loads the list the first time.
export function useChats() {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, () => serverSnapshot);
  useEffect(() => { store.load(); }, []);
  return snapshot;
}

export const chatHref = id => `/chat/${encodeURIComponent(id)}`;

export const loadChats = options => store.load(options);
export const getChat = id => store.getChat(id);
export const startChat = options => store.start(options);
export const openChat = (id, options) => store.openChat(id, options);
export const renameChat = (id, title) => store.rename(id, title);
export const moveChat = (id, classId) => store.move(id, classId);
export const deleteChat = id => store.remove(id);
export const restoreChat = id => store.restore(id);
export const classChats = classId => store.classChats(classId);
export const keepOpenChat = chat => store.keepOpen(chat);
export const showChatMessage = text => store.say(text);
export const dismissChatToast = id => store.dismiss(id);
export const onChatsChanged = listener => store.subscribe(listener);

// Where a chat opens without the new shell (switch off, or a phone): the Tutor page with that chat.
// The live conversation reopens as it is; a saved one through the Tutor page's own resume
// (/tutor?chat=<id>); a chat that can't be found sends the student to the Dashboard.
export async function tutorPageFor(id) {
  const found = await store.getChat(id);
  if (found.ok && found.chat.live) return { href: '/tutor', keep: true };
  if (found.ok) return { href: `/tutor?chat=${encodeURIComponent(found.chat.id)}`, keep: false };
  return { href: '/dashboard', keep: false };
}
