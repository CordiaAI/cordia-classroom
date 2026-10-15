export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record.
export function openNewSheet(mode = '') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode } }));
}
