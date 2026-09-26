import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export const STYLE_OPTIONS = [
  { id: 'visual', label: 'Visual', hint: 'Diagrams, maps and charts' },
  { id: 'aural', label: 'Listening & talking', hint: 'Hear it explained, then explain it back' },
  { id: 'read_write', label: 'Reading & writing', hint: 'Notes, definitions and summaries' },
  { id: 'kinesthetic', label: 'Hands-on', hint: 'Real-life examples and applying ideas' },
  { id: 'multimodal', label: 'A mix', hint: 'Diagrams plus real-life examples' },
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
