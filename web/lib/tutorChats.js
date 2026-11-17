import { apiFetch } from './api';

// Recent chats for the sidebar: the Tutor's open conversation and its saved chats (GET /tutor/chats).
// The Tutor (components/AIChatWidget.js) is always mounted, so it reports its conversation here as
// it changes, and says when the saved list changed (a new chat started, one resumed or deleted).
let live = [];
const listeners = new Set();

export function liveMessages() {
  return live;
}

export function reportTutorSession(messages) {
  const next = Array.isArray(messages) ? messages : [];
  const before = live.filter(message => message?.role === 'user').length;
  live = next;
  if (next.filter(message => message?.role === 'user').length !== before) listeners.forEach(listener => listener({ saved: false }));
}

export function tutorChatsChanged() {
  listeners.forEach(listener => listener({ saved: true }));
}

export function onTutorChats(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The saved chats, newest first; [] when there are none or the list can't load.
export async function loadSavedChats() {
  const data = await apiFetch('/tutor/chats').catch(() => null);
  return Array.isArray(data?.chats) ? data.chats : [];
}
