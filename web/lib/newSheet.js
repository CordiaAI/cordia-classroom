export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record.
// files: File objects to start the upload with (e.g. a Canvas file).
// text, title: text to start Paste with (e.g. an imported Doc), and the guide's name for it.
export function openNewSheet(mode = '', { files, text, title } = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode, files, text, title } }));
}
