// A Learn round, quiz or NCLEX set in progress, kept in this browser after every answer so a
// refresh (or closing the tab by accident) picks up at the same question instead of starting over.
// One per screen per guide; it's dropped when the session finishes, and a day-old one is ignored.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const key = (kind, guideId) => `cordiaResume:${kind}:${guideId}`;

export function readResume(kind, guideId) {
  try {
    const saved = JSON.parse(localStorage.getItem(key(kind, guideId)) || 'null');
    return saved && Date.now() - saved.savedAt < MAX_AGE_MS ? saved : null;
  } catch {
    return null; // storage blocked or the copy unreadable: start fresh
  }
}

export function writeResume(kind, guideId, data) {
  try { localStorage.setItem(key(kind, guideId), JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* full or blocked: this visit only */ }
}

export function clearResume(kind, guideId) {
  try { localStorage.removeItem(key(kind, guideId)); } catch { /* nothing kept */ }
}
