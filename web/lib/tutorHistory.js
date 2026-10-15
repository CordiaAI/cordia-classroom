import { getUserId } from './api';

// Past Tutor chats, kept on this device. The Tutor opens to an empty chat; the turns it
// hides are saved here so History can show them.
const MAX = 30;
const key = () => `tutorHistory:${getUserId() || 'anon'}`;

export function readChatHistory() {
  try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; }
}

export function archiveChat(messages) {
  const clean = (messages || []).filter(item => item?.text && (item.role === 'user' || item.role === 'ai' || item.role === 'assistant')).map(item => ({ role: item.role === 'user' ? 'user' : 'ai', text: String(item.text).slice(0, 4000) }));
  const first = clean.find(item => item.role === 'user');
  if (!first) return;
  const title = first.text.replace(/\s+/g, ' ').slice(0, 80);
  const list = readChatHistory().filter(item => !(item.title === title && item.count === clean.length));
  list.unshift({ at: new Date().toISOString(), title, count: clean.length, messages: clean.slice(-40) });
  try { localStorage.setItem(key(), JSON.stringify(list.slice(0, MAX))); } catch { /* storage full or blocked */ }
}
