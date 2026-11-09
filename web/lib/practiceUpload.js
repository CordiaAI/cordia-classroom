import { apiErrorMessage, authOnlyHeaders, responseJson } from './api';
import { unsupportedFileMessage } from './fileDrop';

// Practice from a file: Library's Practice filter reads the file, then the workspace picks it up.
// It's never saved, so it's handed over in memory for the one in-app navigation (a reload of
// /practice simply goes back to Library). Kept out of web storage on purpose.
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
let handed = null;

export async function readPracticeFile(file) {
  // The picker offers the upload types only, but "All files" in the system dialog can pick anything.
  const problem = unsupportedFileMessage(file);
  if (problem) throw new Error(problem);
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
