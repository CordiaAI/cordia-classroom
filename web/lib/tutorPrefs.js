// The Tutor's settings that live on this device (Settings › Tutor).
const MODE_KEY = 'cordiaTutorMode';

// Modes a student can keep on for every chat. Auto picks from what they ask.
export const TUTOR_MODES = [
  { id: '', label: 'Auto', detail: 'Picks from what you ask' },
  { id: 'explain', label: 'Explain', detail: 'Explains your material' },
  { id: 'practice', label: 'Practice', detail: 'Makes practice problems' },
  { id: 'retain', label: 'Retain', detail: 'Helps you remember' },
  { id: 'plan', label: 'Plan', detail: 'Plans your study time' },
];

export function tutorMode() {
  try {
    const saved = localStorage.getItem(MODE_KEY) || '';
    return TUTOR_MODES.some(mode => mode.id === saved) ? saved : '';
  } catch { return ''; }
}

export function setTutorMode(id) {
  try {
    if (id) localStorage.setItem(MODE_KEY, id);
    else localStorage.removeItem(MODE_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent('cordia:tutor-mode', { detail: { mode: id } }));
}
