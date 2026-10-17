import { apiErrorMessage, authHeaders, responseJson } from './api';

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// SmartNotes requests throw a readable message on any failure, so callers can show it.
export async function notesRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(API + path, {
      ...options,
      headers: { ...authHeaders(), 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new Error(apiErrorMessage('Failed to fetch'));
  }
  const data = await responseJson(response);
  if (!response.ok) throw Object.assign(new Error(data?.detail || apiErrorMessage('')), { status: response.status });
  return data;
}

export function saveErrorMessage(status) {
  if (status === 401) return 'Your session expired. Sign in again to save this note.';
  if (status === 413 || status === 422) return 'This note is too large to save. Split it into two notes.';
  return 'Could not save this note. Check your connection and try again.';
}
