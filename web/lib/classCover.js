import { apiFetch, authOnlyHeaders } from './api';
import { coverFor } from './coverDesign.mjs';
import { invalidateFolders } from './folders';

// A class's cover in Library's card view: a colour and subject icons (lib/coverDesign.mjs).

export async function pickIcons(name, titles = []) {
  try {
    const response = await fetch('/api/cover-icons', {
      method: 'POST',
      headers: { ...authOnlyHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, titles: titles.slice(0, 15) }),
    });
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data.icons) && data.icons.length ? data.icons : null;
  } catch {
    return null;
  }
}

export async function saveCover(folderId, { color, icons }) {
  const data = await apiFetch(`/folders/${folderId}/cover`, { method: 'PUT', body: JSON.stringify({ kind: 'design', color, icons }) });
  if (data?.folder) invalidateFolders({ notify: false });
  return data?.folder ? { folder: data.folder } : { error: data?.detail || 'Cover not saved' };
}

export async function removeCover(folderId) {
  const data = await apiFetch(`/folders/${folderId}/cover`, { method: 'DELETE' });
  if (data?.folder) invalidateFolders({ notify: false });
  return data?.folder ? { folder: data.folder } : { error: data?.detail || 'Cover not removed' };
}

// A class without a saved cover gets AI-picked icons in its colour, kept for next time.
export async function designCover(folder, titles) {
  const first = coverFor(folder, titles);
  const icons = (await pickIcons(folder.name, titles)) || first.icons;
  const cover = { kind: 'design', color: first.color, icons };
  await saveCover(folder.id, cover);
  return cover;
}
