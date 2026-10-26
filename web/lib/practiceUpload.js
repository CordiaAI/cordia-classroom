import { apiErrorMessage, authOnlyHeaders, responseJson } from './api';

// Practice from a file: Library's Practice filter reads the file, then the workspace picks it up
// (it's never saved, so it rides in this tab's sessionStorage for the one hop).
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = 'cordiaPracticeUpload';
export const PRACTICE_FILES = '.pdf,.docx,.pptx,.txt';

export async function readPracticeFile(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(API + '/extract-file-text', { method: 'POST', headers: authOnlyHeaders(), body: form });
  const data = await responseJson(response);
  if (!response.ok || !data?.text) throw new Error(apiErrorMessage(data?.detail, 'This file could not be read.'));
  return { title: file.name, content: data.text };
}

export function handOffUpload(upload) {
  try { sessionStorage.setItem(KEY, JSON.stringify(upload)); return true; } catch { return false; }
}

export function takeUpload() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const upload = raw ? JSON.parse(raw) : null;
    return upload?.content ? upload : null;
  } catch { return null; }
}
