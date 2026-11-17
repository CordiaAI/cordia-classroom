export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record.
// files: File objects to start the upload with, or already-read files ({ name, type, size, lastModified, readText },
// e.g. a Canvas file Cordia read on the server).
// text, title: text to start Paste with (e.g. an imported Doc), and the guide's name for it.
// url: a link to start Link with. folderId: the class the guide goes in.
// create: build straight away, exactly as if Create were pressed (the composer's "make a guide").
export function openNewSheet(mode = '', { files, text, title, url, folderId, create = false } = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode, files, text, title, url, folderId, create } }));
}
