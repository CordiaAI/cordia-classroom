export const NEW_SHEET_EVENT = 'cordia:new';

// Opens the "New guide" sheet from anywhere. mode: upload | paste | link | record | cards.
// extra.guideId with mode "cards" edits that guide's cards.
export function openNewSheet(mode = '', extra = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NEW_SHEET_EVENT, { detail: { mode, ...extra } }));
}
