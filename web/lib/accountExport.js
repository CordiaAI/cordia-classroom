import { authOnlyHeaders } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Settings › Account, "Download my data": the student's own data as one JSON file (backend
// services/account_export.py), saved through a blob link. True when the download started.
export async function downloadMyData() {
  const response = await fetch(`${API}/auth/account/export`, { headers: authOnlyHeaders() }).catch(() => null);
  if (!response?.ok) return false;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `cordia-classroom-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}
