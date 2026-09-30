import { useEffect, useState } from 'react';
import { apiFetch } from './api';

// `uses` must stay accurate: a style changes the Tutor's replies and which view each
// study-guide question's "Learn it your way" panel opens with.
export const STYLE_OPTIONS = [
  {
    id: 'visual', label: 'Visual', hint: 'Diagrams, maps and charts',
    uses: ['Tutor adds a small diagram when an idea has steps or parts', 'Guide questions open a diagram you fill in from memory'],
  },
  {
    id: 'aural', label: 'Listening & talking', hint: 'Hear it explained, then explain it back',
    uses: ['Tutor explains conversationally and asks you to say it back', 'Talk to the Tutor with the mic and hear replies read aloud', 'Guide questions read aloud, and you answer by voice'],
  },
  {
    id: 'read_write', label: 'Reading & writing', hint: 'Notes, definitions and summaries',
    uses: ['Tutor answers with definitions and key-point bullets', 'Guide questions open as notes, key terms and a fill-in summary'],
  },
  {
    id: 'kinesthetic', label: 'Hands-on', hint: 'Real-life examples and applying ideas',
    uses: ['Tutor ties each answer to an everyday example', 'Guide questions give an example, then a situation to apply it'],
  },
  {
    id: 'multimodal', label: 'A mix', hint: 'Diagrams plus real-life examples',
    uses: ['Tutor pairs a short explanation with an example and a diagram', 'Guide questions show a diagram and an example together'],
  },
];

export const AID_TABS = [
  { id: 'mix', label: 'Mix' },
  { id: 'visual', label: 'Diagram' },
  { id: 'aural', label: 'Listen' },
  { id: 'read_write', label: 'Notes' },
  { id: 'kinesthetic', label: 'Real life' },
];

export function defaultAidTab(style) {
  if (style === 'multimodal') return 'mix';
  return AID_TABS.some(tab => tab.id === style) ? style : 'visual';
}

export function useLearningStyle() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let active = true;
    apiFetch('/learning-style').then(data => {
      if (active) setState(data && typeof data.enabled === 'boolean' ? data : { enabled: false, style: null, prompted: true });
    });
    return () => { active = false; };
  }, []);

  async function saveStyle(style) {
    const data = await apiFetch('/learning-style', { method: 'PUT', body: JSON.stringify({ style }) });
    if (data && typeof data.enabled === 'boolean') setState(data);
    return data;
  }

  return { learningStyle: state, saveStyle };
}
