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

// Voice mode's cloud voice (Pro and trial accounts; Free hears the browser's own voice). The keys match
// VOICES in backend/services/tutor_speech.py; the server maps them to voices and ignores anything else.
const VOICE_KEY = 'cordiaTutorVoice';
export const TUTOR_VOICES = [
  { id: 'matilda', label: 'Matilda', detail: 'Calm and warm' },
  { id: 'eric', label: 'Eric', detail: 'Smooth and clear' },
  { id: 'alice', label: 'Alice', detail: 'Bright, British' },
  { id: 'george', label: 'George', detail: 'Gentle, British' },
];
export const DEFAULT_TUTOR_VOICE = 'matilda';

export function tutorVoice() {
  try {
    const saved = localStorage.getItem(VOICE_KEY) || '';
    return TUTOR_VOICES.some(voice => voice.id === saved) ? saved : DEFAULT_TUTOR_VOICE;
  } catch { return DEFAULT_TUTOR_VOICE; }
}

export function setTutorVoice(id) {
  try {
    if (id && id !== DEFAULT_TUTOR_VOICE) localStorage.setItem(VOICE_KEY, id);
    else localStorage.removeItem(VOICE_KEY);
  } catch {}
}
