import { apiFetch, authHeaders, authOnlyHeaders } from './api';

// Browser side of the Lectures section (/api/lectures/*, lib/server/lectureLibrary.mjs).

export function localDate(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function call(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`/api/lectures/${path}`, {
      method,
      headers: body ? authHeaders() : authOnlyHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return response.ok ? data : { ...(data || {}), failed: true, status: response.status };
  } catch {
    return { failed: true, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// Saving reads the whole lecture with AI once, so it gets up to a minute.
export const saveLecture = body => call('save', { method: 'POST', body, timeoutMs: 65000 });
export const listLectures = () => call('list');
export const getLecture = id => call(`get?id=${encodeURIComponent(id)}`);
export const updateLecture = body => call('update', { method: 'POST', body });
export const deleteLecture = id => call('delete', { method: 'POST', body: { id } });
export const updateTodo = body => call('todo', { method: 'POST', body });
export const confirmedTodos = () => call('todos');
// Writes the notes for a lecture saved without them (and files its note in the Notes tab).
export const analyzeLecture = id => call('analyze', { method: 'POST', body: { id }, timeoutMs: 65000 });

// When a lecture can't be saved, the recording still lands in Notes (Classroom API), so a
// transcript is never lost. Returns the note id, or '' if that fails too.
export async function saveTranscriptNote({ title, transcript, folderId }) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = [];
  let current = '';
  for (const sentence of String(transcript || '').split(/(?<=[.!?])\s+/)) {
    current = current ? `${current} ${sentence}` : sentence;
    if (current.length > 500) { paragraphs.push(current); current = ''; }
  }
  if (current) paragraphs.push(current);
  const created = await apiFetch('/smart_notes', { method: 'POST', body: JSON.stringify({ title }) });
  const id = created?.note?.id;
  if (!id) return '';
  await apiFetch(`/smart_notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, content: paragraphs.map(text => `<p>${escape(text)}</p>`).join(''), ...(folderId ? { folder_id: folderId } : {}) }),
  });
  return id;
}

export function clock(ms) {
  const total = Math.floor((ms || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function dueLabel(dueAt) {
  if (!dueAt) return 'No date';
  return new Date(dueAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export { lectureCalendarItems, mergeCalendarItems } from './lectureCalendar.mjs';
