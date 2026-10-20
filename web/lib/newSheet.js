export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record.
// files: File objects to start the upload with (e.g. a Canvas file).
export function openNewSheet(mode = '', { files } = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode, files } }));
}
