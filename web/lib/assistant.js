import { getToken } from './api';

// Cordia Assistant (texting) is its own app behind /assistant (next.config.js rewrites). Its API
// takes the student's Classroom token, the same one the backend uses, so there's no second login.
const BASE = '/assistant/api';

// One id per visit to the settings page: the Assistant texts one summary of changes per visit.
let visit = '';
function visitId() {
  if (!visit) visit = (crypto.randomUUID?.() || String(Date.now())).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  return visit;
}

// Returns { ok, status, data } and never throws: callers show `data.error` when !ok.
export async function assistantApi(path, { method = 'GET', json } = {}) {
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${getToken() || ''}`,
        'x-cordia-session': visitId(),
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Can't reach the Assistant. Check your connection and try again." } };
  }
}

// A file download (the student's data export) with the token, saved through a blob link.
export async function assistantDownload(path, filename) {
  const response = await fetch(BASE + path, { headers: { Authorization: `Bearer ${getToken() || ''}` } }).catch(() => null);
  if (!response?.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

export function formatPhone(input) {
  const d = String(input).replace(/\D/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
