import { apiErrorMessage, authOnlyHeaders, responseJson } from './api';

// Practice from a file: Library's Practice filter reads the file, then the workspace picks it up.
// It's never saved, so it's handed over in memory for the one in-app navigation (a reload of
// /practice simply goes back to Library). Kept out of web storage on purpose.
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
let handed = null;
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
  handed = upload;
}

export function takeUpload() {
  const upload = handed;
  handed = null;
  return upload?.content ? upload : null;
}
