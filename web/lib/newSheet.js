export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record.
// files: File objects to start the upload with, or already-read files ({ name, type, size, lastModified, readText },
// e.g. a Canvas file Cordia read on the server).
export function openNewSheet(mode = '', { files } = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode, files } }));
}
